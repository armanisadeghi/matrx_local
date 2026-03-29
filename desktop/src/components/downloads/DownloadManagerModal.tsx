/**
 * Global Download Manager Modal
 *
 * Custom overlay (no shadcn Dialog) so we control the header/close button
 * placement precisely. Shows:
 *  - Active download: large circular ring, linear bar, speed + ETA
 *  - Queue: ordered list
 *  - History: collapsible completed / failed entries
 *  - Cancel All
 */

import { useState, useEffect, useRef } from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Cpu,
  Mic,
  ImageIcon,
  Volume2,
  FolderSync,
  Loader2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CircularProgress } from "@/components/downloads/CircularProgress";
import { useDownloadManager } from "@/contexts/DownloadManagerContext";
import type { DownloadEntry } from "@/lib/downloads/types";

// ── Formatters ────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return "";
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return "";
  if (secs < 60) return `${Math.round(secs)}s left`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s left`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m left`;
}

// ── Category helpers ──────────────────────────────────────────────────────

function CategoryIcon({ category, className = "" }: { category: string; className?: string }) {
  switch (category) {
    case "llm":       return <Cpu className={className} />;
    case "whisper":   return <Mic className={className} />;
    case "image_gen": return <ImageIcon className={className} />;
    case "tts":       return <Volume2 className={className} />;
    case "file_sync": return <FolderSync className={className} />;
    default:          return <Download className={className} />;
  }
}

function categoryLabel(category: string): string {
  switch (category) {
    case "llm":       return "LLM";
    case "whisper":   return "Voice";
    case "image_gen": return "Image Gen";
    case "tts":       return "TTS";
    case "file_sync": return "File Sync";
    default:          return category;
  }
}

function categoryColor(category: string): string {
  switch (category) {
    case "llm":       return "text-blue-500";
    case "whisper":   return "text-purple-500";
    case "image_gen": return "text-rose-500";
    case "tts":       return "text-amber-500";
    case "file_sync": return "text-emerald-500";
    default:          return "text-primary";
  }
}

// ── Animated progress bar ─────────────────────────────────────────────────

