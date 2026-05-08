/**
 * use-chat-tts — bridges LLM streaming chat responses to TTS playback.
 *
 * Watches an actively streaming assistant message, buffers text at sentence
 * boundaries, converts each sentence from markdown to speech-friendly text,
 * and forwards each chunk to ``ttsActions.speakText()`` which owns all
 * playback (single source of truth).
 *
 * Critical design rule: this hook never plays audio itself. The Web Audio
 * scheduler in ``use-tts.ts`` is the only playback path, so two simultaneous
 * read-aloud attempts cannot collide.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { parseMarkdownToText } from "@/lib/parse-markdown-for-speech";
import { loadSettings } from "@/lib/settings";
import { logError } from "@/lib/error-reporting";
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

  // Keep ttsActions in a ref so callbacks always see the current reference
  const ttsActionsRef = useRef(ttsActions);
  ttsActionsRef.current = ttsActions;

  // Read-aloud only runs when ttsActions is available and the AudioContext
  // path is functional. We don't keep a fallback queue — callers see an error
  // via ttsActions.lastError if synthesis fails.
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

  /**
   * Speak a single chunk via the shared TTS actions.
   * Errors are logged but not propagated; the streaming UI continues to flow.
   */
  const _speakChunk = useCallback(
    async (text: string, signal: AbortSignal) => {
      if (!text.trim() || signal.aborted) return;
      const speechText = parseMarkdownToText(text);
      if (!speechText.trim()) return;

      const actions = ttsActionsRef.current;
      if (!actions) return;

      try {
        await actions.speakText(
          speechText,
          chatVoiceRef.current || undefined,
          chatSpeedRef.current || undefined,
          signal,
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          logError("chat-tts", "speak chunk", e);
        }
      }
    },
    [],
  );

  // Watch the streaming message content; when a sentence terminator appears
  // and the buffer is long enough, dispatch the chunk for synthesis.
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
        void _speakChunk(buf, abort.signal);
      }
    } else {
      pendingBufferRef.current = buf;
    }
  }, [activeMessage?.content, activeMessage?.isStreaming, _speakChunk]);

  // When the LLM stream ends, flush whatever short tail remains so we never
  // drop the last few words.
  useEffect(() => {
    if (!readAloudActiveRef.current) return;
    if (llmIsStreaming) return;

    const remaining = pendingBufferRef.current;
    pendingBufferRef.current = "";

    const finalize = () => {
      readAloudActiveRef.current = false;
      // ttsActions.playbackState will flip to "idle" when audio drains, but
      // our local "currently dispatching chunks" flag is done now.
    };

    if (remaining.trim()) {
      const abort = abortRef.current;
      if (abort && !abort.signal.aborted) {
        _speakChunk(remaining, abort.signal).finally(finalize);
        return;
      }
    }
    finalize();
  }, [llmIsStreaming, _speakChunk]);

  /** Hard stop — abort outstanding fetches and tear down the audio. */
  const stopReadAloud = useCallback(() => {
    readAloudActiveRef.current = false;

    abortRef.current?.abort();
    abortRef.current = null;

    ttsActionsRef.current?.stopAudio();

    sentIndexRef.current = 0;
    pendingBufferRef.current = "";
    setIsReadingAloud(false);
    setIsPaused(false);
  }, []);

  const pauseReadAloud = useCallback(() => {
    ttsActionsRef.current?.pauseAudio();
    setIsPaused(true);
  }, []);

  const resumeReadAloud = useCallback(() => {
    ttsActionsRef.current?.resumeAudio();
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
        _speakChunk(messageContent, abort.signal).finally(() => {
          readAloudActiveRef.current = false;
        });
      } else {
        sentIndexRef.current = activeMessage?.content.length ?? 0;
        pendingBufferRef.current = "";
      }
    },
    [activeMessage, stopReadAloud, _speakChunk],
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
        readAloudActiveRef.current = false;
        setIsReadingAloud(false);
        return;
      }

      const actions = ttsActionsRef.current;
      if (!actions) {
        readAloudActiveRef.current = false;
        setIsReadingAloud(false);
        return;
      }

      actions
        .speakText(
          speechText,
          chatVoiceRef.current || undefined,
          chatSpeedRef.current || undefined,
          abort.signal,
        )
        .catch((e) => {
          if ((e as Error).name !== "AbortError") {
            logError("chat-tts", "readCompleteMessage", e);
          }
        })
        .finally(() => {
          readAloudActiveRef.current = false;
        });
    },
    [stopReadAloud],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      ttsActionsRef.current?.stopAudio();
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
