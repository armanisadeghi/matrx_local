/**
 * DevTerminalPanel — Unified, persistent debug terminal.
 *
 * Tabs:
 *   Overview  — live summary: counts by source & level, last error/warn per source
 *   Server    — engine SSE / sidecar-log lines (source="server" | source="tauri")
 *   Client    — auth, engine discovery, voice, setup (all other sources)
 *   All       — every log line regardless of source
 *
 * Features:
 *   - No auto-scroll ever (user controls scroll position)
 *   - Level filter pills per tab (toggle individual levels; counts shown)
 *   - Copy button copies the currently visible (filtered) lines
 *   - Clear scoped to the active tab's source set
 *   - Drag handle to resize height
 *   - Toggle via DOM event from TerminalToggleButton in the status bar
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Terminal,
  X,
  Copy,
  Check,
  Trash2,
  LayoutDashboard,
  Server,
  Monitor,
  List,
  AlertTriangle,
  AlertCircle,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/sidecar";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  useClientLogSubscriber,
  clearClientLog,
  clearClientLogBySource,
  emitClientLog,
} from "@/hooks/use-client-log";
import type { LogLevel, ClientLogLine } from "@/hooks/use-client-log";

// ---------------------------------------------------------------------------
// Context — broadcasts panel height so AppLayout can compensate
// ---------------------------------------------------------------------------

interface DevTerminalContextValue {
  panelHeight: number;
}

const DevTerminalContext = createContext<DevTerminalContextValue>({ panelHeight: 0 });

export function useDevTerminalHeight(): number {
  return useContext(DevTerminalContext).panelHeight;
}

interface DevTerminalProviderProps {
  children: React.ReactNode;
}

export function DevTerminalProvider({ children }: DevTerminalProviderProps) {
  const [panelHeight, setPanelHeight] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<number>;
      setPanelHeight(custom.detail ?? 0);
    };
    window.addEventListener(DEV_TERMINAL_HEIGHT_EVENT, handler);
    return () => window.removeEventListener(DEV_TERMINAL_HEIGHT_EVENT, handler);
  }, []);

  return (
    <DevTerminalContext.Provider value={{ panelHeight }}>
      {children}
    </DevTerminalContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// DOM events
// ---------------------------------------------------------------------------

export const DEV_TERMINAL_TOGGLE_EVENT = "dev-terminal-toggle";
export const DEV_TERMINAL_HEIGHT_EVENT = "dev-terminal-height";

export function toggleDevTerminal() {
  window.dispatchEvent(new CustomEvent(DEV_TERMINAL_TOGGLE_EVENT));
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 320;
const MAX_HEIGHT = 750;

const ALL_LEVELS: LogLevel[] = ["info", "success", "warn", "error", "data", "cmd"];

// Sources that live in the "Server" tab
const SERVER_SOURCES = new Set(["server", "tauri"]);

// Sources that live in the "Client" tab
const CLIENT_SOURCES = new Set(["engine", "auth", "voice", "setup"]);

const LEVEL_COLOR: Record<LogLevel, string> = {
  info:    "text-zinc-400",
  success: "text-emerald-400",
  warn:    "text-amber-400",
  error:   "text-red-400",
  data:    "text-sky-400",
  cmd:     "text-cyan-400",
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  info:    "INFO",
  success: "OK  ",
  warn:    "WARN",
  error:   "ERR ",
  data:    "DATA",
  cmd:     "CMD ",
};

const LEVEL_PILL_ACTIVE: Record<LogLevel, string> = {
  info:    "bg-zinc-700 text-zinc-200 border-zinc-500",
  success: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
  warn:    "bg-amber-900/50 text-amber-300 border-amber-700",
  error:   "bg-red-900/50 text-red-300 border-red-700",
  data:    "bg-sky-900/50 text-sky-300 border-sky-700",
  cmd:     "bg-cyan-900/50 text-cyan-300 border-cyan-700",
};

const LEVEL_PILL_INACTIVE = "text-zinc-600 border-zinc-800 hover:text-zinc-400 hover:border-zinc-700";

// Heuristic level detection for raw server strings (no structured level)
function inferServerLevel(text: string): LogLevel {
  const t = text.toLowerCase();
  if (t.includes("error") || t.includes("failed") || t.includes("traceback") || t.includes("exception")) return "error";
  if (t.includes("warning") || t.includes("warn")) return "warn";
  if (t.includes("ready") || t.includes("✓") || t.includes("started") || t.includes("success")) return "success";
  if (t.startsWith("[stdout]") || t.includes("info")) return "info";
  return "info";
}

// ---------------------------------------------------------------------------
// Filter pill row sub-component
// ---------------------------------------------------------------------------

function LevelFilters({
  logs,
  activeFilters,
  onToggle,
}: {
  logs: ClientLogLine[];
  activeFilters: Set<LogLevel>;
  onToggle: (level: LogLevel) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/60 flex-wrap">
      <span className="text-[10px] text-zinc-600 font-mono mr-1 select-none shrink-0">filter:</span>
      {ALL_LEVELS.map((level) => {
        const count = logs.filter((l) => l.level === level).length;
        const isActive = activeFilters.has(level);
        return (
          <button
            key={level}
            onClick={() => onToggle(level)}
            title={`${isActive ? "Hide" : "Show"} ${level} (${count})`}
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-mono px-1.5 h-[18px] rounded border transition-colors select-none",
              isActive ? LEVEL_PILL_ACTIVE[level] : LEVEL_PILL_INACTIVE,
            )}
          >
            {LEVEL_LABEL[level].trim()}
            {count > 0 && <span className="opacity-60">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log row
// ---------------------------------------------------------------------------

function LogRow({ line }: { line: ClientLogLine }) {
  return (
    <div className="flex gap-2 min-w-0 hover:bg-zinc-900/40 px-1 rounded">
      <span className="text-zinc-700 shrink-0 tabular-nums select-none text-[10px] pt-px">{line.time}</span>
      <span className={cn("shrink-0 select-none tabular-nums font-semibold text-[10px] pt-px w-8", LEVEL_COLOR[line.level])}>
        {LEVEL_LABEL[line.level]}
      </span>
      {line.source && (
        <span className="text-zinc-600 shrink-0 select-none text-[10px] pt-px">[{line.source}]</span>
      )}
      <span className={cn("break-all whitespace-pre-wrap text-[11px]", LEVEL_COLOR[line.level])}>
        {line.message}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log pane (filterable, no auto-scroll)
// ---------------------------------------------------------------------------

function LogPane({
  logs,
  emptyMessage,
  filterKey,
}: {
  logs: ClientLogLine[];
  emptyMessage: string;
  filterKey: string;
}) {
  const [activeFilters, setActiveFilters] = useState<Set<LogLevel>>(
    () => new Set(ALL_LEVELS),
  );

  // Reset filters when the tab source set changes
  useEffect(() => {
    setActiveFilters(new Set(ALL_LEVELS));
  }, [filterKey]);

  const toggleFilter = useCallback((level: LogLevel) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size === 1) return prev; // keep at least one
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const visible = useMemo(
    () =>
      activeFilters.size === ALL_LEVELS.length
        ? logs
        : logs.filter((l) => activeFilters.has(l.level)),
    [logs, activeFilters],
  );

  return (
    <>
      <LevelFilters logs={logs} activeFilters={activeFilters} onToggle={toggleFilter} />
      <div className="flex-1 overflow-y-auto p-2 space-y-px font-mono">
        {visible.length === 0 ? (
          <div className="flex h-full min-h-[80px] items-center justify-center text-zinc-700 text-[11px]">
            {logs.length === 0 ? emptyMessage : "No logs match the active filters"}
          </div>
        ) : (
          visible.map((line) => <LogRow key={line.id} line={line} />)
        )}
      </div>
      {/* Expose filtered lines for the copy handler via a data attr trick — we
          surface them via a callback ref approach instead */}
      <div data-filtered-count={visible.length} className="hidden" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

