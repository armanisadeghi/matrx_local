"use client";

import { useState, useRef, useCallback, createContext, useContext, useEffect } from "react";
import type { LlmState, LlmActions, ServerStartProgress, ServerLogLine } from "@/hooks/use-llm";
import { useLlmApp } from "@/contexts/LlmContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  Check,
  MessageSquare,
  Wrench,
  Code,
  Server,
  Settings,
  X,
  FolderOpen,
  Plus,
  PackagePlus,
  ExternalLink,
  Loader2,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  GitFork,
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
import { streamCompletion, callWithTools, ContextSizeError } from "@/lib/llm/api";
import type { ChatMessage, LlmModelInfo } from "@/lib/llm/types";
import { useNavigate } from "react-router-dom";
import { systemPrompts, BUILTIN_PROMPTS } from "@/lib/system-prompts";
import type { SystemPrompt } from "@/lib/system-prompts";
import { ModelRepoAnalyzer } from "@/components/llm/ModelRepoAnalyzer";

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

function MsgCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className={`rounded-md p-1.5 transition-colors ${copied ? "text-emerald-500" : "text-muted-foreground hover:text-foreground"}`}
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
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

  useEffect(() => {
    if (!hardwareResult && !isDetecting) {
      detectHardware().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              {isDetecting ? "Detecting…" : "Re-detect"}
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
                    ? `CUDA${hardwareResult.hardware.gpu_name ? ` — ${hardwareResult.hardware.gpu_name}` : ""} — ${((hardwareResult.hardware.gpu_vram_mb ?? 0) / 1024).toFixed(0)} GB VRAM`
                    : hardwareResult.hardware.supports_vulkan
                    ? `Vulkan${hardwareResult.hardware.gpu_name ? ` — ${hardwareResult.hardware.gpu_name}` : ""}${hardwareResult.hardware.gpu_vram_mb ? ` — ${((hardwareResult.hardware.gpu_vram_mb) / 1024).toFixed(0)} GB VRAM` : ""}`
                    : "No GPU detected — CPU inference"}
                </p>
                {!hardwareResult.hardware.is_apple_silicon
                  && !hardwareResult.hardware.supports_cuda
                  && !hardwareResult.hardware.supports_vulkan && (
                  <p className="text-xs text-amber-500 mt-0.5">
                    GPU not found. Ensure GPU drivers are installed and try Re-detect.
                  </p>
                )}
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
          {!hardwareResult && isDetecting && (
            <p className="text-xs text-center text-muted-foreground">
              Detecting hardware…
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Custom Model Inline Row ───────────────────────────────────────────────

function CustomModelRow({ onAdded }: { onAdded: () => void }) {
  const [state, actions] = useLlmContext();
  const { isDownloading, downloadProgress, downloadCancelled } = state;

  const [mode, setMode] = useState<"url" | "local">("url");
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
    } catch { /* ignore */ }
    return "";
  };

  const handleUrlChange = (u: string) => {
    setUrl(u);
    if (!customFilename) setCustomFilename(deriveFilenameFromUrl(u));
  };

  const handleUrlDownload = async () => {
    setLocalError(null);
    setSuccessMsg(null);
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    let filename = customFilename.trim() || deriveFilenameFromUrl(trimmedUrl) || "custom-model.gguf";
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
    const filePath = (file as File & { path?: string }).path;
    if (!isTauri() || !filePath) {
      setLocalError("Local file import only works in the desktop app.");
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
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const progressPercent = downloadProgress?.percent ?? 0;
  const isCustomDownloading = isDownloading && downloadProgress && !downloadProgress.filename.startsWith("ggml");

  return (
    <div className="rounded-lg border border-dashed bg-muted/10 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <PackagePlus className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-muted-foreground">Add Custom Model</span>
        <div className="flex gap-0.5 rounded-md border p-0.5 bg-muted/30 ml-auto">
          <button
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              mode === "url" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("url")}
          >
            URL
          </button>
          <button
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              mode === "local" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("local")}
          >
            Local File
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".gguf" className="hidden" onChange={handleLocalFile} />

      <div className="flex items-end gap-2">
        {mode === "url" ? (
          <div className="flex-1">
            <Input
              placeholder="https://huggingface.co/.../model.gguf"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="text-xs h-8 font-mono"
            />
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen className="h-3 w-3" />
            {isImporting ? "Importing…" : "Choose .gguf"}
          </Button>
        )}
        <Input
          placeholder="Save as (optional)"
          value={customFilename}
          onChange={(e) => setCustomFilename(e.target.value)}
          className="text-xs h-8 w-44"
        />
        {mode === "url" && (
          <Button
            size="sm"
            className="gap-1 h-8 px-3"
            disabled={!url.trim() || isDownloading}
            onClick={handleUrlDownload}
          >
            <Download className="h-3 w-3" />
            {isDownloading ? "Downloading…" : "Add"}
          </Button>
        )}
      </div>

      {isCustomDownloading && downloadProgress && (
        <div className="flex items-center gap-3">
          <Progress value={progressPercent} className="h-1.5 flex-1" />
          <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{progressPercent.toFixed(0)}%</span>
          <button className="text-xs text-destructive hover:underline" onClick={actions.cancelDownload}>Cancel</button>
        </div>
      )}

      {downloadCancelled && (
        <p className="text-xs text-amber-500 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Cancelled.
        </p>
      )}
      {localError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {localError}
        </p>
      )}
      {successMsg && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          {successMsg}
        </p>
      )}
    </div>
  );
}

