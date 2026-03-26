/**
 * Floating download badge pill.
 *
 * Appears in the global layout whenever one or more downloads are active or
 * queued. Clicking it opens the DownloadManagerModal.
 *
 * Renders as a small pill with:
 *  - A pulsing green dot (if active download in progress)
 *  - Count of active + queued downloads
 *  - Clicking opens the modal
 */

import { Download } from "lucide-react";
import { CircularProgress } from "@/components/downloads/CircularProgress";
import { useDownloadManager } from "@/contexts/DownloadManagerContext";

interface DownloadBadgeProps {
  /** Additional CSS classes for positioning (e.g. from the layout) */
  className?: string;
}

export function DownloadBadge({ className = "" }: DownloadBadgeProps) {
  const { downloads, activeCount, openModal } = useDownloadManager();

  if (activeCount === 0) return null;

  const active = downloads.find((d) => d.status === "active");
  const queued = downloads.filter((d) => d.status === "queued");
  const queuedCount = queued.length;

  const hasProgress = active && active.total_bytes > 0;

  return (
    <button
      onClick={openModal}
      className={`
        flex items-center gap-2 px-2.5 py-1.5 rounded-full
        bg-primary/10 hover:bg-primary/20 border border-primary/20
        text-primary text-xs font-medium
        transition-all duration-200 hover:scale-105 active:scale-95
        shadow-sm backdrop-blur-sm
        ${className}
      `}
      title="View downloads"
      aria-label={`${activeCount} download${activeCount !== 1 ? "s" : ""} active`}
    >
      {/* Pulsing indicator or circular progress */}
      {hasProgress ? (
        <CircularProgress
          percent={active.percent}
          size={18}
          strokeWidth={2.5}
          label=""
          className="shrink-0"
        />
      ) : (
        <span className="relative shrink-0">
          <span className="block h-2 w-2 rounded-full bg-primary animate-pulse" />
        </span>
      )}

      <Download className="h-3 w-3 shrink-0" />

      <span className="tabular-nums">
        {active ? (
          hasProgress ? `${Math.round(active.percent)}%` : "↓"
        ) : null}
        {queuedCount > 0 && (
          <span className="text-muted-foreground ml-1">+{queuedCount}</span>
        )}
      </span>
    </button>
  );
}
