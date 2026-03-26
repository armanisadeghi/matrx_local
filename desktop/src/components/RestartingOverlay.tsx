/**
 * Full-screen overlay shown while the app is restarting after an update.
 * Prevents any further interaction and makes it clear the restart is in progress.
 */

import { Loader2 } from "lucide-react";

interface RestartingOverlayProps {
  visible: boolean;
}

export function RestartingOverlay({ visible }: RestartingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm animate-in fade-in duration-200"
      aria-live="assertive"
      aria-label="Restarting application"
    >
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <div className="text-center space-y-1">
        <p className="text-base font-semibold">Restarting…</p>
        <p className="text-sm text-muted-foreground">
          Applying the update and relaunching. This will only take a moment.
        </p>
      </div>
    </div>
  );
}
