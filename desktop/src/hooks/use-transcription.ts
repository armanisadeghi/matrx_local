import { useState, useEffect, useCallback, useRef } from "react";
import { isTauri } from "@/lib/sidecar";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  HardwareDetectionResult,
  WhisperSegment,
  DownloadProgress,
  VoiceSetupStatus,
  AudioDeviceInfo,
} from "@/lib/transcription/types";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function tauriListen<T>(event: string, handler: (e: { payload: T }) => void): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, handler);
}

export interface TranscriptionState {
  // Setup
  setupStatus: VoiceSetupStatus | null;
  hardwareResult: HardwareDetectionResult | null;
  downloadProgress: DownloadProgress | null;
  isDetecting: boolean;
  isDownloading: boolean;
  isInitializing: boolean;

  // Recording
  isRecording: boolean;
  /**
   * True while the mic has been stopped but Rust is still flushing the last
   * audio chunk through Whisper. Listeners are kept alive until whisper-stopped
   * fires, so no transcription is lost.
   */
  isProcessingTail: boolean;
  segments: WhisperSegment[];
  fullTranscript: string;
  activeModel: string | null;
  /** Live RMS energy from the microphone (0–1). Updated ~5Hz while recording. */
  liveRms: number;
  /** Whether the adaptive silence calibration has finished (first 2s of recording). */
  isCalibrating: boolean;

  // Devices
  audioDevices: AudioDeviceInfo[];
  /** Name of the selected input device. null = use system default. */
  selectedDevice: string | null;

  // Errors
  error: string | null;
}

export interface TranscriptionActions {
  detectHardware: () => Promise<HardwareDetectionResult>;
  downloadModel: (filename: string) => Promise<void>;
  downloadVadModel: () => Promise<void>;
  initTranscription: (filename: string) => Promise<void>;
  startRecording: (deviceName?: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  checkModelExists: (filename: string) => Promise<boolean>;
  listDownloadedModels: () => Promise<string[]>;
  deleteModel: (filename: string) => Promise<void>;
  refreshSetupStatus: () => Promise<void>;
  listAudioDevices: () => Promise<AudioDeviceInfo[]>;
  setSelectedDevice: (deviceName: string | null) => void;
  clearSegments: () => void;
  clearError: () => void;

  /** One-click setup: detect hardware, download recommended model + VAD, init */
  quickSetup: () => Promise<void>;
}

export function useTranscription(): [TranscriptionState, TranscriptionActions] {
  const [setupStatus, setSetupStatus] = useState<VoiceSetupStatus | null>(null);
  const [hardwareResult, setHardwareResult] =
    useState<HardwareDetectionResult | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingTail, setIsProcessingTail] = useState(false);
  const [segments, setSegments] = useState<WhisperSegment[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [liveRms, setLiveRms] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlistenersRef = useRef<UnlistenFn[]>([]);

  // Full transcript derived from segments
  const fullTranscript = segments
    .map((s) => s.text)
    .filter((t) => t.length > 0)
    .join(" ");

  // Clean up event listeners on unmount
  useEffect(() => {
    return () => {
      unlistenersRef.current.forEach((fn) => fn());
      unlistenersRef.current = [];
    };
  }, []);

  // Load initial setup status
  useEffect(() => {
    if (!isTauri()) return;
    refreshSetupStatus();
  }, []);

  // Poll get_active_model until the Rust auto-init completes (max 30s).
  // This bridges the gap between the config saying "setup_complete: true"
  // and the TranscriptionManager actually being loaded into memory.
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 30;

    const poll = async () => {
      if (cancelled || attempts >= MAX_ATTEMPTS) return;
      attempts++;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const model = await invoke<string | null>("get_active_model");
        if (model) {
          setActiveModel(model);
          return; // done — model is loaded
        }
      } catch {
        // not ready yet — keep polling
      }
      setTimeout(poll, 1000);
    };

