/**
 * use-chat-tts — bridges LLM streaming chat responses to TTS playback.
 *
 * Watches an actively streaming assistant message, buffers text at sentence
 * boundaries, converts each sentence from markdown to speech-friendly text,
 * and sends it to the TTS streaming pipeline for near-realtime read-aloud.
 *
 * Usage:
 *   const chatTts = useChatTts(ttsActions, activeMessage, isStreaming);
 *   chatTts.readCompleteMessage(content);  // begin reading a complete message
 *   chatTts.stopReadAloud();              // immediately stop
 *   chatTts.pauseReadAloud();             // pause mid-playback
 *   chatTts.resumeReadAloud();            // resume from where we paused
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { parseMarkdownToText } from "@/lib/parse-markdown-for-speech";
import { synthesizeStream } from "@/lib/tts/api";
import { loadSettings } from "@/lib/settings";
import type { UseTtsActions } from "./use-tts";

interface ChatMessage {
  id: string;
  content: string;
  isStreaming?: boolean;
}

const SENTENCE_END = /[.!?;]\s*$/;
const MIN_CHUNK_LEN = 30;

export interface UseChatTtsReturn {
  isReadingAloud: boolean;
  isPaused: boolean;
  startReadAloud: (messageContent?: string) => void;
  stopReadAloud: () => void;
  pauseReadAloud: () => void;
  resumeReadAloud: () => void;
  readCompleteMessage: (content: string) => void;
}

export function useChatTts(
  ttsActions: UseTtsActions | null,
  activeMessage: ChatMessage | null,
  llmIsStreaming: boolean,
): UseChatTtsReturn {
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const readAloudActiveRef = useRef(false);
  const sentIndexRef = useRef(0);
  const pendingBufferRef = useRef("");
  // Keep ttsActions in a ref so stopReadAloud always has the current reference
  const ttsActionsRef = useRef(ttsActions);
  ttsActionsRef.current = ttsActions;

  // ── Fallback queue player (when ttsActions.speakText is unavailable) ────
  // Used for streaming-mode sentence-by-sentence playback.
  // When readCompleteMessage uses speakText, the AudioContext in use-tts.ts
  // handles everything — we just need to track state here.
  const audioQueueRef = useRef<Blob[]>([]);
  const isPlayingRef = useRef(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const prevUrlRef = useRef<string | null>(null);
  const chatVoiceRef = useRef<string>("");
  const chatSpeedRef = useRef<number>(0);

  useEffect(() => {
    loadSettings().then((s) => {
      chatVoiceRef.current = s.ttsChatVoice || s.ttsDefaultVoice;
      chatSpeedRef.current = s.ttsChatSpeed || s.ttsDefaultSpeed;
    });
    const onChanged = () => {
      loadSettings().then((s) => {
        chatVoiceRef.current = s.ttsChatVoice || s.ttsDefaultVoice;
        chatSpeedRef.current = s.ttsChatSpeed || s.ttsDefaultSpeed;
      });
    };
    window.addEventListener("matrx-settings-changed", onChanged);
    return () =>
      window.removeEventListener("matrx-settings-changed", onChanged);
  }, []);

  const _playNextInQueue = useCallback(() => {
    if (isPlayingRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) {
      if (!readAloudActiveRef.current) {
        setIsReadingAloud(false);
        setIsPaused(false);
      }
      return;
    }

    isPlayingRef.current = true;
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    if (audioElRef.current) audioElRef.current.pause();

    const url = URL.createObjectURL(next);
    prevUrlRef.current = url;

    const audio = new Audio(url);
    audioElRef.current = audio;
    audio.onended = () => {
      isPlayingRef.current = false;
      _playNextInQueue();
    };
    audio.onerror = () => {
      isPlayingRef.current = false;
      _playNextInQueue();
    };
    audio.play().catch(() => {
      isPlayingRef.current = false;
      _playNextInQueue();
    });
  }, []);

  const _synthesizeChunk = useCallback(
    async (text: string, signal: AbortSignal) => {
      if (!text.trim()) return;
      const speechText = parseMarkdownToText(text);
      if (!speechText.trim()) return;

      try {
        const gen = synthesizeStream(
          {
            text: speechText,
            voice_id: chatVoiceRef.current || undefined,
            speed: chatSpeedRef.current || undefined,
          },
          signal,
        );
        for await (const wavBlob of gen) {
          if (signal.aborted) break;
          audioQueueRef.current.push(wavBlob);
          _playNextInQueue();
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          console.warn("[chat-tts] Synthesis error:", e);
        }
      }
    },
    [_playNextInQueue],
  );

  useEffect(() => {
    if (!readAloudActiveRef.current || !activeMessage?.isStreaming) return;

    const content = activeMessage.content;
    const newText = content.slice(sentIndexRef.current);
    if (!newText) return;

    const buf = pendingBufferRef.current + newText;
    sentIndexRef.current = content.length;

    if (buf.length >= MIN_CHUNK_LEN && SENTENCE_END.test(buf)) {
      pendingBufferRef.current = "";
      const abort = abortRef.current;
      if (abort && !abort.signal.aborted) {
        _synthesizeChunk(buf, abort.signal);
      }
    } else {
      pendingBufferRef.current = buf;
    }
  }, [activeMessage?.content, activeMessage?.isStreaming, _synthesizeChunk]);

  useEffect(() => {
    if (!readAloudActiveRef.current) return;
    if (llmIsStreaming) return;

    const remaining = pendingBufferRef.current;
    if (remaining.trim()) {
      pendingBufferRef.current = "";
      const abort = abortRef.current;
      if (abort && !abort.signal.aborted) {
        _synthesizeChunk(remaining, abort.signal).then(() => {
          readAloudActiveRef.current = false;
        });
      }
    } else {
      readAloudActiveRef.current = false;
    }
  }, [llmIsStreaming, _synthesizeChunk]);

  /**
   * Hard stop — aborts fetch, stops the shared AudioContext (via ttsActions),
   * clears the fallback queue, and resets all state.
   */
  const stopReadAloud = useCallback(() => {
    readAloudActiveRef.current = false;

    // Abort the synthesis fetch stream
    abortRef.current?.abort();
    abortRef.current = null;

    // Stop the AudioContext nodes that are already scheduled (the main path)
    ttsActionsRef.current?.stopAudio();

    // Also stop the fallback queue player
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = "";
      audioElRef.current = null;
    }
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }

    sentIndexRef.current = 0;
    pendingBufferRef.current = "";
    setIsReadingAloud(false);
    setIsPaused(false);
  }, []);

  /**
   * Pause — suspends the AudioContext mid-playback. Position is preserved.
   */
  const pauseReadAloud = useCallback(() => {
    ttsActionsRef.current?.pauseAudio();
    // Also pause fallback <audio> element if active
    if (audioElRef.current && !audioElRef.current.paused) {
      audioElRef.current.pause();
    }
    setIsPaused(true);
  }, []);

  /**
   * Resume — unsuspends the AudioContext. Playback continues from exact position.
   */
  const resumeReadAloud = useCallback(() => {
    ttsActionsRef.current?.resumeAudio();
    // Also resume fallback <audio> element if it was paused mid-play
    if (
      audioElRef.current &&
      audioElRef.current.paused &&
      audioElRef.current.currentTime > 0
    ) {
      audioElRef.current.play().catch(() => {});
    }
    setIsPaused(false);
  }, []);

  const startReadAloud = useCallback(
    (messageContent?: string) => {
      stopReadAloud();

      const abort = new AbortController();
      abortRef.current = abort;
      readAloudActiveRef.current = true;
      setIsReadingAloud(true);
      setIsPaused(false);

      if (messageContent) {
        sentIndexRef.current = messageContent.length;
        _synthesizeChunk(messageContent, abort.signal).then(() => {
          readAloudActiveRef.current = false;
        });
      } else {
        sentIndexRef.current = activeMessage?.content.length ?? 0;
        pendingBufferRef.current = "";
      }
    },
    [activeMessage, stopReadAloud, _synthesizeChunk],
  );

  const readCompleteMessage = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      stopReadAloud();

      const abort = new AbortController();
      abortRef.current = abort;
      readAloudActiveRef.current = true;
      setIsReadingAloud(true);
      setIsPaused(false);

      const speechText = parseMarkdownToText(content);
      if (!speechText.trim()) {
        setIsReadingAloud(false);
        return;
      }

      if (ttsActionsRef.current) {
        ttsActionsRef.current
          .speakText(
            speechText,
            chatVoiceRef.current || undefined,
            chatSpeedRef.current || undefined,
            abort.signal,
          )
          .finally(() => {
            readAloudActiveRef.current = false;
            // speakText is fire-and-forget — playbackState in use-tts will
            // flip to idle once the AudioContext nodes finish playing.
          });
      } else {
        _synthesizeChunk(content, abort.signal).then(() => {
          readAloudActiveRef.current = false;
        });
      }
    },
    [stopReadAloud, _synthesizeChunk],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      ttsActionsRef.current?.stopAudio();
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      if (audioElRef.current) audioElRef.current.pause();
    };
  }, []);

  return {
    isReadingAloud,
    isPaused,
    startReadAloud,
    stopReadAloud,
    pauseReadAloud,
    resumeReadAloud,
    readCompleteMessage,
  };
}
