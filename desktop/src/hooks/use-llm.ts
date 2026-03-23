import { useState, useEffect, useCallback, useRef } from "react";
import { isTauri } from "@/lib/sidecar";
import { engine } from "@/lib/api";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  LlmHardwareResult,
  LlmServerStatus,
  LlmSetupStatus,
  LlmDownloadProgress,
  LlmDownloadCancelledEvent,
  DownloadedLlmModel,
} from "@/lib/llm/types";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function tauriListen<T>(event: string, handler: (e: { payload: T }) => void): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, handler);
}

export interface ServerStartProgress {
  elapsed_secs: number;
  max_secs: number;
  phase: string;
  percent: number;
}

export interface ServerLogLine {
  line: string;
  kind: "loading" | "progress" | "ready" | "error" | "noise";
}

export interface LlmState {
  // Setup
  setupStatus: LlmSetupStatus | null;
  hardwareResult: LlmHardwareResult | null;
  downloadProgress: LlmDownloadProgress | null;
  isDetecting: boolean;
  isDownloading: boolean;
  isStarting: boolean;
  startingModelName: string | null;
  serverStartProgress: ServerStartProgress | null;
  serverLogs: ServerLogLine[];
  downloadCancelled: boolean;

  // Server
  serverStatus: LlmServerStatus | null;
  downloadedModels: DownloadedLlmModel[];

  // HuggingFace token
  hfToken: string | null;
  /** True when the last download failed because the repo uses XET storage and no token is set. */
  xetTokenRequired: boolean;

  // Errors
  error: string | null;
}

