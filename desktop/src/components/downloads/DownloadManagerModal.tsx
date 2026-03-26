/**
 * Global download manager modal.
 *
 * Shows:
 *  - Active download: large circular progress ring with speed + ETA
 *  - Queue: ordered list with cancel buttons
 *  - History: completed/failed entries, collapsible, with retry for failed
 *  - Cancel All button
 *
 * Rendered once in App.tsx, opened via DownloadManagerContext.openModal().
 */

import { useState } from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Cpu,
  Mic,
  Image,
  Volume2,
  FolderSync,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CircularProgress } from "@/components/downloads/CircularProgress";
import { useDownloadManager } from "@/contexts/DownloadManagerContext";
import type { DownloadEntry } from "@/lib/downloads/types";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return "";
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return "";
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function CategoryIcon({ category, className = "" }: { category: string; className?: string }) {
  switch (category) {
    case "llm":       return <Cpu className={className} />;
    case "whisper":   return <Mic className={className} />;
    case "image_gen": return <Image className={className} />;
    case "tts":       return <Volume2 className={className} />;
    case "file_sync": return <FolderSync className={className} />;
    default:          return <Download className={className} />;
  }
}

function categoryLabel(category: string): string {
  switch (category) {
    case "llm":       return "LLM";
    case "whisper":   return "Whisper";
    case "image_gen": return "Image Gen";
    case "tts":       return "TTS";
    case "file_sync": return "File Sync";
    default:          return category;
  }
}

// ── Active download card ───────────────────────────────────────────────────

function ActiveDownloadCard({ entry, onCancel }: { entry: DownloadEntry; onCancel: () => void }) {
  const speed = formatSpeed(entry.speed_bps ?? 0);
  const eta = formatEta(entry.eta_seconds);
  const partsLabel = entry.part_total > 1
    ? `Part ${entry.part_current}/${entry.part_total}`
    : null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-start gap-4">
        {/* Circular ring */}
        <div className="shrink-0">
          <CircularProgress
            percent={entry.percent}
            size={80}
            strokeWidth={6}
            label={`${Math.round(entry.percent)}%`}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <CategoryIcon category={entry.category} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {categoryLabel(entry.category)}
            </Badge>
          </div>
          <p className="font-semibold text-sm leading-snug truncate" title={entry.display_name}>
            {entry.display_name}
          </p>
          <p className="text-xs text-muted-foreground truncate">{entry.filename}</p>

          {/* Progress bar (linear, below the text) */}
          <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden mt-2">
            <div
              className="h-full bg-primary rounded-full transition-[width] duration-300"
              style={{ width: `${Math.min(100, entry.percent)}%` }}
            />
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-0.5 tabular-nums">
            {entry.total_bytes > 0 && (
              <span>{formatBytes(entry.bytes_done)} / {formatBytes(entry.total_bytes)}</span>
            )}
            {speed && <span className="text-primary/80">{speed}</span>}
            {eta && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {eta}
              </span>
            )}
            {partsLabel && <span>{partsLabel}</span>}
          </div>
        </div>

        {/* Cancel */}
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={onCancel}
          title="Cancel download"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Queue row ─────────────────────────────────────────────────────────────

function QueueRow({
  entry,
  position,
  onCancel,
}: {
  entry: DownloadEntry;
  position: number;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 px-1 border-b last:border-b-0">
      <span className="text-[11px] text-muted-foreground/50 w-4 shrink-0 text-right tabular-nums">
        {position}
      </span>
      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{entry.display_name}</p>
        <p className="text-[11px] text-muted-foreground truncate">{entry.filename}</p>
      </div>
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
        {categoryLabel(entry.category)}
      </Badge>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
        onClick={onCancel}
        title="Remove from queue"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ── History row ───────────────────────────────────────────────────────────

function HistoryRow({
  entry,
  onRetry,
}: {
  entry: DownloadEntry;
  onRetry?: () => void;
}) {
  const isCompleted = entry.status === "completed";
  const isFailed = entry.status === "failed";

  return (
    <div className="flex items-center gap-3 py-2 px-1 border-b last:border-b-0">
      {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
      {isFailed && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
      {!isCompleted && !isFailed && <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}

      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{entry.display_name}</p>
        {isFailed && entry.error_msg && (
          <p className="text-[11px] text-destructive/80 truncate" title={entry.error_msg}>
            {entry.error_msg}
          </p>
        )}
        {isCompleted && entry.total_bytes > 0 && (
          <p className="text-[11px] text-muted-foreground">{formatBytes(entry.total_bytes)}</p>
        )}
      </div>

      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
        {categoryLabel(entry.category)}
      </Badge>

      {isFailed && onRetry && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={onRetry}
          title="Retry download"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────

export function DownloadManagerModal() {
  const { downloads, isModalOpen, closeModal, cancel, enqueue } = useDownloadManager();
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const active = downloads.find((d) => d.status === "active");
  const queued = downloads.filter((d) => d.status === "queued");
  const history = downloads.filter(
    (d) => d.status === "completed" || d.status === "failed" || d.status === "cancelled",
  );

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

  const hasActive = active != null;
  const hasQueued = queued.length > 0;
  const hasHistory = history.length > 0;
  const isEmpty = !hasActive && !hasQueued && !hasHistory;

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" />
              Downloads
              {(hasActive || hasQueued) && (
                <Badge className="text-[10px] px-1.5 py-0 h-4 bg-primary/15 text-primary border-primary/30">
                  {(active ? 1 : 0) + queued.length} active
                </Badge>
              )}
            </DialogTitle>
            {(hasActive || hasQueued) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-destructive px-2"
                onClick={handleCancelAll}
              >
                Cancel All
              </Button>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">
            {isEmpty && (
              <div className="text-center py-10 text-muted-foreground text-sm space-y-2">
                <Download className="h-8 w-8 mx-auto opacity-20" />
                <p>No downloads</p>
                <p className="text-xs opacity-60">
                  Downloads will appear here when you install models or files.
                </p>
              </div>
            )}

            {/* Active download */}
            {active && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Downloading
                </p>
                <ActiveDownloadCard
                  entry={active}
                  onCancel={() => void cancel(active.id)}
                />
              </div>
            )}

            {/* Queue */}
            {hasQueued && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Queue ({queued.length})
                </p>
                <div className="rounded-lg border bg-muted/10 divide-y">
                  {queued.map((entry, idx) => (
                    <QueueRow
                      key={entry.id}
                      entry={entry}
                      position={idx + 1}
                      onCancel={() => void cancel(entry.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            {hasHistory && (
              <div className="space-y-1">
                <button
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-full text-left"
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
                  <div className="rounded-lg border bg-muted/10 divide-y">
                    {history.map((entry) => (
                      <HistoryRow
                        key={entry.id}
                        entry={entry}
                        onRetry={entry.status === "failed" && entry.urls.length > 0
                          ? () => handleRetry(entry)
                          : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
