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

  // ── Sync phase with external state ────────────────────────────────────────

  useEffect(() => {
    if (!isActive) return;

    // Recording started
    if (transcriptionState.isRecording && phase !== "recording") {
      setPhase("recording");
      autoSendFiredRef.current = false;
    }

    // Recording stopped → processing tail
    if (
      !transcriptionState.isRecording &&
      transcriptionState.isProcessingTail &&
      phase === "recording"
    ) {
      setPhase("processing");
    }

    // Tail done → transcribed (or idle if nothing was captured)
    if (
      !transcriptionState.isRecording &&
      !transcriptionState.isProcessingTail &&
      phase === "processing"
    ) {
      const newTranscript = transcriptionState.fullTranscript
        .slice(sessionBaseTranscriptRef.current.length)
        .trim();
      setPendingTranscript(newTranscript);

      if (autoMode && newTranscript && !autoSendFiredRef.current) {
        autoSendFiredRef.current = true;
        setPhase("generating");
        onSend(newTranscript);
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
    autoMode,
    onSend,
  ]);

  // ── Track LLM generating → done ──────────────────────────────────────────

  useEffect(() => {
    if (!isActive) return;
    const wasGenerating = prevIsGeneratingRef.current;
    prevIsGeneratingRef.current = isGenerating;

    if (wasGenerating && !isGenerating && phase === "generating") {
      // Generation just finished — TTS will be started by the parent (VoiceChatBar)
      setPhase("speaking");
    }
  }, [isActive, isGenerating, phase]);

  // ── Track TTS done → restart recording (auto mode) ────────────────────────

  useEffect(() => {
    if (!isActive || !autoMode) return;
    if (phase === "speaking" && ttsPlaybackState === "idle") {
      // TTS finished naturally — restart for next turn
      setPhase("idle");
      void startRecordingSession();
    }
  }, [isActive, autoMode, phase, ttsPlaybackState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Silence detection (auto mode) ─────────────────────────────────────────

  useEffect(() => {
    if (!isActive || !autoMode || phase !== "recording") return;

    const newCount = transcriptionState.segments.length;
    if (newCount <= lastSegmentCountRef.current) return;
    lastSegmentCountRef.current = newCount;

    // New segment arrived — reset the silence timer
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      // No new segment for SILENCE_TIMEOUT_MS → stop and submit
      if (
        transcriptionState.isRecording &&
        autoMode &&
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
      chatTts.stopReadAloud();
      setPhase("idle");
      // Brief cooldown before restarting mic so we don't capture the audio artifact
      setTimeout(() => {
        bargeInCooldownRef.current = false;
        void startRecordingSession();
      }, 300);
    }
  }, [
    isActive,
    autoMode,
    phase,
    ttsPlaybackState,
    transcriptionState.liveRms,
    chatTts,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────

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

  const stopRecordingSession = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    weStartedRef.current = false;
    transcriptionActions.stopRecording();
  }, [transcriptionActions]);

  // ── Public actions ────────────────────────────────────────────────────────

  const activate = useCallback(() => {
    setIsActive(true);
    setPhase("idle");
    setPendingTranscript("");
  }, []);

  const deactivate = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    // Stop anything in progress
    if (transcriptionState.isRecording) transcriptionActions.stopRecording();
    chatTts.stopReadAloud();
    setIsActive(false);
    setPhase("idle");
    setPendingTranscript("");
    weStartedRef.current = false;
    autoSendFiredRef.current = false;
  }, [transcriptionState.isRecording, transcriptionActions, chatTts]);

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
    onSend(text);
  }, [pendingTranscript, onSend]);

  const stopSpeaking = useCallback(() => {
    chatTts.stopReadAloud();
    if (autoMode) {
      setPhase("idle");
      // Give 400ms before restarting so the user doesn't get confused
      setTimeout(() => void startRecordingSession(), 400);
    } else {
      setPhase("idle");
    }
  }, [chatTts, autoMode, startRecordingSession]); // eslint-disable-line react-hooks/exhaustive-deps

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
    };
  }, []);

  const state: VoiceChatState = {
    phase,
    isActive,
    autoMode,
    pendingTranscript,
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
