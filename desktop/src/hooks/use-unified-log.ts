/**
 * use-unified-log — Singleton bus that owns ALL log data sources.
 *
 * Sources:
 *   "server"  → engine /setup/logs SSE (structured, history + live)
 *   "syslog"  → engine /logs/stream SSE (raw system.log tail)
 *   "access"  → engine /logs/access/stream SSE (structured HTTP requests)
 *   "tauri"   → Tauri IPC sidecar-log events (Rust ring buffer + live)
 *   "engine"  → engine discovery/connection lifecycle (emitted by use-engine)
 *   "auth"    → Supabase auth lifecycle (emitted by use-auth)
 *   "voice"   → transcription / whisper (emitted by voice hooks)
 *   "setup"   → setup wizard progress (emitted by SetupWizard)
 *
 * All streams self-initiate and auto-reconnect with exponential backoff.
 * The bus is module-level so it survives component re-renders and unmounts.
 *
 * Access log entries carry an extra `accessEntry` field for structured display.
 */

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "info" | "success" | "warn" | "error" | "data" | "cmd";

/** The structured data for an HTTP access log entry. */
export interface AccessEntry {
  timestamp: string;
  method: string;
  path: string;
  query: string;
  origin: string;
  user_agent: string;
  status: number;
  duration_ms: number;
}

export interface ClientLogLine {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
  source?: string;
  /** Present only on source="access" lines — raw structured data for rich display. */
  accessEntry?: AccessEntry;
}

// ---------------------------------------------------------------------------
// Singleton bus & ring buffers
// ---------------------------------------------------------------------------

const _bus = new EventTarget();
const _EVENT = "client-log";
const _CLEAR_EVENT = "client-log-clear";
let _lineId = 0;

const MAX_TEXT_BUFFERED = 5000;
const MAX_ACCESS_BUFFERED = 1000;
const _buffer: ClientLogLine[] = [];

// Separate ring of raw access entries for consumers that want the full struct
const _accessBuffer: AccessEntry[] = [];

// ---------------------------------------------------------------------------
// Stream management
// ---------------------------------------------------------------------------

interface StreamState {
  engineUrl: string | null;
  getToken: (() => Promise<string | null>) | null;
  paused: boolean;
  // Stop functions for active streams
  stopSetupLogs: (() => void) | null;
  stopSyslog: (() => void) | null;
  stopAccess: (() => void) | null;
  stopTauri: (() => void) | null;
}

const _state: StreamState = {
  engineUrl: null,
  getToken: null,
  paused: false,
  stopSetupLogs: null,
  stopSyslog: null,
  stopAccess: null,
  stopTauri: null,
};

// Pause state change event so subscribers can react
const _PAUSE_EVENT = "unified-log-pause";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _makeTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function _push(line: ClientLogLine): void {
  _buffer.push(line);
  if (_buffer.length > MAX_TEXT_BUFFERED) {
    _buffer.splice(0, _buffer.length - MAX_TEXT_BUFFERED);
  }
  _bus.dispatchEvent(new CustomEvent(_EVENT, { detail: line }));
}

/** Emit into the bus. Exported so external callers (auth, engine, voice, setup) can use it. */
export function emitClientLog(
  level: LogLevel,
  message: string,
  source?: string,
  accessEntry?: AccessEntry,
): void {
  const line: ClientLogLine = {
    id: ++_lineId,
    time: _makeTime(),
    level,
    message,
    source,
    accessEntry,
  };
  _push(line);
}

export function getClientLogBuffer(): ClientLogLine[] {
  return [..._buffer];
}

export function getAccessBuffer(): AccessEntry[] {
  return [..._accessBuffer];
}

export function clearClientLog(): void {
  _buffer.splice(0, _buffer.length);
  _accessBuffer.splice(0, _accessBuffer.length);
  _bus.dispatchEvent(new CustomEvent(_CLEAR_EVENT, { detail: null }));
}

