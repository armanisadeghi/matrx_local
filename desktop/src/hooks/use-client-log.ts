/**
 * use-client-log — Global event bus for all client-side debug logging.
 *
 * Single source of truth for ALL log data shown in DevTerminalPanel:
 *   - "server" source  → engine SSE log stream (Python stdout/stderr)
 *   - "auth" source    → Supabase auth lifecycle events
 *   - "engine" source  → engine discovery, connection, tools
 *   - "voice" source   → transcription / whisper operations
 *   - "setup" source   → setup wizard install progress
 *   - "tauri" source   → sidecar-log Tauri IPC events
 *
 * emitClientLog() is safe to call from anywhere — hooks, event handlers,
 * non-React utilities — and survives component re-renders.
 */

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "info" | "success" | "warn" | "error" | "data" | "cmd";

export interface ClientLogLine {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
  source?: string;
}

// ---------------------------------------------------------------------------
// Singleton event bus
// ---------------------------------------------------------------------------

const _bus = new EventTarget();
const _EVENT = "client-log";
const _CLEAR_EVENT = "client-log-clear";
let _lineId = 0;

const MAX_BUFFERED = 5000;
const _buffer: ClientLogLine[] = [];

function _makeTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Emit a log line into the global bus. Safe to call from anywhere.
 */
export function emitClientLog(
  level: LogLevel,
  message: string,
  source?: string,
): void {
  const line: ClientLogLine = {
    id: ++_lineId,
    time: _makeTime(),
    level,
    message,
    source,
  };
  _buffer.push(line);
  if (_buffer.length > MAX_BUFFERED) {
    _buffer.splice(0, _buffer.length - MAX_BUFFERED);
  }
  _bus.dispatchEvent(new CustomEvent(_EVENT, { detail: line }));
}

/**
 * Get a snapshot of all buffered log lines (for initial render on mount).
 */
export function getClientLogBuffer(): ClientLogLine[] {
  return [..._buffer];
}

/**
 * Clear ALL buffered log lines and notify subscribers.
 */
export function clearClientLog(): void {
  _buffer.splice(0, _buffer.length);
  _bus.dispatchEvent(new CustomEvent(_CLEAR_EVENT, { detail: null }));
}

/**
 * Clear log lines for a specific source only.
 */
export function clearClientLogBySource(source: string): void {
  const removed = new Set<number>();
  for (let i = _buffer.length - 1; i >= 0; i--) {
    if (_buffer[i].source === source) {
      removed.add(_buffer[i].id);
      _buffer.splice(i, 1);
    }
  }
  if (removed.size > 0) {
    _bus.dispatchEvent(new CustomEvent(_CLEAR_EVENT, { detail: source }));
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Subscribe to live client log lines. Initialises with the historical buffer
 * so nothing is lost on mount. Handles both full clears and source clears.
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
        return next.length > MAX_BUFFERED ? next.slice(next.length - MAX_BUFFERED) : next;
      });
    };

    const onClear = (e: Event) => {
      const source = (e as CustomEvent<string | null>).detail;
      if (source == null) {
        // Full clear
        setLinesRef.current([]);
      } else {
        // Source-scoped clear
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