export interface LlmActions {
  detectHardware: () => Promise<LlmHardwareResult>;
  /** Pass all part URLs in order. Single-file models have one URL; split models have multiple. */
  downloadModel: (filename: string, urls: string[]) => Promise<void>;
  /** Request cancellation of an in-flight download. */
  cancelDownload: () => Promise<void>;
  /**
   * Copy a local GGUF file into the app's models directory.
   * Returns the final filename it was saved as.
   */
  importLocalModel: (sourcePath: string, destFilename?: string) => Promise<string>;
  /** Save a HuggingFace access token. Pass empty string to clear. */
  saveHfToken: (token: string) => Promise<void>;
  /** Get the stored HuggingFace token, or null if not set. */
  getHfToken: () => Promise<string | null>;
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
  const [startingModelName, setStartingModelName] = useState<string | null>(null);
  const [serverStartProgress, setServerStartProgress] = useState<ServerStartProgress | null>(null);
  const [serverLogs, setServerLogs] = useState<ServerLogLine[]>([]);
  const [downloadCancelled, setDownloadCancelled] = useState(false);
  const [serverStatus, setServerStatus] = useState<LlmServerStatus | null>(
    null
  );
  const [downloadedModels, setDownloadedModels] = useState<
    DownloadedLlmModel[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [hfToken, setHfToken] = useState<string | null>(null);
  const [xetTokenRequired, setXetTokenRequired] = useState(false);

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
    if (!isTauri()) return;

    refreshSetupStatus();
    // Load saved HF token so the UI can show "token configured" state
    tauriInvoke<string | null>("get_hf_token").then((t) => setHfToken(t ?? null)).catch(() => {});

    let mounted = true;
    const setupListeners = async () => {
      const unlistenReady = await tauriListen<LlmServerStatus>(
        "llm-server-ready",
        (event) => {
          if (mounted) {
            setServerStatus(event.payload);
            setStartingModelName(null);
            setServerStartProgress(null);
            setServerLogs([]);
            // Notify Python engine so agents can route to the local model.
            engine.connectLocalLlm(
              event.payload.port,
              event.payload.model_name ?? "",
            ).catch((err) => {
              console.warn("[use-llm] Failed to notify engine of local LLM start:", err);
            });
          }
        }
      );
      const unlistenStarting = await tauriListen<{ model_filename: string; port: number }>(
        "llm-server-starting",
        (event) => {
          if (mounted) {
            setStartingModelName(event.payload.model_filename);
            setServerStartProgress(null);
            setServerLogs([]);
          }
        }
      );
      const unlistenProgress = await tauriListen<ServerStartProgress>(
        "llm-server-progress",
        (event) => {
          if (mounted) setServerStartProgress(event.payload);
        }
      );
      const unlistenLog = await tauriListen<ServerLogLine>(
        "llm-server-log",
        (event) => {
          if (!mounted) return;
          setServerLogs((prev) => {
            const next = [...prev, event.payload];
            // Keep last 50 lines
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
        }
      );
      const unlistenStopped = await tauriListen<void>("llm-server-stopped", () => {
        if (mounted) {
          setServerStatus((prev) =>
            prev ? { ...prev, running: false, port: 0 } : null
          );
          setStartingModelName(null);
          setServerStartProgress(null);
          // Notify Python engine so it deregisters the local model.
          engine.disconnectLocalLlm().catch((err) => {
            console.warn("[use-llm] Failed to notify engine of local LLM stop:", err);
          });
        }
      });
      const unlistenCancelled = await tauriListen<LlmDownloadCancelledEvent>(
        "llm-download-cancelled",
        () => {
          if (mounted) {
            setDownloadCancelled(true);
            setIsDownloading(false);
            setDownloadProgress(null);
          }
        }
      );
      unlistenRef.current.push(
        unlistenReady, unlistenStarting, unlistenProgress, unlistenLog,
        unlistenStopped, unlistenCancelled
      );
    };
    setupListeners();

    return () => {
      mounted = false;
    };
  }, []);

  const refreshSetupStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const status = await tauriInvoke<LlmSetupStatus>("get_llm_setup_status");
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
      const models = await tauriInvoke<DownloadedLlmModel[]>("list_llm_models");
      setDownloadedModels(models);
    } catch {
      // Not critical — LLM features may not be available
    }
  }, []);

  const detectHardware = useCallback(async () => {
    setIsDetecting(true);
    setError(null);
    try {
      const result = await tauriInvoke<LlmHardwareResult>("detect_llm_hardware");
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
      setXetTokenRequired(false);
      setError(null);

      const unlisten = await tauriListen<LlmDownloadProgress>(
        "llm-download-progress",
        (event) => {
          setDownloadProgress(event.payload);
        }
      );

      try {
        await tauriInvoke("download_llm_model", { filename, urls });
        setDownloadProgress(null);
        const models = await tauriInvoke<DownloadedLlmModel[]>("list_llm_models");
        setDownloadedModels(models);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("XET_TOKEN_REQUIRED") || msg.startsWith("XET_TOKEN_INVALID")) {
          setXetTokenRequired(true);
          setError(msg.replace(/^XET_TOKEN_(REQUIRED|INVALID): /, ""));
        } else if (!msg.toLowerCase().includes("cancel")) {
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
      await tauriInvoke("cancel_llm_download");
    } catch {
      // Ignore errors — the flag is set regardless
    }
  }, []);

  const importLocalModel = useCallback(
    async (sourcePath: string, destFilename = "") => {
      setError(null);
      try {
        const filename = await tauriInvoke<string>("import_local_llm_model", {
          sourcePath,
          destFilename,
        });
        // Refresh the model list so the new model appears immediately
        const models = await tauriInvoke<DownloadedLlmModel[]>("list_llm_models");
        setDownloadedModels(models);
        return filename;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    []
  );

  const startServer = useCallback(
    async (
      modelFilename: string,
      gpuLayers: number,
      contextLength?: number
    ) => {
      setIsStarting(true);
      setStartingModelName(modelFilename);
      setServerStartProgress(null);
      setServerLogs([]);
      setError(null);
      try {
        const status = await tauriInvoke<LlmServerStatus>("start_llm_server", {
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
        setStartingModelName(null);
        setServerStartProgress(null);
      }
    },
    []
  );

  const stopServer = useCallback(async () => {
    setError(null);
    try {
      await tauriInvoke("stop_llm_server");
      setServerStatus((prev) =>
        prev ? { ...prev, running: false, port: 0 } : null
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  const getServerStatus = useCallback(async () => {
    const status = await tauriInvoke<LlmServerStatus>("get_llm_server_status");
    setServerStatus(status);
    return status;
  }, []);

  const healthCheck = useCallback(async () => {
    return tauriInvoke<boolean>("check_llm_server_health");
  }, []);

  const checkModelExists = useCallback((filename: string): boolean => {
    // Synchronous check against downloaded models list (already loaded from Rust)
    return downloadedModels.some((m) => m.filename === filename);
  }, [downloadedModels]);

  const listModels = useCallback(async () => {
    const models = await tauriInvoke<DownloadedLlmModel[]>("list_llm_models");
    setDownloadedModels(models);
    return models;
  }, []);

  const deleteModel = useCallback(
    async (filename: string) => {
      setError(null);
      try {
        await tauriInvoke("delete_llm_model", { filename });
        const models = await tauriInvoke<DownloadedLlmModel[]>("list_llm_models");
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

  const saveHfToken = useCallback(async (token: string) => {
    await tauriInvoke("save_hf_token", { token });
    setHfToken(token.trim() || null);
    if (token.trim()) setXetTokenRequired(false);
  }, []);

  const getHfToken = useCallback(async () => {
    const t = await tauriInvoke<string | null>("get_hf_token");
    setHfToken(t ?? null);
    return t ?? null;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setDownloadCancelled(false);
    setXetTokenRequired(false);
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
    startingModelName,
    serverStartProgress,
    serverLogs,
    downloadCancelled,
    serverStatus,
    downloadedModels,
    hfToken,
    xetTokenRequired,
    error,
  };

  const actions: LlmActions = {
    detectHardware,
    downloadModel,
    cancelDownload,
    importLocalModel,
    saveHfToken,
    getHfToken,
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