export function clearClientLogBySource(source: string): void {
  for (let i = _buffer.length - 1; i >= 0; i--) {
    if (_buffer[i].source === source) _buffer.splice(i, 1);
  }
  if (source === "access") {
    _accessBuffer.splice(0, _accessBuffer.length);
  }
  _bus.dispatchEvent(new CustomEvent(_CLEAR_EVENT, { detail: source }));
}

// ---------------------------------------------------------------------------
// Level inference helpers
// ---------------------------------------------------------------------------

function inferServerLevel(text: string): LogLevel {
  const t = text.toLowerCase();
  if (t.includes("error") || t.includes("failed") || t.includes("traceback") || t.includes("exception")) return "error";
  if (t.includes("warning") || t.includes("warn")) return "warn";
  if (t.includes("ready") || t.includes("✓") || t.includes("started") || t.includes("success")) return "success";
  return "info";
}

function accessLevel(status: number): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "data";
}

// ---------------------------------------------------------------------------
// Backoff reconnect helper
// ---------------------------------------------------------------------------

function makeBackoff(minMs = 1000, maxMs = 30000) {
  let delay = minMs;
  return {
    next(): number {
      const d = delay;
      delay = Math.min(delay * 2, maxMs);
      return d;
    },
    reset() {
      delay = minMs;
    },
  };
}

// ---------------------------------------------------------------------------
// /setup/logs stream (structured events: connected / log / history_end)
// ---------------------------------------------------------------------------

const SETUP_LOG_LEVEL_MAP: Record<string, LogLevel> = {
  debug: "info",
  info: "info",
  warning: "warn",
  error: "error",
  critical: "error",
};

function startSetupLogsStream(engineUrl: string): () => void {
  let active = true;
  let abortCtrl = new AbortController();
  const backoff = makeBackoff();

  const run = async () => {
    while (active) {
      try {
        const url = `${engineUrl}/setup/logs?lines=300`;
        const resp = await fetch(url, { signal: abortCtrl.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        backoff.reset();
        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buf = "";
        let eventType = "";

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const raw of lines) {
            if (raw.startsWith("event: ")) {
              eventType = raw.slice(7).trim();
            } else if (raw.startsWith("data: ")) {
              try {
                const data = JSON.parse(raw.slice(6));
                if (eventType === "log") {
                  const d = data as { line: string; level: string };
                  emitClientLog(SETUP_LOG_LEVEL_MAP[d.level] ?? "info", d.line, "server");
                } else if (eventType === "history_end") {
                  emitClientLog("info", `── History (${data.lines_sent ?? 0} lines) ──────────────────────────`, "server");
                } else if (eventType === "connected") {
                  emitClientLog("info", `Connected — streaming from ${data.log_path ?? ""}`, "server");
                }
              } catch { /* skip malformed */ }
              eventType = "";
            }
          }
        }
      } catch (err) {
        if (!active) break;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("abort")) {
          emitClientLog("error", `Server log stream error: ${msg}`, "server");
        }
      }
      if (!active) break;
      const delay = backoff.next();
      await new Promise((r) => setTimeout(r, delay));
    }
  };

  run();
  return () => {
    active = false;
    abortCtrl.abort();
  };
}

// ---------------------------------------------------------------------------
// /logs/stream stream (raw system.log tail via SSE)
// ---------------------------------------------------------------------------

