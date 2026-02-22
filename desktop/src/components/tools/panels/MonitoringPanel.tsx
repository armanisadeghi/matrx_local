import { useState, useEffect, useRef, useCallback } from "react";
import { Activity, Cpu, HardDrive, Zap, RefreshCw, Battery, BatteryCharging } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiBadge } from "@/components/tools/panels/AiBadge";

interface MonitoringPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

interface ResourceData {
  cpu_percent?: number;
  memory_percent?: number;
  memory_used_gb?: number;
  memory_total_gb?: number;
  disk_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  battery_percent?: number;
  battery_plugged?: boolean;
  uptime_seconds?: number;
}

interface ProcessRow {
  name?: string;
  pid?: number;
  cpu_percent?: number;
  memory_percent?: number;
}

function GaugeRing({ value, label, color, icon: Icon }: {
  value: number;
  label: string;
  color: string;
  icon: React.ElementType;
}) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const progress = Math.min(Math.max(value, 0), 100);
  const offset = circ - (progress / 100) * circ;

  const ringColor =
    progress >= 90 ? "stroke-red-500" :
    progress >= 75 ? "stroke-amber-500" :
    `stroke-${color}-500`;

  const textColor =
    progress >= 90 ? "text-red-400" :
    progress >= 75 ? "text-amber-400" :
    `text-${color}-400`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width="96" height="96" className="-rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="currentColor"
            strokeWidth="8" className="text-muted/30" />
          <circle cx="48" cy="48" r={r} fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            className={`${ringColor} transition-all duration-700`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
          <Icon className={`h-4 w-4 mb-0.5 ${textColor}`} />
          <span className={`text-lg font-bold tabular-nums leading-none ${textColor}`}>
            {Math.round(progress)}
          </span>
          <span className="text-[10px] text-muted-foreground">%</span>
        </div>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function MonitoringPanel({ onInvoke, loading, result }: MonitoringPanelProps) {
  const [resources, setResources] = useState<ResourceData | null>(null);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const parseResources = useCallback((r: unknown): ResourceData | null => {
    if (!r) return null;
    try {
      const d = r as { output?: string; type?: string };
      if (d.output) { return JSON.parse(d.output) as ResourceData; }
    } catch { /* ignore */ }
    return null;
  }, []);

  const refresh = useCallback(async () => {
    await onInvoke("SystemResources", {});
  }, [onInvoke]);

  const refreshProcesses = useCallback(async () => {
    await onInvoke("TopProcesses", { limit: 8, sort_by: "cpu" });
  }, [onInvoke]);

  // Parse result into whichever data type it is
  useEffect(() => {
    const parsed = parseResources(result);
    if (parsed) {
      if (parsed.name !== undefined || Array.isArray(result)) {
        // Assume it's a process list
      } else {
        setResources(parsed);
      }
    }
    // Check if result looks like a process array
    try {
      const d = result as { output?: string };
      if (d?.output) {
        const arr = JSON.parse(d.output);
        if (Array.isArray(arr)) setProcesses(arr);
        else setResources(arr);
      }
    } catch { /* ignore */ }
  }, [result, parseResources]);

  useEffect(() => {
    refresh();
    refreshProcesses();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => { refresh(); }, 5000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, refresh]);

  const cpu    = resources?.cpu_percent ?? 0;
  const mem    = resources?.memory_percent ?? 0;
  const disk   = resources?.disk_percent ?? 0;
  const bat    = resources?.battery_percent;
  const plugged = resources?.battery_plugged;

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      <AiBadge text="Your AI can monitor your system resources in real time" />

      {/* Header controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">System Resources</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`text-xs px-2 py-1 rounded-full border transition-colors ${
              autoRefresh ? "border-violet-500/50 text-violet-400 bg-violet-500/10" : "border-border text-muted-foreground"
            }`}
          >
            {autoRefresh ? "Auto ●" : "Auto ○"}
          </button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Gauge rings */}
      <div className="flex items-center justify-around py-2 px-4 rounded-2xl border bg-card/50">
        <GaugeRing value={cpu}  label="CPU"    color="violet" icon={Cpu}      />
        <GaugeRing value={mem}  label="Memory" color="blue"   icon={Activity} />
        <GaugeRing value={disk} label="Disk"   color="teal"   icon={HardDrive} />
        {bat != null && (
          <GaugeRing value={bat} label="Battery" color="amber"
            icon={plugged ? BatteryCharging : Battery} />
        )}
      </div>

      {/* Detail row */}
      {resources && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border bg-card/40 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">Memory</p>
            <p className="text-sm font-semibold">
              {resources.memory_used_gb?.toFixed(1) ?? "—"} <span className="text-xs text-muted-foreground">/ {resources.memory_total_gb?.toFixed(0) ?? "—"} GB</span>
            </p>
          </div>
          <div className="rounded-xl border bg-card/40 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">Disk Used</p>
            <p className="text-sm font-semibold">
              {resources.disk_used_gb?.toFixed(1) ?? "—"} <span className="text-xs text-muted-foreground">/ {resources.disk_total_gb?.toFixed(0) ?? "—"} GB</span>
            </p>
          </div>
          <div className="rounded-xl border bg-card/40 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">Uptime</p>
            <p className="text-sm font-semibold">
              {resources.uptime_seconds ? formatUptime(resources.uptime_seconds) : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Top Processes */}
      {processes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Processes</h4>
            <button onClick={refreshProcesses} className="text-[10px] text-muted-foreground hover:text-foreground">
              <Zap className="h-3 w-3 inline mr-0.5" /> Refresh
            </button>
          </div>
          <div className="space-y-1">
            {processes.slice(0, 8).map((p, i) => (
              <div key={p.pid ?? i} className="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors">
                <span className="text-[10px] w-5 text-center text-muted-foreground">{i + 1}</span>
                <span className="flex-1 text-xs font-medium truncate">{p.name ?? "unknown"}</span>
                <span className="text-[11px] tabular-nums text-violet-400 w-12 text-right">{(p.cpu_percent ?? 0).toFixed(1)}%</span>
                <span className="text-[11px] tabular-nums text-blue-400 w-12 text-right">{(p.memory_percent ?? 0).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-4 mt-1.5 px-3">
            <span className="text-[10px] text-violet-400">CPU</span>
            <span className="text-[10px] text-blue-400">MEM</span>
          </div>
        </div>
      )}

      {!resources && !loading && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
          Click refresh to load system data
        </div>
      )}
    </div>
  );
}
