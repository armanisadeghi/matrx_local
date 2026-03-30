import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { TtsStatus, TtsVoice, TtsLanguageGroup } from "@/lib/tts/types";
import {
  getTtsStatus,
  getTtsVoices,
  downloadTtsModel,
  synthesize,
  synthesizeStream,
  previewVoice,
  unloadTts,
} from "@/lib/tts/api";
import { loadSettings, saveSetting } from "@/lib/settings";

export interface TtsHistoryEntry {
  id: string;
  text: string;
  voiceId: string;
  voiceName: string;
  duration: number;
  elapsed: number;
  audioUrl: string;
  createdAt: number;
}

/**
 * Playback state machine:
 *  idle       — nothing happening
 *  synthesizing — fetch stream open, chunks arriving, audio being scheduled
 *  playing    — synthesis done (or in progress), AudioContext is running
 *  paused     — AudioContext suspended; position preserved
 */
export type TtsPlaybackState = "idle" | "synthesizing" | "playing" | "paused";

export interface UseTtsState {
  status: TtsStatus | null;
  voices: TtsVoice[];
  languageGroups: TtsLanguageGroup[];
  selectedVoice: string;
  speed: number;
  /** @deprecated use playbackState */
  isSynthesizing: boolean;
  isDownloading: boolean;
  isPreviewPlaying: string | null;
  currentAudioUrl: string | null;
  currentDuration: number;
  currentElapsed: number;
  history: TtsHistoryEntry[];
  error: string | null;
  playbackState: TtsPlaybackState;
}

