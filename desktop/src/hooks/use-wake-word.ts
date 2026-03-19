/**
 * useWakeWord — manages the on-device wake word detection subsystem.
 *
 * State machine:
 *   idle      — KWS not started (model not downloaded or never started)
 *   listening — actively detecting the wake word
 *   muted     — thread running but deliberately ignoring audio
 *   dismissed — user dismissed a false trigger; auto-reverts after 10 s
 *   active    — wake word was detected; transcription is live; overlay shown
 *   setup     — KWS model is being downloaded
 *
 * The hook drives two parallel things:
 *   1. The Rust wake-word background thread (via Tauri IPC)
 *   2. The active-transcription session (delegates to useTranscription actions)
 *
 * When "wake-word-detected" fires, the hook:
 *   - Transitions to "active" state
 *   - Starts the Whisper transcription session
 *   - After ACTIVE_TIMEOUT_MS of silence it auto-stops transcription and
 *     returns to "listening"
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { isTauri } from "@/lib/sidecar";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { WakeWordMode, WakeWordDetectedEvent } from "@/lib/transcription/types";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

async function listen<T>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<T>(event, handler);
}

// How long after waking before auto-dismissing (if user says nothing)
const ACTIVE_TIMEOUT_MS = 30_000;

// ── Public interface ──────────────────────────────────────────────────────────

export type WakeWordUIMode =
  | "idle"       // not started
  | "setup"      // downloading model
  | "listening"  // waiting for wake word
  | "muted"      // explicitly muted
  | "dismissed"  // false trigger cooldown
  | "active";    // wake word heard, transcription live

export interface WakeWordHookState {
  uiMode: WakeWordUIMode;
  /** Live microphone RMS level (0–1) — available even while listening for wake word */
  listenRms: number;
  /** The raw segments text accumulated since waking */
  activeTranscript: string;
  /** Whether the wake word model (ggml-tiny.en.bin) is ready */
  kmsModelReady: boolean;
  /** Always null — wake word reuses whisper model, no separate download needed */
  downloadProgress: null;
  error: string | null;
}

export interface WakeWordHookActions {
  /** Download KWS model if not already present, then start listening */
  setup: () => Promise<void>;
  /** Start listening (model must be ready) */
  startListening: (deviceName?: string) => Promise<void>;
  /** Stop and tear down the background thread */
  stopListening: () => Promise<void>;
  /** Mute without stopping (fast, keeps thread alive) */
  mute: () => Promise<void>;
  /** Resume after mute */
  unmute: () => Promise<void>;
  /** Dismiss a false trigger — suppresses re-trigger for 10 s */
  dismiss: () => Promise<void>;
  /** Fire wake-word as if spoken (the "Wake up" button) */
  manualTrigger: () => Promise<void>;
  clearError: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWakeWord(
  /** Called when wake word fires — start transcription from outside */
  onWake: () => Promise<void>,
  /** Called when active session should stop */
  onSleep: () => Promise<void>,
  /** Live segments from the transcription hook */
  activeTranscript: string,
): [WakeWordHookState, WakeWordHookActions] {
  const [uiMode, setUiMode] = useState<WakeWordUIMode>("idle");
  const [listenRms, setListenRms] = useState(0);
  const [kmsModelReady, setKmsModelReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlisteners = useRef<UnlistenFn[]>([]);
  const activeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceNameRef = useRef<string | undefined>(undefined);

  // ── Cleanup helpers ───────────────────────────────────────────────────────

  const clearActiveTimeout = useCallback(() => {
    if (activeTimeoutRef.current) {
      clearTimeout(activeTimeoutRef.current);
      activeTimeoutRef.current = null;
    }
  }, []);

  const teardownListeners = useCallback(() => {
    unlisteners.current.forEach((fn) => fn());
    unlisteners.current = [];
  }, []);

  useEffect(() => {
    return () => {
      teardownListeners();
      clearActiveTimeout();
    };
  }, [teardownListeners, clearActiveTimeout]);

  // ── Check model on mount ─────────────────────────────────────────────────

  useEffect(() => {
    if (!isTauri()) return;
    invoke<boolean>("check_kws_model_exists")
      .then(setKmsModelReady)
      .catch(() => setKmsModelReady(false));
  }, []);

  // ── Subscribe to Rust events ─────────────────────────────────────────────

  const attachRustListeners = useCallback(async () => {
    if (!isTauri()) return;

    const rmsUL = await listen<number>("wake-word-rms", (e) => {
      setListenRms(Math.min(e.payload, 1));
    });

    const detectedUL = await listen<WakeWordDetectedEvent>("wake-word-detected", async () => {
      setUiMode("active");
      clearActiveTimeout();
      try {
        await onWake();
      } catch {
        // transcription may already be running
      }
      // Auto-sleep after timeout
      activeTimeoutRef.current = setTimeout(async () => {
        try {
          await onSleep();
        } finally {
          setUiMode("listening");
        }
      }, ACTIVE_TIMEOUT_MS);
    });

    const modeUL = await listen<WakeWordMode>("wake-word-mode", (e) => {
      const m = e.payload;
      if (m === "listening") setUiMode("listening");
      else if (m === "muted") setUiMode("muted");
      else if (m === "dismissed") setUiMode("dismissed");
    });

    const errorUL = await listen<string>("wake-word-error", (e) => {
      setError(e.payload);
    });

    unlisteners.current.push(rmsUL, detectedUL, modeUL, errorUL);
  }, [onWake, onSleep, clearActiveTimeout]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const setup = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);

    // The wake word system reuses the whisper tiny model — no separate download.
    // If voice setup has been completed, the model is already present.
    const ready = await invoke<boolean>("check_kws_model_exists");
    if (!ready) {
      setError(
        "Voice setup not complete. Go to Voice → Setup tab and run Quick Setup first, then return here to enable wake word."
      );
      return;
    }

    setKmsModelReady(true);
    await startListening(deviceNameRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startListening = useCallback(async (deviceName?: string) => {
    if (!isTauri()) return;
    deviceNameRef.current = deviceName;
    setError(null);
    teardownListeners();
    await attachRustListeners();
    try {
      await invoke("start_wake_word", { deviceName: deviceName ?? null });
      setUiMode("listening");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      teardownListeners();
      setUiMode("idle");
    }
  }, [attachRustListeners, teardownListeners]);

  const stopListening = useCallback(async () => {
    if (!isTauri()) return;
    clearActiveTimeout();
    try {
      await onSleep();
    } catch { /* already stopped */ }
    try {
      await invoke("stop_wake_word");
    } catch { /* already stopped */ }
    teardownListeners();
    setUiMode("idle");
    setListenRms(0);
  }, [clearActiveTimeout, onSleep, teardownListeners]);

  const mute = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("mute_wake_word");
      setUiMode("muted");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const unmute = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("unmute_wake_word");
      setUiMode("listening");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const dismiss = useCallback(async () => {
    if (!isTauri()) return;
    clearActiveTimeout();
    try {
      await onSleep();
    } catch { /* ok */ }
    try {
      await invoke("dismiss_wake_word");
      setUiMode("dismissed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [clearActiveTimeout, onSleep]);

  const manualTrigger = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("trigger_wake_word");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // ── Return ────────────────────────────────────────────────────────────────

  const state: WakeWordHookState = {
    uiMode,
    listenRms,
    activeTranscript,
    kmsModelReady,
    downloadProgress: null,
    error,
  };

  const actions: WakeWordHookActions = {
    setup,
    startListening,
    stopListening,
    mute,
    unmute,
    dismiss,
    manualTrigger,
    clearError,
  };

  return [state, actions];
}
