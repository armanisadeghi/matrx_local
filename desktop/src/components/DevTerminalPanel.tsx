/**
 * DevTerminalPanel — Persistent floating debug terminal with two tabs:
 *
 *   Server tab — live sidecar-log events (Python engine stdout/stderr via Rust)
 *   Client tab — React-side events from useEngine, useAuth (via use-client-log)
 *
 * Toggled via a Terminal button that dispatches a custom DOM event.
 * Mounted once in App.tsx outside the router so it persists across navigation.
 *
 * Features:
 *   - Slide-up panel at bottom of screen (non-blocking)
 *   - Drag handle to resize height
 *   - Copy-to-clipboard per tab
 *   - Clear per tab
 *   - Auto-scroll
 *   - Color-coded log levels
 */

import {
  useCallback, useEffect, useRef, useState,
} from "react";
import { Terminal, X, Copy, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/sidecar";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  useClientLogSubscriber,
  clearClientLog,
} from "@/hooks/use-client-log";
import type { LogLevel } from "@/hooks/use-client-log";

// ---------------------------------------------------------------------------
// Custom DOM event used to toggle the panel from anywhere in the tree
// ---------------------------------------------------------------------------

export const DEV_TERMINAL_TOGGLE_EVENT = "dev-terminal-toggle";

