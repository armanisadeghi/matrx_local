import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SubTabBar } from "@/components/layout/SubTabBar";
import { useLlm, type LlmState, type LlmActions } from "@/hooks/use-llm";
import { Button } from "@/components/ui/button";
import { DownloadProgress } from "@/components/DownloadProgress";
import { Badge } from "@/components/ui/badge";
import {
  Cpu,
  HardDrive,
  Download,
  AlertCircle,
  Trash2,
  Play,
  Square,
  RefreshCw,
  Zap,
  Monitor,
  Server,
  Activity,
  Loader2,
  Info,
  Settings2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DebugTerminal, useDebugTerminal } from "@/components/DebugTerminal";
import type { LlmModelInfo, LlmTier } from "@/lib/llm/types";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "models", label: "Models" },
  { value: "server", label: "Server" },
  { value: "hardware", label: "Hardware" },
  { value: "inference", label: "Test" },
];

export function LocalModels() {
  const [tab, setTab] = useState("overview");
  const [state, actions] = useLlm();
  const { logs, logLine, logData, clearLogs } = useDebugTerminal();

  // Wire state changes to the terminal
  useEffect(() => {
    if (state.downloadProgress) {
      logData("[llm] download-progress", state.downloadProgress);
    }
  }, [state.downloadProgress, logData]);

  useEffect(() => {
    if (state.error) {
      logLine("error", `[llm] ERROR: ${state.error}`);
    }
  }, [state.error, logLine]);

  useEffect(() => {
    if (state.serverStatus) {
      logData("[llm] server-status", state.serverStatus);
    }
  }, [state.serverStatus, logData]);

  // Wrapped actions with full terminal logging
  const wrappedDetectHardware = useCallback(async () => {
    logLine("cmd", "invoke detect_llm_hardware");
    try {
      const result = await actions.detectHardware();
      logData("[llm] hardware-result", result);
      logLine("success", `Hardware: ${result.hardware.is_apple_silicon ? "Apple Silicon" : `${result.hardware.total_ram_mb}MB RAM`} — recommended: ${result.recommended_filename}`);
      return result;
    } catch (e) {
      logLine("error", `detect_llm_hardware failed: ${e}`);
      throw e;
    }
  }, [actions, logLine, logData]);

  const wrappedDownloadModel = useCallback(async (filename: string, urls: string[]) => {
    logLine("cmd", `invoke download_llm_model: ${filename}`);
    logLine("info", `Parts: ${urls.length} — ${urls[0]}${urls.length > 1 ? ` (+${urls.length - 1} more)` : ""}`);
    logLine("info", "Download started — progress events will appear below");
    try {
      await actions.downloadModel(filename, urls);
      logLine("success", `Model downloaded and validated: ${filename}`);
    } catch (e) {
      logLine("error", `download_llm_model failed: ${e}`);
      throw e;
    }
  }, [actions, logLine]);

  const wrappedStartServer = useCallback(async (modelFilename: string, gpuLayers: number, contextLength?: number) => {
    logLine("cmd", `invoke start_llm_server: ${modelFilename} gpu_layers=${gpuLayers} ctx=${contextLength ?? 8192}`);
    try {
      const result = await actions.startServer(modelFilename, gpuLayers, contextLength);
      logData("[llm] server-started", result);
      logLine("success", `Server running on port ${result.port}`);
      return result;
    } catch (e) {
      logLine("error", `start_llm_server failed: ${e}`);
      throw e;
    }
  }, [actions, logLine, logData]);

  const wrappedStopServer = useCallback(async () => {
    logLine("cmd", "invoke stop_llm_server");
    try {
      await actions.stopServer();
      logLine("success", "Server stopped");
    } catch (e) {
      logLine("error", `stop_llm_server failed: ${e}`);
      throw e;
    }
  }, [actions, logLine]);

  const wrappedDeleteModel = useCallback(async (filename: string) => {
    logLine("cmd", `invoke delete_llm_model: ${filename}`);
    try {
      await actions.deleteModel(filename);
      logLine("success", `Model deleted: ${filename}`);
    } catch (e) {
      logLine("error", `delete_llm_model failed: ${e}`);
    }
  }, [actions, logLine]);

  const wrappedHealthCheck = useCallback(async () => {
    logLine("cmd", "invoke check_llm_server_health");
    try {
      const ok = await actions.healthCheck();
      logLine(ok ? "success" : "warn", `Health check: ${ok ? "healthy" : "not healthy"}`);
      return ok;
    } catch (e) {
      logLine("error", `health check failed: ${e}`);
      return false;
    }
  }, [actions, logLine]);

  const wrappedQuickSetup = useCallback(async () => {
    logLine("info", "=== Starting LLM Quick Setup ===");
    try {
      await actions.quickSetup();
      logLine("success", "=== LLM Quick Setup complete ===");
    } catch (e) {
      logLine("error", `Quick setup failed: ${e}`);
    }
  }, [actions, logLine]);

  const wrappedActions: LlmActions = {
    ...actions,
    detectHardware: wrappedDetectHardware,
    downloadModel: wrappedDownloadModel,
    startServer: wrappedStartServer,
    stopServer: wrappedStopServer,
    deleteModel: wrappedDeleteModel,
    healthCheck: wrappedHealthCheck,
    quickSetup: wrappedQuickSetup,
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Local Models"
        description="Manage local LLM inference with llama-server"
      />
      <SubTabBar tabs={TABS} value={tab} onValueChange={setTab} />
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "overview" && (
          <OverviewTab state={state} actions={wrappedActions} logs={logs} onClearLogs={clearLogs} />
        )}
        {tab === "models" && (
          <ModelsTab state={state} actions={wrappedActions} logs={logs} onClearLogs={clearLogs} />
        )}
        {tab === "server" && <ServerTab state={state} actions={wrappedActions} />}
        {tab === "hardware" && (
          <HardwareTab state={state} actions={wrappedActions} />
        )}
        {tab === "inference" && (
          <InferenceTab state={state} actions={wrappedActions} />
        )}
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────

function OverviewTab({
  state,
  actions,
  logs,
  onClearLogs,
}: {
  state: LlmState;
  actions: LlmActions;
  logs: import("@/components/DebugTerminal").LogLine[];
  onClearLogs: () => void;
}) {
  const isSetup = state.setupStatus?.setup_complete ?? false;
  const isRunning = state.serverStatus?.running ?? false;
  const isActive = state.isDetecting || state.isDownloading || state.isStarting;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Quick Setup Card */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl",
              isRunning
                ? "bg-emerald-500/15 text-emerald-500"
                : isSetup
                  ? "bg-amber-500/15 text-amber-500"
                  : "bg-primary/15 text-primary"
            )}
          >
            {isRunning ? (
              <Server className="h-6 w-6" />
            ) : (
              <Zap className="h-6 w-6" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">
              {isRunning
                ? "LLM Server Running"
                : isSetup
                  ? "Model Ready"
                  : "Set Up Local LLM"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {isRunning
                ? `${state.serverStatus?.model_name} on port ${state.serverStatus?.port}`
                : isSetup
                  ? `${state.setupStatus?.selected_model} downloaded. Start the server to begin inference.`
                  : "Detect your hardware, download a model, and start running AI locally."}
            </p>

            {state.error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}

            <DownloadProgress
              progress={state.downloadProgress}
              isDownloading={state.isDownloading}
              error={state.error}
              className="mt-3"
            />

            <div className="mt-4 flex gap-2 flex-wrap">
              {!isSetup && !isRunning && (
                <Button
                  onClick={() => actions.quickSetup()}
                  disabled={
                    state.isDetecting ||
                    state.isDownloading ||
                    state.isStarting
                  }
                >
                  {state.isDetecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Detecting Hardware...
                    </>
                  ) : state.isDownloading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Downloading Model...
                    </>
                  ) : state.isStarting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting Server...
                    </>
                  ) : (
                    <>
                      <Zap className="mr-2 h-4 w-4" />
                      Quick Setup
                    </>
                  )}
                </Button>
              )}

              {isSetup && !isRunning && (
                <Button
                  onClick={async () => {
                    const hw = await actions.detectHardware();
                    await actions.startServer(
                      state.setupStatus!.selected_model!,
                      hw.recommended_gpu_layers,
                      8192
                    );
                  }}
                  disabled={state.isStarting}
                >
                  {state.isStarting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Start Server
                    </>
                  )}
                </Button>
              )}

              {isRunning && (
                <Button variant="destructive" onClick={actions.stopServer}>
                  <Square className="mr-2 h-4 w-4" />
                  Stop Server
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={actions.refreshSetupStatus}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Refresh
              </Button>

              {state.error && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={actions.clearError}
                >
                  Dismiss Error
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatusCard
          icon={<HardDrive className="h-5 w-5" />}
          label="Models Downloaded"
          value={String(state.downloadedModels.length)}
          detail={
            state.downloadedModels.length > 0
              ? state.downloadedModels.map((m) => m.name).join(", ")
              : "No models downloaded"
          }
        />
        <StatusCard
          icon={<Server className="h-5 w-5" />}
          label="Server Status"
          value={isRunning ? "Running" : "Stopped"}
          detail={
            isRunning
              ? `Port ${state.serverStatus?.port}`
              : "Not active"
          }
          variant={isRunning ? "success" : "muted"}
        />
        <StatusCard
          icon={<Cpu className="h-5 w-5" />}
          label="GPU Offload"
          value={
            state.serverStatus?.running
              ? state.serverStatus.gpu_layers > 0
                ? `${state.serverStatus.gpu_layers} layers`
                : "CPU only"
              : "N/A"
          }
          detail={
            state.hardwareResult?.hardware.is_apple_silicon
              ? "Apple Silicon (Metal)"
              : state.hardwareResult?.hardware.supports_cuda
                ? "NVIDIA CUDA"
                : "CPU inference"
          }
        />
      </div>

      {/* API Endpoint Info */}
      {isRunning && (
        <div className="rounded-xl border bg-card p-6">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            API Endpoint
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">
                http://127.0.0.1:{state.serverStatus?.port}/v1/chat/completions
              </code>
            </div>
            <p className="text-xs text-muted-foreground">
              OpenAI-compatible endpoint. Supports tool calling, structured
              output, and streaming.
            </p>
          </div>
        </div>
      )}

      {/* Debug Terminal */}
      <DebugTerminal
        logs={logs}
        onClear={onClearLogs}
        title="LLM Operations Log"
        defaultOpen={isActive}
        maxHeight="260px"
      />
    </div>
  );
}

// ── Models Tab ────────────────────────────────────────────────────────────

function ModelsTab({
  state,
  actions,
  logs,
  onClearLogs,
}: {
  state: LlmState;
  actions: LlmActions;
  logs: import("@/components/DebugTerminal").LogLine[];
  onClearLogs: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const allModels = state.hardwareResult?.all_models ?? [];
  const downloadedFilenames = new Set(
    state.downloadedModels.map((m) => m.filename)
  );

  useEffect(() => {
    if (!state.hardwareResult && !state.isDetecting) {
      actions.detectHardware();
    }
  }, []);

  const handleDownload = async (model: LlmModelInfo) => {
    setDownloadingFile(model.filename);
    try {
      await actions.downloadModel(model.filename, model.all_part_urls);
    } finally {
      setDownloadingFile(null);
    }
  };

  const handleDelete = async (filename: string) => {
    setDeleting(filename);
    try {
      await actions.deleteModel(filename);
    } finally {
      setDeleting(null);
    }
  };

  const handleLoadModel = async (filename: string, model?: LlmModelInfo) => {
    const hw = state.hardwareResult;
    const gpuLayers = hw ? hw.recommended_gpu_layers : 0;
    const ctx = model?.context_length ?? 8192;
    await actions.startServer(filename, gpuLayers, ctx);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Available Models</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => actions.detectHardware()}
          disabled={state.isDetecting}
        >
          <RefreshCw
            className={cn(
              "mr-2 h-3.5 w-3.5",
              state.isDetecting && "animate-spin"
            )}
          />
          Refresh
        </Button>
      </div>

      {state.error && (
        <ErrorBanner message={state.error} onDismiss={actions.clearError} />
      )}

      <DownloadProgress
        progress={state.downloadProgress}
        isDownloading={state.isDownloading}
      />

      {state.isDetecting ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {allModels.map((model) => {
            const isDownloaded = downloadedFilenames.has(model.filename);
            const isActive =
              (state.serverStatus?.running &&
              state.serverStatus?.model_name ===
                model.filename.replace(".gguf", "")) ?? false;
            const isRecommended =
              model.filename ===
              state.hardwareResult?.recommended_filename;

            return (
              <ModelCard
                key={model.filename}
                model={model}
                isDownloaded={isDownloaded}
                isActive={isActive}
                isRecommended={isRecommended}
                isDownloading={
                  (state.isDownloading || downloadingFile === model.filename) &&
                  (state.downloadProgress?.filename === model.filename || downloadingFile === model.filename)
                }
                isStarting={state.isStarting}
                isDeleting={deleting === model.filename}
                onDownload={() => handleDownload(model)}
                onDelete={() => handleDelete(model.filename)}
                onLoad={() => handleLoadModel(model.filename, model)}
                onStop={actions.stopServer}
              />
            );
          })}
        </div>
      )}

      {/* Debug Terminal */}
      <DebugTerminal
        logs={logs}
        onClear={onClearLogs}
        title="Model Download Log"
        defaultOpen={state.isDownloading || downloadingFile !== null}
        maxHeight="260px"
      />
    </div>
  );
}

