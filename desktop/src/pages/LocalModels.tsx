"use client";

import { useState, useRef, useCallback, createContext, useContext, useEffect } from "react";
import { useLlm } from "@/hooks/use-llm";
import type { LlmState, LlmActions, ServerStartProgress, ServerLogLine } from "@/hooks/use-llm";
import {
  Download,
  Trash2,
  Play,
  Square,
  RotateCcw,
  Zap,
  Cpu,
  HardDrive,
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  MessageSquare,
  Wrench,
  Code,
  Server,
  Settings,
  X,
  FolderOpen,
  Link,
  Plus,
  PackagePlus,
} from "lucide-react";
import { isTauri } from "@/lib/sidecar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { streamCompletion, callWithTools } from "@/lib/llm/api";
import type { ChatMessage, LlmModelInfo } from "@/lib/llm/types";

// ── Shared LLM context (single hook instance for all tabs) ───────────────

const LlmContext = createContext<[LlmState, LlmActions] | null>(null);

function useLlmContext(): [LlmState, LlmActions] {
  const ctx = useContext(LlmContext);
  if (!ctx) throw new Error("useLlmContext used outside LlmContext.Provider");
  return ctx;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function ToolCallRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className={`h-2 w-2 rounded-full ${i < rating ? "bg-blue-500" : "bg-muted"}`}
        />
      ))}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 gap-1" onClick={copy}>
      <Copy className="h-3 w-3" />
      {copied ? "Copied!" : label ?? "Copy"}
    </Button>
  );
}

// ── Model Loading Progress Card ───────────────────────────────────────────