function ProgressBar({ percent, indeterminate = false }: { percent: number; indeterminate?: boolean }) {
  return (
    <div className="w-full h-1 rounded-full bg-muted/50 overflow-hidden">
      {indeterminate ? (
        <div className="h-full w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent rounded-full animate-pulse" />
      ) : (
        <div
          className="h-full bg-gradient-to-r from-primary/80 to-primary rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      )}
    </div>
  );
}

// ── Active download card ───────────────────────────────────────────────────

function ActiveCard({ entry, onCancel }: { entry: DownloadEntry; onCancel: () => void }) {
  const speed = formatSpeed(entry.speed_bps ?? 0);
  const eta = formatEta(entry.eta_seconds);
  const isStarting = entry.percent === 0 && entry.bytes_done === 0;
  const partsLabel = entry.part_total > 1
    ? `Part ${entry.part_current} of ${entry.part_total}`
    : null;

  return (
    <div className="rounded-xl border border-border/60 bg-gradient-to-br from-card to-muted/20 p-4 space-y-3 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Circular ring */}
        <div className="shrink-0 relative">
          {isStarting ? (
            <div className="relative flex items-center justify-center" style={{ width: 72, height: 72 }}>
              <div className="absolute inset-0 rounded-full border-4 border-muted/40" />
              <div className="absolute inset-0 rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" />
              <span className="text-[10px] font-medium text-muted-foreground">Starting</span>
            </div>
          ) : (
            <CircularProgress
              percent={entry.percent}
              size={72}
              strokeWidth={5}
              label={`${Math.round(entry.percent)}%`}
            />
          )}
        </div>

        {/* Info column */}
        <div className="flex-1 min-w-0 space-y-1.5 pt-0.5">
          {/* Category + name row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${categoryColor(entry.category)}`}>
              <CategoryIcon category={entry.category} className="h-3 w-3" />
              {categoryLabel(entry.category)}
            </span>
            {partsLabel && (
              <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">
                {partsLabel}
              </span>
            )}
          </div>

          <p className="font-semibold text-sm leading-tight truncate" title={entry.display_name}>
            {entry.display_name}
          </p>
          <p className="text-[11px] text-muted-foreground/70 truncate font-mono">
            {entry.filename}
          </p>
        </div>

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Cancel download"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      <ProgressBar percent={entry.percent} indeterminate={isStarting} />

      {/* Stats row */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
        <div className="flex items-center gap-3">
          {entry.total_bytes > 0 && (
            <span>
              <span className="text-foreground/80 font-medium">{formatBytes(entry.bytes_done)}</span>
              <span className="mx-1 opacity-50">/</span>
              {formatBytes(entry.total_bytes)}
            </span>
          )}
          {speed && (
            <span className="flex items-center gap-1 text-primary/80 font-medium">
              <Zap className="h-2.5 w-2.5" />
              {speed}
            </span>
          )}
        </div>
        {eta && (
          <span className="flex items-center gap-1 opacity-70">
            <Clock className="h-3 w-3" />
            {eta}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Queue row ─────────────────────────────────────────────────────────────

function QueueRow({ entry, position, onCancel }: {
  entry: DownloadEntry;
  position: number;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors rounded-lg group">
      <span className="text-[11px] text-muted-foreground/40 w-5 shrink-0 text-center font-mono tabular-nums">
        {position}
      </span>
      <Loader2 className="h-3.5 w-3.5 text-muted-foreground/50 animate-spin shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{entry.display_name}</p>
        <p className="text-[11px] text-muted-foreground/60 truncate font-mono">{entry.filename}</p>
      </div>
      <span className={`text-[10px] font-semibold uppercase ${categoryColor(entry.category)} shrink-0`}>
        {categoryLabel(entry.category)}
      </span>
      <button
        onClick={onCancel}
        className="shrink-0 h-6 w-6 rounded flex items-center justify-center text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
        title="Remove from queue"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── History row ───────────────────────────────────────────────────────────

function HistoryRow({ entry, onRetry }: { entry: DownloadEntry; onRetry?: () => void }) {
  const isCompleted = entry.status === "completed";
  const isFailed = entry.status === "failed";

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors rounded-lg group">
      <div className="shrink-0">
        {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
        {isFailed && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
        {!isCompleted && !isFailed && <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ opacity: isFailed ? 0.7 : 1 }}>
          {entry.display_name}
        </p>
        {isFailed && entry.error_msg ? (
          <p className="text-[11px] text-destructive/70 truncate" title={entry.error_msg}>
            {entry.error_msg}
          </p>
        ) : isCompleted && entry.total_bytes > 0 ? (
          <p className="text-[11px] text-muted-foreground/60">{formatBytes(entry.total_bytes)}</p>
        ) : null}
      </div>
      <span className={`text-[10px] font-semibold uppercase ${categoryColor(entry.category)} shrink-0 opacity-60`}>
        {categoryLabel(entry.category)}
      </span>
      {isFailed && onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 h-6 w-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-all"
          title="Retry"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────

export function DownloadManagerModal() {
  const { downloads, isModalOpen, closeModal, cancel, enqueue } = useDownloadManager();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const active = downloads.find((d) => d.status === "active");
  const queued = downloads.filter((d) => d.status === "queued");
  const history = downloads.filter(
    (d) => d.status === "completed" || d.status === "failed" || d.status === "cancelled",
  );

  const hasActive = active != null;
  const hasQueued = queued.length > 0;
  const hasHistory = history.length > 0;
  const isEmpty = !hasActive && !hasQueued && !hasHistory;

  // Close on Escape
  useEffect(() => {
    if (!isModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isModalOpen, closeModal]);

  const handleCancelAll = async () => {
    const toCancel = downloads.filter((d) => d.status === "active" || d.status === "queued");
    await Promise.allSettled(toCancel.map((d) => cancel(d.id)));
  };

  const handleRetry = (entry: DownloadEntry) => {
    void enqueue({
      id: `${entry.id}-retry-${Date.now()}`,
      category: entry.category,
      filename: entry.filename,
      display_name: entry.display_name,
      urls: entry.urls,
    });
  };

  if (!isModalOpen) return null;

  const totalActive = (hasActive ? 1 : 0) + queued.length;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-end sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Download Manager"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={closeModal}
      />

      {/* Panel */}
      <div className="relative z-10 w-full sm:w-[440px] max-h-[85dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-background border border-border/60 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary/10 p-1.5">
              <Download className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-none">Downloads</h2>
              {totalActive > 0 && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {totalActive} {totalActive === 1 ? "item" : "items"} in progress
                </p>
              )}
            </div>
            {totalActive > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-primary/15 text-primary border-primary/25 font-semibold">
                {totalActive} active
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            {(hasActive || hasQueued) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2.5 rounded-lg"
                onClick={handleCancelAll}
              >
                Cancel All
              </Button>
            )}
            <button
              onClick={closeModal}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">

            {/* Empty state */}
            {isEmpty && (
              <div className="flex flex-col items-center justify-center py-14 space-y-3 text-center">
                <div className="rounded-2xl bg-muted/40 p-4">
                  <Download className="h-7 w-7 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No downloads yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Model and file downloads will appear here in real time.
                  </p>
                </div>
              </div>
            )}

            {/* Active download */}
            {active && (
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Downloading
                  </p>
                </div>
                <ActiveCard
                  entry={active}
                  onCancel={() => void cancel(active.id)}
                />
              </section>
            )}

            {/* Queue */}
            {hasQueued && (
              <section className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                  Up Next ({queued.length})
                </p>
                <div className="rounded-xl border border-border/40 bg-muted/10 p-1 space-y-0.5">
                  {queued.map((entry, idx) => (
                    <QueueRow
                      key={entry.id}
                      entry={entry}
                      position={idx + 1}
                      onCancel={() => void cancel(entry.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* History */}
            {hasHistory && (
              <section className="space-y-1">
                <button
                  className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-1 w-full text-left"
                  onClick={() => setHistoryExpanded((e) => !e)}
                >
                  {historyExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  History ({history.length})
                </button>
                {historyExpanded && (
                  <div className="rounded-xl border border-border/40 bg-muted/10 p-1 space-y-0.5">
                    {history.map((entry) => (
                      <HistoryRow
                        key={entry.id}
                        entry={entry}
                        onRetry={
                          entry.status === "failed" && entry.urls.length > 0
                            ? () => handleRetry(entry)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </ScrollArea>

        {/* Bottom drag handle (mobile) */}
        <div className="sm:hidden flex justify-center py-2 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>
      </div>
    </div>
  );
}