// ── Server Tab ────────────────────────────────────────────────────────────

function ServerTab({
  state,
  actions,
}: {
  state: LlmState;
  actions: LlmActions;
}) {
  const [healthStatus, setHealthStatus] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const isRunning = state.serverStatus?.running ?? false;

  const runHealthCheck = async () => {
    setChecking(true);
    try {
      const ok = await actions.healthCheck();
      setHealthStatus(ok);
    } catch {
      setHealthStatus(false);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {state.error && (
        <ErrorBanner message={state.error} onDismiss={actions.clearError} />
      )}

      {/* Server Status */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Server className="h-5 w-5" />
            llama-server
          </h3>
          <Badge variant={isRunning ? "default" : "secondary"}>
            {isRunning ? "Running" : "Stopped"}
          </Badge>
        </div>

        {isRunning && state.serverStatus && (
          <div className="space-y-3">
            <InfoRow label="Model" value={state.serverStatus.model_name} />
            <InfoRow
              label="Port"
              value={String(state.serverStatus.port)}
            />
            <InfoRow
              label="GPU Layers"
              value={
                state.serverStatus.gpu_layers > 0
                  ? `${state.serverStatus.gpu_layers} (GPU offload)`
                  : "0 (CPU only)"
              }
            />
            <InfoRow
              label="Context Length"
              value={`${state.serverStatus.context_length} tokens`}
            />
            <InfoRow
              label="Endpoint"
              value={`http://127.0.0.1:${state.serverStatus.port}/v1/chat/completions`}
              mono
            />

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={runHealthCheck}
                disabled={checking}
              >
                {checking ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Activity className="mr-2 h-3.5 w-3.5" />
                )}
                Health Check
              </Button>
              {healthStatus !== null && (
                <Badge variant={healthStatus ? "default" : "destructive"}>
                  {healthStatus ? "Healthy" : "Unhealthy"}
                </Badge>
              )}
            </div>
          </div>
        )}

        {!isRunning && (
          <p className="text-sm text-muted-foreground">
            The llama-server is not running. Start it from the Overview or
            Models tab.
          </p>
        )}

        <div className="flex gap-2 mt-4 pt-4 border-t">
          {isRunning ? (
            <Button variant="destructive" onClick={actions.stopServer}>
              <Square className="mr-2 h-4 w-4" />
              Stop Server
            </Button>
          ) : (
            state.setupStatus?.selected_model && (
              <Button
                onClick={async () => {
                  const hw = await actions.detectHardware();
                  await actions.startServer(
                    state.setupStatus!.selected_model!,
                    hw.recommended_gpu_layers,
                    8192
                  );
                }}
                disabled={state.isStarting}
              >
                {state.isStarting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Start Server
              </Button>
            )
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={actions.refreshSetupStatus}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Refresh Status
          </Button>
        </div>
      </div>

      {/* Server Configuration Info */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Configuration Details
        </h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            The llama-server runs as a sidecar process, providing an
            OpenAI-compatible API on localhost.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Tool calling enabled via <code>--jinja</code> flag
            </li>
            <li>
              Flash attention enabled for faster inference
            </li>
            <li>Port auto-selected from range 11434-11533</li>
            <li>
              Supports Qwen3, Phi-4, and Mistral model families
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Hardware Tab ──────────────────────────────────────────────────────────

function HardwareTab({
  state,
  actions,
}: {
  state: LlmState;
  actions: LlmActions;
}) {
  useEffect(() => {
    if (!state.hardwareResult && !state.isDetecting) {
      actions.detectHardware();
    }
  }, []);

  const hw = state.hardwareResult?.hardware;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">System Hardware</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => actions.detectHardware()}
          disabled={state.isDetecting}
        >
          <RefreshCw
            className={cn(
              "mr-2 h-3.5 w-3.5",
              state.isDetecting && "animate-spin"
            )}
          />
          Re-detect
        </Button>
      </div>

      {state.isDetecting ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : hw ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <HardwareCard
              icon={<Monitor className="h-5 w-5" />}
              label="Total RAM"
              value={`${(hw.total_ram_mb / 1024).toFixed(1)} GB`}
            />
            <HardwareCard
              icon={<Cpu className="h-5 w-5" />}
              label="CPU Threads"
              value={String(hw.cpu_threads)}
            />
            <HardwareCard
              icon={<Cpu className="h-5 w-5" />}
              label="GPU VRAM"
              value={
                hw.gpu_vram_mb
                  ? `${(hw.gpu_vram_mb / 1024).toFixed(1)} GB`
                  : "N/A"
              }
            />
            <HardwareCard
              icon={<Zap className="h-5 w-5" />}
              label="GPU Acceleration"
              value={
                hw.is_apple_silicon
                  ? "Metal (Apple Silicon)"
                  : hw.supports_cuda
                    ? "NVIDIA CUDA"
                    : "CPU only"
              }
            />
          </div>

          {/* Recommendation */}
          {state.hardwareResult && (
            <div className="rounded-xl border bg-card p-6">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Info className="h-4 w-4" />
                Recommendation
              </h3>
              <p className="text-sm text-muted-foreground">
                {state.hardwareResult.reason}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Badge>
                  {state.hardwareResult.recommended_name}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  ({state.hardwareResult.recommended_size_gb} GB download)
                </span>
              </div>
              {state.hardwareResult.can_upgrade && (
                <p className="mt-2 text-xs text-amber-500">
                  Your hardware can support a larger model. Check the Models
                  tab for options.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Cpu className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p>Click "Re-detect" to scan your hardware</p>
        </div>
      )}
    </div>
  );
}

// ── Inference Test Tab ────────────────────────────────────────────────────

function InferenceTab({
  state,
}: {
  state: LlmState;
  actions: LlmActions;
}) {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const isRunning = state.serverStatus?.running ?? false;
  const port = state.serverStatus?.port ?? 0;

  const runInference = async () => {
    if (!prompt.trim() || !isRunning) return;

    setIsGenerating(true);
    setResponse("");
    setElapsed(null);
    const start = Date.now();

    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "local",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 1024,
            stream: false,
            chat_template_kwargs: { enable_thinking: false },
          }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        setResponse(`Error (${res.status}): ${text}`);
        return;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "(empty response)";
      setResponse(content.replace(/<think>[\s\S]*?<\/think>/g, "").trim());
      setElapsed(Date.now() - start);
    } catch (e) {
      setResponse(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {!isRunning ? (
        <div className="text-center py-12 text-muted-foreground">
          <Server className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p>Start the LLM server to test inference</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border bg-card p-6">
            <h3 className="text-sm font-semibold mb-3">Test Prompt</h3>
            <textarea
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm min-h-[100px] resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Enter a prompt to test the model..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  runInference();
                }
              }}
            />
            <div className="flex items-center gap-2 mt-3">
              <Button
                onClick={runInference}
                disabled={!prompt.trim() || isGenerating}
                size="sm"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-3.5 w-3.5" />
                    Send
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to
                send
              </span>
            </div>
          </div>

          {response && (
            <div className="rounded-xl border bg-card p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Response</h3>
                {elapsed !== null && (
                  <span className="text-xs text-muted-foreground">
                    {(elapsed / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <div className="rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap">
                {response}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Reusable Components ───────────────────────────────────────────────────

function ModelCard({
  model,
  isDownloaded,
  isActive,
  isRecommended,
  isDownloading,
  isStarting,
  isDeleting,
  onDownload,
  onDelete,
  onLoad,
  onStop,
}: {
  model: LlmModelInfo;
  isDownloaded: boolean;
  isActive: boolean;
  isRecommended: boolean;
  isDownloading: boolean;
  isStarting: boolean;
  isDeleting: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onLoad: () => void;
  onStop: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition-colors",
        isActive && "border-emerald-500/50 bg-emerald-500/5",
        isRecommended && !isActive && "border-primary/30"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">{model.name}</h4>
            {isRecommended && (
              <Badge variant="outline" className="text-xs">
                Recommended
              </Badge>
            )}
            {isActive && (
              <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-xs">
                Active
              </Badge>
            )}
            <TierBadge tier={model.tier} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {model.description}
          </p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{model.disk_size_gb} GB download</span>
            <span>{model.ram_required_gb} GB RAM required</span>
            <span>{model.speed}</span>
            <span>
              {"★".repeat(model.tool_calling_rating)}
              {"☆".repeat(5 - model.tool_calling_rating)} Tools
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          {!isDownloaded ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : isActive ? (
            <Button size="sm" variant="destructive" onClick={onStop}>
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onLoad}
                disabled={isStarting}
              >
                {isStarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                disabled={isDeleting}
                className="text-muted-foreground hover:text-red-400"
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  detail,
  variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  variant?: "default" | "success" | "muted";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p
        className={cn(
          "text-lg font-semibold",
          variant === "success" && "text-emerald-500",
          variant === "muted" && "text-muted-foreground"
        )}
      >
        {value}
      </p>
      {detail && (
        <p className="text-xs text-muted-foreground mt-1 truncate">{detail}</p>
      )}
    </div>
  );
}

function HardwareCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 mb-1 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn("text-sm", mono && "font-mono text-xs bg-muted px-2 py-0.5 rounded")}
      >
        {value}
      </span>
    </div>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
      <div className="flex-1 text-sm text-red-400">{message}</div>
      <Button variant="ghost" size="sm" onClick={onDismiss} className="shrink-0">
        Dismiss
      </Button>
    </div>
  );
}

function TierBadge({ tier }: { tier: LlmTier }) {
  const labels: Record<LlmTier, string> = {
    Low: "Low",
    LowAlt: "Low",
    Default: "Default",
    High: "High",
    HighAlt: "High",
  };
  const colors: Record<LlmTier, string> = {
    Low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    LowAlt: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    Default: "bg-primary/10 text-primary border-primary/20",
    High: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    HighAlt: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", colors[tier])}>
      {labels[tier]}
    </Badge>
  );
}

