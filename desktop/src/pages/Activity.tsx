/**
 * Activity page — Real-time request & log monitor.
 *
 * Consumes the unified log bus (use-unified-log). No owned SSE connections —
 * all streams are managed by App.tsx via initUnifiedLog. Data persists across
 * tab switches since it lives in the module-level ring buffer.
 *
 * Tabs:
 *   HTTP Requests  — structured access log (source="access")
 *   System Log     — raw syslog lines + server SSE (source="syslog" | "server" | "tauri")
 *
 * Features per tab:
 *   - Level filter pills (same as DevTerminalPanel)
 *   - Text filter (HTTP: path/method/origin; System: keyword search)
 *   - Group similar toggle (INFO/OK/DATA/CMD only; WARN/ERR always individual)
 *   - Auto-scroll toggle
 *   - Pause/Resume (global, shared with DevTerminalPanel)
 *   - Copy filtered
 *   - Copy Issue Report (system log)
 *   - Error/warn badges on tab triggers
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Activity as ActivityIcon,
  Trash2,
  Pause,
  Play,
  ArrowDown,
  Filter,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Clock,
  Globe,
  Copy,
  Check,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { EngineStatus } from "@/hooks/use-engine";
import {
  useClientLogSubscriber,
  clearClientLogBySource,
  setLogsPaused,
  useLogsPaused,
} from "@/hooks/use-unified-log";
import type { LogLevel, ClientLogLine, AccessEntry } from "@/hooks/use-unified-log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_LEVELS: LogLevel[] = ["info", "success", "warn", "error", "data", "cmd"];
const GROUPABLE_LEVELS = new Set<LogLevel>(["info", "success", "data", "cmd"]);

// Sources shown in the System Log tab
const SYSTEM_SOURCES = new Set(["server", "tauri", "syslog"]);

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

const LEVEL_PILL_INACTIVE = "text-muted-foreground/40 border-border/30 hover:text-muted-foreground hover:border-border/60";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(code: number): string {
  if (code < 300) return "text-emerald-400";
  if (code < 400) return "text-amber-400";
  if (code < 500) return "text-orange-400";
  return "text-red-400";
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":    return "text-sky-400";
    case "POST":   return "text-violet-400";
    case "PUT":    return "text-amber-400";
    case "DELETE": return "text-red-400";
    case "PATCH":  return "text-orange-400";
    default:       return "text-muted-foreground";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return "—"; }
}

// ---------------------------------------------------------------------------
// Group similar
// ---------------------------------------------------------------------------

interface GroupedRow {
  representative: ClientLogLine;
  count: number;
  key: string;
}

function groupSimilarLogs(logs: ClientLogLine[]): GroupedRow[] {
  const rows: GroupedRow[] = [];
  const groupMap = new Map<string, GroupedRow>();

  for (const line of logs) {
    if (!GROUPABLE_LEVELS.has(line.level)) {
      rows.push({ representative: line, count: 1, key: String(line.id) });
    } else {
      const key = `${line.level}|${line.source ?? ""}|${line.message}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.count++;
        existing.representative = line;
      } else {
        const row: GroupedRow = { representative: line, count: 1, key };
        groupMap.set(key, row);
        rows.push(row);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Issue report builder (mirrors DevTerminalPanel)
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  server: "Engine (SSE)",
  tauri:  "Sidecar IPC",
  syslog: "System Log",
};

function buildIssueReport(logs: ClientLogLine[]): string {
  const bySource = new Map<string, { errors: string[]; warns: string[]; total: number }>();
  logs.forEach((l) => {
    const s = l.source ?? "unknown";
    if (!bySource.has(s)) bySource.set(s, { errors: [], warns: [], total: 0 });
    const entry = bySource.get(s)!;
    entry.total++;
    if (l.level === "error") entry.errors.push(`  ${l.time} ${l.message}`);
    if (l.level === "warn")  entry.warns.push(`  ${l.time} ${l.message}`);
  });

  const now = new Date().toLocaleString("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const totalErrors = logs.filter((l) => l.level === "error").length;
  const totalWarns  = logs.filter((l) => l.level === "warn").length;

  const lines: string[] = [
    `=== Matrx Issue Report — ${now} ===`,
    `Total: ${logs.length} log lines | ${totalErrors} errors | ${totalWarns} warnings`,
    "",
  ];

  for (const [source, stats] of bySource.entries()) {
    if (stats.errors.length === 0 && stats.warns.length === 0) continue;
    const label = SOURCE_LABELS[source] ?? source;
    lines.push(`── ${label} ──`);
    lines.push(`   errors: ${stats.errors.length}  warnings: ${stats.warns.length}`);
    if (stats.errors.length > 0) { lines.push("   ERRORS:"); stats.errors.forEach((m) => lines.push(m)); }
    if (stats.warns.length > 0)  { lines.push("   WARNINGS:"); stats.warns.forEach((m) => lines.push(m)); }
    lines.push("");
  }

  if (lines[lines.length - 1] === "") lines.pop();
  lines.push("=== END ===");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Level filter bar (shared between tabs)
// ---------------------------------------------------------------------------

function LevelFilterBar({
  logs,
  activeFilters,
  onToggle,
  grouped,
  onToggleGroup,
  autoScroll,
  onToggleAutoScroll,
}: {
  logs: ClientLogLine[];
  activeFilters: Set<LogLevel>;
  onToggle: (l: LogLevel) => void;
  grouped: boolean;
  onToggleGroup: () => void;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b flex-wrap bg-muted/10">
      <span className="text-[10px] text-muted-foreground/60 font-mono mr-1 select-none shrink-0">filter:</span>
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
      <div className="w-px h-3 bg-border/40 mx-0.5 shrink-0" />
      <button
        onClick={onToggleGroup}
        title="Group identical INFO/OK/DATA/CMD messages"
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-mono px-1.5 h-[18px] rounded border transition-colors select-none",
          grouped
            ? "bg-violet-900/50 text-violet-300 border-violet-700"
            : LEVEL_PILL_INACTIVE,
        )}
      >
        Group similar
      </button>
      <button
        onClick={onToggleAutoScroll}
        title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-mono px-1.5 h-[18px] rounded border transition-colors select-none",
          autoScroll
            ? "bg-zinc-700 text-zinc-200 border-zinc-500"
            : LEVEL_PILL_INACTIVE,
        )}
      >
        <ArrowDown className="h-2.5 w-2.5" />
        Scroll
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access Log Tab
// ---------------------------------------------------------------------------

function AccessLogTab({ logs }: { logs: ClientLogLine[] }) {
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(
    () => logs.map((l) => l.accessEntry).filter((e): e is AccessEntry => e != null),
    [logs],
  );

  const filtered = useMemo(() => {
    if (!filter) return entries;
    const q = filter.toLowerCase();
    return entries.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        e.origin.toLowerCase().includes(q),
    );
  }, [entries, filter]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const handleCopy = useCallback(async () => {
    const body = filtered
      .map((e) => `${formatTime(e.timestamp)} ${e.method.padEnd(7)} ${e.path}${e.query ? `?${e.query}` : ""} ${e.status} ${e.duration_ms.toFixed(0)}ms`)
      .join("\n");
    const now = new Date().toLocaleString("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    await navigator.clipboard.writeText(`=== HTTP Access Log — ${now} ===\n${body}\n=== END ===`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [filtered]);

  const successCount = filtered.filter((e) => e.status < 400).length;
  const errorCount   = filtered.filter((e) => e.status >= 400).length;
  const avgMs = filtered.length > 0
    ? Math.round(filtered.reduce((s, e) => s + e.duration_ms, 0) / filtered.length)
    : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder="Filter by path, method, origin…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 bg-transparent text-xs font-mono text-foreground placeholder-muted-foreground/50 outline-none"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleCopy}
          disabled={filtered.length === 0}
          title="Copy filtered log"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setAutoScroll((v) => !v)}
          title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
        >
          <ArrowDown className={cn("h-3.5 w-3.5", autoScroll ? "text-primary" : "text-muted-foreground")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => clearClientLogBySource("access")}
          title="Clear HTTP log"
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b text-xs text-muted-foreground bg-muted/10">
        <span className="flex items-center gap-1">
          <Globe className="h-3 w-3" />
          {filtered.length} request{filtered.length !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle className="h-3 w-3 text-emerald-400" />
          {successCount} success
        </span>
        <span className={cn("flex items-center gap-1", errorCount > 0 ? "text-red-400" : "")}>
          <AlertCircle className="h-3 w-3" />
          {errorCount} error{errorCount !== 1 ? "s" : ""}
        </span>
        {filtered.length > 0 && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            avg {avgMs}ms
          </span>
        )}
      </div>

      {/* Log rows */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="px-1 py-1 space-y-0.5 font-mono">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <ActivityIcon className="h-12 w-12 opacity-20 mb-4" />
              <p className="text-sm font-medium">No requests yet</p>
              <p className="text-xs mt-1">HTTP calls to the engine will appear here in real time</p>
            </div>
          ) : (
            filtered.map((e, i) => (
              <div
                key={i}
                className="grid gap-2 rounded px-3 py-1 text-[11px] hover:bg-accent/40 transition-colors"
                style={{ gridTemplateColumns: "5rem 3.5rem 1fr auto auto" }}
              >
                <span className="text-muted-foreground tabular-nums">{formatTime(e.timestamp)}</span>
                <span className={cn("font-bold", methodColor(e.method))}>{e.method}</span>
                <span className="text-foreground truncate">
                  {e.path}
                  {e.query ? <span className="text-muted-foreground">?{e.query}</span> : null}
                </span>
                <span className="text-muted-foreground tabular-nums text-right">{e.duration_ms.toFixed(0)}ms</span>
                <span className={cn("font-bold tabular-nums", statusColor(e.status))}>{e.status}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Log Tab
// ---------------------------------------------------------------------------

function SystemLogTab({ logs }: { logs: ClientLogLine[] }) {
  const [activeFilters, setActiveFilters] = useState<Set<LogLevel>>(() => new Set(ALL_LEVELS));
  const [grouped, setGrouped] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const [textFilter, setTextFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleFilter = useCallback((level: LogLevel) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size === 1) return prev;
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const levelFiltered = useMemo(
    () =>
      activeFilters.size === ALL_LEVELS.length
        ? logs
        : logs.filter((l) => activeFilters.has(l.level)),
    [logs, activeFilters],
  );

  const filtered = useMemo(() => {
    if (!textFilter) return levelFiltered;
    const q = textFilter.toLowerCase();
    return levelFiltered.filter((l) => l.message.toLowerCase().includes(q));
  }, [levelFiltered, textFilter]);

  const groupedRows = useMemo(
    () => (grouped ? groupSimilarLogs(filtered) : null),
    [filtered, grouped],
  );

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, groupedRows, autoScroll]);

  const hasIssues = logs.some((l) => l.level === "error" || l.level === "warn");

  const handleCopy = useCallback(async () => {
    const rows = groupedRows ?? filtered.map((l) => ({ representative: l, count: 1 }));
    const body = rows
      .map(({ representative: l, count }) => {
        const suffix = count > 1 ? ` ×${count}` : "";
        return `${l.time} ${LEVEL_LABEL[l.level]} [${l.source ?? ""}] ${l.message}${suffix}`;
      })
      .join("\n");
    const now = new Date().toLocaleString("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    await navigator.clipboard.writeText(`=== System Log — ${now} ===\n${body}\n=== END ===`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [filtered, groupedRows]);

  const handleCopyIssueReport = useCallback(async () => {
    await navigator.clipboard.writeText(buildIssueReport(logs));
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  }, [logs]);

  const displayRows = groupedRows ?? null;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder="Search messages…"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          className="flex-1 bg-transparent text-xs font-mono text-foreground placeholder-muted-foreground/50 outline-none"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleCopy}
          disabled={filtered.length === 0}
          title="Copy filtered log"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleCopyIssueReport}
          disabled={!hasIssues}
          title="Copy error/warning issue report (paste to AI)"
        >
          {copiedReport ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setAutoScroll((v) => !v)}
          title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
        >
          <ArrowDown className={cn("h-3.5 w-3.5", autoScroll ? "text-primary" : "text-muted-foreground")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => { clearClientLogBySource("server"); clearClientLogBySource("tauri"); clearClientLogBySource("syslog"); }}
          title="Clear system log"
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {/* Level + group filters */}
      <LevelFilterBar
        logs={logs}
        activeFilters={activeFilters}
        onToggle={toggleFilter}
        grouped={grouped}
        onToggleGroup={() => setGrouped((v) => !v)}
        autoScroll={autoScroll}
        onToggleAutoScroll={() => setAutoScroll((v) => !v)}
      />

      {/* Stats */}
      <div className="flex items-center gap-4 px-4 py-1 border-b text-xs text-muted-foreground bg-muted/10">
        <span>{filtered.length} line{filtered.length !== 1 ? "s" : ""}</span>
        {logs.filter((l) => l.level === "error").length > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <AlertCircle className="h-3 w-3" />
            {logs.filter((l) => l.level === "error").length} errors
          </span>
        )}
        {logs.filter((l) => l.level === "warn").length > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            {logs.filter((l) => l.level === "warn").length} warnings
          </span>
        )}
      </div>

      {/* Log rows */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-zinc-950/40">
        <div className="px-4 py-2 font-mono text-[11px] space-y-0.5">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              {logs.length === 0 ? "Waiting for log output…" : "No logs match the current filters"}
            </p>
          ) : displayRows ? (
            displayRows.map(({ representative: l, count, key }) => (
              <div key={key} className={cn("flex gap-2 items-start hover:bg-zinc-900/60 px-1 rounded", LEVEL_COLOR[l.level])}>
                <span className="text-zinc-600 shrink-0 tabular-nums select-none">{l.time}</span>
                <span className="font-semibold shrink-0 w-8 select-none">{LEVEL_LABEL[l.level]}</span>
                {l.source && <span className="text-zinc-600 shrink-0 select-none">[{l.source}]</span>}
                <span className="break-all whitespace-pre-wrap flex-1">{l.message}</span>
                {count > 1 && (
                  <span className="shrink-0 self-center text-[9px] font-bold bg-zinc-700 text-zinc-300 rounded-full px-1.5 py-px tabular-nums select-none">
                    {count}
                  </span>
                )}
              </div>
            ))
          ) : (
            filtered.map((l) => (
              <div key={l.id} className={cn("flex gap-2 items-start hover:bg-zinc-900/60 px-1 rounded", LEVEL_COLOR[l.level])}>
                <span className="text-zinc-600 shrink-0 tabular-nums select-none">{l.time}</span>
                <span className="font-semibold shrink-0 w-8 select-none">{LEVEL_LABEL[l.level]}</span>
                {l.source && <span className="text-zinc-600 shrink-0 select-none">[{l.source}]</span>}
                <span className="break-all whitespace-pre-wrap flex-1">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function Activity({ engineStatus }: ActivityProps) {
  const paused = useLogsPaused();
  const [tab, setTab] = useState<"access" | "system">("access");

  const allLogs = useClientLogSubscriber();

  const accessLogs = useMemo(
    () => allLogs.filter((l) => l.source === "access"),
    [allLogs],
  );

  const systemLogs = useMemo(
    () => allLogs.filter((l) => SYSTEM_SOURCES.has(l.source ?? "")),
    [allLogs],
  );

  // Badge counts
  const accessErrors = accessLogs.filter((l) => l.level === "error").length;
  const accessWarns  = accessLogs.filter((l) => l.level === "warn").length;
  const systemErrors = systemLogs.filter((l) => l.level === "error").length;
  const systemWarns  = systemLogs.filter((l) => l.level === "warn").length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Activity" description="Real-time request & log monitor">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLogsPaused(!paused)}
            title={paused ? "Resume" : "Pause live streams"}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          {paused && <Badge variant="warning" className="text-[10px]">PAUSED</Badge>}
          {engineStatus !== "connected" && (
            <Badge variant="destructive" className="text-[10px]">ENGINE OFFLINE</Badge>
          )}
        </div>
      </PageHeader>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "access" | "system")}
        className="flex flex-col flex-1 overflow-hidden"
      >
        <TabsList className="mx-4 mt-2 self-start">
          <TabsTrigger value="access" className="flex items-center gap-1.5">
            HTTP Requests
            {accessErrors > 0 && (
              <span className="text-[9px] bg-red-900/50 text-red-400 rounded px-1 py-px font-mono">{accessErrors}e</span>
            )}
            {accessErrors === 0 && accessWarns > 0 && (
              <span className="text-[9px] bg-amber-900/50 text-amber-400 rounded px-1 py-px font-mono">{accessWarns}w</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="system" className="flex items-center gap-1.5">
            System Log
            {systemErrors > 0 && (
              <span className="text-[9px] bg-red-900/50 text-red-400 rounded px-1 py-px font-mono">{systemErrors}e</span>
            )}
            {systemErrors === 0 && systemWarns > 0 && (
              <span className="text-[9px] bg-amber-900/50 text-amber-400 rounded px-1 py-px font-mono">{systemWarns}w</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="access" className="flex-1 overflow-hidden mt-2">
          <AccessLogTab logs={accessLogs} />
        </TabsContent>

        <TabsContent value="system" className="flex-1 overflow-hidden mt-2">
          <SystemLogTab logs={systemLogs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
