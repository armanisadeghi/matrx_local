/**
 * Update notification dialog.
 *
 * Shows when a new version is available, with release notes,
 * download progress bar, and install/restart buttons.
 *
 * When the update was pre-downloaded in the background (status === "installed"
 * before the user clicked anything), the dialog opens directly to the
 * "Ready to Install" state — no download step is required.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, Loader2, ArrowUpCircle, X, CheckCircle2 } from "lucide-react";
import type { AutoUpdateState, AutoUpdateActions } from "@/hooks/use-auto-update";

declare const __APP_VERSION__: string;

interface UpdateDialogProps {
  state: AutoUpdateState;
  actions: AutoUpdateActions;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateDialog({ state, actions }: UpdateDialogProps) {
  const { status, busy, preDownloading, progress, dialogOpen } = state;
  const isDownloading = status?.status === "downloading" || preDownloading;
  const isInstalled = status?.status === "installed";
  const isAvailable = status?.status === "available";

  const titleText = isInstalled
    ? "Ready to Install"
    : isDownloading
      ? "Downloading Update"
      : "Update Available";

  const descriptionText = isInstalled
    ? "The update has been downloaded. Restart to apply the new version."
    : isDownloading
      ? "Downloading update in the background…"
      : "A new version of AI Matrx is available.";

  return (
    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) actions.dismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isInstalled ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <ArrowUpCircle className="h-5 w-5 text-primary" />
            )}
            {titleText}
          </DialogTitle>
          <DialogDescription>{descriptionText}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Version info */}
          {status?.version && (
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Current</span>
                <Badge variant="secondary">{__APP_VERSION__}</Badge>
              </div>
              <span className="text-muted-foreground">→</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">New</span>
                <Badge variant="default">v{status.version}</Badge>
              </div>
            </div>
          )}

          {/* Release notes — show for available and while downloading */}
          {status?.body && (isAvailable || isDownloading) && (
            <div className="rounded-lg bg-muted/50 p-3 max-h-40 overflow-y-auto">
              <p className="text-xs font-medium text-muted-foreground mb-1">Release Notes</p>
              <p className="text-sm whitespace-pre-wrap">{status.body}</p>
            </div>
          )}

          {/* Download progress */}
          {isDownloading && (
            <div className="space-y-2">
              <Progress value={progress} />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{progress}%</span>
                {status?.content_length && (
                  <span>
                    {formatBytes(status.downloaded ?? 0)} / {formatBytes(status.content_length)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {isInstalled ? (
            <Button onClick={actions.restart} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Restart Now
            </Button>
          ) : isDownloading ? (
            <>
              <Button variant="ghost" onClick={actions.dismiss} className="gap-2">
                <X className="h-4 w-4" />
                Later
              </Button>
              <Button disabled className="gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Downloading…
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={actions.dismiss} className="gap-2">
                <X className="h-4 w-4" />
                Later
              </Button>
              <Button onClick={actions.install} disabled={busy} className="gap-2">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Install Update
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
