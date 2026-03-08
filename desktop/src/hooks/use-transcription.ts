import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  HardwareDetectionResult,
  WhisperSegment,
  DownloadProgress,
  VoiceSetupStatus,
  AudioDeviceInfo,
} from "@/lib/transcription/types";

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
  segments: WhisperSegment[];
  fullTranscript: string;
  activeModel: string | null;

  // Devices
  audioDevices: AudioDeviceInfo[];

  // Errors
  error: string | null;
}

export interface TranscriptionActions {
  detectHardware: () => Promise<HardwareDetectionResult>;
  downloadModel: (filename: string) => Promise<void>;
  downloadVadModel: () => Promise<void>;
  initTranscription: (filename: string) => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  checkModelExists: (filename: string) => Promise<boolean>;
  listDownloadedModels: () => Promise<string[]>;
  deleteModel: (filename: string) => Promise<void>;
  refreshSetupStatus: () => Promise<void>;
  listAudioDevices: () => Promise<AudioDeviceInfo[]>;
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
  const [segments, setSegments] = useState<WhisperSegment[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
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
    refreshSetupStatus();
  }, []);

  const refreshSetupStatus = useCallback(async () => {
    try {
      const status = await invoke<VoiceSetupStatus>("get_voice_setup_status");
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
      const result = await invoke<HardwareDetectionResult>("detect_hardware");
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

    // Listen for progress events
    const unlisten = await listen<DownloadProgress>(
      "whisper-download-progress",
      (event) => {
        setDownloadProgress(event.payload);
      }
    );

    try {
      await invoke("download_whisper_model", { filename });
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
    setError(null);
    try {
      await invoke("download_vad_model");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    }
  }, []);

  const initTranscription = useCallback(async (filename: string) => {
    setIsInitializing(true);
    setError(null);
    try {
      await invoke("init_transcription", { filename });
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

  const startRecording = useCallback(async () => {
    setError(null);
    setSegments([]);

    // Set up event listeners for segments and errors
    const segmentUnlisten = await listen<WhisperSegment>(
      "whisper-segment",
      (event) => {
        setSegments((prev) => [...prev, event.payload]);
      }
    );

    const errorUnlisten = await listen<string>("whisper-error", (event) => {
      setError(event.payload);
      setIsRecording(false);
    });

    unlistenersRef.current.push(segmentUnlisten, errorUnlisten);

    try {
      await invoke("start_transcription");
      setIsRecording(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      segmentUnlisten();
      errorUnlisten();
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      await invoke("stop_transcription");
    } catch {
      // Ignore — the recording may have already stopped
    }
    setIsRecording(false);

    // Clean up segment/error listeners
    unlistenersRef.current.forEach((fn) => fn());
    unlistenersRef.current = [];
  }, []);

  const checkModelExists = useCallback(async (filename: string) => {
    return invoke<boolean>("check_model_exists", { filename });
  }, []);

  const listDownloadedModels = useCallback(async () => {
    return invoke<string[]>("list_downloaded_models");
  }, []);

  const deleteModel = useCallback(async (filename: string) => {
    await invoke("delete_model", { filename });
    await refreshSetupStatus();
  }, [refreshSetupStatus]);

  const listAudioDevices = useCallback(async () => {
    const devices = await invoke<AudioDeviceInfo[]>("list_audio_input_devices");
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
    segments,
    fullTranscript,
    activeModel,
    audioDevices,
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
    clearSegments,
    clearError,
    quickSetup,
  };

  return [state, actions];
}
