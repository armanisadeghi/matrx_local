/**
 * Auto-update hook for the Tauri desktop app.
 *
 * Flow:
 *   1. After startup delay, silently check for updates.
 *   2. If an update is available, immediately begin downloading it in the
 *      background (pre-download). The UpdateBanner shows "Downloading…"
 *      during this phase without any user interaction required.
 *   3. When the user clicks "Install", if the download has already completed
 *      (status === "installed"), we just open the confirm-restart dialog —
 *      no second download. If it's still in progress, the dialog shows the
 *      live progress bar. If it hasn't started for some reason, we kick it off.
 *
 * The "Check Again" action re-runs the check which resets state and, if a
 * (possibly newer) update is still available, restarts the pre-download.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { isTauri, checkForUpdates, restartApp, type UpdateStatus } from "@/lib/sidecar";
import { loadSettings } from "@/lib/settings";

export interface AutoUpdateState {
  /** Current status of the update system */
  status: UpdateStatus | null;
  /** Whether a check or install is actively in progress */
  busy: boolean;
  /** True while the background pre-download is running (not user-initiated) */
  preDownloading: boolean;
  /** Download progress (0-100), valid when status is "downloading" */
  progress: number;
  /** Whether the update dialog should be shown */
  dialogOpen: boolean;
  /** User dismissed the dialog — don't auto-show again for this version */
  dismissed: boolean;
}

export interface AutoUpdateActions {
  /**
   * Trigger an update check.
   * Pass `showResult: true` for manual checks so the dialog opens when an
   * update is found. Background periodic checks leave the dialog closed —
   * the UpdateBanner handles non-disruptive notification.
   */
  check: (opts?: { showResult?: boolean }) => Promise<void>;
  /**
   * Open the install/restart dialog.
   * If the pre-download has already completed, shows "Restart Now".
   * If it's still in progress, shows the live download progress.
   * If it hasn't started yet (e.g. pre-download was skipped), kicks it off.
   */
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
  const [preDownloading, setPreDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  // Track the current pre-download so we don't double-start it
  const preDownloadInProgressRef = useRef(false);

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
              Math.round(((payload.downloaded ?? 0) / payload.content_length) * 100),
            );
            setProgress(pct);
          } else if (payload.status === "installed") {
            setProgress(100);
            setBusy(false);
            setPreDownloading(false);
            preDownloadInProgressRef.current = false;
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

  /**
   * Kick off a background download without opening the dialog.
   * Safe to call multiple times — guarded by preDownloadInProgressRef.
   */
  const startPreDownload = useCallback(async () => {
    if (!isTauri() || preDownloadInProgressRef.current) return;
    preDownloadInProgressRef.current = true;
    setPreDownloading(true);
    setProgress(0);
    try {
      const result = await checkForUpdates(true);
      setStatus(result);
      if (result.status === "installed") {
        setProgress(100);
      }
    } catch (err) {
      console.error("[auto-update] Background pre-download failed:", err);
    } finally {
      setPreDownloading(false);
      preDownloadInProgressRef.current = false;
    }
  }, []);

  const check = useCallback(
    async (opts?: { showResult?: boolean }) => {
      if (!isTauri() || busy) return;
      setBusy(true);
      setProgress(0);
      // Reset pre-download guard so a fresh check can trigger a new download
      preDownloadInProgressRef.current = false;
      try {
        const result = await checkForUpdates(false);
        setStatus(result);
        if (result.status === "available") {
          if (opts?.showResult) {
            setDialogOpen(true);
            setDismissed(false);
          }
          // Start background pre-download regardless of whether the dialog opened
          void startPreDownload();
        }
      } catch {
        // Network error or updater not available — fail silently
      } finally {
        setBusy(false);
      }
    },
    [busy, startPreDownload],
  );

  const install = useCallback(async () => {
    if (!isTauri()) return;

    // If the pre-download already finished, just open the restart dialog
    if (status?.status === "installed") {
      setDialogOpen(true);
      return;
    }

    // If a pre-download is already in progress, just surface the dialog so the
    // user can watch the progress and click "Restart" when it completes
    if (preDownloadInProgressRef.current || status?.status === "downloading") {
      setDialogOpen(true);
      return;
    }

    // Pre-download hadn't started yet (e.g. user clicked Install very quickly).
    // Start the download now and open the dialog so progress is visible.
    setDialogOpen(true);
    if (!busy) {
      setBusy(true);
      setProgress(0);
      preDownloadInProgressRef.current = true;
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
        preDownloadInProgressRef.current = false;
      }
    }
  }, [busy, status?.status]);

  const restart = useCallback(async () => {
    await restartApp();
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
        void check();

        // Set up periodic checks
        const intervalMs = Math.max(60, settings.updateCheckInterval) * 60 * 1000;
        intervalRef.current = setInterval(() => void check(), intervalMs);
      }, STARTUP_DELAY_MS);
    };

    void setupPolling();

    return () => {
      if (startupTimer) clearTimeout(startupTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const state: AutoUpdateState = {
    status,
    busy,
    preDownloading,
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