const SOURCE_ORDER = ["server", "tauri", "engine", "auth", "voice", "setup"];
const SOURCE_LABELS: Record<string, string> = {
  server: "Engine (SSE)",
  tauri:  "Sidecar IPC",
  engine: "Engine Client",
  auth:   "Auth",
  voice:  "Voice",
  setup:  "Setup Wizard",
};

function OverviewTab({ logs }: { logs: ClientLogLine[] }) {
  const sources = useMemo(() => {
    const map = new Map<string, { info: number; success: number; warn: number; error: number; data: number; cmd: number; lastError: string | null; lastWarn: string | null }>();

    const knownSources = [...SOURCE_ORDER];
    // Add any unknown sources
    logs.forEach((l) => {
      const s = l.source ?? "unknown";
      if (!knownSources.includes(s)) knownSources.push(s);
    });

    knownSources.forEach((s) => {
      map.set(s, { info: 0, success: 0, warn: 0, error: 0, data: 0, cmd: 0, lastError: null, lastWarn: null });
    });

    logs.forEach((l) => {
      const s = l.source ?? "unknown";
      if (!map.has(s)) map.set(s, { info: 0, success: 0, warn: 0, error: 0, data: 0, cmd: 0, lastError: null, lastWarn: null });
      const entry = map.get(s)!;
      entry[l.level]++;
      if (l.level === "error" && !entry.lastError) entry.lastError = l.message;
      if (l.level === "warn" && !entry.lastWarn) entry.lastWarn = l.message;
    });

    return [...map.entries()].filter(([, v]) =>
      (v.info + v.success + v.warn + v.error + v.data + v.cmd) > 0
    );
  }, [logs]);

  const totalErrors = logs.filter((l) => l.level === "error").length;
  const totalWarns = logs.filter((l) => l.level === "warn").length;
  const totalLines = logs.length;

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-zinc-700">
        <Terminal className="h-8 w-8 opacity-30" />
        <p className="text-[12px] font-mono">No log activity yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Top-line summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col gap-1">
          <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Total Lines</span>
          <span className="text-xl font-mono text-zinc-200">{totalLines.toLocaleString()}</span>
        </div>
        <div className={cn(
          "rounded-lg border p-3 flex flex-col gap-1",
          totalErrors > 0 ? "border-red-900/60 bg-red-950/30" : "border-zinc-800 bg-zinc-900/60"
        )}>
          <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />Errors
          </span>
          <span className={cn("text-xl font-mono", totalErrors > 0 ? "text-red-400" : "text-zinc-600")}>
            {totalErrors}
          </span>
        </div>
        <div className={cn(
          "rounded-lg border p-3 flex flex-col gap-1",
          totalWarns > 0 ? "border-amber-900/60 bg-amber-950/20" : "border-zinc-800 bg-zinc-900/60"
        )}>
          <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />Warnings
          </span>
          <span className={cn("text-xl font-mono", totalWarns > 0 ? "text-amber-400" : "text-zinc-600")}>
            {totalWarns}
          </span>
        </div>
      </div>

      {/* Per-source breakdown */}
      <div className="space-y-1.5">
        <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider px-0.5">By Source</p>
        {sources.map(([source, counts]) => {
          const total = counts.info + counts.success + counts.warn + counts.error + counts.data + counts.cmd;
          const label = SOURCE_LABELS[source] ?? source;
          return (
            <div
              key={source}
              className={cn(
                "rounded-lg border bg-zinc-900/40 p-2.5",
                counts.error > 0
                  ? "border-red-900/40"
                  : counts.warn > 0
                  ? "border-amber-900/40"
                  : "border-zinc-800/60",
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-mono text-zinc-300">{label}</span>
                <span className="text-[10px] font-mono text-zinc-600">{total} lines</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(["error", "warn", "success", "info", "data", "cmd"] as LogLevel[]).map((level) => {
                  const n = counts[level];
                  if (n === 0) return null;
                  return (
                    <span
                      key={level}
                      className={cn(
                        "text-[10px] font-mono px-1.5 py-0 rounded border",
                        LEVEL_PILL_ACTIVE[level],
                      )}
                    >
                      {LEVEL_LABEL[level].trim()} {n}
                    </span>
                  );
                })}
              </div>
              {counts.lastError && (
                <p className="mt-1.5 text-[10px] text-red-400/70 font-mono truncate">
                  Last error: {counts.lastError}
                </p>
              )}
              {!counts.lastError && counts.lastWarn && (
                <p className="mt-1.5 text-[10px] text-amber-400/70 font-mono truncate">
                  Last warning: {counts.lastWarn}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab definition
// ---------------------------------------------------------------------------

type TabId = "overview" | "server" | "client" | "all";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  filter: (l: ClientLogLine) => boolean;
  clearSources: string[] | null; // null = clear all
  emptyMessage: string;
}

const TABS: TabDef[] = [
  {
    id: "overview",
    label: "Overview",
    icon: <LayoutDashboard className="h-3 w-3" />,
    filter: () => true,
    clearSources: null,
    emptyMessage: "",
  },
  {
    id: "server",
    label: "Server",
    icon: <Server className="h-3 w-3" />,
    filter: (l) => SERVER_SOURCES.has(l.source ?? ""),
    clearSources: ["server", "tauri"],
    emptyMessage: "No server logs yet — engine stdout/stderr will appear here",
  },
  {
    id: "client",
    label: "Client",
    icon: <Monitor className="h-3 w-3" />,
    filter: (l) => {
      const s = l.source ?? "";
      return CLIENT_SOURCES.has(s) || (!SERVER_SOURCES.has(s) && !CLIENT_SOURCES.has(s));
    },
    clearSources: ["engine", "auth", "voice", "setup"],
    emptyMessage: "No client logs yet — engine, auth, voice, and setup events appear here",
  },
  {
    id: "all",
    label: "All",
    icon: <List className="h-3 w-3" />,
    filter: () => true,
    clearSources: null,
    emptyMessage: "No log activity yet",
  },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DevTerminalPanel() {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  // All logs from the unified bus (includes server, client, voice, etc.)
  const allLogs = useClientLogSubscriber();

  // Drag resize
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  const isDragging = useRef(false);

  // Copy state per tab
  const [copied, setCopied] = useState(false);

  // Tauri sidecar-log listener — feeds into the global bus as source="tauri"
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Broadcast panel height
  const broadcastHeight = useCallback((isOpen: boolean, h: number) => {
    window.dispatchEvent(
      new CustomEvent<number>(DEV_TERMINAL_HEIGHT_EVENT, { detail: isOpen ? h : 0 }),
    );
  }, []);

  // Toggle via DOM event
  useEffect(() => {
    const handler = () =>
      setOpen((v) => {
        const next = !v;
        broadcastHeight(next, height);
        return next;
      });
    window.addEventListener(DEV_TERMINAL_TOGGLE_EVENT, handler);
    return () => {
      window.removeEventListener(DEV_TERMINAL_TOGGLE_EVENT, handler);
      window.dispatchEvent(new CustomEvent<number>(DEV_TERMINAL_HEIGHT_EVENT, { detail: 0 }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // Subscribe to Tauri sidecar-log events → emit into unified bus as source="tauri"
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      // Replay ring buffer from Rust
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const historical = await invoke<string[]>("get_sidecar_logs").catch(() => []);
        if (!cancelled && historical.length > 0) {
          historical.forEach((text) => {
            emitClientLog(inferServerLevel(text), text, "tauri");
          });
        }
      } catch {
        // Not in Tauri
      }

      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<string>("sidecar-log", (event) => {
          if (cancelled) return;
          const text = typeof event.payload === "string" ? event.payload : String(event.payload);
          emitClientLog(inferServerLevel(text), text, "tauri");
        });
        unlistenRef.current = unlisten;
      } catch {
        // Not in Tauri
      }
    })();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  // Drag-to-resize
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartH.current = height;

      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const next = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, dragStartH.current + (dragStartY.current - ev.clientY)),
        );
        setHeight(next);
        broadcastHeight(true, next);
      };
      const onUp = () => {
        isDragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height, broadcastHeight],
  );

  const activeTabDef = TABS.find((t) => t.id === activeTab)!;
  const tabLogs = useMemo(
    () => allLogs.filter(activeTabDef.filter),
    [allLogs, activeTabDef],
  );

  const handleCopy = useCallback(async () => {
    if (tabLogs.length === 0) return;
    const now = new Date().toLocaleString("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const header = `=== Matrx Log [${activeTabDef.label}] — ${now} ===`;
    const body = tabLogs
      .map((l) => `${l.time} ${LEVEL_LABEL[l.level]} [${l.source ?? "app"}] ${l.message}`)
      .join("\n");
    await navigator.clipboard.writeText(`${header}\n${body}\n=== END ===`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [tabLogs, activeTabDef]);

  const handleClear = useCallback(() => {
    if (activeTabDef.clearSources === null) {
      clearClientLog();
    } else {
      activeTabDef.clearSources.forEach(clearClientLogBySource);
    }
  }, [activeTabDef]);

  // Tab badge counts
  const serverCount = allLogs.filter((l) => SERVER_SOURCES.has(l.source ?? "")).length;
  const clientCount = allLogs.filter((l) => {
    const s = l.source ?? "";
    return CLIENT_SOURCES.has(s) || (!SERVER_SOURCES.has(s) && !CLIENT_SOURCES.has(s));
  }).length;
  const totalErrors = allLogs.filter((l) => l.level === "error").length;
  const totalWarns = allLogs.filter((l) => l.level === "warn").length;

  if (!open) return null;

  const HEADER_H = 36;
  const FILTER_H = activeTab !== "overview" ? 30 : 0;
  const contentH = height - HEADER_H - FILTER_H;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t border-zinc-700/60 bg-zinc-950/97 backdrop-blur-sm shadow-2xl"
      style={{ height }}
    >
      {/* Drag handle */}
      <div
        className="absolute -top-1.5 left-0 right-0 flex cursor-row-resize justify-center py-1 group"
        onMouseDown={onDragStart}
      >
        <div className="h-1 w-16 rounded-full bg-zinc-800 group-hover:bg-zinc-600 transition-colors" />
      </div>

      {/* Header */}
      <div className="flex items-center gap-0 border-b border-zinc-800/60 px-2 flex-shrink-0" style={{ height: HEADER_H }}>
        {/* Terminal icon */}
        <span className="flex items-center gap-1.5 pr-3 text-zinc-600 select-none">
          <Terminal className="h-3.5 w-3.5" />
        </span>

        {/* Tabs */}
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          let badge: number | null = null;
          if (tab.id === "server") badge = serverCount;
          if (tab.id === "client") badge = clientCount;
          if (tab.id === "all") badge = allLogs.length;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-full text-[11px] font-mono border-b-2 transition-colors",
                isActive
                  ? "text-zinc-200 border-primary"
                  : "text-zinc-500 border-transparent hover:text-zinc-300",
              )}
            >
              {tab.icon}
              {tab.label}
              {badge !== null && badge > 0 && (
                <span className={cn(
                  "text-[9px] font-mono rounded px-1 py-px",
                  tab.id === "server" && totalErrors > 0 ? "bg-red-900/50 text-red-400" :
                  tab.id === "client" && totalWarns > 0 ? "bg-amber-900/50 text-amber-400" :
                  "bg-zinc-800 text-zinc-500"
                )}>
                  {badge}
                </span>
              )}
              {tab.id === "overview" && totalErrors > 0 && (
                <span className="text-[9px] bg-red-900/50 text-red-400 rounded px-1 py-px font-mono">
                  {totalErrors}e
                </span>
              )}
              {tab.id === "overview" && totalErrors === 0 && totalWarns > 0 && (
                <span className="text-[9px] bg-amber-900/50 text-amber-400 rounded px-1 py-px font-mono">
                  {totalWarns}w
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Actions — only shown for non-overview tabs */}
        {activeTab !== "overview" && (
          <>
            <button
              onClick={handleCopy}
              disabled={tabLogs.length === 0}
              title="Copy visible logs to clipboard"
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={handleClear}
              disabled={tabLogs.length === 0}
              title="Clear these logs"
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {/* Activity pulse */}
        <span className="flex items-center gap-1 px-2 text-[10px] text-zinc-600 font-mono">
          <Activity className="h-3 w-3" />
          {allLogs.length.toLocaleString()}
        </span>

        {/* Close */}
        <button
          onClick={() => { setOpen(false); broadcastHeight(false, height); }}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors ml-1"
          title="Close terminal"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-col overflow-hidden" style={{ height: contentH + FILTER_H }}>
        {activeTab === "overview" ? (
          <OverviewTab logs={allLogs} />
        ) : (
          <LogPane
            logs={tabLogs}
            emptyMessage={activeTabDef.emptyMessage}
            filterKey={activeTab}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TerminalToggleButton — placed in the status bar
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
        className,
      )}
    >
      <Terminal className="h-3.5 w-3.5" />
      <span>Terminal</span>
    </button>
  );
}
