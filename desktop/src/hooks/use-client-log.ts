/**
 * use-client-log — Global event bus for client-side debug logging.
 *
 * A module-level EventTarget singleton emits log lines from useEngine,
 * useAuth, and anywhere else. DevTerminalPanel subscribes via
 * useClientLogSubscriber() to display them in the Client tab.
 *
 * Kept outside React state so it survives component re-renders and
 * is available from non-component contexts (e.g. API utilities).
 */

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types (re-export LogLevel from DebugTerminal to keep a single source)
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
let _lineId = 0;

const MAX_BUFFERED = 2000;
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
 * Emit a client-side log line. Safe to call from anywhere — hooks, API
 * clients, event handlers. The line is added to the in-memory ring buffer
 * AND dispatched as a CustomEvent for live subscribers.
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
 * Subscribe to live client log lines. Returns accumulated lines
 * (including historical buffer on first render).
 */
export function useClientLogSubscriber(): ClientLogLine[] {
  const [lines, setLines] = useState<ClientLogLine[]>(() => getClientLogBuffer());
  const setLinesRef = useRef(setLines);
  setLinesRef.current = setLines;

  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent<ClientLogLine>).detail;
      setLinesRef.current((prev) => {
        const next = [...prev, line];
        return next.length > MAX_BUFFERED
          ? next.slice(next.length - MAX_BUFFERED)
          : next;
      });
    };
    _bus.addEventListener(_EVENT, handler);
    return () => _bus.removeEventListener(_EVENT, handler);
  }, []);

  return lines;
}

/**
 * Clear the in-memory buffer and notify subscribers.
 */
export function clearClientLog(): void {
  _buffer.splice(0, _buffer.length);
  _bus.dispatchEvent(new CustomEvent("client-log-clear"));
}

export function useClientLogClear(): () => void {
  return clearClientLog;
}
