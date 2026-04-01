/**
 * Module-level singleton for image-gen install state.
 *
 * This lives OUTSIDE React so it survives tab switches, component unmounts,
 * and re-renders.  The component subscribes via `subscribe()` and gets the
 * full accumulated log on mount via `getSnapshot()`.
 */

import type { ImageGenInstallStatus } from "@/lib/api";

export type InstallPhase = "idle" | "running" | "complete" | "error";

export interface InstallSnapshot {
  phase: InstallPhase;
  status: ImageGenInstallStatus | null;
  stageMessage: string;
  percent: number;
  logLines: string[];
  error: string | null;
}

type Listener = (snap: InstallSnapshot) => void;

// ── Singleton state ───────────────────────────────────────────────────────────

let _phase: InstallPhase = "idle";
let _status: ImageGenInstallStatus | null = null;
let _stageMessage = "";
let _percent = 0;
let _logLines: string[] = [];
let _error: string | null = null;
let _sseCleanup: (() => void) | null = null;
const _listeners = new Set<Listener>();

function _notify() {
  const snap = getSnapshot();
  _listeners.forEach((fn) => fn(snap));
}

export function getSnapshot(): InstallSnapshot {
  return {
    phase: _phase,
    status: _status,
    stageMessage: _stageMessage,
    percent: _percent,
    logLines: _logLines,
    error: _error,
  };
}

export function subscribe(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function applyEvent(ev: ImageGenInstallStatus) {
  if (ev.status === "complete" || ev.status === "error") {
    _phase = ev.status as InstallPhase;
    _percent = ev.percent ?? _percent;
    if (ev.status === "error") {
      _error = ev.error ?? ev.message ?? "Unknown error";
      _stageMessage = _error;
    } else {
      _stageMessage = ev.message || "Installation complete!";
      _percent = 100;
    }
    _status = ev;
    _notify();
    return;
  }

  if (ev.log) {
    // Raw pip output line — append only, don't update stage
    if (ev.message) {
      _logLines = [..._logLines, ev.message];
      if (_logLines.length > 2000) _logLines = _logLines.slice(-2000);
    }
    _notify();
    return;
  }

  // Stage update
  if (
    ev.status === "running" ||
    ev.status === "connected" ||
    ev.status === "waiting"
  ) {
    _phase = "running";
  }
  if (ev.percent !== undefined) _percent = ev.percent;
  if (ev.message) _stageMessage = ev.message;
  _status = ev;
  _notify();
}

/** Restore full log from a /install/status poll response (reconnect). */
export function restoreFromPoll(resp: ImageGenInstallStatus) {
  if (resp.log_lines && resp.log_lines.length > 0) {
    // Merge: keep any lines we already have, then append anything new from poll
    const existing = new Set(_logLines);
    const incoming = resp.log_lines.filter((l) => !existing.has(l));
    if (incoming.length > 0 || _logLines.length === 0) {
      _logLines = resp.log_lines;
    }
  }

  if (resp.status === "complete" || resp.status === "error") {
    _phase = resp.status as InstallPhase;
    _error = resp.error ?? null;
    _stageMessage =
      resp.message ||
      (resp.status === "complete"
        ? "Installation complete!"
        : "Installation failed");
    _percent = resp.percent ?? _percent;
  } else if (resp.status === "running") {
    _phase = "running";
    _percent = resp.percent ?? _percent;
    _stageMessage = resp.message || _stageMessage;
  }
  _status = resp;
  _notify();
}

export function markStarted() {
  _phase = "running";
  _stageMessage = "Starting…";
  _percent = 0;
  _logLines = [];
  _error = null;
  _status = null;
  _notify();
}

export function reset() {
  _sseCleanup?.();
  _sseCleanup = null;
  _phase = "idle";
  _status = null;
  _stageMessage = "";
  _percent = 0;
  _logLines = [];
  _error = null;
  _notify();
}

export function setSseCleanup(fn: () => void) {
  _sseCleanup?.();
  _sseCleanup = fn;
}

export function stopSse() {
  _sseCleanup?.();
  _sseCleanup = null;
}
