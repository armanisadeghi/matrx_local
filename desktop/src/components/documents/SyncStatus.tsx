import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  CloudOff,
  Loader2,
  Monitor,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SyncStatus as SyncStatusType } from "@/lib/api";

interface SyncStatusProps {
  status: SyncStatusType | null;
  syncing: boolean;
  onSync: () => void;
}

export function SyncStatusBar({ status, syncing, onSync }: SyncStatusProps) {
  if (!status) return null;

  const lastSync = status.last_full_sync
    ? new Date(status.last_full_sync * 1000).toLocaleTimeString()
    : "Never";

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {/* Sync button */}
      <button
        onClick={onSync}
        disabled={syncing}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors",
          "hover:bg-accent hover:text-foreground",
          syncing && "opacity-60",
        )}
        title="Sync now"
      >
        {syncing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        <span>{syncing ? "Syncing..." : "Sync"}</span>
      </button>

      {/* Status indicators */}
      {status.configured ? (
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          Connected
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <CloudOff className="h-3 w-3 text-amber-500" />
          Offline
        </span>
      )}

      {/* Conflict warning */}
      {status.conflict_count > 0 && (
        <span className="flex items-center gap-1 text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          {status.conflict_count} conflict{status.conflict_count > 1 ? "s" : ""}
        </span>
      )}

      {/* Watcher status */}
      {status.watcher_active && (
        <span className="flex items-center gap-1">
          <Eye className="h-3 w-3 text-blue-400" />
          Watching
        </span>
      )}

      {/* Tracked files */}
      <span className="flex items-center gap-1">
        <Monitor className="h-3 w-3" />
        {status.tracked_files} files
      </span>

      {/* Last sync time */}
      <span>Last sync: {lastSync}</span>
    </div>
  );
}
