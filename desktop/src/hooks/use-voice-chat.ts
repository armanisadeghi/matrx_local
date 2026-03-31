/**
 * use-voice-chat
 *
 * Owns the voice-chat state machine for the Local Models inference tab.
 *
 * Phases:
 *   idle        — waiting; user can click mic or speak after wake word
 *   recording   — Whisper is capturing audio
 *   processing  — mic stopped, Rust flushing remaining audio buffers
 *   transcribed — transcript ready; waiting for user to click Send (manual mode)
 *   generating  — LLM is streaming a response
 *   speaking    — TTS is playing the response audio
 *
 * Two submission modes (controlled by `autoMode`):
 *   Manual   — user clicks Send to submit; TTS auto-plays the response.
 *   Auto     — silence detection auto-submits; TTS auto-plays; recording
 *              restarts automatically for the next turn.
 *
 * Barge-in (auto mode only):
 *   While TTS is playing, if liveRms exceeds BARGE_IN_THRESHOLD the
 *   response audio is cut and recording restarts immediately.
 *
 * The caller is responsible for providing `handleSend` from the inference
 * component and the TTS `chatTts` instance. The hook does not own LLM state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TranscriptionState,
  TranscriptionActions,
} from "./use-transcription";
import type { UseChatTtsReturn } from "./use-chat-tts";
import type { TtsPlaybackState } from "./use-tts";

export type VoiceChatPhase =
  | "idle"
  | "recording"
  | "processing"
  | "transcribed"
  | "generating"
  | "speaking";

export interface VoiceChatState {
  phase: VoiceChatPhase;
  isActive: boolean; // voice chat panel is open
  autoMode: boolean; // auto-submit + auto-restart on silence
  pendingTranscript: string; // transcript accumulated in this turn
  sessionBaseTranscript: string; // transcript base at session start (for delta display)
}

export interface VoiceChatActions {
  /** Open the voice chat panel. */
  activate: () => void;
  /** Close the panel and hard-stop everything. */
  deactivate: () => void;
  /** Toggle recording on/off. */
  toggleRecording: () => void;
  /** Manually submit the pending transcript. */
  sendPendingTranscript: () => void;
  /** Stop the TTS response mid-playback. */
  stopSpeaking: () => void;
  /** Toggle auto-mode on/off. */
  setAutoMode: (on: boolean) => void;
  /** Clear the pending transcript without sending. */
  clearTranscript: () => void;
}

// How long (ms) after the last whisper-segment with no new ones before
// we treat it as end-of-speech and auto-submit.
const SILENCE_TIMEOUT_MS = 1400;

// liveRms threshold to detect barge-in while TTS is playing.
const BARGE_IN_THRESHOLD = 0.012;

interface UseVoiceChatOptions {
  /** The transcription singleton's state. */
  transcriptionState: TranscriptionState;
  /** The transcription singleton's actions. */
  transcriptionActions: TranscriptionActions;
  /** The chat-TTS hook instance. */
  chatTts: UseChatTtsReturn;
  /** Current TTS playback state from use-tts. */
  ttsPlaybackState: TtsPlaybackState;
  /**
   * Called to submit a message. Mirrors LocalModels' handleSend but accepts
   * an optional text override (so we can inject the transcript).
   */
  onSend: (text: string) => void;
  /**
   * Called when the LLM finishes generating and TTS should start.
   * Supply the content to speak. The hook calls this; LocalModels provides it.
   * Return false if no content is available (hook will go back to idle).
   */
  onStartTts: () => string | null;
  /** Whether the LLM is currently generating. */
  isGenerating: boolean;
  /** Whether the transcription model is ready (activeModel !== null). */
  modelReady: boolean;
}

