import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SubTabBar } from "@/components/layout/SubTabBar";
import { useTranscription } from "@/hooks/use-transcription";
import { Button } from "@/components/ui/button";
import { DownloadProgress } from "@/components/DownloadProgress";
import {
  Mic,
  MicOff,
  Download,
  CheckCircle2,
  AlertCircle,
  Cpu,
  HardDrive,
  Monitor,
  Trash2,
  RefreshCw,
  Zap,
  Volume2,
  ChevronRight,
  Loader2,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DebugTerminal, useDebugTerminal } from "@/components/DebugTerminal";
import type {
  WhisperModelTier,
  HardwareDetectionResult,
  ModelInfo,
} from "@/lib/transcription/types";

const TABS = [
  { value: "setup", label: "Setup" },
  { value: "transcribe", label: "Transcribe" },
  { value: "models", label: "Models" },
  { value: "devices", label: "Audio Devices" },
];

export function Voice() {
  const [tab, setTab] = useState("setup");
  const [state, actions] = useTranscription();
  const { logs, logLine, logData, clearLogs } = useDebugTerminal();

  // Wire Tauri events to the debug terminal
  useEffect(() => {
    // Log download progress events
    if (state.downloadProgress) {
      logData("[whisper] download-progress", state.downloadProgress);
    }
  }, [state.downloadProgress, logData]);

  useEffect(() => {
    if (state.error) {
      logLine("error", `[whisper] ERROR: ${state.error}`);
    }
  }, [state.error, logLine]);

  // Wrapped actions that also log to the terminal
  const wrappedDetectHardware = useCallback(async () => {
    logLine("cmd", "invoke detect_hardware");
    try {
      const result = await actions.detectHardware();
      logData("[whisper] hardware-result", result);
      return result;
    } catch (e) {
      logLine("error", `detect_hardware failed: ${e}`);
      throw e;
    }
  }, [actions, logLine, logData]);

  const wrappedDownloadModel = useCallback(async (filename: string) => {
    logLine("cmd", `invoke download_whisper_model: ${filename}`);
    logLine("info", `Starting download from HuggingFace: ggml/${filename}`);
    try {
      await actions.downloadModel(filename);
      logLine("success", `Model downloaded: ${filename}`);
    } catch (e) {
      logLine("error", `download_whisper_model failed: ${e}`);
      throw e;
    }
  }, [actions, logLine]);

  const wrappedInitTranscription = useCallback(async (filename: string) => {
    logLine("cmd", `invoke init_transcription: ${filename}`);
    try {
      await actions.initTranscription(filename);
      logLine("success", `Transcription engine initialized with: ${filename}`);
    } catch (e) {
      logLine("error", `init_transcription failed: ${e}`);
      throw e;
    }
  }, [actions, logLine]);

  const wrappedQuickSetup = useCallback(async () => {
    logLine("info", "=== Starting Voice Quick Setup ===");
    // quickSetup handles: detect hardware → download model → download VAD → init
    logLine("cmd", "quickSetup (detect + download + VAD + init)");
    try {
      await actions.quickSetup();
      logLine("success", "=== Voice Quick Setup complete ===");
    } catch (e) {
      logLine("error", `Quick setup failed: ${e}`);
    }
  }, [actions, logLine]);

  const wrappedDeleteModel = useCallback(async (filename: string) => {
    logLine("cmd", `invoke delete_model: ${filename}`);
    try {
      await actions.deleteModel(filename);
      logLine("success", `Model deleted: ${filename}`);
    } catch (e) {
      logLine("error", `delete_model failed: ${e}`);
    }
  }, [actions, logLine]);

  const wrappedActions = {
    ...actions,
    detectHardware: wrappedDetectHardware,
    downloadModel: wrappedDownloadModel,
    initTranscription: wrappedInitTranscription,
    quickSetup: wrappedQuickSetup,
    deleteModel: wrappedDeleteModel,
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Voice"
        description="Local speech-to-text transcription powered by Whisper"
      />
      <SubTabBar tabs={TABS} value={tab} onValueChange={setTab} />
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "setup" && (
          <SetupTab
            state={state}
            actions={wrappedActions}
            logs={logs}
            onClearLogs={clearLogs}
          />
        )}
        {tab === "transcribe" && (
          <TranscribeTab state={state} actions={actions} />
        )}
        {tab === "models" && (
          <ModelsTab
            state={state}
            actions={wrappedActions}
            logs={logs}
            onClearLogs={clearLogs}
          />
        )}
        {tab === "devices" && <DevicesTab state={state} actions={actions} />}
      </div>
    </div>
  );
}