async function startSyslogStream(engineUrl: string, getToken: () => Promise<string | null>): Promise<() => void> {
  let active = true;
  let esRef: EventSource | null = null;
  const backoff = makeBackoff();

  const connect = async () => {
    const token = await getToken();
    if (!token || !active) return;
    const url = `${engineUrl}/logs/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef = es;

    es.onmessage = (evt) => {
      if (_state.paused) return;
      emitClientLog(inferServerLevel(evt.data), evt.data, "syslog");
    };

    es.onerror = () => {
      es.close();
      esRef = null;
      if (!active) return;
      const delay = backoff.next();
      setTimeout(connect, delay);
    };

    es.onopen = () => { backoff.reset(); };
  };

  connect();

  return () => {
    active = false;
    esRef?.close();
    esRef = null;
  };
}

// ---------------------------------------------------------------------------
// /logs/access snapshot + /logs/access/stream SSE
// ---------------------------------------------------------------------------

async function startAccessStream(engineUrl: string, getToken: () => Promise<string | null>): Promise<() => void> {
  let active = true;
  let esRef: EventSource | null = null;
  const backoff = makeBackoff();

  // Fetch historical snapshot first
  const token = await getToken();
  if (token && active) {
    try {
      const resp = await fetch(`${engineUrl}/logs/access?n=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json() as { entries?: AccessEntry[] };
        if (Array.isArray(data?.entries)) {
          const entries = data.entries.slice(-200);
          entries.forEach((entry) => {
            _accessBuffer.push(entry);
            const msg = `${entry.method} ${entry.path}${entry.query ? `?${entry.query}` : ""} → ${entry.status} (${entry.duration_ms.toFixed(0)}ms)`;
            emitClientLog(accessLevel(entry.status), msg, "access", entry);
          });
          if (_accessBuffer.length > MAX_ACCESS_BUFFERED) {
            _accessBuffer.splice(0, _accessBuffer.length - MAX_ACCESS_BUFFERED);
          }
        }
      }
    } catch { /* silent */ }
  }

  const connect = async () => {
    const tok = await getToken();
    if (!tok || !active) return;
    const url = `${engineUrl}/logs/access/stream?token=${encodeURIComponent(tok)}`;
    const es = new EventSource(url);
    esRef = es;

    es.onmessage = (evt) => {
      if (_state.paused) return;
      try {
        const entry: AccessEntry = JSON.parse(evt.data);
        _accessBuffer.push(entry);
        if (_accessBuffer.length > MAX_ACCESS_BUFFERED) {
          _accessBuffer.splice(0, _accessBuffer.length - MAX_ACCESS_BUFFERED);
        }
        const msg = `${entry.method} ${entry.path}${entry.query ? `?${entry.query}` : ""} → ${entry.status} (${entry.duration_ms.toFixed(0)}ms)`;
        emitClientLog(accessLevel(entry.status), msg, "access", entry);
      } catch { /* skip malformed */ }
    };

    es.onerror = () => {
      es.close();
      esRef = null;
      if (!active) return;
      setTimeout(connect, backoff.next());
    };

    es.onopen = () => { backoff.reset(); };
  };

  connect();

  return () => {
    active = false;
    esRef?.close();
    esRef = null;
  };
}

// ---------------------------------------------------------------------------
// Tauri sidecar-log IPC
// ---------------------------------------------------------------------------

async function startTauriStream(): Promise<() => void> {
  let unlistenFn: (() => void) | null = null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const historical = await invoke<string[]>("get_sidecar_logs").catch(() => [] as string[]);
    historical.forEach((text) => {
      emitClientLog(inferServerLevel(text), text, "tauri");
    });
  } catch { /* not in Tauri */ }

  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string>("sidecar-log", (event) => {
      if (_state.paused) return;
      const text = typeof event.payload === "string" ? event.payload : String(event.payload);
      emitClientLog(inferServerLevel(text), text, "tauri");
    });
    unlistenFn = unlisten;
  } catch { /* not in Tauri */ }

  return () => { unlistenFn?.(); };
}

// ---------------------------------------------------------------------------
// Public API — init / pause / teardown
// ---------------------------------------------------------------------------

/**
 * Initialize all log streams. Call once when engineUrl becomes available.
 * Safe to call multiple times — only starts new streams if engineUrl changed.
 */