export function useVoiceChat({
  transcriptionState,
  transcriptionActions,
  chatTts,
  ttsPlaybackState,
  onSend,
  onStartTts,
  isGenerating,
  modelReady,
}: UseVoiceChatOptions): [VoiceChatState, VoiceChatActions] {
  const [isActive, setIsActive] = useState(false);
  const [autoMode, setAutoModeState] = useState(false);
  const [phase, setPhase] = useState<VoiceChatPhase>("idle");
  const [pendingTranscript, setPendingTranscript] = useState("");

  // Track the segment count we last saw so we can detect new arrivals
  const lastSegmentCountRef = useRef(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Transcript that was committed at the start of this recording session
  const sessionBaseTranscriptRef = useRef("");
  // Prevent double-send on auto-mode
  const autoSendFiredRef = useRef(false);
  // Whether we started this recording ourselves (vs. external)
  const weStartedRef = useRef(false);
  // Prevent barge-in rapid re-triggering
  const bargeInCooldownRef = useRef(false);
  // Track previous isGenerating to detect transition to false
  const prevIsGeneratingRef = useRef(false);

  // ── Stable refs so effects don't re-run on every parent render ────────────

  // Keep chatTts in a ref — its identity changes every render, so reading
  // it inside setTimeouts / effects via this ref avoids stale closures.
  const chatTtsRef = useRef(chatTts);
  chatTtsRef.current = chatTts;

  // Same pattern for onStartTts.
  const onStartTtsRef = useRef(onStartTts);
  onStartTtsRef.current = onStartTts;

  // Same for onSend.
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  // Keep autoMode readable from within callbacks without stale closure.
  const autoModeRef = useRef(autoMode);
  autoModeRef.current = autoMode;

  // Timers we need to cancel on unmount or deactivate.
  const ttsStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const bargeInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Stable helper: startRecordingSession ──────────────────────────────────
  // Kept in a ref so effects/callbacks always call the latest version without
  // needing it in their dep arrays (which would cause spurious re-runs).
  const startRecordingSessionRef = useRef<(() => Promise<void>) | null>(null);
  const startRecordingSession = useCallback(async () => {
    if (!modelReady) return;
    // Snapshot the current transcript as the base for delta extraction
    sessionBaseTranscriptRef.current = transcriptionState.fullTranscript;
    lastSegmentCountRef.current = transcriptionState.segments.length;
    autoSendFiredRef.current = false;
    weStartedRef.current = true;
    setPendingTranscript("");
    await transcriptionActions.startRecording();
  }, [
    modelReady,
    transcriptionState.fullTranscript,
    transcriptionState.segments.length,
    transcriptionActions,
  ]);
  startRecordingSessionRef.current = startRecordingSession;

  const stopRecordingSession = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    weStartedRef.current = false;
    transcriptionActions.stopRecording();
  }, [transcriptionActions]);

  // ── Sync phase with external transcription state ───────────────────────────
  //
  // We use a single effect but handle the three transitions sequentially by
  // checking phase explicitly.  This avoids the problem of two transitions
  // being skipped when React batches multiple state updates into one render.
  //
  // The key insight: we always move forward ONE step per render:
  //   recording   → processing   (isRecording just became false, tail active)
  //   recording   → transcribed  (isRecording false AND no tail — same render)
  //   processing  → transcribed  (tail just finished)
  //
  // The third case (no tail) is now handled: if isProcessingTail is already
  // false when recording stops (Rust reports them atomically), we skip
  // "processing" and go directly to "transcribed"/"idle".

  useEffect(() => {
    if (!isActive) return;

    // Recording started
    if (transcriptionState.isRecording && phase !== "recording") {
      setPhase("recording");
      autoSendFiredRef.current = false;
      return;
    }

    // Recording stopped — handle both: with and without a processing tail
    if (!transcriptionState.isRecording && phase === "recording") {
      if (transcriptionState.isProcessingTail) {
        setPhase("processing");
      } else {
        // Rust reported both flags false in the same batch — skip "processing"
        const newTranscript = transcriptionState.fullTranscript
          .slice(sessionBaseTranscriptRef.current.length)
          .trim();
        setPendingTranscript(newTranscript);

        if (autoModeRef.current && newTranscript && !autoSendFiredRef.current) {
          autoSendFiredRef.current = true;
          setPhase("generating");
          onSendRef.current(newTranscript);
        } else if (newTranscript) {
          setPhase("transcribed");
        } else {
          setPhase("idle");
        }
      }
      return;
    }

    // Processing tail finished → transcribed (or idle if nothing was captured)
    if (
      !transcriptionState.isRecording &&
      !transcriptionState.isProcessingTail &&
      phase === "processing"
    ) {
      const newTranscript = transcriptionState.fullTranscript
        .slice(sessionBaseTranscriptRef.current.length)
        .trim();
      setPendingTranscript(newTranscript);

      if (autoModeRef.current && newTranscript && !autoSendFiredRef.current) {
        autoSendFiredRef.current = true;
        setPhase("generating");
        onSendRef.current(newTranscript);
      } else if (newTranscript) {
        setPhase("transcribed");
      } else {
        setPhase("idle");
      }
    }
  }, [
    isActive,
    transcriptionState.isRecording,
    transcriptionState.isProcessingTail,
    transcriptionState.fullTranscript,
    phase,
  ]);

  // ── Track LLM generating → done ──────────────────────────────────────────

  useEffect(() => {
    if (!isActive) return;
    const wasGenerating = prevIsGeneratingRef.current;
    prevIsGeneratingRef.current = isGenerating;

    if (wasGenerating && !isGenerating && phase === "generating") {
      // Generation just finished — ask the parent for the content to read aloud.
      // Use a small delay so React has time to commit the final message update
      // (isStreaming flag cleared) before we read it.
      if (ttsStartTimerRef.current) clearTimeout(ttsStartTimerRef.current);
      ttsStartTimerRef.current = setTimeout(() => {
        ttsStartTimerRef.current = null;
        const content = onStartTtsRef.current();
        if (content) {
          chatTtsRef.current.readCompleteMessage(content);
          setPhase("speaking");
        } else {
          setPhase("idle");
        }
      }, 80);
    }
  }, [isActive, isGenerating, phase]);

  // ── Track TTS done → restart recording (auto mode) ────────────────────────

  useEffect(() => {
    if (!isActive || !autoMode) return;
    if (phase === "speaking" && ttsPlaybackState === "idle") {
      // TTS finished naturally — restart for next turn
      setPhase("idle");
      void startRecordingSessionRef.current?.();
    }
  }, [isActive, autoMode, phase, ttsPlaybackState]);

  // ── Silence detection (auto mode) ─────────────────────────────────────────

  useEffect(() => {
    if (!isActive || !autoMode || phase !== "recording") return;

    const newCount = transcriptionState.segments.length;
    if (newCount <= lastSegmentCountRef.current) return;
    lastSegmentCountRef.current = newCount;

    // New segment arrived — reset the silence timer
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      // No new segment for SILENCE_TIMEOUT_MS → stop and submit
      if (
        transcriptionState.isRecording &&
        autoModeRef.current &&
        !autoSendFiredRef.current
      ) {
        transcriptionActions.stopRecording();
      }
    }, SILENCE_TIMEOUT_MS);
  }, [
    isActive,
    autoMode,
    phase,
    transcriptionState.segments,
    transcriptionState.isRecording,
    transcriptionActions,
  ]);

  // ── Barge-in detection (auto mode) ────────────────────────────────────────

  useEffect(() => {
    if (!isActive || !autoMode) return;
    if (phase !== "speaking") return;
    if (ttsPlaybackState === "idle") return;
    if (bargeInCooldownRef.current) return;

    if (transcriptionState.liveRms > BARGE_IN_THRESHOLD) {
      bargeInCooldownRef.current = true;
      chatTtsRef.current.stopReadAloud();
      setPhase("idle");
      // Brief cooldown before restarting mic so we don't capture the audio artifact
      if (bargeInTimerRef.current) clearTimeout(bargeInTimerRef.current);
      bargeInTimerRef.current = setTimeout(() => {
        bargeInTimerRef.current = null;
        bargeInCooldownRef.current = false;
        void startRecordingSessionRef.current?.();
      }, 300);
    }
  }, [isActive, autoMode, phase, ttsPlaybackState, transcriptionState.liveRms]);

  // ── Public actions ────────────────────────────────────────────────────────

  const activate = useCallback(() => {
    setIsActive(true);
    setPhase("idle");
    setPendingTranscript("");
  }, []);

  const deactivate = useCallback(() => {
    // Cancel all pending timers
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (ttsStartTimerRef.current) clearTimeout(ttsStartTimerRef.current);
    if (stopSpeakingTimerRef.current)
      clearTimeout(stopSpeakingTimerRef.current);
    if (bargeInTimerRef.current) clearTimeout(bargeInTimerRef.current);

    // Stop anything in progress
    if (transcriptionState.isRecording) transcriptionActions.stopRecording();
    chatTtsRef.current.stopReadAloud();
    setIsActive(false);
    setPhase("idle");
    setPendingTranscript("");
    weStartedRef.current = false;
    autoSendFiredRef.current = false;
  }, [transcriptionState.isRecording, transcriptionActions]);

  const toggleRecording = useCallback(() => {
    if (transcriptionState.isRecording || transcriptionState.isProcessingTail) {
      stopRecordingSession();
    } else {
      void startRecordingSession();
    }
  }, [
    transcriptionState.isRecording,
    transcriptionState.isProcessingTail,
    startRecordingSession,
    stopRecordingSession,
  ]);

  const sendPendingTranscript = useCallback(() => {
    if (!pendingTranscript.trim()) return;
    const text = pendingTranscript.trim();
    setPendingTranscript("");
    setPhase("generating");
    onSendRef.current(text);
  }, [pendingTranscript]);

  const stopSpeaking = useCallback(() => {
    chatTtsRef.current.stopReadAloud();
    setPhase("idle");
    if (autoModeRef.current) {
      // Give 400ms before restarting so the user doesn't get confused
      if (stopSpeakingTimerRef.current)
        clearTimeout(stopSpeakingTimerRef.current);
      stopSpeakingTimerRef.current = setTimeout(() => {
        stopSpeakingTimerRef.current = null;
        void startRecordingSessionRef.current?.();
      }, 400);
    }
  }, []);

  const setAutoMode = useCallback((on: boolean) => {
    setAutoModeState(on);
  }, []);

  const clearTranscript = useCallback(() => {
    setPendingTranscript("");
    if (phase === "transcribed") setPhase("idle");
  }, [phase]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (ttsStartTimerRef.current) clearTimeout(ttsStartTimerRef.current);
      if (stopSpeakingTimerRef.current)
        clearTimeout(stopSpeakingTimerRef.current);
      if (bargeInTimerRef.current) clearTimeout(bargeInTimerRef.current);
    };
  }, []);

  const state: VoiceChatState = {
    phase,
    isActive,
    autoMode,
    pendingTranscript,
    sessionBaseTranscript: sessionBaseTranscriptRef.current,
  };

  const actions: VoiceChatActions = {
    activate,
    deactivate,
    toggleRecording,
    sendPendingTranscript,
    stopSpeaking,
    setAutoMode,
    clearTranscript,
  };

  return [state, actions];
}