// ── Setup Tab ──────────────────────────────────────────────────────────────

function SetupTab({
  state,
  actions,
  logs,
  onClearLogs,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
  logs: import("@/components/DebugTerminal").LogLine[];
  onClearLogs: () => void;
}) {
  const isSetupDone = state.setupStatus?.setup_complete ?? false;
  const isActive = state.isDetecting || state.isDownloading || state.isInitializing;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Quick Setup Card */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl",
              isSetupDone
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-primary/10 text-primary"
            )}
          >
            {isSetupDone ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : (
              <Zap className="h-6 w-6" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <h2 className="text-lg font-semibold">
              {isSetupDone
                ? "Voice Features Ready"
                : "Set Up Voice Transcription"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isSetupDone
                ? `Using ${state.activeModel ?? state.setupStatus?.selected_model ?? "unknown model"}. You can change models in the Models tab.`
                : "One-click setup detects your hardware, downloads the best model for your system, and gets everything ready."}
            </p>
            {!isSetupDone && (
              <Button
                onClick={actions.quickSetup}
                disabled={isActive}
                className="mt-2"
                size="lg"
              >
                {state.isDetecting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Detecting hardware...</>
                ) : state.isDownloading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Downloading model...</>
                ) : state.isInitializing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading model...</>
                ) : (
                  <><Zap className="mr-2 h-4 w-4" />One-Click Setup</>
                )}
              </Button>
            )}
            {isSetupDone && (
              <Button
                variant="outline"
                size="sm"
                onClick={actions.refreshSetupStatus}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Refresh Status
              </Button>
            )}
          </div>
        </div>

        {/* Download progress */}
        <DownloadProgress
          progress={state.downloadProgress}
          isDownloading={state.isDownloading}
          error={state.error}
          className="mt-4"
        />
      </div>

      {/* Error display */}
      {state.error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-500">Error</p>
            <p className="text-sm text-red-400 whitespace-pre-wrap">{state.error}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={actions.clearError}
            className="text-red-400 hover:text-red-300"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Hardware Info */}
      <HardwareInfoCard state={state} actions={actions} />

      {/* Debug Terminal — always visible, auto-opens during active operations */}
      <DebugTerminal
        logs={logs}
        onClear={onClearLogs}
        title="Voice Setup Log"
        defaultOpen={isActive}
        maxHeight="260px"
      />

      {/* How it works */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" />
          How it works
        </h3>
        <div className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">1</div>
            <p><strong className="text-foreground">Local processing</strong> — All transcription runs on your machine using Whisper. No audio leaves your device.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">2</div>
            <p><strong className="text-foreground">Adaptive models</strong> — The system picks the best model for your hardware. Faster machines get more accurate models.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">3</div>
            <p><strong className="text-foreground">Future: Wake words</strong> — This system will support custom wake words that trigger AI agents automatically.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hardware Info Card ─────────────────────────────────────────────────────

function HardwareInfoCard({
  state,
  actions,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
}) {
  const hw = state.hardwareResult;

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">System Hardware</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={actions.detectHardware}
          disabled={state.isDetecting}
        >
          {state.isDetecting ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          {hw ? "Rescan" : "Detect"}
        </Button>
      </div>

      {!hw ? (
        <p className="text-sm text-muted-foreground">
          Click Detect to scan your system hardware and get a model
          recommendation.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Hardware specs grid */}
          <div className="grid grid-cols-2 gap-3">
            <HardwareStat
              icon={<HardDrive className="h-4 w-4" />}
              label="System RAM"
              value={formatRam(hw.hardware.total_ram_mb)}
            />
            <HardwareStat
              icon={<Cpu className="h-4 w-4" />}
              label="CPU Threads"
              value={String(hw.hardware.cpu_threads)}
            />
            <HardwareStat
              icon={<Monitor className="h-4 w-4" />}
              label="GPU"
              value={getGpuLabel(hw)}
            />
            <HardwareStat
              icon={<Zap className="h-4 w-4" />}
              label="Acceleration"
              value={getAccelLabel(hw)}
            />
          </div>

          {/* Recommendation */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">Recommendation</span>
            </div>
            <p className="text-sm text-muted-foreground">{hw.reason}</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                {hw.recommended_filename}
              </span>
              <span className="text-muted-foreground">
                ({hw.recommended_size_mb} MB download)
              </span>
            </div>
            {hw.can_upgrade && (
              <p className="text-xs text-amber-500 mt-1">
                Your system can handle a higher-quality model. Check the Models
                tab for options.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HardwareStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

// ── Transcribe Tab ─────────────────────────────────────────────────────────

function TranscribeTab({
  state,
  actions,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
}) {
  const isReady = state.setupStatus?.setup_complete ?? false;

  if (!isReady) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card p-12 text-center space-y-4">
          <Mic className="h-12 w-12 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold">Setup Required</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Complete the voice setup first to enable transcription. Go to the
            Setup tab and click "One-Click Setup".
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Recording controls */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Live Transcription</h3>
            <p className="text-sm text-muted-foreground">
              {state.isRecording
                ? "Listening... speak into your microphone"
                : "Click the microphone to start transcribing"}
            </p>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {state.activeModel ?? "No model"}
          </div>
        </div>

        <div className="flex items-center justify-center py-8">
          <button
            onClick={
              state.isRecording ? actions.stopRecording : actions.startRecording
            }
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300",
              state.isRecording
                ? "bg-red-500 text-white shadow-lg shadow-red-500/25 hover:bg-red-600 animate-pulse"
                : "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90"
            )}
          >
            {state.isRecording ? (
              <MicOff className="h-8 w-8" />
            ) : (
              <Mic className="h-8 w-8" />
            )}
          </button>
        </div>

        {state.isRecording && (
          <div className="flex items-center justify-center gap-2 text-sm text-red-500">
            <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            Recording
          </div>
        )}
      </div>

      {/* Error */}
      {state.error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-400">{state.error}</p>
        </div>
      )}

      {/* Transcript output */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Transcript</h3>
          {state.segments.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(state.fullTranscript);
                }}
              >
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={actions.clearSegments}
              >
                Clear
              </Button>
            </div>
          )}
        </div>

        {state.segments.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {state.isRecording
              ? "Waiting for speech..."
              : "No transcript yet. Start recording to begin."}
          </p>
        ) : (
          <div className="space-y-1">
            {state.segments.map((seg, i) => (
              <div key={i} className="flex items-start gap-3 text-sm group">
                <span className="text-xs text-muted-foreground font-mono pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity min-w-[60px]">
                  {formatTime(seg.start_sec)}
                </span>
                <span>{seg.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Full merged transcript */}
        {state.fullTranscript.length > 0 && (
          <div className="border-t pt-4 mt-4">
            <p className="text-xs text-muted-foreground mb-2 font-medium">
              Full transcript
            </p>
            <p className="text-sm leading-relaxed">{state.fullTranscript}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Models Tab ─────────────────────────────────────────────────────────────

function ModelsTab({
  state,
  actions,
  logs,
  onClearLogs,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
  logs: import("@/components/DebugTerminal").LogLine[];
  onClearLogs: () => void;
}) {
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const hw = state.hardwareResult;
  const downloaded = state.setupStatus?.downloaded_models ?? [];

  useEffect(() => {
    if (!hw) {
      actions.detectHardware();
    }
  }, [hw, actions]);

  const handleDownloadAndActivate = async (model: ModelInfo) => {
    setDownloadingFile(model.filename);
    try {
      const exists = await actions.checkModelExists(model.filename);
      if (!exists) {
        await actions.downloadModel(model.filename);
      }
      await actions.initTranscription(model.filename);
    } catch {
      // Error displayed in terminal + state.error
    }
    setDownloadingFile(null);
  };

  const allModels = hw?.all_models ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h3 className="font-semibold">Available Models</h3>
        <p className="text-sm text-muted-foreground">
          All models use the same API — switching models only changes accuracy
          and speed. English-only models are optimized for English transcription.
        </p>

        <div className="space-y-3">
          {allModels.map((model) => {
            const isDownloaded = downloaded.includes(model.filename);
            const isActive = state.activeModel === model.filename;
            const isDownloading = downloadingFile === model.filename;
            const isRecommended =
              hw?.recommended_filename === model.filename;

            return (
              <div
                key={model.filename}
                className={cn(
                  "rounded-lg border p-4 space-y-3 transition-colors",
                  isActive && "border-primary/50 bg-primary/5"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{tierLabel(model.tier)}</span>
                      {isRecommended && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          Recommended
                        </span>
                      )}
                      {isActive && (
                        <span className="text-xs bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {model.description}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Stat label="Download" value={`${model.download_size_mb} MB`} />
                  <Stat label="RAM Usage" value={`${model.ram_required_mb} MB`} />
                  <Stat label="Speed" value={model.relative_speed} />
                  <Stat label="Accuracy" value={model.accuracy} />
                </div>

                <div className="flex items-center gap-2">
                  {isActive ? (
                    <span className="text-xs text-emerald-500 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Currently active
                    </span>
                  ) : isDownloading ? (
                    <Button size="sm" disabled>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      {state.downloadProgress
                        ? `${Math.round(state.downloadProgress.percent)}%`
                        : "Downloading..."}
                    </Button>
                  ) : isDownloaded ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadAndActivate(model)}
                      >
                        <ChevronRight className="mr-1 h-3 w-3" />
                        Activate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => actions.deleteModel(model.filename)}
                        className="text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleDownloadAndActivate(model)}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      Download & Activate
                    </Button>
                  )}
                </div>

                {/* Download progress for this model */}
                {isDownloading && (
                  <DownloadProgress
                    progress={state.downloadProgress}
                    isDownloading={state.isDownloading}
                  />
                )}
              </div>
            );
          })}
        </div>

        {allModels.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Button onClick={actions.detectHardware} disabled={state.isDetecting}>
              {state.isDetecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Detect Hardware to See Models
            </Button>
          </div>
        )}
      </div>

      {/* Model file info */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h3 className="font-semibold text-sm">Technical Details</h3>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Models are GGML format files from the whisper.cpp project. They are
            downloaded from Hugging Face and stored locally.
          </p>
          <p>
            <code className="bg-muted px-1 py-0.5 rounded">.en</code> suffix
            means English-only (optimized). For multilingual support, different
            models will be available in a future update.
          </p>
          <p>
            Switching models reinitializes the transcription context. The API is
            identical across all models — only accuracy and speed change.
          </p>
        </div>
      </div>

      {/* Debug Terminal */}
      <DebugTerminal
        logs={logs}
        onClear={onClearLogs}
        title="Model Download Log"
        defaultOpen={downloadingFile !== null}
        maxHeight="260px"
      />
    </div>
  );
}

// ── Devices Tab ────────────────────────────────────────────────────────────

function DevicesTab({
  state,
  actions,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
}) {
  useEffect(() => {
    actions.listAudioDevices();
  }, [actions]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Audio Input Devices</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={actions.listAudioDevices}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Refresh
          </Button>
        </div>

        {state.audioDevices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
            <Volume2 className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No audio input devices detected. Make sure a microphone is
              connected.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {state.audioDevices.map((device, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-4 space-y-2",
                  device.is_default && "border-primary/50 bg-primary/5"
                )}
              >
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{device.name}</span>
                  {device.is_default && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      Default
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {device.sample_rates.length > 0 && (
                    <span>
                      Sample rates:{" "}
                      {device.sample_rates
                        .map((r) => `${r / 1000}kHz`)
                        .join(", ")}
                    </span>
                  )}
                  {device.channels.length > 0 && (
                    <span>
                      Channels: {device.channels.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h3 className="font-semibold text-sm">Requirements</h3>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Whisper requires <strong>16kHz mono</strong> audio input. Most
            modern microphones support this natively. If your device only
            supports higher sample rates, audio will be captured at the native
            rate.
          </p>
          <p>
            For best results, use a dedicated microphone rather than a laptop's
            built-in mic. External USB microphones typically have better noise
            cancellation.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

function tierLabel(tier: WhisperModelTier): string {
  switch (tier) {
    case "Low":
      return "Tiny (Fast)";
    case "Default":
      return "Base (Balanced)";
    case "High":
      return "Small (Accurate)";
  }
}

function formatRam(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getGpuLabel(hw: HardwareDetectionResult): string {
  if (hw.hardware.is_apple_silicon) return "Apple Silicon (Metal)";
  if (hw.hardware.supports_cuda && hw.hardware.gpu_vram_mb) {
    return `NVIDIA (${formatRam(hw.hardware.gpu_vram_mb)} VRAM)`;
  }
  if (hw.hardware.supports_metal) return "Metal (macOS)";
  return "CPU only";
}

function getAccelLabel(hw: HardwareDetectionResult): string {
  if (hw.hardware.is_apple_silicon) return "Metal (GPU)";
  if (hw.hardware.supports_cuda) return "CUDA (GPU)";
  if (hw.hardware.supports_metal) return "Metal (GPU)";
  return "SIMD (CPU)";
}