    poll();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSetupStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const status = await tauriInvoke<VoiceSetupStatus>("get_voice_setup_status");
      setSetupStatus(status);
      if (status.selected_model) {
        setActiveModel(status.selected_model);
      }
    } catch {
      // Not critical — app may work without voice features
    }
  }, []);

  const detectHardware = useCallback(async () => {
    setIsDetecting(true);
    setError(null);
    try {
      const result = await tauriInvoke<HardwareDetectionResult>("detect_hardware");
      setHardwareResult(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setIsDetecting(false);
    }
  }, []);

  const downloadModel = useCallback(async (filename: string) => {
    setIsDownloading(true);
    setDownloadProgress(null);
    setError(null);

    const unlisten = await tauriListen<DownloadProgress>(
      "whisper-download-progress",
      (event) => {
        setDownloadProgress(event.payload);
      }
    );

    try {
      await tauriInvoke("download_whisper_model", { filename });
      setDownloadProgress(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      unlisten();
      setIsDownloading(false);
    }
  }, []);

  const downloadVadModel = useCallback(async () => {
    setIsDownloading(true);
    setDownloadProgress(null);
    setError(null);

    const unlisten = await tauriListen<DownloadProgress>(
      "whisper-download-progress",
      (event) => {
        setDownloadProgress(event.payload);
      }
    );

    try {
      await tauriInvoke("download_vad_model");
      setDownloadProgress(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      unlisten();
      setIsDownloading(false);
    }
  }, []);

  const initTranscription = useCallback(async (filename: string) => {
    setIsInitializing(true);
    setError(null);
    try {
      await tauriInvoke("init_transcription", { filename });
      setActiveModel(filename);
      await refreshSetupStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setIsInitializing(false);
    }
  }, [refreshSetupStatus]);

  const startRecording = useCallback(async (deviceName?: string) => {
    setError(null);
    setSegments([]);
    setLiveRms(0);
    setIsCalibrating(true);
    setIsProcessingTail(false);

    const segmentUnlisten = await tauriListen<WhisperSegment>(
      "whisper-segment",
      (event) => {
        setSegments((prev) => [...prev, event.payload]);
      }
    );

    const errorUnlisten = await tauriListen<string>("whisper-error", (event) => {
      setError(event.payload);
      setIsRecording(false);
      setIsProcessingTail(false);
      setLiveRms(0);
      setIsCalibrating(false);
    });

    const rmsUnlisten = await tauriListen<number>("whisper-rms", (event) => {
      setLiveRms(event.payload);
    });

    const calibratedUnlisten = await tauriListen<{ floor_rms: number; threshold: number }>(
      "whisper-calibrated",
      () => {
        setIsCalibrating(false);
      }
    );

    // whisper-stopped fires after the Rust thread has flushed the final
    // audio chunk through Whisper. Only at this point do we tear down the
    // listeners — ensuring no segments are lost.
    const stoppedUnlisten = await tauriListen<null>("whisper-stopped", () => {
      setIsProcessingTail(false);
      setLiveRms(0);
      unlistenersRef.current.forEach((fn) => fn());
      unlistenersRef.current = [];
    });

    unlistenersRef.current.push(
      segmentUnlisten,
      errorUnlisten,
      rmsUnlisten,
      calibratedUnlisten,
      stoppedUnlisten,
    );

    // Prefer explicitly passed device, fall back to persisted selectedDevice state
    const resolvedDevice = deviceName ?? selectedDevice ?? undefined;

    try {
      await tauriInvoke("start_transcription", {
        deviceName: resolvedDevice ?? null,
      });
      setIsRecording(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      segmentUnlisten();
      errorUnlisten();
      rmsUnlisten();
      calibratedUnlisten();
      stoppedUnlisten();
      unlistenersRef.current = [];
    }
  }, [selectedDevice]);

  const stopRecording = useCallback(async () => {
    // Tell Rust to stop capturing audio. The recording thread will flush any
    // buffered audio through Whisper and then emit "whisper-stopped". We stay
    // in isProcessingTail state until that event arrives so the UI can show
    // "Processing…" and the segment listener stays alive.
    setIsRecording(false);
    setIsCalibrating(false);
    // Keep liveRms until whisper-stopped so the meter fades naturally
    try {
      await tauriInvoke("stop_transcription");
      setIsProcessingTail(true);
    } catch {
      // Ignore — the recording may have already stopped
      setIsProcessingTail(false);
      setLiveRms(0);
      unlistenersRef.current.forEach((fn) => fn());
      unlistenersRef.current = [];
    }
  }, []);

  const checkModelExists = useCallback(async (filename: string) => {
    return tauriInvoke<boolean>("check_model_exists", { filename });
  }, []);

  const listDownloadedModels = useCallback(async () => {
    return tauriInvoke<string[]>("list_downloaded_models");
  }, []);

  const deleteModel = useCallback(async (filename: string) => {
    await tauriInvoke("delete_model", { filename });
    await refreshSetupStatus();
  }, [refreshSetupStatus]);

  const listAudioDevices = useCallback(async () => {
    const devices = await tauriInvoke<AudioDeviceInfo[]>("list_audio_input_devices");
    setAudioDevices(devices);
    return devices;
  }, []);

  const clearSegments = useCallback(() => setSegments([]), []);
  const clearError = useCallback(() => setError(null), []);

  // One-click setup
  const quickSetup = useCallback(async () => {
    setError(null);
    try {
      // 1. Detect hardware
      const hw = await detectHardware();

      // 2. Check if recommended model already downloaded
      const exists = await checkModelExists(hw.recommended_filename);
      if (!exists) {
        // Download recommended model
        await downloadModel(hw.recommended_filename);
      }

      // 3. Download VAD model (small, fast)
      await downloadVadModel();

      // 4. Initialize transcription context
      await initTranscription(hw.recommended_filename);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Setup failed: ${msg}`);
      throw e;
    }
  }, [
    detectHardware,
    checkModelExists,
    downloadModel,
    downloadVadModel,
    initTranscription,
  ]);

  const state: TranscriptionState = {
    setupStatus,
    hardwareResult,
    downloadProgress,
    isDetecting,
    isDownloading,
    isInitializing,
    isRecording,
    isProcessingTail,
    segments,
    fullTranscript,
    activeModel,
    liveRms,
    isCalibrating,
    audioDevices,
    selectedDevice,
    error,
  };

  const actions: TranscriptionActions = {
    detectHardware,
    downloadModel,
    downloadVadModel,
    initTranscription,
    startRecording,
    stopRecording,
    checkModelExists,
    listDownloadedModels,
    deleteModel,
    refreshSetupStatus,
    listAudioDevices,
    setSelectedDevice,
    clearSegments,
    clearError,
    quickSetup,
  };

  return [state, actions];
}
