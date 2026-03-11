/**
 * Auto-update hook for the Tauri desktop app.
 *
 * Checks for updates on startup (after a short delay) and periodically
 * based on the user's configured interval. Listens for real-time progress
 * events from the Rust updater during downloads.
 *
 * Returns the current update state so App.tsx can render the UpdateDialog.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { isTauri, checkForUpdates, type UpdateStatus } from "@/lib/sidecar";
import { loadSettings } from "@/lib/settings";

export interface AutoUpdateState {
  /** Current status of the update system */
  status: UpdateStatus | null;
  /** Whether a check or install is in progress */
  busy: boolean;
  /** Download progress (0-100), only valid when status is "downloading" */
  progress: number;
  /** Whether the update dialog should be shown */
  dialogOpen: boolean;
  /** User dismissed the dialog — don't auto-show again for this version */
  dismissed: boolean;
}

export interface AutoUpdateActions {
  /** Manually trigger an update check */
  check: () => Promise<void>;
  /** Download and install the available update */
  install: () => Promise<void>;
  /** Restart the app after update is installed */
  restart: () => Promise<void>;
  /** Dismiss the update dialog */
  dismiss: () => void;
  /** Re-open the update dialog */
  openDialog: () => void;
}

const DISMISSED_VERSION_KEY = "matrx-update-dismissed-version";
const STARTUP_DELAY_MS = 15_000; // Wait 15s after app start before first check

export function useAutoUpdate(): [AutoUpdateState, AutoUpdateActions] {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Listen for real-time download progress events from Rust
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<UpdateStatus>("update-progress", (event) => {
          if (cancelled) return;
          const payload = event.payload;
          setStatus(payload);

          if (payload.status === "downloading" && payload.content_length) {
            const pct = Math.min(
              100,
              Math.round((payload.downloaded ?? 0) / payload.content_length * 100),
            );
            setProgress(pct);
          } else if (payload.status === "installed") {
            setProgress(100);
            setBusy(false);
          }
        });
        if (!cancelled) {
          unlistenRef.current = unlisten;
        } else {
          unlisten();
        }
      } catch {
        // event API not available
      }
    })();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const check = useCallback(async () => {
    if (!isTauri() || busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const result = await checkForUpdates(false);
      setStatus(result);
      // Do NOT auto-open the dialog on background checks — the UpdateBanner
      // handles the non-disruptive notification. The dialog is only opened
      // when the user explicitly clicks "Details" or triggers a manual check
      // from Settings.
    } catch {
      // Network error or updater not available — fail silently
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const install = useCallback(async () => {
    if (!isTauri() || busy) return;
    setBusy(true);
    setProgress(0);
    setDialogOpen(true);
    try {
      const result = await checkForUpdates(true);
      setStatus(result);
      if (result.status === "installed") {
        setProgress(100);
      }
    } catch (err) {
      console.error("[auto-update] Install failed:", err);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const restart = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      // plugin not available
    }
  }, []);

  const dismiss = useCallback(() => {
    setDialogOpen(false);
    setDismissed(true);
    // Remember this version so we don't nag again until a newer version appears
    if (status?.version) {
      localStorage.setItem(DISMISSED_VERSION_KEY, status.version);
    }
  }, [status?.version]);

  const openDialog = useCallback(() => {
    setDialogOpen(true);
    setDismissed(false);
  }, []);

  // Startup check + periodic polling
  useEffect(() => {
    if (!isTauri()) return;

    let startupTimer: ReturnType<typeof setTimeout> | null = null;

    const setupPolling = async () => {
      const settings = await loadSettings();
      if (!settings.autoCheckUpdates) return;

      // Initial check after startup delay
      startupTimer = setTimeout(() => {
        check();

        // Set up periodic checks
        const intervalMs = Math.max(60, settings.updateCheckInterval) * 60 * 1000;
        intervalRef.current = setInterval(check, intervalMs);
      }, STARTUP_DELAY_MS);
    };

    setupPolling();

    return () => {
      if (startupTimer) clearTimeout(startupTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const state: AutoUpdateState = {
    status,
    busy,
    progress,
    dialogOpen,
    dismissed,
  };

  const actions: AutoUpdateActions = {
    check,
    install,
    restart,
    dismiss,
    openDialog,
  };

  return [state, actions];
}
