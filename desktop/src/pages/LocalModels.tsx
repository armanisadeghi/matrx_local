"use client";

import { useState, useRef, useCallback } from "react";
import { useLlm } from "@/hooks/use-llm";
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
} from "lucide-react";
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

// ── Helpers ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatSpeed(bps: number): string {
  const mbps = bps / (1024 * 1024);
  return `${mbps.toFixed(1)} MB/s`;
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

// ── Setup Tab ─────────────────────────────────────────────────────────────

function SetupTab() {
  const [state, actions] = useLlm();
  const {
    hardwareResult,
    downloadProgress,
    isDetecting,
    isDownloading,
    isStarting,
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

          {serverStatus?.running && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Server running on port {serverStatus.port} — model: {serverStatus.model_name}
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive flex items-start gap-2 bg-destructive/10 rounded px-3 py-2">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              {error}
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

// ── Models Tab ────────────────────────────────────────────────────────────

function ModelsTab() {
  const [state, actions] = useLlm();
  const {
    hardwareResult,
    downloadProgress,
    isDownloading,
    downloadedModels,
    serverStatus,
    error,
  } = state;
  const { detectHardware, downloadModel, startServer, deleteModel, cancelDownload } = actions;

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
          {error ?? localError}
        </div>
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

      {/* Raw files section for downloaded models not in catalog */}
      {downloadedModels.some(
        (dm) => !allModels.some((m) => m.filename === dm.filename)
      ) && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Custom Models</h3>
          {downloadedModels
            .filter((dm) => !allModels.some((m) => m.filename === dm.filename))
            .map((dm) => (
              <div
                key={dm.filename}
                className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{dm.name}</p>
                  <p className="text-xs text-muted-foreground">{dm.size_gb} GB</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      startServer(dm.filename, 0, 4096)
                    }
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Load
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => handleDelete(dm.filename)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Inference / Playground Tab ────────────────────────────────────────────

type InferenceMode = "chat" | "tools" | "raw";

interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

function InferenceTab() {
  const [state, actions] = useLlm();
  const { serverStatus, isStarting, hardwareResult, downloadedModels } = state;
  const { startServer, stopServer, detectHardware } = actions;

  const [mode, setMode] = useState<InferenceMode>("chat");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [showSampling, setShowSampling] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tool test mode state
  const [toolDef, setToolDef] = useState(
    JSON.stringify(
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get current weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "City name" },
            },
            required: ["location"],
          },
        },
      },
      null,
      2
    )
  );
  const [toolResult, setToolResult] = useState<string | null>(null);

  // Raw JSON mode state
  const [rawJson, setRawJson] = useState(
    JSON.stringify(
      {
        model: "local",
        messages: [{ role: "user", content: "Hello!" }],
        max_tokens: 256,
        temperature: 0.7,
        stream: false,
      },
      null,
      2
    )
  );
  const [rawResult, setRawResult] = useState<string | null>(null);

  // Sampling params
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.8);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [enableThinking, setEnableThinking] = useState(false);

  // Server override controls
  const [gpuLayersOverride, setGpuLayersOverride] = useState(99);
  const [contextLengthOverride, setContextLengthOverride] = useState(8192);
  const [selectedModel, setSelectedModel] = useState("");

  const stopRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const port = serverStatus?.running ? serverStatus.port : null;

  const scrollToBottom = () => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const handleSend = async () => {
    if (!port || !input.trim() || isGenerating) return;
    const userMsg = input.trim();
    setInput("");
    setError(null);
    stopRef.current = false;

    const chatMessages: ChatMessage[] = [
      ...(systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: userMsg },
    ];

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: userMsg },
      { id: crypto.randomUUID(), role: "assistant", content: "", isStreaming: true },
    ]);
    setIsGenerating(true);
    scrollToBottom();

    let accumulated = "";
    const assistantId = crypto.randomUUID();

    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };
      return copy;
    });

    try {
      const stream = streamCompletion(port, chatMessages, { temperature, maxTokens });
      for await (const token of stream) {
        if (stopRef.current) break;
        accumulated += token;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: accumulated } : m
          )
        );
        scrollToBottom();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        )
      );
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
      const result = await callWithTools(
        port,
        [{ role: "user", content: input }],
        [tool]
      );
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
    if (!selectedModel && downloadedModels.length === 0) return;
    const modelToLoad = selectedModel || downloadedModels[0]?.filename;
    try {
      const hw = hardwareResult ?? (await detectHardware());
      await startServer(modelToLoad, gpuLayersOverride, contextLengthOverride);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!port) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4" />
              Start Inference Server
            </CardTitle>
            <CardDescription>
              Load a model to enable the inference playground.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {downloadedModels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No models downloaded yet. Go to the Models tab to download one.
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
                    <Label className="text-xs">GPU Layers</Label>
                    <Input
                      type="number"
                      value={gpuLayersOverride}
                      onChange={(e) => setGpuLayersOverride(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Context Length</Label>
                    <Input
                      type="number"
                      value={contextLengthOverride}
                      onChange={(e) =>
                        setContextLengthOverride(parseInt(e.target.value) || 4096)
                      }
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={isStarting}
                  onClick={handleStartServer}
                >
                  {isStarting ? "Starting…" : "Start Server"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] gap-4">
      {/* Header: mode + server status */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border p-1 bg-muted/30">
          {(["chat", "tools", "raw"] as InferenceMode[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? "default" : "ghost"}
              className="h-7 px-3 text-xs gap-1"
              onClick={() => setMode(m)}
            >
              {m === "chat" && <MessageSquare className="h-3 w-3" />}
              {m === "tools" && <Wrench className="h-3 w-3" />}
              {m === "raw" && <Code className="h-3 w-3" />}
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-green-600">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Port {port}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={stopServer}
          >
            <Square className="h-3 w-3 mr-1" />
            Stop
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Chat Mode */}
      {mode === "chat" && (
        <>
          {/* Collapsible system prompt */}
          <div className="rounded-lg border">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors"
              onClick={() => setShowSystem((v) => !v)}
            >
              <span className="font-medium text-muted-foreground">System Prompt</span>
              {showSystem ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {showSystem && (
              <div className="px-4 pb-3">
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Optional system prompt…"
                  className="text-sm resize-none h-20"
                />
              </div>
            )}
          </div>

          {/* Sampling controls */}
          <div className="rounded-lg border">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors"
              onClick={() => setShowSampling((v) => !v)}
            >
              <span className="font-medium text-muted-foreground">Sampling Parameters</span>
              {showSampling ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {showSampling && (
              <div className="px-4 pb-4 grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs">Temperature</Label>
                    <span className="text-xs text-muted-foreground">{temperature.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={0} max={2} step={0.05}
                    value={[temperature]}
                    onValueChange={([v]) => setTemperature(v)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs">Top-P</Label>
                    <span className="text-xs text-muted-foreground">{topP.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={0} max={1} step={0.05}
                    value={[topP]}
                    onValueChange={([v]) => setTopP(v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Max Tokens</Label>
                  <Input
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value) || 256)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Conversation */}
          <ScrollArea className="flex-1 rounded-lg border bg-muted/10">
            <div className="p-4 space-y-4">
              {messages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Start a conversation with the local model.
                </p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/60"
                    }`}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                    {msg.isStreaming && (
                      <span className="inline-block h-3.5 w-0.5 bg-current opacity-70 animate-pulse ml-0.5" />
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="flex gap-2">
            {isGenerating && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => (stopRef.current = true)}
              >
                <Square className="h-4 w-4" />
              </Button>
            )}
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              className="text-sm resize-none h-20 flex-1"
              disabled={isGenerating}
            />
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                disabled={isGenerating || !input.trim()}
                onClick={handleSend}
                className="h-full"
              >
                Send
              </Button>
              {messages.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMessages([])}
                  title="Clear chat"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Tool Test Mode */}
      {mode === "tools" && (
        <div className="flex-1 overflow-auto space-y-4">
          <div className="grid grid-cols-2 gap-4 h-full">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Tool Definition (JSON)</Label>
              <Textarea
                value={toolDef}
                onChange={(e) => setToolDef(e.target.value)}
                className="font-mono text-xs h-48 resize-none"
              />
              <Label className="text-sm font-medium">User Prompt</Label>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="What is the weather in San Francisco?"
                className="text-sm resize-none h-24"
              />
              <Button
                disabled={isGenerating || !input.trim()}
                onClick={handleToolTest}
                className="w-full"
              >
                {isGenerating ? "Running…" : "Run Tool Call"}
              </Button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Response</Label>
                {toolResult && <CopyButton text={toolResult} />}
              </div>
              {toolResult ? (
                <ScrollArea className="h-80 rounded-lg border bg-muted/30">
                  <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{toolResult}</pre>
                </ScrollArea>
              ) : (
                <div className="h-80 rounded-lg border bg-muted/10 flex items-center justify-center text-sm text-muted-foreground">
                  Response will appear here
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raw JSON Mode */}
      {mode === "raw" && (
        <div className="flex-1 overflow-auto space-y-4">
          <div className="grid grid-cols-2 gap-4 h-full">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Request Body</Label>
                <span className="text-xs text-muted-foreground font-mono">
                  POST /v1/chat/completions
                </span>
              </div>
              <Textarea
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                className="font-mono text-xs h-64 resize-none"
              />
              <Button
                disabled={isGenerating}
                onClick={handleRawJson}
                className="w-full"
              >
                {isGenerating ? "Running…" : "Send Request"}
              </Button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Raw Response</Label>
                {rawResult && <CopyButton text={rawResult} />}
              </div>
              {rawResult ? (
                <ScrollArea className="h-80 rounded-lg border bg-muted/30">
                  <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{rawResult}</pre>
                </ScrollArea>
              ) : (
                <div className="h-80 rounded-lg border bg-muted/10 flex items-center justify-center text-sm text-muted-foreground">
                  Response will appear here
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Server Tab ────────────────────────────────────────────────────────────

function ServerTab() {
  const [state, actions] = useLlm();
  const { serverStatus, isStarting, downloadedModels, hardwareResult } = state;
  const { startServer, stopServer, getServerStatus, healthCheck, detectHardware } = actions;

  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [healthLatency, setHealthLatency] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [gpuLayers, setGpuLayers] = useState(99);
  const [contextLen, setContextLen] = useState(8192);
  const [selectedModel, setSelectedModel] = useState(
    downloadedModels[0]?.filename ?? ""
  );

  const runHealthCheck = async () => {
    setLocalError(null);
    const start = Date.now();
    const ok = await healthCheck();
    setHealthOk(ok);
    setHealthLatency(Date.now() - start);
  };

  const handleStart = async () => {
    setLocalError(null);
    const model = selectedModel || downloadedModels[0]?.filename;
    if (!model) return;
    try {
      const hw = hardwareResult ?? (await detectHardware());
      await startServer(model, gpuLayers, contextLen);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStop = async () => {
    await stopServer();
  };

  const handleRefresh = async () => {
    await getServerStatus();
  };

  const endpointUrl = serverStatus?.running
    ? `http://127.0.0.1:${serverStatus.port}/v1`
    : null;

  return (
    <div className="space-y-4 max-w-2xl">
      {localError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {localError}
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
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
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
              Server not running
            </div>
          )}
        </CardContent>
      </Card>

      {/* Start Server Card */}
      {!serverStatus?.running && (
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
                    <div className="flex justify-between">
                      <Label className="text-xs">GPU Layers</Label>
                      <span className="text-xs text-muted-foreground">{gpuLayers}</span>
                    </div>
                    <Slider
                      min={0} max={99} step={1}
                      value={[gpuLayers]}
                      onValueChange={([v]) => setGpuLayers(v)}
                    />
                    <p className="text-xs text-muted-foreground">
                      99 = full GPU offload
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
                      <option value={8192}>8192</option>
                      <option value={16384}>16384</option>
                      <option value={32768}>32768</option>
                    </select>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={isStarting}
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
  const [state, actions] = useLlm();
  const { hardwareResult, isDetecting } = state;
  const { detectHardware } = actions;

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

export default function LocalModels() {
  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Cpu className="h-6 w-6 text-blue-500" />
          Local Models
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run AI models locally on your device using llama.cpp
        </p>
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