// ── HuggingFace Token Panel ───────────────────────────────────────────────
//
// Some HuggingFace repos store files in their XET content-addressed storage
// system. A plain HTTP download cannot reconstruct XET files — it requires
// an access token so HF can serve a direct CDN URL instead.
//
// This panel lets users add their (free) HF token once. It shows:
//   • When xetTokenRequired is set (download just failed needing a token)
//   • Always as a collapsible section at the bottom of the Models tab

function HfTokenPanel({ forcedOpen = false }: { forcedOpen?: boolean }) {
  const [state, actions] = useLlmContext();
  const { hfToken, xetTokenRequired } = state;
  const { saveHfToken, clearError } = actions;

  const [open, setOpen] = useState(forcedOpen || xetTokenRequired);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Auto-expand if a download just failed with XET error
  useEffect(() => {
    if (xetTokenRequired) setOpen(true);
  }, [xetTokenRequired]);

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed.startsWith("hf_") && trimmed !== "") {
      setLocalError('HuggingFace tokens start with "hf_". Please check and try again.');
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      await saveHfToken(trimmed);
      setSavedMsg(true);
      setInputValue("");
      clearError();
      setTimeout(() => setSavedMsg(false), 3000);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await saveHfToken("");
      setSavedMsg(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-lg border ${xetTokenRequired ? "border-amber-500/60 bg-amber-500/5" : "border-border bg-muted/10"} p-4 space-y-3`}>
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm font-medium flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          HuggingFace Access Token
          {hfToken ? (
            <span className="ml-1 text-xs text-green-500 font-normal">✓ configured</span>
          ) : (
            <span className="ml-1 text-xs text-muted-foreground font-normal">optional — required for some models</span>
          )}
        </span>
        {open ? <ChevronUp className="h-3 w-3 ml-auto text-muted-foreground" /> : <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-3 pt-1">
          {xetTokenRequired && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-600 dark:text-amber-400 space-y-1">
              <p className="font-medium">This model requires a HuggingFace token to download.</p>
              <p>The model is hosted on HuggingFace's new XET storage system, which requires authentication. A <strong>free</strong> account and read-only token is all you need.</p>
            </div>
          )}

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground text-sm">How to get your token (free):</p>
            <ol className="space-y-1 list-decimal list-inside">
              <li>
                Go to{" "}
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
                >
                  huggingface.co/settings/tokens <ExternalLink className="h-3 w-3" />
                </a>
                {" "}(create a free account if you don't have one)
              </li>
              <li>Click <strong>New token</strong>, choose <strong>Read</strong> access, give it any name</li>
              <li>Copy the token (starts with <code className="bg-muted px-1 rounded">hf_</code>) and paste it below</li>
            </ol>
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="password"
              placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="text-xs h-8 font-mono flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            />
            <Button size="sm" className="h-8 px-3" disabled={!inputValue.trim() || saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {hfToken && (
              <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive" disabled={saving} onClick={handleClear}>
                Remove
              </Button>
            )}
          </div>

          {localError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {localError}
            </p>
          )}
          {savedMsg && (
            <p className="text-xs text-green-500 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              Token saved. Downloads will now work for XET-storage repos.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Your token is stored locally on this machine only. It is never sent anywhere except to huggingface.co when downloading models.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Models Tab ────────────────────────────────────────────────────────────

function ModelsTab() {
  const [state, actions] = useLlmContext();
  const {
    hardwareResult,
    downloadProgress,
    isDownloading,
    downloadingFilename,
    downloadQueue,
    isStarting,
    isDetecting,
    startingModelName,
    serverStartProgress,
    serverLogs,
    downloadedModels,
    serverStatus,
    error,
    xetTokenRequired,
  } = state;
  const { detectHardware, startServer, deleteModel, cancelDownload, queueDownload, downloadAll, listModels } = actions;

  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    if (!hardwareResult && !isDetecting) {
      detectHardware().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureHardware = useCallback(async () => {
    if (!hardwareResult) return await detectHardware();
    return hardwareResult;
  }, [hardwareResult, detectHardware]);

  const handleDownload = (model: LlmModelInfo, andRun: boolean) => {
    setLocalError(null);
    if (andRun) {
      // For "download and run" we still need the sequential async flow
      const run = async () => {
        try {
          const hw = await ensureHardware();
          queueDownload(model.filename, model.all_part_urls);
          // Wait for download to complete then start server
          const checkAndStart = async () => {
            const isNowDownloaded = downloadedModels.some((m) => m.filename === model.filename);
            if (isNowDownloaded) {
              await startServer(model.filename, hw.recommended_gpu_layers, model.context_length);
            } else {
              setTimeout(checkAndStart, 500);
            }
          };
          setTimeout(checkAndStart, 1000);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.toLowerCase().includes("cancel")) setLocalError(msg);
        }
      };
      void run();
    } else {
      queueDownload(model.filename, model.all_part_urls);
    }
  };

  const handleDownloadAll = () => {
    const allModels = hardwareResult?.all_models ?? [];
    const entries = allModels
      .filter((m) => !downloadedModels.some((d) => d.filename === m.filename))
      .map((m) => ({ filename: m.filename, urls: m.all_part_urls }));
    downloadAll(entries);
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

  const handleLoadCustom = async (filename: string) => {
    setLocalError(null);
    try {
      const hw = await ensureHardware();
      await startServer(filename, hw.recommended_gpu_layers, 4096);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
    }
  };

  const allModels = hardwareResult?.all_models ?? [];
  const customModels = downloadedModels.filter(
    (dm) => !allModels.some((m) => m.filename === dm.filename)
  );
  const isRunning = !!serverStatus?.running;
  const runningModelPath = serverStatus?.model_path ?? "";

  return (
    <div className="space-y-4">
      {(error || localError) && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap flex-1">{error ?? localError}</span>
          <button className="text-xs underline shrink-0" onClick={() => setLocalError(null)}>Dismiss</button>
        </div>
      )}

      {isStarting && (
        <ModelLoadingCard
          modelName={startingModelName}
          progress={serverStartProgress}
          logs={serverLogs}
        />
      )}

      {allModels.length === 0 && !isDetecting && (
        <div className="rounded-lg border bg-muted/20 px-6 py-8 text-center text-sm text-muted-foreground">
          <Cpu className="h-6 w-6 mx-auto mb-2 opacity-30" />
          <p>Detecting hardware to find compatible models…</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={detectHardware}>
            Retry Detection
          </Button>
        </div>
      )}

      {isDetecting && allModels.length === 0 && (
        <div className="rounded-lg border bg-muted/20 px-6 py-8 text-center text-sm text-muted-foreground">
          <Activity className="h-5 w-5 mx-auto mb-2 animate-pulse text-blue-500" />
          Detecting hardware…
        </div>
      )}

      {allModels.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_160px_72px_64px_80px_100px] gap-px items-center px-4 py-2 bg-muted/40 text-xs font-medium text-muted-foreground border-b">
            <span>Model</span>
            <span className="text-center">Speed</span>
            <span className="text-right">Size</span>
            <span className="text-right">RAM</span>
            <span className="text-center">Tools</span>
            <div className="flex items-center justify-end gap-2">
              <span>Action</span>
              {allModels.some((m) => !downloadedModels.some((d) => d.filename === m.filename)) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px] gap-1"
                  onClick={handleDownloadAll}
                  disabled={isDownloading && downloadQueue.length === allModels.filter((m) => !downloadedModels.some((d) => d.filename === m.filename)).length}
                >
                  <Download className="h-3 w-3" />
                  All
                </Button>
              )}
              {downloadQueue.length > 0 && (
                <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 tabular-nums">
                  {downloadQueue.length}
                </span>
              )}
            </div>
          </div>

          {/* Model rows */}
          {allModels.map((model) => {
            const isDownloaded = downloadedModels.some((m) => m.filename === model.filename);
            const isDownloadingThis = isDownloading && downloadingFilename === model.filename;
            const isQueued = !isDownloadingThis && downloadQueue.some((e) => e.filename === model.filename);
            const isThisRunning = isRunning && runningModelPath.includes(model.filename);
            const isExpanded = expandedRow === model.filename;

            return (
              <div key={model.filename} className="border-b last:border-b-0">
                <div
                  className={`grid grid-cols-[1fr_160px_72px_64px_80px_100px] gap-px items-center px-4 py-2.5 text-sm transition-colors hover:bg-muted/20 ${
                    isThisRunning ? "bg-green-500/5" : ""
                  }`}
                >
                  {/* Name + badges */}
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      className="flex items-center gap-1.5 min-w-0 text-left"
                      onClick={() => setExpandedRow(isExpanded ? null : model.filename)}
                    >
                      <ChevronDown className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      <span className="font-medium truncate">{model.name}</span>
                    </button>
                    {model.tier === "Default" && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-blue-500/15 text-blue-600 border-blue-500/30 shrink-0">
                        rec
                      </Badge>
                    )}
                    {isThisRunning && (
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                    )}
                  </div>

                  {/* Speed */}
                  <span className="text-xs text-muted-foreground text-center min-w-0 truncate" title={model.speed}>
                    {model.speed}
                  </span>

                  {/* Size */}
                  <span className="text-xs text-muted-foreground text-right tabular-nums">
                    {model.disk_size_gb.toFixed(1)} GB
                  </span>

                  {/* RAM */}
                  <span className="text-xs text-muted-foreground text-right tabular-nums">
                    {model.ram_required_gb.toFixed(0)} GB
                  </span>

                  {/* Tool calling rating */}
                  <div className="flex justify-center">
                    <ToolCallRating rating={model.tool_calling_rating} />
                  </div>

                  {/* Action button — single context-aware button */}
                  <div className="flex justify-end">
                    {isDownloadingThis ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive"
                        onClick={cancelDownload}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                    ) : isQueued ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 px-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Queued
                      </span>
                    ) : isDownloaded ? (
                      <div className="flex gap-1">
                        {!isThisRunning && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => handleLoad(model)}
                            disabled={isStarting}
                          >
                            <Play className="h-3 w-3" />
                            Run
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(model.filename)}
                          title="Delete model"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => handleDownload(model, false)}
                      >
                        <Download className="h-3 w-3" />
                        Get
                      </Button>
                    )}
                  </div>
                </div>

                {/* Download progress bar — inline beneath the row */}
                {isDownloadingThis && downloadProgress && (
                  <div className="px-4 pb-2 flex items-center gap-3">
                    <Progress value={downloadProgress.percent} className="h-1 flex-1" />
                    <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                      {downloadProgress.percent.toFixed(0)}% · {formatBytes(downloadProgress.bytes_downloaded)}
                    </span>
                  </div>
                )}

                {/* Expandable description row */}
                {isExpanded && (
                  <div className="px-4 pb-3 pl-9">
                    <p className="text-xs text-muted-foreground leading-relaxed">{model.description}</p>
                    {model.is_split && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Split into {model.hf_parts.length + 1} parts · {model.context_length.toLocaleString()} context
                      </p>
                    )}
                    {!model.is_split && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {model.context_length.toLocaleString()} context length
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Custom models in the same table */}
          {customModels.map((dm) => {
            const isThisRunning = isRunning && runningModelPath.includes(dm.filename);
            return (
              <div key={dm.filename} className={`grid grid-cols-[1fr_160px_72px_64px_80px_100px] gap-px items-center px-4 py-2.5 text-sm border-b last:border-b-0 ${isThisRunning ? "bg-green-500/5" : ""}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate pl-5">{dm.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">custom</Badge>
                  {isThisRunning && <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />}
                </div>
                <span className="text-xs text-muted-foreground text-center">—</span>
                <span className="text-xs text-muted-foreground text-right tabular-nums">{dm.size_gb} GB</span>
                <span className="text-xs text-muted-foreground text-right">—</span>
                <span className="text-xs text-muted-foreground text-center">—</span>
                <div className="flex justify-end gap-1">
                  {!isThisRunning && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => handleLoadCustom(dm.filename)} disabled={isStarting}>
                      <Play className="h-3 w-3" />
                      Run
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(dm.filename)} title="Delete model">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Always-visible custom model input */}
      <CustomModelRow onAdded={listModels} />

      {/* Intelligent repository analyzer */}
      <ModelRepoAnalyzer
        hardwareResult={hardwareResult}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onDownload={queueDownload}
      />

      {/* HuggingFace token — shown expanded when a XET download failed, collapsed otherwise */}
      <HfTokenPanel forcedOpen={xetTokenRequired} />
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

