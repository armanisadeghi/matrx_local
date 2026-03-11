import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  LlmHardwareResult,
  LlmServerStatus,
  LlmSetupStatus,
  LlmDownloadProgress,
  LlmDownloadCancelledEvent,
  DownloadedLlmModel,
} from "@/lib/llm/types";

export interface LlmState {
  // Setup
  setupStatus: LlmSetupStatus | null;
  hardwareResult: LlmHardwareResult | null;
  downloadProgress: LlmDownloadProgress | null;
  isDetecting: boolean;
  isDownloading: boolean;
  isStarting: boolean;
  downloadCancelled: boolean;

  // Server
  serverStatus: LlmServerStatus | null;
  downloadedModels: DownloadedLlmModel[];

  // Errors
  error: string | null;
}

export interface LlmActions {
  detectHardware: () => Promise<LlmHardwareResult>;
  /** Pass all part URLs in order. Single-file models have one URL; split models have multiple. */
  downloadModel: (filename: string, urls: string[]) => Promise<void>;
  /** Request cancellation of an in-flight download. */
  cancelDownload: () => Promise<void>;
  startServer: (
    modelFilename: string,
    gpuLayers: number,
    contextLength?: number
  ) => Promise<LlmServerStatus>;
  stopServer: () => Promise<void>;
  getServerStatus: () => Promise<LlmServerStatus>;
  healthCheck: () => Promise<boolean>;
  checkModelExists: (filename: string) => boolean;
  listModels: () => Promise<DownloadedLlmModel[]>;
  deleteModel: (filename: string) => Promise<void>;
  refreshSetupStatus: () => Promise<void>;
  quickSetup: () => Promise<void>;
  clearError: () => void;
}