function ModelLoadingCard({
  modelName,
  progress,
  logs,
}: {
  modelName: string | null;
  progress: ServerStartProgress | null;
  logs: ServerLogLine[];
}) {
  const [elapsed, setElapsed] = useState(0);
  const [showLogs, setShowLogs] = useState(false);

  // Local timer that ticks every second regardless of Tauri events
  useEffect(() => {
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [modelName]);

  const pct = progress?.percent ?? Math.min((elapsed / 120) * 60, 55);
  const phase = progress?.phase ?? (elapsed < 3 ? "initializing" : "loading model");
  const elapsedDisplay = progress?.elapsed_secs ?? elapsed;

  // Meaningful log lines to show
  const visibleLogs = logs.filter((l) => l.kind !== "noise").slice(-8);

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-blue-500 animate-pulse shrink-0" />
          <p className="text-sm font-semibold">Loading model into memory</p>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {elapsedDisplay}s
          </span>
        </div>

        {modelName && (
          <p className="text-xs text-muted-foreground font-mono truncate pl-6">
            {modelName}
          </p>
        )}

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground capitalize">{phase}</span>
            <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-1000 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Large models take 10–90 seconds to map into GPU memory.
          </p>
        </div>
      </div>

      {/* Log toggle */}
      {visibleLogs.length > 0 && (
        <div className="border-t">
          <button
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setShowLogs((v) => !v)}
          >
            {showLogs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showLogs ? "Hide" : "Show"} server output
          </button>
          {showLogs && (
            <div className="px-4 pb-3 space-y-0.5 max-h-40 overflow-y-auto">
              {visibleLogs.map((l, i) => (
                <p
                  key={i}
                  className={`text-xs font-mono leading-relaxed ${
                    l.kind === "error"
                      ? "text-destructive"
                      : l.kind === "ready"
                      ? "text-green-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {l.line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Setup Tab ─────────────────────────────────────────────────────────────

function SetupTab() {
  const [state, actions] = useLlmContext();
  const {
    hardwareResult,
    downloadProgress,
    isDetecting,
    isDownloading,
    isStarting,
    startingModelName,
    serverStartProgress,
    serverLogs,
    downloadCancelled,
    downloadedModels,
    serverStatus,
    error,
  } = state;
  const { detectHardware, quickSetup, cancelDownload, clearError } = actions;

  const isModelDownloaded = hardwareResult
    ? downloadedModels.some((m) => m.filename === hardwareResult.recommended_filename)
    : false;

  const handleQuickSetup = async () => {
    clearError();
    await quickSetup();
  };

  const progressPercent = downloadProgress?.percent ?? 0;
  const partLabel =
    downloadProgress && downloadProgress.total_parts > 1
      ? ` — Part ${downloadProgress.part} of ${downloadProgress.total_parts}`
      : "";
  const bytesLabel = downloadProgress
    ? `${formatBytes(downloadProgress.bytes_downloaded)} / ${formatBytes(downloadProgress.total_bytes || (hardwareResult?.all_models.find(m => m.filename === downloadProgress.filename)?.expected_size_bytes ?? 0))}`
    : "";

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Hardware Detection Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4 text-blue-500" />
              Hardware Profile
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              disabled={isDetecting}
              onClick={detectHardware}
            >
              {isDetecting ? "Detecting…" : hardwareResult ? "Re-detect" : "Detect Hardware"}
            </Button>
          </div>
        </CardHeader>
        {hardwareResult && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">RAM</p>
                <p className="font-medium">
                  {(hardwareResult.hardware.total_ram_mb / 1024).toFixed(0)} GB
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">CPU Threads</p>
                <p className="font-medium">{hardwareResult.hardware.cpu_threads}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">GPU</p>
                <p className="font-medium">
                  {hardwareResult.hardware.is_apple_silicon
                    ? "Apple Silicon (Metal)"
                    : hardwareResult.hardware.supports_cuda
                    ? `CUDA — ${((hardwareResult.hardware.gpu_vram_mb ?? 0) / 1024).toFixed(0)} GB VRAM`
                    : "CPU only"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Recommended</p>
                <p className="font-medium text-blue-500">{hardwareResult.recommended_name}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3 bg-muted/40 rounded px-3 py-2">
              {hardwareResult.reason}
            </p>
          </CardContent>
        )}
      </Card>

      {/* Quick Setup Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            Quick Setup
          </CardTitle>
          <CardDescription>
            One click to download the recommended model and start inference.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hardwareResult && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
              <div className="flex-1">
                <p className="font-medium text-sm">{hardwareResult.recommended_name}</p>
                <p className="text-xs text-muted-foreground">
                  {hardwareResult.recommended_size_gb.toFixed(1)} GB •{" "}
                  {hardwareResult.recommended_gpu_layers === 99
                    ? "Full GPU offload"
                    : hardwareResult.recommended_gpu_layers === 0
                    ? "CPU inference"
                    : `${hardwareResult.recommended_gpu_layers} GPU layers`}
                </p>
              </div>
              {isModelDownloaded ? (
                <Badge className="bg-green-500/20 text-green-600 border-green-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Downloaded
                </Badge>
              ) : (
                <Badge variant="outline">Not downloaded</Badge>
              )}
            </div>
          )}

          {/* Download progress */}
          {isDownloading && downloadProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium">
                  Downloading{partLabel}
                </span>
                <span>{bytesLabel}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {progressPercent.toFixed(1)}%
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs text-destructive border-destructive/30"
                  onClick={cancelDownload}
                >
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {downloadCancelled && (
            <div className="text-xs text-amber-500 flex items-center gap-2">
              <AlertCircle className="h-3 w-3" />
              Download cancelled. Partial files have been cleaned up.
            </div>
          )}

          {/* Model loading progress — shown while server is starting */}
          {isStarting && (
            <ModelLoadingCard
              modelName={startingModelName}
              progress={serverStartProgress}
              logs={serverLogs}
            />
          )}

          {serverStatus?.running && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Server running on port {serverStatus.port} — model: {serverStatus.model_name}
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive flex items-start gap-2 bg-destructive/10 rounded px-3 py-2">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}

          <Button
            className="w-full"
            disabled={isDetecting || isDownloading || isStarting || !hardwareResult}
            onClick={handleQuickSetup}
          >
            {isDetecting
              ? "Detecting hardware…"
              : isDownloading
              ? "Downloading…"
              : isStarting
              ? "Starting server…"
              : serverStatus?.running && isModelDownloaded
              ? "Restart with Recommended Model"
              : isModelDownloaded
              ? "Start Inference Server"
              : "Download & Start"}
          </Button>
          {!hardwareResult && !isDetecting && (
            <p className="text-xs text-center text-muted-foreground">
              Detect hardware first to get a recommendation.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Model Card ────────────────────────────────────────────────────────────

function ModelCard({
  model,
  isDownloaded,
  isServerRunning,
  downloadingFilename,
  downloadProgress,
  onDownload,
  onDownloadAndRun,
  onLoad,
  onDelete,
  onCancel,
}: {
  model: LlmModelInfo;
  isDownloaded: boolean;
  isServerRunning: boolean;
  downloadingFilename: string | null;
  downloadProgress: { percent: number; part: number; total_parts: number; bytes_downloaded: number } | null;
  onDownload: (model: LlmModelInfo) => void;
  onDownloadAndRun: (model: LlmModelInfo) => void;
  onLoad: (model: LlmModelInfo) => void;
  onDelete: (filename: string) => void;
  onCancel: () => void;
}) {
  const isDownloadingThis = downloadingFilename === model.filename;

  return (
    <Card className={isDownloaded ? "border-green-500/30" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm">{model.name}</CardTitle>
              {model.is_split && (
                <Badge variant="outline" className="text-xs">
                  {model.hf_parts.length + 1} parts
                </Badge>
              )}
              {model.tier === "Default" && (
                <Badge className="text-xs bg-blue-500/20 text-blue-600 border-blue-500/30">
                  Recommended
                </Badge>
              )}
              {isDownloaded && (
                <Badge className="text-xs bg-green-500/20 text-green-600 border-green-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Downloaded
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{model.description}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground mb-1">Disk</p>
            <p className="font-semibold">{model.disk_size_gb.toFixed(1)} GB</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground mb-1">RAM</p>
            <p className="font-semibold">{model.ram_required_gb.toFixed(0)} GB</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground mb-1">Speed</p>
            <p className="font-semibold">{model.speed}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground mb-2">Tool Calling</p>
            <ToolCallRating rating={model.tool_calling_rating} />
          </div>
        </div>

        {/* Download progress for this card */}
        {isDownloadingThis && downloadProgress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {downloadProgress.total_parts > 1
                  ? `Part ${downloadProgress.part}/${downloadProgress.total_parts}`
                  : "Downloading"}
              </span>
              <span>{formatBytes(downloadProgress.bytes_downloaded)}</span>
            </div>
            <Progress value={downloadProgress.percent} className="h-1.5" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {downloadProgress.percent.toFixed(1)}%
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1 text-xs text-destructive"
                onClick={onCancel}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {isDownloaded ? (
            <>
              {!isServerRunning && (
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => onLoad(model)}
                >
                  <Play className="h-3 w-3" />
                  Load & Run
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => onDelete(model.filename)}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                className="gap-1"
                disabled={isDownloadingThis}
                onClick={() => onDownloadAndRun(model)}
              >
                <Zap className="h-3 w-3" />
                Download & Run
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={isDownloadingThis}
                onClick={() => onDownload(model)}
              >
                <Download className="h-3 w-3" />
                Download Only
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Custom Model Section ──────────────────────────────────────────────────

/**
 * Lets users add their own GGUF models two ways:
 *  1. Paste a direct download URL (any GGUF from HuggingFace or elsewhere)
 *  2. Pick a .gguf file already on disk (Tauri only — uses a hidden file input)
 */
function CustomModelSection({ onAdded }: { onAdded: () => void }) {
  const [state, actions] = useLlmContext();
  const { isDownloading, downloadProgress, downloadCancelled } = state;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"url" | "local">("url");

  // URL download state
  const [url, setUrl] = useState("");
  const [customFilename, setCustomFilename] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const deriveFilenameFromUrl = (u: string) => {
    try {
      const segments = new URL(u).pathname.split("/");
      const last = segments[segments.length - 1];
      if (last.endsWith(".gguf")) return last;
    } catch {
      // not a valid URL yet — ignore
    }
    return "";
  };

  const handleUrlChange = (u: string) => {
    setUrl(u);
    if (!customFilename) {
      setCustomFilename(deriveFilenameFromUrl(u));
    }
  };

  const handleUrlDownload = async () => {
    setLocalError(null);
    setSuccessMsg(null);
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    let filename = customFilename.trim();
    if (!filename) {
      filename = deriveFilenameFromUrl(trimmedUrl);
    }
    if (!filename) {
      filename = "custom-model.gguf";
    }
    if (!filename.endsWith(".gguf")) filename += ".gguf";

    try {
      await actions.downloadModel(filename, [trimmedUrl]);
      setSuccessMsg(`Downloaded: ${filename}`);
      setUrl("");
      setCustomFilename("");
      onAdded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes("cancel")) setLocalError(msg);
    }
  };

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalError(null);
    setSuccessMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // In Tauri the webview exposes the real filesystem path via `file.path`
    // (a Tauri-specific extension). Fall back gracefully in browser.
    const filePath = (file as File & { path?: string }).path;

    if (!isTauri() || !filePath) {
      setLocalError(
        "Local file import only works in the desktop app. " +
          "If you're already in the desktop app, try restarting it."
      );
      return;
    }

    if (!file.name.endsWith(".gguf")) {
      setLocalError("Only .gguf files are supported.");
      return;
    }

    setIsImporting(true);
    try {
      const saved = await actions.importLocalModel(filePath, customFilename.trim());
      setSuccessMsg(`Imported: ${saved}`);
      setCustomFilename("");
      onAdded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
    } finally {
      setIsImporting(false);
      // Reset file input so the same file can be picked again if needed
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const progressPercent = downloadProgress?.percent ?? 0;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
            <PackagePlus className="h-4 w-4" />
            Add Custom Model
          </CardTitle>
          <Plus
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-45" : ""}`}
          />
        </button>
        {!open && (
          <CardDescription className="text-xs mt-1">
            Add any GGUF model from a URL or from a file already on your machine.
          </CardDescription>
        )}
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-1 rounded-lg border p-1 bg-muted/30 w-fit">
            <button
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                mode === "url"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode("url")}
            >
              <Link className="h-3 w-3" />
              Download from URL
            </button>
            <button
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                mode === "local"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode("local")}
            >
              <FolderOpen className="h-3 w-3" />
              Use Local File
            </button>
          </div>

          {/* Optional custom filename */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Save as (optional)
            </Label>
            <Input
              placeholder="my-model.gguf — leave blank to use the source filename"
              value={customFilename}
              onChange={(e) => setCustomFilename(e.target.value)}
              className="text-sm h-8"
            />
          </div>

          {mode === "url" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Download URL</Label>
                <Input
                  placeholder="https://huggingface.co/.../model.gguf"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  className="text-sm h-8 font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Direct link to any .gguf file. HuggingFace, GitHub, or any CDN.
                </p>
              </div>

              {/* Download progress */}
              {isDownloading && downloadProgress && !downloadProgress.filename.startsWith("ggml") && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Downloading…</span>
                    <span>{formatBytes(downloadProgress.bytes_downloaded)}</span>
                  </div>
                  <Progress value={progressPercent} className="h-1.5" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{progressPercent.toFixed(1)}%</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1 text-xs text-destructive"
                      onClick={actions.cancelDownload}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {downloadCancelled && (
                <p className="text-xs text-amber-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Download cancelled.
                </p>
              )}

              <Button
                size="sm"
                className="w-full gap-1.5"
                disabled={!url.trim() || isDownloading}
                onClick={handleUrlDownload}
              >
                {isDownloading ? (
                  <><Download className="h-3.5 w-3.5 animate-bounce" />Downloading…</>
                ) : (
                  <><Download className="h-3.5 w-3.5" />Download Model</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Pick a .gguf file already on your machine. It will be copied into the
                app's models folder so it can be managed here.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".gguf"
                className="hidden"
                onChange={handleLocalFile}
              />

              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {isImporting ? "Importing…" : "Choose .gguf File…"}
              </Button>

              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p className="font-medium">Requirements</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Must be a valid GGUF file (llama.cpp format)</li>
                  <li>Compatible with llama-server (most chat/instruct models work)</li>
                  <li>Quantized versions (Q4_K_M, Q5_K_M, etc.) are recommended</li>
                  <li>
                    Find models at{" "}
                    <a
                      href="https://huggingface.co/models?library=gguf&sort=trending"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-foreground"
                    >
                      huggingface.co
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Feedback */}
          {localError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {localError}
            </div>
          )}
          {successMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {successMsg}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Models Tab ────────────────────────────────────────────────────────────

function ModelsTab() {
  const [state, actions] = useLlmContext();
  const {
    hardwareResult,
    downloadProgress,
    isDownloading,
    isStarting,
    startingModelName,
    serverStartProgress,
    serverLogs,
    downloadedModels,
    serverStatus,
    error,
  } = state;
  const { detectHardware, downloadModel, startServer, deleteModel, cancelDownload, listModels } = actions;

  const [downloadingFilename, setDownloadingFilename] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // Ensure hardware/models are loaded
  const ensureHardware = useCallback(async () => {
    if (!hardwareResult) {
      return await detectHardware();
    }
    return hardwareResult;
  }, [hardwareResult, detectHardware]);

  const handleDownload = async (model: LlmModelInfo, andRun: boolean) => {
    setLocalError(null);
    setDownloadingFilename(model.filename);
    try {
      await downloadModel(model.filename, model.all_part_urls);
      if (andRun) {
        const hw = await ensureHardware();
        await startServer(model.filename, hw.recommended_gpu_layers, model.context_length);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes("cancel")) setLocalError(msg);
    } finally {
      setDownloadingFilename(null);
    }
  };

  const handleLoad = async (model: LlmModelInfo) => {
    setLocalError(null);
    try {
      const hw = await ensureHardware();
      await startServer(model.filename, hw.recommended_gpu_layers, model.context_length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
    }
  };

  const handleDelete = async (filename: string) => {
    setLocalError(null);
    try {
      await deleteModel(filename);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
    }
  };

  const allModels = hardwareResult?.all_models ?? [];

  return (
    <div className="space-y-4">
      {(error || localError) && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{error ?? localError}</span>
        </div>
      )}

      {isStarting && (
        <ModelLoadingCard
          modelName={startingModelName}
          progress={serverStartProgress}
          logs={serverLogs}
        />
      )}

      {allModels.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground text-sm">
            <Cpu className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>Run hardware detection first to see available models.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={detectHardware}
            >
              Detect Hardware
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {allModels.map((model) => {
          const isDownloaded = downloadedModels.some(
            (m) => m.filename === model.filename
          );
          return (
            <ModelCard
              key={model.filename}
              model={model}
              isDownloaded={isDownloaded}
              isServerRunning={!!serverStatus?.running}
              downloadingFilename={isDownloading ? downloadingFilename : null}
              downloadProgress={
                downloadingFilename === model.filename ? downloadProgress : null
              }
              onDownload={(m) => handleDownload(m, false)}
              onDownloadAndRun={(m) => handleDownload(m, true)}
              onLoad={handleLoad}
              onDelete={handleDelete}
              onCancel={cancelDownload}
            />
          );
        })}
      </div>

      {/* Custom models already on disk but not in the catalog */}
      {downloadedModels.some(
        (dm) => !allModels.some((m) => m.filename === dm.filename)
      ) && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Your Custom Models</h3>
          {downloadedModels
            .filter((dm) => !allModels.some((m) => m.filename === dm.filename))
            .map((dm) => (
              <Card key={dm.filename}>
                <CardContent className="py-3 px-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{dm.name}</p>
                    <p className="text-xs text-muted-foreground">{dm.size_gb} GB • Custom</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => startServer(dm.filename, 99, 4096)}
                    >
                      <Play className="h-3 w-3" />
                      Load
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(dm.filename)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* Add a new custom model */}
      <CustomModelSection onAdded={listModels} />
    </div>
  );
}

// ── Inference / Playground Tab ────────────────────────────────────────────

type InferenceMode = "chat" | "tools" | "raw";

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface SavedConversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
  modelName?: string;
}

const CONVERSATIONS_STORE_KEY = "llm-playground-conversations";
const MAX_CONVERSATIONS = 50;

function makeTitle(firstUserMsg: string): string {
  return firstUserMsg.length > 40
    ? firstUserMsg.slice(0, 40).trimEnd() + "…"
    : firstUserMsg;
}

function loadConversations(): SavedConversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(convs: SavedConversation[]): void {
  try {
    localStorage.setItem(CONVERSATIONS_STORE_KEY, JSON.stringify(convs.slice(0, MAX_CONVERSATIONS)));
  } catch {
    // storage full — ignore silently
  }
}

// Model switcher used inside the inference header bar
function ModelSwitcher() {
  const [state, actions] = useLlmContext();
  const { serverStatus, downloadedModels, isStarting, hardwareResult } = state;
  const { startServer, stopServer, detectHardware, listModels } = actions;
  const [switching, setSwitching] = useState(false);

  useEffect(() => { listModels(); }, [listModels]);

  const currentModel = serverStatus?.model_name ?? serverStatus?.model_path?.split("/").pop() ?? "";

  const handleSwitch = async (filename: string) => {
    if (switching || isStarting) return;
    setSwitching(true);
    try {
      const hw = hardwareResult ?? await detectHardware();
      const ctx = 8192;
      await stopServer();
      await startServer(filename, hw.recommended_gpu_layers, ctx);
    } catch {
      // error surfaced by server tab
    } finally {
      setSwitching(false);
    }
  };

  if (downloadedModels.length <= 1) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
        <span className="font-medium truncate max-w-[160px]">{currentModel || "Running"}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
      <select
        className="text-xs bg-transparent border-0 outline-none cursor-pointer font-medium text-foreground max-w-[200px] truncate"
        value={downloadedModels.find((m) => serverStatus?.model_path?.includes(m.filename))?.filename ?? ""}
        onChange={(e) => handleSwitch(e.target.value)}
        disabled={switching || isStarting}
        title="Switch model"
      >
        {downloadedModels.map((m) => (
          <option key={m.filename} value={m.filename} className="bg-background">
            {m.name} ({m.size_gb} GB)
          </option>
        ))}
      </select>
      {(switching || isStarting) && (
        <span className="text-xs text-muted-foreground animate-pulse">switching…</span>
      )}
    </div>
  );
}

function InferenceTab() {
  const [state, actions] = useLlmContext();
  const { serverStatus, isStarting, hardwareResult, downloadedModels } = state;
  const { startServer, stopServer, detectHardware, listModels } = actions;

  // ── Conversation list ──────────────────────────────────────────────────
  const [conversations, setConversations] = useState<SavedConversation[]>(() => loadConversations());
  const [activeConvId, setActiveConvId] = useState<string | null>(
    () => loadConversations()[0]?.id ?? null
  );

  // ── Active conversation state ──────────────────────────────────────────
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const messages: ConversationMessage[] = activeConv?.messages ?? [];
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Settings panel ─────────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(activeConv?.systemPrompt ?? "");
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.8);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [mode, setMode] = useState<InferenceMode>("chat");

  // Tool / Raw state
  const [toolDef, setToolDef] = useState(
    JSON.stringify({ type: "function", function: { name: "get_weather", description: "Get current weather for a location", parameters: { type: "object", properties: { location: { type: "string", description: "City name" } }, required: ["location"] } } }, null, 2)
  );
  const [toolResult, setToolResult] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState(
    JSON.stringify({ model: "local", messages: [{ role: "user", content: "Hello!" }], max_tokens: 256, temperature: 0.7, stream: false }, null, 2)
  );
  const [rawResult, setRawResult] = useState<string | null>(null);

  // ── Server launch state ────────────────────────────────────────────────
  const [gpuLayersOverride, setGpuLayersOverride] = useState(99);
  const [gpuLayersRaw, setGpuLayersRaw] = useState("99");
  const [contextLengthOverride, setContextLengthOverride] = useState(8192);
  const [selectedModel, setSelectedModel] = useState("");

  useEffect(() => { listModels(); }, [listModels]);

  useEffect(() => {
    if (hardwareResult?.recommended_gpu_layers !== undefined) {
      setGpuLayersOverride(hardwareResult.recommended_gpu_layers);
      setGpuLayersRaw(String(hardwareResult.recommended_gpu_layers));
    }
  }, [hardwareResult?.recommended_gpu_layers]);

  // Sync system prompt when switching conversations
  useEffect(() => {
    setSystemPrompt(activeConv?.systemPrompt ?? "");
  }, [activeConvId]);

  const port = serverStatus?.running ? serverStatus.port : null;

  // ── Conversation helpers ───────────────────────────────────────────────
  const persistConvs = (updated: SavedConversation[]) => {
    setConversations(updated);
    saveConversations(updated);
  };

  const newConversation = () => {
    const conv: SavedConversation = {
      id: crypto.randomUUID(),
      title: "New conversation",
      messages: [],
      systemPrompt: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelName: serverStatus?.model_name,
    };
    const updated = [conv, ...conversations];
    persistConvs(updated);
    setActiveConvId(conv.id);
    setSystemPrompt("");
    setInput("");
    setError(null);
  };

  const deleteConversation = (id: string) => {
    const updated = conversations.filter((c) => c.id !== id);
    persistConvs(updated);
    if (activeConvId === id) {
      setActiveConvId(updated[0]?.id ?? null);
    }
  };

  const updateMessages = (id: string, msgs: ConversationMessage[], sysPrompt?: string) => {
    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === id
          ? {
              ...c,
              messages: msgs,
              systemPrompt: sysPrompt !== undefined ? sysPrompt : c.systemPrompt,
              title: msgs.find((m) => m.role === "user")
                ? makeTitle(msgs.find((m) => m.role === "user")!.content)
                : c.title,
              updatedAt: Date.now(),
            }
          : c
      );
      saveConversations(updated);
      return updated;
    });
  };

  const scrollToBottom = () => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  // ── Send message ───────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!port || !input.trim() || isGenerating) return;
    const userMsg = input.trim();
    setInput("");
    setError(null);
    stopRef.current = false;

    // Ensure we have an active conversation
    let convId = activeConvId;
    if (!convId) {
      const conv: SavedConversation = {
        id: crypto.randomUUID(),
        title: makeTitle(userMsg),
        messages: [],
        systemPrompt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        modelName: serverStatus?.model_name,
      };
      persistConvs([conv, ...conversations]);
      convId = conv.id;
      setActiveConvId(convId);
    }

    const chatMessages: ChatMessage[] = [
      ...(systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: userMsg },
    ];

    const assistantId = crypto.randomUUID();
    const newMessages: ConversationMessage[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: userMsg },
      { id: assistantId, role: "assistant", content: "", isStreaming: true },
    ];

    updateMessages(convId, newMessages, systemPrompt);
    setIsGenerating(true);
    scrollToBottom();

    let accumulated = "";
    try {
      const stream = streamCompletion(port, chatMessages, { temperature, maxTokens });
      for await (const token of stream) {
        if (stopRef.current) break;
        accumulated += token;
        setConversations((prev) => {
          const updated = prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantId ? { ...m, content: accumulated } : m
                  ),
                }
              : c
          );
          saveConversations(updated);
          return updated;
        });
        scrollToBottom();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === convId
            ? { ...c, messages: c.messages.map((m) => m.id === assistantId ? { ...m, isStreaming: false } : m) }
            : c
        );
        saveConversations(updated);
        return updated;
      });
      setIsGenerating(false);
    }
  };

  const handleToolTest = async () => {
    if (!port || !input.trim()) return;
    setError(null);
    setToolResult(null);
    setIsGenerating(true);
    try {
      const tool = JSON.parse(toolDef);
      const result = await callWithTools(port, [{ role: "user", content: input }], [tool]);
      setToolResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRawJson = async () => {
    if (!port) return;
    setError(null);
    setRawResult(null);
    setIsGenerating(true);
    try {
      const body = JSON.parse(rawJson);
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setRawResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartServer = async () => {
    const modelToLoad = selectedModel || downloadedModels[0]?.filename;
    if (!modelToLoad) {
      setError("No model selected. Download a model from the Models tab first.");
      return;
    }
    try {
      if (!hardwareResult) await detectHardware();
      await startServer(modelToLoad, gpuLayersOverride, contextLengthOverride);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── No server running — launch screen ─────────────────────────────────
  if (!port) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-16rem)]">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4" />
              Start Inference Server
            </CardTitle>
            <CardDescription>
              Load a model to open the playground.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {isStarting && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                Starting server…
              </div>
            )}
            {downloadedModels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No models downloaded yet. Go to the <strong>Models</strong> tab to download one.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-xs">Model</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedModel || downloadedModels[0]?.filename}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  >
                    {downloadedModels.map((m) => (
                      <option key={m.filename} value={m.filename}>
                        {m.name} ({m.size_gb} GB)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs" title="Transformer layers to offload to GPU. 99 = all layers (Metal/CUDA). 0 = CPU only.">
                      GPU Layers
                    </Label>
                    <Input
                      type="number"
                      value={gpuLayersRaw}
                      onChange={(e) => { setGpuLayersRaw(e.target.value); const n = parseInt(e.target.value); if (!isNaN(n)) setGpuLayersOverride(n); }}
                      onBlur={() => { const n = parseInt(gpuLayersRaw); const c = isNaN(n) ? 0 : n; setGpuLayersOverride(c); setGpuLayersRaw(String(c)); }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Context Length</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={contextLengthOverride}
                      onChange={(e) => setContextLengthOverride(parseInt(e.target.value))}
                    >
                      {[2048, 4096, 8192, 16384, 32768].map((n) => (
                        <option key={n} value={n}>{n.toLocaleString()}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <Button className="w-full" disabled={isStarting} onClick={handleStartServer}>
                  {isStarting ? "Starting…" : "Start Server"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Full playground layout ─────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-13rem)] gap-0 rounded-xl border overflow-hidden bg-background">

      {/* ── Left sidebar: conversation list ── */}
      <div className="w-56 shrink-0 flex flex-col border-r bg-muted/20">
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conversations</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={newConversation} title="New conversation">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1.5 space-y-0.5">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6 px-2">
                No conversations yet. Start chatting!
              </p>
            )}
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-1 rounded-lg px-2 py-2 cursor-pointer text-sm transition-colors ${
                  conv.id === activeConvId
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/60 text-foreground"
                }`}
                onClick={() => { setActiveConvId(conv.id); setError(null); }}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="flex-1 truncate text-xs leading-tight">{conv.title}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity"
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  title="Delete"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Main chat area ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
          <div className="flex items-center gap-3">
            {/* Mode switcher */}
            <div className="flex gap-0.5 rounded-md border p-0.5 bg-muted/30">
              {(["chat", "tools", "raw"] as InferenceMode[]).map((m) => (
                <button
                  key={m}
                  className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    mode === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setMode(m)}
                >
                  {m === "chat" && <MessageSquare className="h-3 w-3" />}
                  {m === "tools" && <Wrench className="h-3 w-3" />}
                  {m === "raw" && <Code className="h-3 w-3" />}
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <ModelSwitcher />
          </div>
          <div className="flex items-center gap-2">
            {mode === "chat" && activeConv && messages.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground gap-1"
                onClick={() => { updateMessages(activeConvId!, [], systemPrompt); setError(null); }}
                title="Clear messages"
              >
                <RotateCcw className="h-3 w-3" />
                Clear
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 w-7 ${showSettings ? "bg-muted" : ""}`}
              onClick={() => setShowSettings((v) => !v)}
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={stopServer}
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-destructive bg-destructive/10 border-b shrink-0">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
            <button className="ml-auto text-xs underline" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {/* ── Chat mode ── */}
        {mode === "chat" && (
          <>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-6 max-w-3xl mx-auto w-full">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <MessageSquare className="h-6 w-6 text-primary/60" />
                    </div>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      Start a conversation with the local model. Your chats are saved automatically.
                    </p>
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "assistant" && (
                      <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                        <Cpu className="h-3.5 w-3.5 text-primary" />
                      </div>
                    )}
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : "bg-muted/60 rounded-tl-sm"
                      }`}
                    >
                      <pre className="whitespace-pre-wrap font-sans break-words">{msg.content}</pre>
                      {msg.isStreaming && (
                        <span className="inline-block h-4 w-0.5 bg-current opacity-70 animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-semibold text-muted-foreground">U</span>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Input area */}
            <div className="border-t p-3 shrink-0 bg-background">
              <div className="max-w-3xl mx-auto flex gap-2 items-end">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="Message the local model… (Enter to send, Shift+Enter for newline)"
                  className="text-sm resize-none flex-1 min-h-[44px] max-h-[200px] rounded-xl border-muted-foreground/20"
                  disabled={isGenerating}
                  rows={1}
                />
                {isGenerating ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 w-10 shrink-0 rounded-xl"
                    onClick={() => (stopRef.current = true)}
                    title="Stop generation"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-10 w-10 shrink-0 rounded-xl"
                    disabled={!input.trim()}
                    onClick={handleSend}
                    title="Send"
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Tools mode ── */}
        {mode === "tools" && (
          <div className="flex-1 overflow-auto p-4">
            <div className="grid grid-cols-2 gap-4 h-full max-w-4xl mx-auto">
              <div className="space-y-3">
                <Label className="text-sm font-medium">Tool Definition (JSON)</Label>
                <Textarea value={toolDef} onChange={(e) => setToolDef(e.target.value)} className="font-mono text-xs h-48 resize-none" />
                <Label className="text-sm font-medium">User Prompt</Label>
                <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="What is the weather in San Francisco?" className="text-sm resize-none h-24" />
                <Button disabled={isGenerating || !input.trim()} onClick={handleToolTest} className="w-full">
                  {isGenerating ? "Running…" : "Run Tool Call"}
                </Button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Response</Label>
                  {toolResult && <CopyButton text={toolResult} />}
                </div>
                {toolResult ? (
                  <ScrollArea className="h-96 rounded-lg border bg-muted/30">
                    <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{toolResult}</pre>
                  </ScrollArea>
                ) : (
                  <div className="h-96 rounded-lg border bg-muted/10 flex items-center justify-center text-sm text-muted-foreground">Response will appear here</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Raw JSON mode ── */}
        {mode === "raw" && (
          <div className="flex-1 overflow-auto p-4">
            <div className="grid grid-cols-2 gap-4 max-w-4xl mx-auto">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Request Body</Label>
                  <span className="text-xs text-muted-foreground font-mono">POST /v1/chat/completions</span>
                </div>
                <Textarea value={rawJson} onChange={(e) => setRawJson(e.target.value)} className="font-mono text-xs h-64 resize-none" />
                <Button disabled={isGenerating} onClick={handleRawJson} className="w-full">
                  {isGenerating ? "Running…" : "Send Request"}
                </Button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Raw Response</Label>
                  {rawResult && <CopyButton text={rawResult} />}
                </div>
                {rawResult ? (
                  <ScrollArea className="h-96 rounded-lg border bg-muted/30">
                    <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{rawResult}</pre>
                  </ScrollArea>
                ) : (
                  <div className="h-96 rounded-lg border bg-muted/10 flex items-center justify-center text-sm text-muted-foreground">Response will appear here</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Right settings panel ── */}
      {showSettings && (
        <div className="w-64 shrink-0 flex flex-col border-l bg-muted/10">
          <div className="flex items-center justify-between px-3 py-2.5 border-b">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Settings</span>
            <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-5">
              {/* System prompt */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">System Prompt</Label>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => {
                    setSystemPrompt(e.target.value);
                    if (activeConvId) updateMessages(activeConvId, messages, e.target.value);
                  }}
                  placeholder="You are a helpful assistant…"
                  className="text-xs resize-none h-28"
                />
              </div>

              <Separator />

              {/* Sampling params */}
              <div className="space-y-4">
                <p className="text-xs font-medium">Sampling</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground">Temperature</Label>
                    <span className="text-xs tabular-nums">{temperature.toFixed(2)}</span>
                  </div>
                  <Slider min={0.01} max={2} step={0.01} value={[temperature]} onValueChange={([v]) => setTemperature(v)} />
                  <p className="text-xs text-muted-foreground">0.7 balanced · 0.1 precise · 1.5 creative</p>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground">Top-P</Label>
                    <span className="text-xs tabular-nums">{topP.toFixed(2)}</span>
                  </div>
                  <Slider min={0.1} max={1} step={0.05} value={[topP]} onValueChange={([v]) => setTopP(v)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Max Tokens</Label>
                  <Input
                    type="number"
                    value={maxTokens}
                    onChange={(e) => { const n = parseInt(e.target.value); if (!isNaN(n) && n > 0) setMaxTokens(n); }}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <Separator />

              {/* Server info */}
              <div className="space-y-2">
                <p className="text-xs font-medium">Server</p>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Port</span>
                    <span className="font-mono">{port}</span>
                  </div>
                  {serverStatus?.gpu_layers !== undefined && (
                    <div className="flex justify-between">
                      <span>GPU layers</span>
                      <span className="font-mono">{serverStatus.gpu_layers}</span>
                    </div>
                  )}
                  {serverStatus?.context_length !== undefined && (
                    <div className="flex justify-between">
                      <span>Context</span>
                      <span className="font-mono">{serverStatus.context_length.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ── Server Tab ────────────────────────────────────────────────────────────

function ServerTab() {
  const [state, actions] = useLlmContext();
  const {
    serverStatus,
    isStarting,
    startingModelName,
    serverStartProgress,
    serverLogs,
    downloadedModels,
    hardwareResult,
    isDetecting,
  } = state;
  const { startServer, stopServer, getServerStatus, healthCheck, detectHardware } = actions;

  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [healthLatency, setHealthLatency] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // Null means "not yet user-edited" — will be set from hardware detection
  const [gpuLayers, setGpuLayers] = useState<number | null>(null);
  const [contextLen, setContextLen] = useState(8192);
  const [selectedModel, setSelectedModel] = useState(
    downloadedModels[0]?.filename ?? ""
  );
  // Persisted logs shown after a failed start attempt
  const [failureLogs, setFailureLogs] = useState<ServerLogLine[]>([]);
  const [showFailureLogs, setShowFailureLogs] = useState(true);

  // Auto-detect hardware on mount so GPU layers have a real default
  useEffect(() => {
    if (!hardwareResult && !isDetecting) {
      detectHardware().catch(() => {/* non-critical */});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync gpuLayers default from hardware detection result (only when not yet user-edited)
  useEffect(() => {
    if (hardwareResult && gpuLayers === null) {
      setGpuLayers(hardwareResult.recommended_gpu_layers ?? 99);
    }
  }, [hardwareResult, gpuLayers]);

  const effectiveGpuLayers = gpuLayers ?? 99;

  const runHealthCheck = async () => {
    setLocalError(null);
    const start = Date.now();
    const ok = await healthCheck();
    setHealthOk(ok);
    setHealthLatency(Date.now() - start);
  };

  const handleStart = async () => {
    setLocalError(null);
    setFailureLogs([]);
    const model = selectedModel || downloadedModels[0]?.filename;
    if (!model) return;
    try {
      if (!hardwareResult) await detectHardware();
      await startServer(model, effectiveGpuLayers, contextLen);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
      // Capture whatever logs accumulated during the failed start attempt
      setFailureLogs(serverLogs.slice());
      setShowFailureLogs(true);
    }
  };

  const handleStop = async () => {
    try {
      await stopServer();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRefresh = async () => {
    try {
      await getServerStatus();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const endpointUrl = serverStatus?.running
    ? `http://127.0.0.1:${serverStatus.port}/v1`
    : null;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Error banner */}
      {localError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive space-y-1">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-sans break-words flex-1">{localError}</pre>
          </div>
        </div>
      )}

      {/* Live loading card — shown while server is starting */}
      {isStarting && (
        <ModelLoadingCard
          modelName={startingModelName}
          progress={serverStartProgress}
          logs={serverLogs}
        />
      )}

      {/* Post-failure log panel — persists after a failed start */}
      {!isStarting && failureLogs.length > 0 && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
            onClick={() => setShowFailureLogs((v) => !v)}
          >
            {showFailureLogs ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
            <span>Server output</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {failureLogs.length} line{failureLogs.length !== 1 ? "s" : ""}
            </span>
          </button>
          {showFailureLogs && (
            <div className="border-t px-4 py-3 space-y-0.5 max-h-64 overflow-y-auto">
              {failureLogs.map((l, i) => (
                <p
                  key={i}
                  className={`text-xs font-mono leading-relaxed ${
                    l.kind === "error"
                      ? "text-destructive"
                      : l.kind === "ready"
                      ? "text-green-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {l.line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Server Status
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isStarting}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {serverStatus?.running ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    <p className="font-medium text-green-600">Running</p>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Port</p>
                  <p className="font-medium">{serverStatus.port}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Model</p>
                  <p className="font-medium truncate">{serverStatus.model_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">GPU Layers</p>
                  <p className="font-medium">{serverStatus.gpu_layers}</p>
                </div>
              </div>

              {endpointUrl && (
                <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                  <code className="text-xs flex-1 overflow-hidden text-ellipsis">
                    {endpointUrl}
                  </code>
                  <CopyButton text={endpointUrl} label="Copy URL" />
                </div>
              )}

              {/* Health check */}
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" onClick={runHealthCheck}>
                  Check Health
                </Button>
                {healthOk !== null && (
                  <span
                    className={`text-sm flex items-center gap-1.5 ${
                      healthOk ? "text-green-600" : "text-destructive"
                    }`}
                  >
                    {healthOk ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    {healthOk ? `OK — ${healthLatency}ms` : "Unhealthy"}
                  </span>
                )}
              </div>

              <Separator />

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30"
                  onClick={handleStop}
                >
                  <Square className="h-3 w-3 mr-1" />
                  Stop Server
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              {isStarting ? "Starting…" : "Server not running"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Start Server Card — hidden while starting or already running */}
      {!serverStatus?.running && !isStarting && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Start Server
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {downloadedModels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No models downloaded. Go to the Models tab first.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-xs">Model</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedModel || downloadedModels[0]?.filename}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  >
                    {downloadedModels.map((m) => (
                      <option key={m.filename} value={m.filename}>
                        {m.name} ({m.size_gb} GB)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label
                        className="text-xs"
                        title="Transformer layers to offload to the GPU accelerator. 99 = offload all layers (fastest, uses GPU memory). 0 = CPU-only. Auto-set from your hardware."
                      >
                        GPU Layers (offload to accelerator)
                      </Label>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {effectiveGpuLayers}
                        {isDetecting && " (detecting…)"}
                        {!isDetecting && hardwareResult && gpuLayers !== null && (
                          <span className="text-green-600 ml-1">✓ auto</span>
                        )}
                      </span>
                    </div>
                    <Slider
                      min={0} max={99} step={1}
                      value={[effectiveGpuLayers]}
                      onValueChange={([v]) => setGpuLayers(v)}
                      disabled={isDetecting}
                    />
                    <p className="text-xs text-muted-foreground">
                      {hardwareResult
                        ? hardwareResult.recommended_gpu_layers === 99
                          ? "Full GPU offload recommended for your hardware"
                          : hardwareResult.recommended_gpu_layers === 0
                          ? "CPU-only mode recommended (no compatible GPU)"
                          : `Partial offload recommended for your hardware`
                        : "99 = full GPU offload · 0 = CPU only"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Context Length</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={contextLen}
                      onChange={(e) => setContextLen(parseInt(e.target.value))}
                    >
                      <option value={2048}>2048</option>
                      <option value={4096}>4096</option>
                      <option value={8192}>8192 (recommended)</option>
                      <option value={16384}>16384</option>
                      <option value={32768}>32768</option>
                    </select>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={isStarting || isDetecting}
                  onClick={handleStart}
                >
                  {isStarting ? "Starting…" : "Start Server"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Hardware Tab ──────────────────────────────────────────────────────────

function HardwareTab() {
  const [state, actions] = useLlmContext();
  const { hardwareResult, isDetecting, downloadedModels } = state;
  const { detectHardware, listModels } = actions;

  useEffect(() => {
    listModels();
  }, [listModels]);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">System Hardware</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={isDetecting}
          onClick={detectHardware}
        >
          {isDetecting ? "Detecting…" : "Refresh"}
        </Button>
      </div>

      {!hardwareResult ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground text-sm">
            <HardDrive className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>Click Refresh to detect your hardware capabilities.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Memory</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total RAM</span>
                  <span className="font-medium">
                    {(hardwareResult.hardware.total_ram_mb / 1024).toFixed(1)} GB
                  </span>
                </div>
                {hardwareResult.hardware.gpu_vram_mb && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">GPU VRAM</span>
                    <span className="font-medium">
                      {(hardwareResult.hardware.gpu_vram_mb / 1024).toFixed(1)} GB
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Compute</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">CPU Threads</span>
                  <span className="font-medium">{hardwareResult.hardware.cpu_threads}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Acceleration</span>
                  <span className="font-medium">
                    {hardwareResult.hardware.is_apple_silicon
                      ? "Apple Metal"
                      : hardwareResult.hardware.supports_cuda
                      ? "CUDA"
                      : "CPU only"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Model Recommendation</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{hardwareResult.recommended_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {hardwareResult.recommended_size_gb.toFixed(1)} GB •{" "}
                    {hardwareResult.recommended_gpu_layers === 99
                      ? "Full GPU offload"
                      : hardwareResult.recommended_gpu_layers === 0
                      ? "CPU inference"
                      : `${hardwareResult.recommended_gpu_layers} GPU layers`}
                  </p>
                </div>
                {hardwareResult.can_upgrade && (
                  <Badge variant="outline" className="text-xs">
                    Can upgrade
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
                {hardwareResult.reason}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">All Compatible Models</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {hardwareResult.all_models.map((m) => {
                  const isRecommended = m.filename === hardwareResult.recommended_filename;
                  const ramOk = hardwareResult.hardware.total_ram_mb / 1024 >= m.ram_required_gb;
                  const downloaded = m.is_split
                    ? downloadedModels.some(
                        (d) => d.filename === m.filename && d.all_parts_present
                      )
                    : downloadedModels.some((d) => d.filename === m.filename);
                  return (
                    <div
                      key={m.filename}
                      className={`flex items-center justify-between py-2 text-sm ${
                        !ramOk ? "opacity-50" : ""
                      }`}
                    >
                      <div>
                        <span className="font-medium">{m.name}</span>
                        {isRecommended && (
                          <Badge className="ml-2 text-xs bg-blue-500/20 text-blue-600 border-blue-500/30">
                            Recommended
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{m.disk_size_gb.toFixed(1)} GB</span>
                        <span>{m.ram_required_gb.toFixed(0)} GB RAM</span>
                        {downloaded ? (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-500/40 gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Downloaded
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Not downloaded
                          </Badge>
                        )}
                        {!ramOk && (
                          <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">
                            Low RAM
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Page Root ─────────────────────────────────────────────────────────────

export function LocalModels() {
  // Single hook instance — all tabs share this state, no resets when switching tabs
  const llm = useLlm();

  return (
    <LlmContext.Provider value={llm}>
      <LocalModelsInner />
    </LlmContext.Provider>
  );
}

function LocalModelsInner() {
  const [state] = useLlmContext();
  const { serverStatus } = state;

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Cpu className="h-6 w-6 text-blue-500" />
              Local Models
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Run AI models locally on your device using llama.cpp
            </p>
          </div>
          {serverStatus?.running && (
            <Badge className="bg-green-500/20 text-green-600 border-green-500/30 gap-1.5">
              <Activity className="h-3 w-3" />
              Server running · port {serverStatus.port}
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="setup" className="flex-1 flex flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="setup" className="gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Setup
          </TabsTrigger>
          <TabsTrigger value="models" className="gap-1.5">
            <HardDrive className="h-3.5 w-3.5" />
            Models
          </TabsTrigger>
          <TabsTrigger value="inference" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Inference
          </TabsTrigger>
          <TabsTrigger value="server" className="gap-1.5">
            <Server className="h-3.5 w-3.5" />
            Server
          </TabsTrigger>
          <TabsTrigger value="hardware" className="gap-1.5">
            <Cpu className="h-3.5 w-3.5" />
            Hardware
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto pt-6">
          <TabsContent value="setup" className="m-0">
            <SetupTab />
          </TabsContent>
          <TabsContent value="models" className="m-0">
            <ModelsTab />
          </TabsContent>
          <TabsContent value="inference" className="m-0 h-full">
            <InferenceTab />
          </TabsContent>
          <TabsContent value="server" className="m-0">
            <ServerTab />
          </TabsContent>
          <TabsContent value="hardware" className="m-0">
            <HardwareTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