// ── System Prompt Selector ────────────────────────────────────────────────
// A proper full-width selector for the settings panel.
// Shows a dropdown of all saved + builtin prompts, a textarea for the
// current content, and a link to the full System Prompts management page.

function SystemPromptSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (content: string) => void;
}) {
  const navigate = useNavigate();
  const [userPrompts, setUserPrompts] = useState<SystemPrompt[]>(() => systemPrompts.list());
  const allPrompts = [...BUILTIN_PROMPTS, ...userPrompts];
  const activePrompt = allPrompts.find((p) => p.content === value);

  // Reload when the user returns from the prompts page
  useEffect(() => {
    setUserPrompts(systemPrompts.list());
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">System Prompt</Label>
        <button
          className="flex items-center gap-1 text-xs text-primary hover:underline"
          onClick={() => navigate("/system-prompts")}
          title="Open System Prompts library"
        >
          <ExternalLink className="h-3 w-3" />
          Manage
        </button>
      </div>

      {/* Prompt picker dropdown */}
      <div className="space-y-1.5">
        <select
          className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          value={activePrompt?.id ?? "__custom__"}
          onChange={(e) => {
            if (e.target.value === "__custom__") return;
            if (e.target.value === "__manage__") {
              navigate("/system-prompts");
              return;
            }
            const found = allPrompts.find((p) => p.id === e.target.value);
            if (found) onChange(found.content);
          }}
        >
          <option value="__custom__">
            {activePrompt ? activePrompt.name : "— custom / paste below —"}
          </option>
          {userPrompts.length > 0 && (
            <optgroup label="My Prompts">
              {userPrompts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Built-in">
            {BUILTIN_PROMPTS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
          <option value="__manage__">→ Open Prompts Library…</option>
        </select>

        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="You are a helpful assistant… (or select from the library above)"
          className="text-xs resize-none h-32"
        />
        <p className="text-[10px] text-muted-foreground text-right">{value.length} chars</p>
      </div>
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Message actions state ─────────────────────────────────────────────
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [reactions, setReactions] = useState<Record<string, "up" | "down" | null>>({});
  const [switchingModel, setSwitchingModel] = useState(false);
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const promptPickerRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

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

  // ── Auto-resize textarea ──────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  // ── Close pickers on outside click ────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (promptPickerRef.current && !promptPickerRef.current.contains(e.target as Node)) {
        setShowPromptPicker(false);
      }
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Edit & resend a user message ──────────────────────────────────────
  const handleEditAndResend = async (msgId: string, newContent: string) => {
    if (!port || !newContent.trim() || isGenerating) return;
    setEditingMsgId(null);
    setEditingContent("");
    const msgIndex = messages.findIndex((m) => m.id === msgId);
    if (msgIndex === -1) return;

    const truncated = messages.slice(0, msgIndex);
    const editedUserMsg: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: newContent.trim(),
    };
    const assistantId = crypto.randomUUID();
    const newMessages = [
      ...truncated,
      editedUserMsg,
      { id: assistantId, role: "assistant" as const, content: "", isStreaming: true },
    ];

    if (activeConvId) updateMessages(activeConvId, newMessages, systemPrompt);
    setIsGenerating(true);
    stopRef.current = false;
    scrollToBottom();

    const chatMessages: ChatMessage[] = [
      ...(systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt }] : []),
      ...truncated.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: newContent.trim() },
    ];

    let accumulated = "";
    try {
      const stream = streamCompletion(port, chatMessages, { temperature, maxTokens });
      for await (const token of stream) {
        if (stopRef.current) break;
        accumulated += token;
        setConversations((prev) => {
          const updated = prev.map((c) =>
            c.id === activeConvId
              ? { ...c, messages: c.messages.map((m) => m.id === assistantId ? { ...m, content: accumulated } : m) }
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
          c.id === activeConvId
            ? { ...c, messages: c.messages.map((m) => m.id === assistantId ? { ...m, isStreaming: false } : m) }
            : c
        );
        saveConversations(updated);
        return updated;
      });
      setIsGenerating(false);
    }
  };

  // ── Edit assistant message (in-place correction) ──────────────────────
  const handleEditAssistant = (msgId: string, newContent: string) => {
    if (!activeConvId) return;
    setEditingMsgId(null);
    setEditingContent("");
    const updatedMsgs = messages.map((m) =>
      m.id === msgId ? { ...m, content: newContent } : m
    );
    updateMessages(activeConvId, updatedMsgs, systemPrompt);
  };

  // ── Fork conversation from a specific assistant message ───────────────
  const forkFromMessage = (msgId: string) => {
    if (!activeConv) return;
    const msgIndex = messages.findIndex((m) => m.id === msgId);
    if (msgIndex === -1) return;
    const forkedMessages = messages.slice(0, msgIndex + 1).map((m) => ({
      ...m,
      id: crypto.randomUUID(),
      isStreaming: false,
    }));
    const fork: SavedConversation = {
      id: crypto.randomUUID(),
      title: activeConv.title + " (fork)",
      messages: forkedMessages,
      systemPrompt: activeConv.systemPrompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelName: activeConv.modelName,
    };
    const updated = [fork, ...conversations];
    persistConvs(updated);
    setActiveConvId(fork.id);
  };

  // ── Toggle reaction ───────────────────────────────────────────────────
  const toggleReaction = (msgId: string, type: "up" | "down") => {
    setReactions((prev) => ({
      ...prev,
      [msgId]: prev[msgId] === type ? null : type,
    }));
  };

  // ── Switch model from composer ────────────────────────────────────────
  const handleModelSwitch = async (filename: string) => {
    if (switchingModel || isStarting) return;
    setShowModelPicker(false);
    setSwitchingModel(true);
    try {
      const hw = hardwareResult ?? await detectHardware();
      const ctx = 8192;
      await stopServer();
      await startServer(filename, hw.recommended_gpu_layers, ctx);
    } catch {
      // error surfaced elsewhere
    } finally {
      setSwitchingModel(false);
    }
  };

  // Prompt/model display helpers
  const allPrompts = [...BUILTIN_PROMPTS, ...systemPrompts.list()];
  const activePromptName = allPrompts.find((p) => p.content === systemPrompt)?.name ?? null;
  const currentModelName = serverStatus?.model_name ?? serverStatus?.model_path?.split("/").pop() ?? "Model";

  // ── Send message ───────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!port || !input.trim() || isGenerating) return;
    const userMsg = input.trim();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
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
      if (e instanceof ContextSizeError) {
        // Remove the empty assistant placeholder so the conversation stays clean
        setConversations((prev) => {
          const updated = prev.map((c) =>
            c.id === convId
              ? { ...c, messages: c.messages.filter((m) => m.id !== assistantId) }
              : c
          );
          saveConversations(updated);
          return updated;
        });
        const overBy = e.promptTokens - e.contextSize;
        setError(
          `Your conversation is too long for this model's context window.\n\n` +
          `• Used: ${e.promptTokens.toLocaleString()} tokens  •  Limit: ${e.contextSize.toLocaleString()} tokens  •  Over by: ${overBy.toLocaleString()} tokens\n\n` +
          `To fix this, you can:\n` +
          `  1. Start a new conversation (the + button above).\n` +
          `  2. Shorten your message or clear some history.\n` +
          `  3. Increase the Context Length in Server Settings (currently ${contextLengthOverride.toLocaleString()}) and restart the server.`
        );
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
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
      <div className="flex items-center justify-center h-full">
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
    <div className="flex h-full gap-0 rounded-xl border overflow-hidden bg-background">

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
                className={`group flex items-center gap-1 min-w-0 rounded-lg px-2 py-2 cursor-pointer text-sm transition-colors ${
                  conv.id === activeConvId
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/60 text-foreground"
                }`}
                onClick={() => { setActiveConvId(conv.id); setError(null); }}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="flex-1 min-w-0 truncate text-xs leading-tight">{conv.title}</span>
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
          <div className="flex gap-2 px-4 py-3 text-sm text-destructive bg-destructive/10 border-b shrink-0">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="flex-1 whitespace-pre-wrap leading-relaxed">{error}</span>
            <button className="ml-2 shrink-0 text-xs underline self-start" onClick={() => setError(null)}>Dismiss</button>
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
                  <div key={msg.id} className="group/msg">
                    <div className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "assistant" && (
                        <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                          <Cpu className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                      <div className="max-w-[78%] min-w-0">
                        {editingMsgId === msg.id ? (
                          <div className="space-y-2">
                            <textarea
                              className="w-full min-h-[60px] rounded-xl border bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              autoFocus
                            />
                            <div className="flex gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => { setEditingMsgId(null); setEditingContent(""); }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={!editingContent.trim()}
                                onClick={() => {
                                  if (msg.role === "user") {
                                    handleEditAndResend(msg.id, editingContent);
                                  } else {
                                    handleEditAssistant(msg.id, editingContent);
                                  }
                                }}
                              >
                                {msg.role === "user" ? "Save & Resend" : "Save"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                              msg.role === "user"
                                ? "bg-primary text-primary-foreground rounded-tr-sm"
                                : "bg-muted/60 rounded-tl-sm"
                            }`}
                          >
                            {msg.role === "assistant" ? (
                              <div className="chat-prose text-sm leading-relaxed">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    pre: ({ children }) => (
                                      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[0.8125rem]">
                                        {children}
                                      </pre>
                                    ),
                                    code: ({ className, children, ...props }) => {
                                      const isInline = !className;
                                      if (isInline) {
                                        return (
                                          <code className="rounded bg-muted px-1.5 py-0.5 text-[0.8125rem] font-mono" {...props}>
                                            {children}
                                          </code>
                                        );
                                      }
                                      return <code className={className} {...props}>{children}</code>;
                                    },
                                  }}
                                >
                                  {msg.content}
                                </ReactMarkdown>
                                {msg.isStreaming && (
                                  <span className="inline-block h-4 w-0.5 bg-primary opacity-70 animate-pulse ml-0.5 align-middle" />
                                )}
                              </div>
                            ) : (
                              <>
                                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                                {msg.isStreaming && (
                                  <span className="inline-block h-4 w-0.5 bg-current opacity-70 animate-pulse ml-0.5 align-middle" />
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Message action icons — hover row */}
                        {!msg.isStreaming && editingMsgId !== msg.id && msg.content && (
                          <div className={`flex items-center gap-0.5 mt-1 opacity-0 transition-opacity group-hover/msg:opacity-100 ${
                            msg.role === "user" ? "justify-end" : "justify-start"
                          }`}>
                            <MsgCopyButton text={msg.content} />
                            <button
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                              title="Edit"
                              onClick={() => { setEditingMsgId(msg.id); setEditingContent(msg.content); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {msg.role === "assistant" && (
                              <>
                                <button
                                  className={`rounded-md p-1.5 transition-colors ${reactions[msg.id] === "up" ? "text-green-500" : "text-muted-foreground hover:text-foreground"}`}
                                  title="Good response"
                                  onClick={() => toggleReaction(msg.id, "up")}
                                >
                                  <ThumbsUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  className={`rounded-md p-1.5 transition-colors ${reactions[msg.id] === "down" ? "text-red-500" : "text-muted-foreground hover:text-foreground"}`}
                                  title="Bad response"
                                  onClick={() => toggleReaction(msg.id, "down")}
                                >
                                  <ThumbsDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                                  title="Fork conversation from here"
                                  onClick={() => forkFromMessage(msg.id)}
                                >
                                  <GitFork className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {msg.role === "user" && (
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-xs font-semibold text-muted-foreground">U</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Input area — composer with prompt/model selectors */}
            <div className="border-t p-3 shrink-0 bg-background">
              <div className="max-w-3xl mx-auto">
                {switchingModel && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 px-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Switching model…
                  </div>
                )}
                <div className="glass relative rounded-xl transition-shadow focus-within:shadow-md">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                    }}
                    placeholder={switchingModel ? "Switching model…" : "Message the local model… (Enter to send, Shift+Enter for newline)"}
                    className="min-h-[2.5rem] w-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
                    disabled={isGenerating || switchingModel}
                    rows={1}
                  />
                  <div className="flex items-center justify-between px-2 pb-1.5">
                    <div className="flex items-center gap-1">
                      {/* Prompt selector */}
                      <div className="relative" ref={promptPickerRef}>
                        <button
                          onClick={() => { setShowPromptPicker(!showPromptPicker); setShowModelPicker(false); }}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          title="Select system prompt"
                        >
                          <span className="max-w-[140px] truncate">
                            {activePromptName ?? "No prompt"}
                          </span>
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {showPromptPicker && (
                          <div className="glass absolute bottom-full left-0 mb-1.5 min-w-[240px] max-h-64 overflow-y-auto rounded-lg p-1.5 z-50">
                            <button
                              className={`flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors ${
                                !systemPrompt ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
                              }`}
                              onClick={() => {
                                setSystemPrompt("");
                                if (activeConvId) updateMessages(activeConvId, messages, "");
                                setShowPromptPicker(false);
                              }}
                            >
                              <span className="text-muted-foreground">No prompt</span>
                            </button>
                            {allPrompts.map((p) => (
                              <button
                                key={p.id}
                                className={`flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors ${
                                  p.content === systemPrompt ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
                                }`}
                                onClick={() => {
                                  setSystemPrompt(p.content);
                                  if (activeConvId) updateMessages(activeConvId, messages, p.content);
                                  setShowPromptPicker(false);
                                }}
                              >
                                <span className="font-medium">{p.name}</span>
                                <span className="ml-auto text-[10px] text-muted-foreground">{p.category}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Model selector */}
                      <div className="relative" ref={modelPickerRef}>
                        <button
                          onClick={() => { setShowModelPicker(!showModelPicker); setShowPromptPicker(false); }}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          title="Select model"
                        >
                          <Cpu className="h-3 w-3 text-blue-500 shrink-0" />
                          <span className="max-w-[140px] truncate">{currentModelName}</span>
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {showModelPicker && (
                          <div className="glass absolute bottom-full left-0 mb-1.5 min-w-[240px] max-h-64 overflow-y-auto rounded-lg p-1.5 z-50">
                            {downloadedModels.map((m) => {
                              const isCurrent = serverStatus?.model_path?.includes(m.filename);
                              return (
                                <button
                                  key={m.filename}
                                  className={`flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors ${
                                    isCurrent ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
                                  }`}
                                  onClick={() => {
                                    if (!isCurrent) handleModelSwitch(m.filename);
                                    setShowModelPicker(false);
                                  }}
                                >
                                  <Cpu className="h-3 w-3 text-blue-500 mr-2 shrink-0" />
                                  <span className="font-medium truncate">{m.name}</span>
                                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{m.size_gb} GB</span>
                                  {isCurrent && <span className="ml-1.5 text-[10px] text-green-500 shrink-0">running</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      {isGenerating ? (
                        <button
                          onClick={() => (stopRef.current = true)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors"
                          title="Stop generation"
                        >
                          <Square className="h-3 w-3" />
                        </button>
                      ) : (
                        <button
                          onClick={handleSend}
                          disabled={!input.trim() || switchingModel}
                          title="Send"
                          className={`flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 ${
                            !input.trim() || switchingModel
                              ? "bg-muted-foreground/30 text-primary-foreground opacity-30 cursor-not-allowed"
                              : "bg-primary text-primary-foreground active:scale-[0.96]"
                          }`}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
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
              <SystemPromptSelector
                value={systemPrompt}
                onChange={(content) => {
                  setSystemPrompt(content);
                  if (activeConvId) updateMessages(activeConvId, messages, content);
                }}
              />

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
    if (!hardwareResult && !isDetecting) {
      detectHardware().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Use the shared app-level LLM context so Voice and other pages see the same server state
  const llm = useLlmApp();

  return (
    <LlmContext.Provider value={llm}>
      <LocalModelsInner />
    </LlmContext.Provider>
  );
}

function LocalModelsInner() {
  const [state] = useLlmContext();
  const { serverStatus } = state;
  const [activeTab, setActiveTab] = useState(() =>
    serverStatus?.running ? "inference" : "setup"
  );

  useEffect(() => {
    if (serverStatus?.running && activeTab === "setup") {
      setActiveTab("inference");
    }
  }, [serverStatus?.running]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-6 pt-6 pb-4">
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 px-6">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="inference" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Inference
          </TabsTrigger>
          <TabsTrigger value="setup" className="gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Setup
          </TabsTrigger>
          <TabsTrigger value="models" className="gap-1.5">
            <HardDrive className="h-3.5 w-3.5" />
            Models
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

        <div className="flex-1 min-h-0 pt-6 overflow-hidden">
          <TabsContent value="setup" className="m-0 h-full overflow-auto">
            <SetupTab />
          </TabsContent>
          <TabsContent value="models" className="m-0 h-full overflow-auto">
            <ModelsTab />
          </TabsContent>
          <TabsContent value="inference" className="m-0 h-full">
            <InferenceTab />
          </TabsContent>
          <TabsContent value="server" className="m-0 h-full overflow-auto">
            <ServerTab />
          </TabsContent>
          <TabsContent value="hardware" className="m-0 h-full overflow-auto">
            <HardwareTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
