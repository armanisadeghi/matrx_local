import { useState, useEffect, useRef } from "react";
import {
  Activity as ActivityIcon,
  Trash2,
  Pause,
  Play,
  ArrowDown,
  Filter,
  CheckCircle,
  AlertCircle,
  Clock,
  Globe,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import type { EngineStatus } from "@/hooks/use-engine";
import supabase from "@/lib/supabase";

/** Get the current Supabase access token, or null if not signed in. */
async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

interface ActivityProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
}

// ── Structured Access Entry (from GET /logs/access/stream) ──────────────────
interface AccessEntry {
  timestamp: string;
  method: string;
  path: string;
  query: string;
  origin: string;
  user_agent: string;
  status: number;
  duration_ms: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
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
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

// ── AccessLog Tab ────────────────────────────────────────────────────────────
function AccessLogTab({
  engineUrl,
  paused,
}: {
  engineUrl: string | null;
  paused: boolean;
}) {
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // Load recent entries on mount
  useEffect(() => {
    if (!engineUrl) return;
    getToken().then((token) => {
      if (!token) return;
      fetch(`${engineUrl}/logs/access?n=200`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.entries)) {
            setEntries(data.entries.slice(-200));
          }
        })
        .catch(() => {/* silent */});
    });
  }, [engineUrl]);

  // SSE live-push stream
  useEffect(() => {
    if (!engineUrl) return;
    // EventSource doesn't support custom headers; pass token as query param.
    // The backend reads it from `?token=` if present.
    getToken().then((token) => {
      if (!token) return;
      const url = `${engineUrl}/logs/access/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;
      es.onmessage = (evt: MessageEvent<string>) => {
        if (pausedRef.current) return;
        try {
          const entry: AccessEntry = JSON.parse(evt.data);
          setEntries((prev) => [...prev.slice(-999), entry]);
        } catch {/* ignore parse errors */}
      };
    });

    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [engineUrl]);

  // Keep pausedRef in sync so the message handler sees the latest value
  // without needing to reconnect the EventSource.
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Auto-scroll — scroll only within the container, never the page
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const filtered = filter
    ? entries.filter(
        (e) =>
          e.path.toLowerCase().includes(filter.toLowerCase()) ||
          e.method.toLowerCase().includes(filter.toLowerCase()) ||
          e.origin.toLowerCase().includes(filter.toLowerCase()),
      )
    : entries;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          placeholder="Filter by path, method, origin…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 text-xs bg-background/50 border-muted"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setAutoScroll((v) => !v)}
          title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
        >
          <ArrowDown
            className={`h-3.5 w-3.5 ${autoScroll ? "text-primary" : "text-muted-foreground"}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setEntries([])}
          title="Clear"
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
          {filtered.filter((e) => e.status < 400).length} success
        </span>
        <span className="flex items-center gap-1">
          <AlertCircle className="h-3 w-3 text-red-400" />
          {filtered.filter((e) => e.status >= 400).length} errors
        </span>
        {filtered.length > 0 && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            avg{" "}
            {Math.round(
              filtered.reduce((s, e) => s + e.duration_ms, 0) / filtered.length,
            )}
            ms
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
              <p className="text-xs mt-1">
                HTTP calls from aimatrx.com will appear here in real time
              </p>
            </div>
          ) : (
            filtered.map((e, i) => (
              <div
                key={i}
                className="grid gap-2 rounded px-3 py-1 text-[11px] hover:bg-accent/40 transition-colors"
                style={{ gridTemplateColumns: "5rem 3.5rem 1fr auto auto" }}
              >
                {/* Time */}
                <span className="text-muted-foreground tabular-nums">
                  {formatTime(e.timestamp)}
                </span>
                {/* Method */}
                <span className={`font-bold ${methodColor(e.method)}`}>
                  {e.method}
                </span>
                {/* Path + query */}
                <span className="text-foreground truncate">
                  {e.path}
                  {e.query ? (
                    <span className="text-muted-foreground">?{e.query}</span>
                  ) : null}
                </span>
                {/* Duration */}
                <span className="text-muted-foreground tabular-nums text-right">
                  {e.duration_ms.toFixed(0)}ms
                </span>
                {/* Status */}
                <span className={`font-bold tabular-nums ${statusColor(e.status)}`}>
                  {e.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── SystemLog Tab (raw tail) ─────────────────────────────────────────────────
function SystemLogTab({
  engineUrl,
  paused,
}: {
  engineUrl: string | null;
  paused: boolean;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (!engineUrl) return;
    let es: EventSource | null = null;
    getToken().then((token) => {
      if (!token) return;
      const url = `${engineUrl}/logs/stream?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      es.onmessage = (evt) => {
        if (pausedRef.current) return;
        setLines((prev) => [...prev.slice(-2000), evt.data]);
      };
    });
    return () => { es?.close(); };
  }, [engineUrl]);

  // Auto-scroll — scroll only within the container, never the page
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <span className="text-xs text-muted-foreground">
          {lines.length} line{lines.length !== 1 ? "s" : ""} (last 2 000)
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setAutoScroll((v) => !v)}
          >
            <ArrowDown
              className={`h-3.5 w-3.5 ${autoScroll ? "text-primary" : "text-muted-foreground"}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setLines([])}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-zinc-950/40">
        <div className="px-4 py-2 font-mono text-[11px] space-y-0.5">
          {lines.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              Waiting for log output…
            </p>
          ) : (
            lines.map((line, i) => {
              const level = line.includes(" ERROR ")
                ? "text-red-400"
                : line.includes(" WARNING ")
                ? "text-amber-400"
                : line.includes(" INFO ")
                ? "text-sky-300"
                : "text-muted-foreground";
              return (
                <div key={i} className={level}>
                  {line}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function Activity({ engineStatus, engineUrl }: ActivityProps) {
  const [paused, setPaused] = useState(false);
  const [tab, setTab] = useState<"access" | "system">("access");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Activity" description="Real-time request & log monitor">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPaused((v) => !v)}
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
          </Button>
          {paused && (
            <Badge variant="warning" className="text-[10px]">
              PAUSED
            </Badge>
          )}
          {engineStatus !== "connected" && (
            <Badge variant="destructive" className="text-[10px]">
              ENGINE OFFLINE
            </Badge>
          )}
        </div>
      </PageHeader>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "access" | "system")}
        className="flex flex-col flex-1 overflow-hidden"
      >
        <TabsList className="mx-4 mt-2 self-start">
          <TabsTrigger value="access">HTTP Requests</TabsTrigger>
          <TabsTrigger value="system">System Log</TabsTrigger>
        </TabsList>

        <TabsContent value="access" className="flex-1 overflow-hidden mt-2">
          <AccessLogTab engineUrl={engineUrl} paused={paused} />
        </TabsContent>

        <TabsContent value="system" className="flex-1 overflow-hidden mt-2">
          <SystemLogTab engineUrl={engineUrl} paused={paused} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
