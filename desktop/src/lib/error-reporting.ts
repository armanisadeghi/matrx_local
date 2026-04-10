/**
 * error-reporting.ts — Centralized error reporting bridge for the React frontend.
 *
 * Provides utilities that replace bare `.catch(() => {})` handlers with
 * structured error reporting to the unified log system. This ensures no
 * error is silently swallowed and all failures are visible in the Activity panel.
 *
 * Usage:
 *   import { logError, logWarn, catchAndLog, safeAsync } from "@/lib/error-reporting";
 *
 *   // Replace: somePromise.catch(() => {})
 *   // With:    somePromise.catch(catchAndLog("tts", "AudioContext close"))
 *
 *   // Replace: try { ... } catch { }
 *   // With:    try { ... } catch (e) { logWarn("engine", "heartbeat failed", e) }
 *
 *   // For fire-and-forget async calls:
 *   safeAsync("downloads", "enqueue", () => fetchSomething());
 */

import { emitClientLog } from "@/hooks/use-unified-log";

/**
 * Log an error to the unified log system.
 * Use for unexpected failures that indicate a bug or broken feature.
 */
export function logError(source: string, context: string, error?: unknown): void {
  const msg = error instanceof Error ? error.message : String(error ?? "unknown");
  emitClientLog("error", `[${source}] ${context}: ${msg}`, source);
  // Also keep in console for dev tools debugging
  console.error(`[${source}] ${context}:`, error);
}

/**
 * Log a warning to the unified log system.
 * Use for degraded functionality that isn't fatal (e.g. optional feature unavailable).
 */
export function logWarn(source: string, context: string, error?: unknown): void {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const suffix = msg ? `: ${msg}` : "";
  emitClientLog("warn", `[${source}] ${context}${suffix}`, source);
  console.warn(`[${source}] ${context}:`, error);
}

/**
 * Returns a catch handler that logs the error instead of swallowing it.
 * Use as a drop-in replacement for `.catch(() => {})`.
 *
 * @param source - Log source tag (e.g. "tts", "engine", "downloads")
 * @param context - What operation failed (e.g. "AudioContext close", "heartbeat")
 * @param level - "warn" for expected/non-critical, "error" for unexpected failures
 *
 * @example
 *   // Before (silent):
 *   audioCtx.close().catch(() => {});
 *
 *   // After (visible):
 *   audioCtx.close().catch(catchAndLog("tts", "AudioContext close"));
 */
export function catchAndLog(
  source: string,
  context: string,
  level: "warn" | "error" = "warn",
): (error: unknown) => void {
  return (error: unknown) => {
    if (level === "error") {
      logError(source, context, error);
    } else {
      logWarn(source, context, error);
    }
  };
}

/**
 * Execute an async function with automatic error logging.
 * For fire-and-forget operations where you don't need the result.
 *
 * @example
 *   // Before:
 *   someAsyncOp().catch(() => {});
 *
 *   // After:
 *   safeAsync("engine", "cloud sync", () => someAsyncOp());
 */
export async function safeAsync(
  source: string,
  context: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logWarn(source, context, error);
  }
}