export function toggleDevTerminal() {
  window.dispatchEvent(new CustomEvent(DEV_TERMINAL_TOGGLE_EVENT));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServerLogLine {
  id: number;
  time: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Level styling
// ---------------------------------------------------------------------------

const CLIENT_LEVEL_CLASSES: Record<LogLevel, string> = {
  info:    "text-zinc-400",
  success: "text-emerald-400",
  warn:    "text-amber-400",
  error:   "text-red-400",
  data:    "text-sky-400",
  cmd:     "text-cyan-400",
};

const CLIENT_LEVEL_LABEL: Record<LogLevel, string> = {
  info:    "INFO ",
  success: "OK   ",
  warn:    "WARN ",
  error:   "ERR  ",
  data:    "DATA ",
  cmd:     "CMD  ",
};

function serverLineClass(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("error") || t.includes("failed") || t.includes("traceback")) return "text-red-400";
  if (t.includes("warning") || t.includes("warn")) return "text-amber-400";
  if (t.includes("ready") || t.includes("✓") || t.includes("started")) return "text-emerald-400";
  if (t.startsWith("[stdout]")) return "text-zinc-300";
  return "text-zinc-500";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 300;
const MAX_HEIGHT = 700;

export function DevTerminalPanel() {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [activeTab, setActiveTab] = useState<"server" | "client">("server");

  // Server logs — sidecar-log Tauri events
  const [serverLogs, setServerLogs] = useState<ServerLogLine[]>([]);
  const serverScrollRef = useRef<HTMLDivElement>(null);
  const serverIdRef = useRef(0);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Client logs
  const clientLogs = useClientLogSubscriber();
  const clientScrollRef = useRef<HTMLDivElement>(null);

  // Drag resize
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  const isDragging = useRef(false);

  // Copy state
  const [copiedServer, setCopiedServer] = useState(false);
  const [copiedClient, setCopiedClient] = useState(false);

  // Toggle via custom DOM event
  useEffect(() => {
    const handler = () => setOpen((v) => !v);
    window.addEventListener(DEV_TERMINAL_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(DEV_TERMINAL_TOGGLE_EVENT, handler);
  }, []);

  // Subscribe to sidecar-log Tauri events
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    (async () => {
      // Load historical ring buffer on open
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const historical = await invoke<string[]>("get_sidecar_logs").catch(() => []);
        if (!cancelled && historical.length > 0) {
          const lines: ServerLogLine[] = historical.map((text) => ({
            id: ++serverIdRef.current,
            time: "",
            text,
          }));
          setServerLogs(lines);
        }
      } catch {
        // Not in Tauri
      }

      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<string>("sidecar-log", (event) => {
          if (cancelled) return;
          const text = typeof event.payload === "string" ? event.payload : String(event.payload);
          const time = new Date().toLocaleTimeString("en-US", {
            hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
          });
          setServerLogs((prev) => {
            const next = [...prev, { id: ++serverIdRef.current, time, text }];
            return next.length > 2000 ? next.slice(next.length - 2000) : next;
          });
        });
        unlistenRef.current = unlisten;
      } catch {
        // Not in Tauri or listen unavailable
      }
    })();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  // Auto-scroll active tab
  useEffect(() => {
    if (!open) return;
    if (activeTab === "server" && serverScrollRef.current) {
      serverScrollRef.current.scrollTop = serverScrollRef.current.scrollHeight;
    }
  }, [serverLogs, open, activeTab]);

  useEffect(() => {
    if (!open) return;
    if (activeTab === "client" && clientScrollRef.current) {
      clientScrollRef.current.scrollTop = clientScrollRef.current.scrollHeight;
    }
  }, [clientLogs, open, activeTab]);

  // Drag-to-resize handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartH.current = height;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - ev.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartH.current + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [height]);

  const copyServerLogs = useCallback(async () => {
    const text = `=== Matrx Server Log — ${new Date().toLocaleString()} ===\n${serverLogs.map((l) => `${l.time} ${l.text}`).join("\n")}\n=== END ===`;
    await navigator.clipboard.writeText(text);
    setCopiedServer(true);
    setTimeout(() => setCopiedServer(false), 2000);
  }, [serverLogs]);

  const copyClientLogs = useCallback(async () => {
    const text = `=== Matrx Client Log — ${new Date().toLocaleString()} ===\n${clientLogs.map((l) => `${l.time} ${CLIENT_LEVEL_LABEL[l.level]} [${l.source ?? "app"}] ${l.message}`).join("\n")}\n=== END ===`;
    await navigator.clipboard.writeText(text);
    setCopiedClient(true);
    setTimeout(() => setCopiedClient(false), 2000);
  }, [clientLogs]);

  if (!open) return null;

  const contentHeight = height - 36; // subtract header

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t border-zinc-700/60 bg-zinc-950/95 backdrop-blur-sm shadow-2xl"
      style={{ height }}
    >
      {/* Drag handle */}
      <div
        className="absolute -top-1.5 left-0 right-0 flex cursor-row-resize justify-center py-1 group"
        onMouseDown={onDragStart}
      >
        <div className="h-1 w-12 rounded-full bg-zinc-700 group-hover:bg-zinc-500 transition-colors" />
      </div>

      {/* Header bar */}
      <div className="flex items-center gap-0 border-b border-zinc-800/60 px-2 h-9 flex-shrink-0">
        {/* Tabs */}
        <button
          onClick={() => setActiveTab("server")}
          className={cn(
            "px-3 h-full text-xs font-mono border-b-2 transition-colors",
            activeTab === "server"
              ? "text-zinc-200 border-primary"
              : "text-zinc-500 border-transparent hover:text-zinc-300"
          )}
        >
          Server
        </button>
        <button
          onClick={() => setActiveTab("client")}
          className={cn(
            "px-3 h-full text-xs font-mono border-b-2 transition-colors",
            activeTab === "client"
              ? "text-zinc-200 border-primary"
              : "text-zinc-500 border-transparent hover:text-zinc-300"
          )}
        >
          Client
        </button>

        <div className="flex-1" />

        {/* Actions */}
        {activeTab === "server" && (
          <>
            <button
              onClick={copyServerLogs}
              disabled={serverLogs.length === 0}
              title="Copy server logs to clipboard"
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              {copiedServer ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedServer ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={() => setServerLogs([])}
              disabled={serverLogs.length === 0}
              title="Clear server logs"
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {activeTab === "client" && (
          <>
            <button
              onClick={copyClientLogs}
              disabled={clientLogs.length === 0}
              title="Copy client logs to clipboard"
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              {copiedClient ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedClient ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={clearClientLog}
              disabled={clientLogs.length === 0}
              title="Clear client logs"
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {/* Count badge */}
        <span className="min-w-[28px] rounded bg-zinc-800 px-1.5 py-0.5 text-center text-[10px] text-zinc-500 font-mono mx-1">
          {activeTab === "server" ? serverLogs.length : clientLogs.length}
        </span>

        {/* Close */}
        <button
          onClick={() => setOpen(false)}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors ml-1"
          title="Close terminal"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Log pane */}
      <div style={{ height: contentHeight }} className="overflow-hidden">
        {/* Server tab */}
        {activeTab === "server" && (
          <div
            ref={serverScrollRef}
            className="h-full overflow-y-auto p-2 font-mono text-[11px] leading-relaxed space-y-0.5"
          >
            {serverLogs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-700">
                No server logs yet — engine stdout/stderr will appear here
              </div>
            ) : (
              serverLogs.map((line) => (
                <div key={line.id} className="flex gap-2 min-w-0">
                  {line.time && (
                    <span className="text-zinc-700 shrink-0 tabular-nums select-none">{line.time}</span>
                  )}
                  <span className={cn("break-all whitespace-pre-wrap", serverLineClass(line.text))}>
                    {line.text}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Client tab */}
        {activeTab === "client" && (
          <div
            ref={clientScrollRef}
            className="h-full overflow-y-auto p-2 font-mono text-[11px] leading-relaxed space-y-0.5"
          >
            {clientLogs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-700">
                No client logs yet — engine and auth events will appear here
              </div>
            ) : (
              clientLogs.map((line) => (
                <div key={line.id} className="flex gap-2 min-w-0">
                  <span className="text-zinc-700 shrink-0 tabular-nums select-none">{line.time}</span>
                  <span className={cn("shrink-0 select-none font-semibold", CLIENT_LEVEL_CLASSES[line.level])}>
                    {CLIENT_LEVEL_LABEL[line.level]}
                  </span>
                  {line.source && (
                    <span className="text-zinc-600 shrink-0 select-none">[{line.source}]</span>
                  )}
                  <span className={cn("break-all whitespace-pre-wrap", CLIENT_LEVEL_CLASSES[line.level])}>
                    {line.message}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TerminalToggleButton — placed in the AppLayout status bar
// ---------------------------------------------------------------------------

interface TerminalToggleButtonProps {
  className?: string;
}

export function TerminalToggleButton({ className }: TerminalToggleButtonProps) {
  return (
    <button
      onClick={toggleDevTerminal}
      title="Toggle debug terminal"
      className={cn(
        "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-mono text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors",
        className
      )}
    >
      <Terminal className="h-3.5 w-3.5" />
      <span>Terminal</span>
    </button>
  );
}
