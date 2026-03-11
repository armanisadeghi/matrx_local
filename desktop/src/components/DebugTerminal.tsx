/**
 * DebugTerminal — fully transparent log viewer for setup and download operations.
 *
 * Shows every event, error, and raw payload with timestamps and color-coded
 * log levels. Includes a "Copy All" button that produces a clean plaintext
 * block ready to paste into a support conversation.
 *
 * Usage:
 *   const { logLine, logs, clearLogs } = useDebugTerminal();
 *   <DebugTerminal logs={logs} onClear={clearLogs} />
 *
 * logLine(level, message) — append a new line. Levels:
 *   "info"    → muted white
 *   "success" → green
 *   "warn"    → amber
 *   "error"   → red
 *   "data"    → blue  (raw JSON payloads, event dumps)
 *   "cmd"     → cyan  (commands being run)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check, Trash2, ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "info" | "success" | "warn" | "error" | "data" | "cmd";

export interface LogLine {
  id: number;
  time: string;        // "HH:MM:SS"
  level: LogLevel;
  message: string;
}

// ---------------------------------------------------------------------------
// Hook — useDebugTerminal
// ---------------------------------------------------------------------------

let _lineId = 0;

export function useDebugTerminal() {
  const [logs, setLogs] = useState<LogLine[]>([]);

  const logLine = useCallback((level: LogLevel, message: string) => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((prev) => [
      ...prev,
      { id: ++_lineId, time, level, message },
    ]);
  }, []);

  /** Log a raw object/value as a DATA line (pretty-printed JSON). */
  const logData = useCallback(
    (label: string, payload: unknown) => {
      try {
        const formatted =
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 0);
        logLine("data", `${label}: ${formatted}`);
      } catch {
        logLine("data", `${label}: [unserializable]`);
      }
    },
    [logLine],
  );

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, logLine, logData, clearLogs };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DebugTerminalProps {
  logs: LogLine[];
  onClear: () => void;
  /** Default collapsed? (terminal auto-expands when logs arrive) */
  defaultOpen?: boolean;
  /** Title shown in the header bar */
  title?: string;
  /** Max height of the scrollable pane */
  maxHeight?: string;
  className?: string;
}

const LEVEL_CLASSES: Record<LogLevel, string> = {
  info:    "text-zinc-400",
  success: "text-emerald-400",
  warn:    "text-amber-400",
  error:   "text-red-400",
  data:    "text-sky-400",
  cmd:     "text-cyan-400",
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  info:    "INFO ",
  success: "OK   ",
  warn:    "WARN ",
  error:   "ERR  ",
  data:    "DATA ",
  cmd:     "CMD  ",
};

export function DebugTerminal({
  logs,
  onClear,
  defaultOpen = false,
  title = "Debug Terminal",
  maxHeight = "260px",
  className,
}: DebugTerminalProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLogCount = useRef(0);

  // Auto-expand when new logs arrive (during active operations)
  useEffect(() => {
    if (logs.length > prevLogCount.current && !open) {
      setOpen(true);
    }
    prevLogCount.current = logs.length;
  }, [logs.length, open]);

  // Auto-scroll to bottom — scroll only within the terminal container, never the page
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, open]);

  const copyAll = useCallback(async () => {
    if (logs.length === 0) return;
    const now = new Date().toLocaleString("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const header = `=== Matrx Debug Log — ${now} ===`;
    const body = logs
      .map((l) => `${l.time} ${LEVEL_LABEL[l.level]} ${l.message}`)
      .join("\n");
    const footer = "=== END ===";
    await navigator.clipboard.writeText(`${header}\n${body}\n${footer}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [logs]);

  const hasErrors = logs.some((l) => l.level === "error");
  const hasWarns = logs.some((l) => l.level === "warn");

  return (
    <div className={cn("rounded-lg border border-zinc-700/60 bg-zinc-950/80", className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/60">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <Terminal className="h-3.5 w-3.5" />
          <span>{title}</span>
          {logs.length > 0 && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 h-4 font-mono border-zinc-600",
                hasErrors
                  ? "text-red-400 border-red-600"
                  : hasWarns
                  ? "text-amber-400 border-amber-600"
                  : "text-zinc-500",
              )}
            >
              {logs.length}
            </Badge>
          )}
          {open ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-zinc-200"
            onClick={copyAll}
            title="Copy all logs to clipboard"
            disabled={logs.length === 0}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-zinc-200"
            onClick={onClear}
            title="Clear logs"
            disabled={logs.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Log pane */}
      {open && (
        <div
          ref={scrollRef}
          className="overflow-y-auto font-mono text-[11px] leading-relaxed p-2 space-y-0.5"
          style={{ maxHeight }}
        >
          {logs.length === 0 && (
            <div className="text-zinc-600 py-3 text-center select-none">
              No output yet — logs will appear here when operations run
            </div>
          )}
          {logs.map((line) => (
            <div key={line.id} className="flex gap-2 min-w-0">
              <span className="text-zinc-600 shrink-0 select-none tabular-nums">
                {line.time}
              </span>
              <span
                className={cn(
                  "shrink-0 select-none tabular-nums font-semibold",
                  LEVEL_CLASSES[line.level],
                )}
              >
                {LEVEL_LABEL[line.level]}
              </span>
              <span
                className={cn(
                  "break-all whitespace-pre-wrap",
                  LEVEL_CLASSES[line.level],
                )}
              >
                {line.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
