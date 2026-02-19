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

/** Wait for the engine health endpoint to respond. */
export async function waitForEngine(
  baseUrl: string,
  maxRetries = 30,
  intervalMs = 500
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`${baseUrl}/tools/list`, {
        signal: AbortSignal.timeout(1000),
      });
      if (resp.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
