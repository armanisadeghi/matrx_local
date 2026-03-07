/**
 * Sidecar management for the Python/FastAPI engine.
 *
 * In production (packaged Tauri app), the engine runs as a Tauri sidecar.
 * In development, the engine is expected to be running separately.
 */

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

async function loadTauriInvoke() {
  if (invoke) return invoke;
  try {
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke;
    return invoke;
  } catch {
    return null;
  }
}

/** Whether we're running inside a Tauri window. */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Start the Python engine sidecar (Tauri only). */
export async function startSidecar(): Promise<void> {
  const inv = await loadTauriInvoke();
  if (!inv) {
    console.log("[sidecar] Not in Tauri, skipping sidecar start");
    return;
  }
  await inv("start_sidecar");
}

/** Stop the Python engine sidecar (Tauri only). */
export async function stopSidecar(): Promise<void> {
  const inv = await loadTauriInvoke();
  if (!inv) return;
  await inv("stop_sidecar");
}

/** Set whether closing the window hides to tray or quits. */
export async function setCloseToTray(enabled: boolean): Promise<void> {
  const inv = await loadTauriInvoke();
  if (!inv) return;
  await inv("set_close_to_tray", { enabled });
}

export interface UpdateStatus {
  status: "up_to_date" | "available" | "downloading" | "installed";
  version?: string;
  body?: string;
  content_length?: number;
  downloaded?: number;
}

/** Check for updates via the Tauri updater plugin. */
export async function checkForUpdates(install = false): Promise<UpdateStatus> {
  const inv = await loadTauriInvoke();
  if (!inv) return { status: "up_to_date" };
  const result = await inv("check_for_updates", { install }) as UpdateStatus;
  return result;
}

/** Restart the app (used after installing an update). */
export async function restartApp(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    // process plugin not available
  }
}

/** Get sidecar process status from Rust (Tauri only). */
export async function getSidecarStatus(): Promise<{ running: boolean; port: number } | null> {
  const inv = await loadTauriInvoke();
  if (!inv) return null;
  try {
    return (await inv("sidecar_status")) as { running: boolean; port: number };
  } catch {
    return null;
  }
}

/** Get buffered sidecar stdout/stderr lines from Rust (Tauri only). */
export async function getSidecarLogs(): Promise<string[]> {
  const inv = await loadTauriInvoke();
  if (!inv) return [];
  try {
    return (await inv("get_sidecar_logs")) as string[];
  } catch {
    return [];
  }
}

/**
 * Wait for the engine health endpoint to respond.
 * Defaults tuned for PyInstaller sidecar cold boot (~10-30s).
 */
export async function waitForEngine(
  baseUrl: string,
  maxRetries = 60,
  intervalMs = 1000
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`${baseUrl}/tools/list`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Scan the engine port range and return the first port that responds.
 * This is a standalone helper so the recovery modal can use it independently.
 */
export async function discoverEnginePort(): Promise<string | null> {
  const ports = Array.from({ length: 20 }, (_, i) => 22140 + i);
  for (const port of ports) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/tools/list`, {
        signal: AbortSignal.timeout(1000),
      });
      if (resp.ok) return `http://127.0.0.1:${port}`;
    } catch {
      continue;
    }
  }
  return null;
}