export async function initUnifiedLog(
  engineUrl: string,
  getToken: () => Promise<string | null>,
): Promise<void> {
  // Stop existing engine streams if URL changed
  if (_state.engineUrl !== engineUrl) {
    _state.stopSetupLogs?.();
    _state.stopSyslog?.();
    _state.stopAccess?.();
    _state.stopSetupLogs = null;
    _state.stopSyslog = null;
    _state.stopAccess = null;
  }

  _state.engineUrl = engineUrl;
  _state.getToken = getToken;

  if (!_state.stopSetupLogs) {
    _state.stopSetupLogs = startSetupLogsStream(engineUrl);
  }
  if (!_state.stopSyslog) {
    _state.stopSyslog = await startSyslogStream(engineUrl, getToken);
  }
  if (!_state.stopAccess) {
    _state.stopAccess = await startAccessStream(engineUrl, getToken);
  }
}

/**
 * Initialize the Tauri sidecar listener. Call once on app mount (no engine required).
 */
export async function initTauriLogStream(): Promise<void> {
  if (!_state.stopTauri) {
    _state.stopTauri = await startTauriStream();
  }
}

/**
 * Stop all engine streams (e.g. when engine disconnects).
 */
export function stopEngineStreams(): void {
  _state.stopSetupLogs?.();
  _state.stopSyslog?.();
  _state.stopAccess?.();
  _state.stopSetupLogs = null;
  _state.stopSyslog = null;
  _state.stopAccess = null;
  _state.engineUrl = null;
}

/**
 * Stop the Tauri sidecar log listener. Call on app unmount to remove the
 * Tauri IPC event listener and prevent it from leaking after the WebView tears down.
 */
export function stopTauriStream(): void {
  _state.stopTauri?.();
  _state.stopTauri = null;
}

/**
 * Stop all streams (both engine and Tauri). Call on full app teardown.
 */
export function stopAllStreams(): void {
  stopEngineStreams();
  stopTauriStream();
}

/**
 * Get / set the global pause state. When paused, live incoming SSE events are
 * dropped (historical buffer is unaffected).
 */
export function setLogsPaused(paused: boolean): void {
  _state.paused = paused;
  _bus.dispatchEvent(new CustomEvent(_PAUSE_EVENT, { detail: paused }));
}

export function getLogsPaused(): boolean {
  return _state.paused;
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

/**
 * Subscribe to all log lines. Initialises with the full historical buffer.
 */
export function useClientLogSubscriber(): ClientLogLine[] {
  const [lines, setLines] = useState<ClientLogLine[]>(() => getClientLogBuffer());
  const setLinesRef = useRef(setLines);
  setLinesRef.current = setLines;

  useEffect(() => {
    const onLine = (e: Event) => {
      const line = (e as CustomEvent<ClientLogLine>).detail;
      setLinesRef.current((prev) => {
        const next = [...prev, line];
        return next.length > MAX_TEXT_BUFFERED ? next.slice(next.length - MAX_TEXT_BUFFERED) : next;
      });
    };

    const onClear = (e: Event) => {
      const source = (e as CustomEvent<string | null>).detail;
      if (source == null) {
        setLinesRef.current([]);
      } else {
        setLinesRef.current((prev) => prev.filter((l) => l.source !== source));
      }
    };

    _bus.addEventListener(_EVENT, onLine);
    _bus.addEventListener(_CLEAR_EVENT, onClear);
    return () => {
      _bus.removeEventListener(_EVENT, onLine);
      _bus.removeEventListener(_CLEAR_EVENT, onClear);
    };
  }, []);

  return lines;
}

/**
 * Subscribe to just the pause/resume state.
 */
export function useLogsPaused(): boolean {
  const [paused, setPaused] = useState(() => getLogsPaused());

  useEffect(() => {
    const handler = (e: Event) => {
      setPaused((e as CustomEvent<boolean>).detail);
    };
    _bus.addEventListener(_PAUSE_EVENT, handler);
    return () => _bus.removeEventListener(_PAUSE_EVENT, handler);
  }, []);

  return paused;
}
