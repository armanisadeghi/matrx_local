import { useState, useCallback, useEffect } from "react";
import { Clock, Plus, Trash2, Zap, RefreshCw, Moon, Timer, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToolSection } from "@/components/tools/shared/ToolSection";
import { StatusBadge } from "@/components/tools/shared/StatusBadge";
import { OutputCard } from "@/components/tools/shared/OutputCard";
import { cn } from "@/lib/utils";

interface SchedulerPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

interface ScheduledTask {
  id?: string;
  task_id?: string;
  tool?: string;
  tool_name?: string;
  delay?: number;
  interval?: number;
  next_run?: string;
  status?: string;
}

function tryParse(result: unknown): ScheduledTask[] | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error") return null;
    if (d.output) {
      const arr = JSON.parse(d.output);
      if (Array.isArray(arr)) return arr;
    }
    return null;
  } catch { return null; }
}

function parseText(result: unknown): string | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error") return d?.output ?? null;
    return d.output ?? null;
  } catch { return null; }
}

function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function SchedulerPanel({ onInvoke, loading, result }: SchedulerPanelProps) {
  const [view, setView] = useState<"tasks" | "system">("tasks");
  const [tasks, setTasks]       = useState<ScheduledTask[]>([]);
  const [toolName, setToolName]   = useState("");
  const [delay, setDelay]         = useState("60");
  const [intervalSec, setIntervalSec] = useState("300");
  const [heartbeat, setHeartbeat] = useState<string | null>(null);

  const textOutput = parseText(result);

  useEffect(() => {
    const parsed = tryParse(result);
    if (parsed) setTasks(parsed);
    try {
      const d = result as { output?: string; type?: string };
      if (d?.output && !parsed) {
        setHeartbeat(d.output);
      }
    } catch { /* ignore */ }
  }, [result]);

  const schedule = useCallback(async () => {
    if (!toolName.trim()) return;
    await onInvoke("ScheduleTask", {
      tool_name: toolName,
      delay:     parseInt(delay, 10) || 60,
      interval:  parseInt(intervalSec, 10) || 300,
    });
    setToolName("");
    await onInvoke("ListScheduled", {});
  }, [onInvoke, toolName, delay, intervalSec]);

  const cancel = useCallback((taskId: string) => {
    onInvoke("CancelScheduled", { task_id: taskId }).then(() => {
      onInvoke("ListScheduled", {});
    });
  }, [onInvoke]);

  const listTasks       = useCallback(() => onInvoke("ListScheduled", {}), [onInvoke]);
  const heartbeatStatus = useCallback(() => onInvoke("HeartbeatStatus", {}), [onInvoke]);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      {/* View switcher */}
      <div className="flex gap-1 rounded-xl border bg-muted/20 p-1">
        {([
          { key: "tasks", label: "Tasks", icon: Calendar },
          { key: "system", label: "System", icon: Zap },
        ] as const).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all",
              view === v.key ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            <v.icon className="h-3.5 w-3.5" />
            {v.label}
          </button>
        ))}
      </div>

      {/* ── TASKS ── */}
      {view === "tasks" && (
        <>
          <ToolSection title="Schedule a Task" icon={Plus} iconColor="text-orange-400">
            <div className="space-y-3">
              <Input value={toolName} onChange={(e) => setToolName(e.target.value)}
                placeholder="Tool name (e.g., SystemResources)" className="text-xs" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Delay (sec)</label>
                  <Input type="number" value={delay} onChange={(e) => setDelay(e.target.value)}
                    className="text-xs mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Interval (sec)</label>
                  <Input type="number" value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)}
                    className="text-xs mt-0.5" />
                </div>
              </div>
              <Button onClick={schedule} disabled={loading || !toolName.trim()} className="w-full gap-2">
                <Clock className="h-4 w-4" /> Schedule
              </Button>
            </div>
          </ToolSection>

          <ToolSection title="Scheduled Tasks" icon={Calendar} iconColor="text-orange-400"
            actions={
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={listTasks} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            }>
            {tasks.length > 0 ? (
              <div className="space-y-1.5">
                {tasks.map((t, i) => (
                  <div key={t.id ?? t.task_id ?? i}
                    className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
                    <Timer className="h-4 w-4 text-orange-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{t.tool ?? t.tool_name ?? "Unknown"}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {t.interval != null && (
                          <span className="text-[10px] text-muted-foreground">
                            Every {formatSeconds(t.interval)}
                          </span>
                        )}
                        {t.next_run && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            Next: {t.next_run}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge
                      status={t.status === "running" ? "running" : t.status === "paused" ? "warning" : "info"}
                      label={t.status ?? "scheduled"}
                    />
                    <button onClick={() => cancel(t.id ?? t.task_id ?? "")}
                      className="text-muted-foreground hover:text-destructive transition-colors ml-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <button onClick={listTasks} disabled={loading}
                className="w-full rounded-xl border border-dashed bg-muted/20 p-6 flex flex-col items-center gap-2 text-muted-foreground hover:bg-muted/30 transition-colors">
                <Calendar className="h-8 w-8 opacity-30" />
                <p className="text-xs">Click to load scheduled tasks</p>
              </button>
            )}
          </ToolSection>
        </>
      )}

      {/* ── SYSTEM ── */}
      {view === "system" && (
        <>
          <ToolSection title="Heartbeat Status" icon={Zap} iconColor="text-yellow-400"
            actions={
              <Button variant="ghost" size="sm" onClick={heartbeatStatus} disabled={loading} className="h-7 text-xs gap-1.5">
                <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Check
              </Button>
            }>
            {heartbeat ? (
              <pre className="text-xs font-mono text-foreground bg-muted/30 rounded-lg p-3 overflow-auto max-h-32 whitespace-pre-wrap">
                {heartbeat}
              </pre>
            ) : (
              <button onClick={heartbeatStatus} disabled={loading}
                className="w-full rounded-xl border border-dashed bg-muted/20 p-6 flex flex-col items-center gap-2 text-muted-foreground hover:bg-muted/30 transition-colors">
                <Zap className="h-8 w-8 opacity-30" />
                <p className="text-xs">Click to check heartbeat status</p>
              </button>
            )}
          </ToolSection>

          <ToolSection title="Sleep Prevention" icon={Moon} iconColor="text-yellow-400">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Prevent the system from sleeping while tasks are running.
              </p>
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("PreventSleep", {})} disabled={loading}>
                <Moon className="h-3.5 w-3.5" /> Toggle Sleep Prevention
              </Button>
            </div>
          </ToolSection>

          {textOutput && !heartbeat && <OutputCard title="Result" content={textOutput} />}
        </>
      )}
    </div>
  );
}
