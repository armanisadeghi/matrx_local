import { useState, useCallback, useRef, useEffect } from "react";
import type { TtsStatus, TtsVoice, TtsLanguageGroup } from "@/lib/tts/types";
import {
  getTtsStatus,
  getTtsVoices,
  downloadTtsModel,
  synthesize,
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

export interface UseTtsState {
  status: TtsStatus | null;
  voices: TtsVoice[];
  languageGroups: TtsLanguageGroup[];
  selectedVoice: string;
  speed: number;
  isSynthesizing: boolean;
  isDownloading: boolean;
  isPreviewPlaying: string | null;
  currentAudioUrl: string | null;
  currentDuration: number;
  currentElapsed: number;
  history: TtsHistoryEntry[];
  error: string | null;
}

export interface UseTtsActions {
  refreshStatus: () => Promise<void>;
  refreshVoices: () => Promise<void>;
  downloadModel: () => Promise<void>;
  setSelectedVoice: (voiceId: string) => void;
  setSpeed: (speed: number) => void;
  speak: (text: string) => Promise<void>;
  preview: (voiceId: string) => Promise<void>;
  stopAudio: () => void;
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
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState<string | null>(null);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [currentElapsed, setCurrentElapsed] = useState(0);
  const [history, setHistory] = useState<TtsHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevAudioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (prevAudioUrlRef.current) {
        URL.revokeObjectURL(prevAudioUrlRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

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

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPreviewPlaying(null);
  }, []);

  const playBlob = useCallback(
    (blob: Blob, onEnd?: () => void): string => {
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
        onEnd?.();
      };
      audio.onerror = () => {
        onEnd?.();
      };
      audio.play().catch(() => onEnd?.());
      return url;
    },
    [],
  );

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setIsSynthesizing(true);
      setError(null);
      stopAudio();

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
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsSynthesizing(false);
      }
    },
    [selectedVoice, speed, voices, playBlob, stopAudio],
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
    isSynthesizing,
    isDownloading,
    isPreviewPlaying,
    currentAudioUrl,
    currentDuration,
    currentElapsed,
    history,
    error,
  };

  const actions: UseTtsActions = {
    refreshStatus,
    refreshVoices,
    downloadModel,
    setSelectedVoice,
    setSpeed,
    speak,
    preview,
    stopAudio,
    unload,
    clearHistory,
    clearError,
  };

  return [state, actions];
}
