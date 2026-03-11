/**
 * Persistent but non-disruptive update notification banner.
 *
 * Appears in the bottom-right corner whenever an update is available,
 * is downloading, or is ready to install. Does NOT take over the page —
 * the user can dismiss it and return later via the Settings > About tab.
 *
 * The full UpdateDialog (with release notes and progress bar) is opened
 * from the "View Details" / "Install" button here.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowUpCircle, Download, RefreshCw, X, Loader2 } from "lucide-react";
import type { AutoUpdateState, AutoUpdateActions } from "@/hooks/use-auto-update";

declare const __APP_VERSION__: string;

interface UpdateBannerProps {
  state: AutoUpdateState;
  actions: AutoUpdateActions;
}

export function UpdateBanner({ state, actions }: UpdateBannerProps) {
  const { status, busy, progress } = state;
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismissedVersionRef = useRef<string | null>(null);

  const isAvailable = status?.status === "available";
  const isDownloading = status?.status === "downloading";
  const isInstalled = status?.status === "installed";

  // Show banner when update is available, downloading, or installed —
  // but not if the user already dismissed this exact version.
  useEffect(() => {
    if (!status) return;

    if (isAvailable) {
      if (dismissedVersionRef.current === status.version) return;
      setVisible(true);
      setDismissed(false);
    } else if (isDownloading || isInstalled) {
      // Always show during active download or when restart is needed
      setVisible(true);
      setDismissed(false);
    }
  }, [status?.status, status?.version, isAvailable, isDownloading, isInstalled]);

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    if (status?.version) {
      dismissedVersionRef.current = status.version;
    }
    // Also tell the hook so the full dialog won't re-open for this version
    actions.dismiss();
  };

  const handleInstall = () => {
    // Start install but keep banner visible for progress
    actions.install();
  };

  const handleViewDetails = () => {
    actions.openDialog();
  };

  if (!visible || dismissed) return null;
  if (!isAvailable && !isDownloading && !isInstalled) return null;

  return (
    <div
      className={[
        "fixed bottom-4 right-4 z-50 w-80",
        "rounded-xl border bg-card/95 backdrop-blur-sm shadow-xl",
        "animate-in slide-in-from-bottom-4 fade-in duration-300",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="mt-0.5 shrink-0">
          {isInstalled ? (
            <RefreshCw className="h-4 w-4 text-green-500" />
          ) : isDownloading ? (
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
          ) : (
            <ArrowUpCircle className="h-4 w-4 text-primary" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">
            {isInstalled
              ? "Update ready to install"
              : isDownloading
                ? "Downloading update..."
                : "Update available"}
          </p>
          {status?.version && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {isInstalled
                ? `v${status.version} — restart to apply`
                : isDownloading
                  ? `v${status.version}`
                  : `v${__APP_VERSION__} → v${status.version}`}
            </p>
          )}
        </div>

        {/* Dismiss — only allowed when not actively downloading */}
        {!isDownloading && (
          <button
            onClick={handleDismiss}
            className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Dismiss update notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Progress bar — shown during download */}
      {isDownloading && (
        <div className="px-4 pb-3 space-y-1">
          <Progress value={progress} className="h-1.5" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress}%</span>
            {status?.content_length && status?.downloaded != null && (
              <span>
                {formatBytes(status.downloaded)} / {formatBytes(status.content_length)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-4 pb-4">
        {isInstalled ? (
          <Button
            size="sm"
            onClick={actions.restart}
            className="flex-1 gap-1.5 h-8 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Restart Now
          </Button>
        ) : isDownloading ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleViewDetails}
            className="flex-1 h-8 text-xs"
          >
            View Progress
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              onClick={handleInstall}
              disabled={busy}
              className="flex-1 gap-1.5 h-8 text-xs"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Install
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleViewDetails}
              className="h-8 text-xs"
            >
              Details
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