export function useLlm(): [LlmState, LlmActions] {
  const [setupStatus, setSetupStatus] = useState<LlmSetupStatus | null>(null);
  const [hardwareResult, setHardwareResult] =
    useState<LlmHardwareResult | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<LlmDownloadProgress | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [downloadCancelled, setDownloadCancelled] = useState(false);
  const [serverStatus, setServerStatus] = useState<LlmServerStatus | null>(
    null
  );
  const [downloadedModels, setDownloadedModels] = useState<
    DownloadedLlmModel[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const unlistenRef = useRef<UnlistenFn[]>([]);

  // Clean up event listeners on unmount
  useEffect(() => {
    return () => {
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    };
  }, []);

  // Load initial setup status and listen for server/cancel events
  useEffect(() => {
    refreshSetupStatus();

    let mounted = true;
    const setupListeners = async () => {
      const unlistenReady = await listen<LlmServerStatus>(
        "llm-server-ready",
        (event) => {
          if (mounted) setServerStatus(event.payload);
        }
      );
      const unlistenStopped = await listen("llm-server-stopped", () => {
        if (mounted)
          setServerStatus((prev) =>
            prev ? { ...prev, running: false, port: 0 } : null
          );
      });
      const unlistenCancelled = await listen<LlmDownloadCancelledEvent>(
        "llm-download-cancelled",
        () => {
          if (mounted) {
            setDownloadCancelled(true);
            setIsDownloading(false);
            setDownloadProgress(null);
          }
        }
      );
      unlistenRef.current.push(unlistenReady, unlistenStopped, unlistenCancelled);
    };
    setupListeners();

    return () => {
      mounted = false;
    };
  }, []);

  const refreshSetupStatus = useCallback(async () => {
    try {
      const status = await invoke<LlmSetupStatus>("get_llm_setup_status");
      setSetupStatus(status);
      if (status.server_running) {
        setServerStatus({
          running: true,
          port: status.server_port,
          model_path: "",
          model_name: status.server_model,
          gpu_layers: 0,
          context_length: 0,
        });
      }
      const models = await invoke<DownloadedLlmModel[]>("list_llm_models");
      setDownloadedModels(models);
    } catch {
      // Not critical — LLM features may not be available
    }
  }, []);

  const detectHardware = useCallback(async () => {
    setIsDetecting(true);
    setError(null);
    try {
      const result = await invoke<LlmHardwareResult>("detect_llm_hardware");
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

  const downloadModel = useCallback(
    async (filename: string, urls: string[]) => {
      setIsDownloading(true);
      setDownloadProgress(null);
      setDownloadCancelled(false);
      setError(null);

      const unlisten = await listen<LlmDownloadProgress>(
        "llm-download-progress",
        (event) => {
          setDownloadProgress(event.payload);
        }
      );

      try {
        await invoke("download_llm_model", { filename, urls });
        setDownloadProgress(null);
        const models = await invoke<DownloadedLlmModel[]>("list_llm_models");
        setDownloadedModels(models);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.toLowerCase().includes("cancel")) {
          setError(msg);
        }
        throw e;
      } finally {
        unlisten();
        setIsDownloading(false);
      }
    },
    []
  );

  const cancelDownload = useCallback(async () => {
    try {
      await invoke("cancel_llm_download");
    } catch {
      // Ignore errors — the flag is set regardless
    }
  }, []);

  const startServer = useCallback(
    async (
      modelFilename: string,
      gpuLayers: number,
      contextLength?: number
    ) => {
      setIsStarting(true);
      setError(null);
      try {
        const status = await invoke<LlmServerStatus>("start_llm_server", {
          modelFilename,
          gpuLayers,
          contextLength,
        });
        setServerStatus(status);
        return status;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setIsStarting(false);
      }
    },
    []
  );

  const stopServer = useCallback(async () => {
    setError(null);
    try {
      await invoke("stop_llm_server");
      setServerStatus((prev) =>
        prev ? { ...prev, running: false, port: 0 } : null
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  const getServerStatus = useCallback(async () => {
    const status = await invoke<LlmServerStatus>("get_llm_server_status");
    setServerStatus(status);
    return status;
  }, []);

  const healthCheck = useCallback(async () => {
    return invoke<boolean>("check_llm_server_health");
  }, []);

  const checkModelExists = useCallback((filename: string): boolean => {
    // Synchronous check against downloaded models list (already loaded from Rust)
    return downloadedModels.some((m) => m.filename === filename);
  }, [downloadedModels]);

  const listModels = useCallback(async () => {
    const models = await invoke<DownloadedLlmModel[]>("list_llm_models");
    setDownloadedModels(models);
    return models;
  }, []);

  const deleteModel = useCallback(
    async (filename: string) => {
      setError(null);
      try {
        await invoke("delete_llm_model", { filename });
        const models = await invoke<DownloadedLlmModel[]>("list_llm_models");
        setDownloadedModels(models);
        await refreshSetupStatus();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    [refreshSetupStatus]
  );

  const clearError = useCallback(() => {
    setError(null);
    setDownloadCancelled(false);
  }, []);

  // One-click setup: detect hardware, download recommended model, start server
  const quickSetup = useCallback(async () => {
    setError(null);
    try {
      const hw = await detectHardware();

      const alreadyDownloaded = downloadedModels.some(
        (m) => m.filename === hw.recommended_filename
      );
      if (!alreadyDownloaded) {
        const modelInfo = hw.all_models.find(
          (m) => m.filename === hw.recommended_filename
        );
        if (!modelInfo) {
          throw new Error(
            `Model info not found for ${hw.recommended_filename}`
          );
        }
        await downloadModel(hw.recommended_filename, modelInfo.all_part_urls);
      }

      await startServer(
        hw.recommended_filename,
        hw.recommended_gpu_layers,
        8192
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes("cancel")) {
        setError(`Setup failed: ${msg}`);
      }
      throw e;
    }
  }, [detectHardware, downloadedModels, downloadModel, startServer]);

  const state: LlmState = {
    setupStatus,
    hardwareResult,
    downloadProgress,
    isDetecting,
    isDownloading,
    isStarting,
    downloadCancelled,
    serverStatus,
    downloadedModels,
    error,
  };

  const actions: LlmActions = {
    detectHardware,
    downloadModel,
    cancelDownload,
    startServer,
    stopServer,
    getServerStatus,
    healthCheck,
    checkModelExists,
    listModels,
    deleteModel,
    refreshSetupStatus,
    quickSetup,
    clearError,
  };

  return [state, actions];
}
