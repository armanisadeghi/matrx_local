/**
 * use-chat-tts — bridges LLM streaming chat responses to TTS playback.
 *
 * Watches an actively streaming assistant message, buffers text at sentence
 * boundaries, converts each sentence from markdown to speech-friendly text,
 * and sends it to the TTS streaming pipeline for near-realtime read-aloud.
 *
 * Usage:
 *   const chatTts = useChatTts(ttsActions, activeMessage, isStreaming);
 *   chatTts.startReadAloud();   // begin reading the current message
 *   chatTts.stopReadAloud();    // stop
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
  startReadAloud: (messageContent?: string) => void;
  stopReadAloud: () => void;
  readCompleteMessage: (content: string) => void;
}

export function useChatTts(
  ttsActions: UseTtsActions | null,
  activeMessage: ChatMessage | null,
  llmIsStreaming: boolean,
): UseChatTtsReturn {
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const readAloudActiveRef = useRef(false);
  const sentIndexRef = useRef(0);
  const pendingBufferRef = useRef("");
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

  const stopReadAloud = useCallback(() => {
    readAloudActiveRef.current = false;
    abortRef.current?.abort();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    sentIndexRef.current = 0;
    pendingBufferRef.current = "";
    setIsReadingAloud(false);
  }, []);

  const startReadAloud = useCallback(
    (messageContent?: string) => {
      stopReadAloud();

      const abort = new AbortController();
      abortRef.current = abort;
      readAloudActiveRef.current = true;
      setIsReadingAloud(true);

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

      const speechText = parseMarkdownToText(content);
      if (!speechText.trim()) {
        setIsReadingAloud(false);
        return;
      }

      if (ttsActions) {
        ttsActions
          .speakText(
            speechText,
            chatVoiceRef.current || undefined,
            chatSpeedRef.current || undefined,
            abort.signal,
          )
          .finally(() => {
            readAloudActiveRef.current = false;
          });
      } else {
        _synthesizeChunk(content, abort.signal).then(() => {
          readAloudActiveRef.current = false;
        });
      }
    },
    [ttsActions, stopReadAloud, _synthesizeChunk],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      if (audioElRef.current) audioElRef.current.pause();
    };
  }, []);

  return {
    isReadingAloud,
    startReadAloud,
    stopReadAloud,
    readCompleteMessage,
  };
}