export interface UseTtsActions {
  refreshStatus: () => Promise<void>;
  refreshVoices: () => Promise<void>;
  downloadModel: () => Promise<void>;
  setSelectedVoice: (voiceId: string) => void;
  setSpeed: (speed: number) => void;
  speak: (text: string) => Promise<void>;
  speakStreaming: (text: string) => Promise<void>;
  speakText: (
    text: string,
    voiceId?: string,
    speed?: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  preview: (voiceId: string) => Promise<void>;
  stopAudio: () => void;
  pauseAudio: () => void;
  resumeAudio: () => void;
  unload: () => Promise<void>;
  clearHistory: () => void;
  clearError: () => void;
}

const MAX_HISTORY = 50;

function groupVoicesByLanguage(voices: TtsVoice[]): TtsLanguageGroup[] {
  const map = new Map<string, TtsVoice[]>();
  for (const v of voices) {
    const key = v.language;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(v);
  }
  const groups: TtsLanguageGroup[] = [];
  for (const [language, list] of map) {
    groups.push({
      language,
      lang_code: list[0].lang_code,
      voices: list,
    });
  }
  return groups;
}

export function useTts(): [UseTtsState, UseTtsActions] {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [languageGroups, setLanguageGroups] = useState<TtsLanguageGroup[]>([]);
  const [selectedVoice, setSelectedVoiceState] = useState("af_heart");
  const [speed, setSpeedState] = useState(1.0);

  useEffect(() => {
    loadSettings().then((s) => {
      if (s.ttsDefaultVoice) setSelectedVoiceState(s.ttsDefaultVoice);
      if (s.ttsDefaultSpeed != null) setSpeedState(s.ttsDefaultSpeed);
    });
  }, []);

  const [playbackState, setPlaybackState] = useState<TtsPlaybackState>("idle");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState<string | null>(null);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [currentElapsed, setCurrentElapsed] = useState(0);
  const [history, setHistory] = useState<TtsHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevAudioUrlRef = useRef<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  // AudioContext scheduler for gapless streaming playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  // Counts how many sources are still playing (used to flip to idle)
  const activeSourceCountRef = useRef<number>(0);
  // Set to true when the synthesis stream is fully consumed
  const synthDoneRef = useRef<boolean>(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getTtsStatus();
      setStatus(s);
    } catch (e) {
      console.warn("[use-tts] Status fetch failed:", e);
    }
  }, []);

  const refreshVoices = useCallback(async () => {
    try {
      const v = await getTtsVoices();
      setVoices(v);
      setLanguageGroups(groupVoicesByLanguage(v));
    } catch (e) {
      console.warn("[use-tts] Voices fetch failed:", e);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshVoices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!status?.is_downloading) return;
    const id = setInterval(() => void refreshStatus(), 2000);
    return () => clearInterval(id);
  }, [status?.is_downloading, refreshStatus]);

  useEffect(() => {
    return () => {
      if (prevAudioUrlRef.current) {
        URL.revokeObjectURL(prevAudioUrlRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  const downloadModel = useCallback(async () => {
    setIsDownloading(true);
    setError(null);
    try {
      await downloadTtsModel();
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsDownloading(false);
    }
  }, [refreshStatus]);

  const setSelectedVoice = useCallback((voiceId: string) => {
    setSelectedVoiceState(voiceId);
    saveSetting("ttsDefaultVoice", voiceId);
  }, []);

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
    saveSetting("ttsDefaultSpeed", s);
  }, []);

  /**
   * Hard-stop: abort fetch, stop all scheduled nodes, close AudioContext.
   * Resets to idle immediately.
   */
  const stopAudio = useCallback(() => {
    // 1. Abort the fetch stream so no more chunks arrive
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;

    // 2. Stop all scheduled AudioBufferSourceNodes immediately
    const sources = scheduledSourcesRef.current;
    scheduledSourcesRef.current = [];
    for (const src of sources) {
      try {
        src.onended = null;
        src.stop(0);
      } catch {
        /* already stopped */
      }
    }
    activeSourceCountRef.current = 0;
    synthDoneRef.current = false;
    nextStartTimeRef.current = 0;

    // 3. Close AudioContext (frees all resources)
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }

    // 4. Stop any plain <audio> element (used for non-streaming speak())
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setIsPreviewPlaying(null);
    setPlaybackState("idle");
  }, []);

  /**
   * Pause: suspend the AudioContext so audio stops at current position.
   * The scheduled nodes remain on the timeline; resume() will pick up exactly
   * where we left off because AudioContext.currentTime pauses too.
   */
  const pauseAudio = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state !== "running") return;
    audioCtxRef.current.suspend().catch(() => {});

    // Also pause plain <audio> if active
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }

    setPlaybackState("paused");
  }, []);

  /**
   * Resume: unsuspend the AudioContext; playback continues exactly where paused.
   * If synthesis is still in progress, stay in "synthesizing", otherwise "playing".
   */
  const resumeAudio = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state !== "suspended")
      return;
    audioCtxRef.current.resume().catch(() => {});

    // Also resume plain <audio> if it was the active playback path
    if (
      audioRef.current &&
      audioRef.current.paused &&
      audioRef.current.currentTime > 0
    ) {
      audioRef.current.play().catch(() => {});
    }

    setPlaybackState(synthDoneRef.current ? "playing" : "synthesizing");
  }, []);

  const playBlob = useCallback((blob: Blob, onEnd?: () => void): string => {
    if (prevAudioUrlRef.current) {
      URL.revokeObjectURL(prevAudioUrlRef.current);
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const url = URL.createObjectURL(blob);
    prevAudioUrlRef.current = url;

    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      setPlaybackState("idle");
      onEnd?.();
    };
    audio.onerror = () => {
      setPlaybackState("idle");
      onEnd?.();
    };
    audio.play().catch(() => {
      setPlaybackState("idle");
      onEnd?.();
    });
    return url;
  }, []);

  /**
   * Called when the last AudioBufferSourceNode finishes playing.
   * Transitions to idle only if synthesis is also complete.
   */
  const onAllSourcesEnded = useCallback(() => {
    if (synthDoneRef.current && activeSourceCountRef.current === 0) {
      setPlaybackState("idle");
    }
  }, []);

  /**
   * Schedule a WAV blob for gapless playback using the Web Audio API.
   */
  const scheduleChunk = useCallback(
    async (wavBlob: Blob) => {
      try {
        // Lazy-create a single shared AudioContext for the session
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          audioCtxRef.current = new AudioContext();
          nextStartTimeRef.current = 0;
          scheduledSourcesRef.current = [];
          activeSourceCountRef.current = 0;
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        const arrayBuf = await wavBlob.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);

        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(ctx.destination);

        // Schedule at the end of the previous chunk (or now if first)
        const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
        src.start(startAt);
        nextStartTimeRef.current = startAt + audioBuf.duration;

        activeSourceCountRef.current += 1;
        scheduledSourcesRef.current.push(src);

        src.onended = () => {
          src.onended = null;
          scheduledSourcesRef.current = scheduledSourcesRef.current.filter(
            (s) => s !== src,
          );
          activeSourceCountRef.current = Math.max(
            0,
            activeSourceCountRef.current - 1,
          );
          onAllSourcesEnded();
        };
      } catch (err) {
        // Fallback: plain <audio> element if Web Audio API fails
        console.warn(
          "[use-tts] AudioContext decode failed, falling back:",
          err,
        );
        const url = URL.createObjectURL(wavBlob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setPlaybackState("idle");
        };
        audio.play().catch(() => {
          URL.revokeObjectURL(url);
          setPlaybackState("idle");
        });
      }
    },
    [onAllSourcesEnded],
  );

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      stopAudio();
      setPlaybackState("synthesizing");
      setError(null);

      try {
        const result = await synthesize({
          text,
          voice_id: selectedVoice,
          speed,
        });

        const url = playBlob(result.blob);
        setCurrentAudioUrl(url);
        setCurrentDuration(result.duration);
        setCurrentElapsed(result.elapsed);
        setPlaybackState("playing");

        const voiceObj = voices.find((v) => v.voice_id === selectedVoice);
        const entry: TtsHistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: text.slice(0, 500),
          voiceId: selectedVoice,
          voiceName: voiceObj?.name ?? selectedVoice,
          duration: result.duration,
          elapsed: result.elapsed,
          audioUrl: url,
          createdAt: Date.now(),
        };
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(e instanceof Error ? e.message : String(e));
        }
        setPlaybackState("idle");
      }
    },
    [selectedVoice, speed, voices, playBlob, stopAudio],
  );

  const speakStreaming = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      stopAudio();

      // Reset playback tracking for new session
      synthDoneRef.current = false;
      activeSourceCountRef.current = 0;
      setPlaybackState("synthesizing");
      setError(null);

      const abort = new AbortController();
      streamAbortRef.current = abort;

      const t0 = performance.now();

      try {
        const gen = synthesizeStream(
          { text, voice_id: selectedVoice, speed },
          abort.signal,
        );

        for await (const wavBlob of gen) {
          if (abort.signal.aborted) break;
          await scheduleChunk(wavBlob);
        }

        if (!abort.signal.aborted) {
          const elapsed = (performance.now() - t0) / 1000;
          setCurrentElapsed(elapsed);
          synthDoneRef.current = true;

          // Transition: synthesis stream exhausted; audio may still be playing
          if (activeSourceCountRef.current > 0) {
            setPlaybackState("playing");
          } else {
            setPlaybackState("idle");
          }

          const voiceObj = voices.find((v) => v.voice_id === selectedVoice);
          const entry: TtsHistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text: text.slice(0, 500),
            voiceId: selectedVoice,
            voiceName: voiceObj?.name ?? selectedVoice,
            duration: 0,
            elapsed,
            audioUrl: prevAudioUrlRef.current ?? "",
            createdAt: Date.now(),
          };
          setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(e instanceof Error ? e.message : String(e));
        }
        setPlaybackState("idle");
      }
    },
    [selectedVoice, speed, voices, stopAudio, scheduleChunk],
  );

  const speakText = useCallback(
    async (
      text: string,
      voiceId?: string,
      spd?: number,
      signal?: AbortSignal,
    ) => {
      if (!text.trim()) return;
      const vid = voiceId ?? selectedVoice;
      const s = spd ?? speed;

      streamAbortRef.current?.abort();
      const abort = new AbortController();
      streamAbortRef.current = abort;

      if (signal) {
        signal.addEventListener("abort", () => abort.abort(), { once: true });
      }

      try {
        const gen = synthesizeStream(
          { text, voice_id: vid, speed: s },
          abort.signal,
        );
        for await (const wavBlob of gen) {
          if (abort.signal.aborted) break;
          await scheduleChunk(wavBlob);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          throw e;
        }
      }
    },
    [selectedVoice, speed, scheduleChunk],
  );

  const preview = useCallback(
    async (voiceId: string) => {
      setIsPreviewPlaying(voiceId);
      try {
        const result = await previewVoice(voiceId);
        playBlob(result.blob, () => setIsPreviewPlaying(null));
      } catch (e) {
        setIsPreviewPlaying(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [playBlob],
  );

  const unload = useCallback(async () => {
    try {
      await unloadTts();
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refreshStatus]);

  const clearHistory = useCallback(() => {
    history.forEach((h) => {
      try {
        URL.revokeObjectURL(h.audioUrl);
      } catch {
        // ignore
      }
    });
    setHistory([]);
  }, [history]);

  const clearError = useCallback(() => setError(null), []);

  const state: UseTtsState = {
    status,
    voices,
    languageGroups,
    selectedVoice,
    speed,
    isSynthesizing: playbackState === "synthesizing",
    isDownloading,
    isPreviewPlaying,
    currentAudioUrl,
    currentDuration,
    currentElapsed,
    history,
    error,
    playbackState,
  };

  const actions: UseTtsActions = useMemo(
    () => ({
      refreshStatus,
      refreshVoices,
      downloadModel,
      setSelectedVoice,
      setSpeed,
      speak,
      speakStreaming,
      speakText,
      preview,
      stopAudio,
      pauseAudio,
      resumeAudio,
      unload,
      clearHistory,
      clearError,
    }),
    [
      refreshStatus,
      refreshVoices,
      downloadModel,
      setSelectedVoice,
      setSpeed,
      speak,
      speakStreaming,
      speakText,
      preview,
      stopAudio,
      pauseAudio,
      resumeAudio,
      unload,
      clearHistory,
      clearError,
    ],
  );

  return [state, actions];
}
