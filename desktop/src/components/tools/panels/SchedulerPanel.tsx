import { useState, useCallback, useEffect } from "react";
import { Clock, Plus, Trash2, Zap, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AiBadge } from "@/components/tools/panels/AiBadge";

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

export function SchedulerPanel({ onInvoke, loading, result }: SchedulerPanelProps) {
  const [tasks, setTasks]       = useState<ScheduledTask[]>([]);
  const [toolName, setToolName]   = useState("");
  const [delay, setDelay]         = useState("60");
  const [intervalSec, setIntervalSec] = useState("300");
  const [heartbeat, setHeartbeat] = useState<string | null>(null);

  useEffect(() => {
    const parsed = tryParse(result);
    if (parsed) setTasks(parsed);
    // Check if result is heartbeat
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
    // Refresh list
    await onInvoke("ListScheduled", {});
  }, [onInvoke, toolName, delay, intervalSec]);

  const cancel = useCallback((taskId: string) => {
    onInvoke("CancelScheduled", { task_id: taskId }).then(() => {
      onInvoke("ListScheduled", {});
    });
  }, [onInvoke]);

  const listTasks    = useCallback(() => onInvoke("ListScheduled",    {}), [onInvoke]);
  const heartbeatStatus = useCallback(() => onInvoke("HeartbeatStatus", {}), [onInvoke]);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      <AiBadge text="Your AI can schedule and manage recurring tasks on your machine" />

      {/* New task form */}
      <div className="rounded-2xl border bg-card/50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-orange-400" />
          <h3 className="text-sm font-semibold">Schedule a Task</h3>
        </div>
        <div className="space-y-2">
          <Input value={toolName} onChange={(e) => setToolName(e.target.value)}
            placeholder="Tool name (e.g., SystemResources)" className="text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Delay (sec)</label>
              <Input type="number" value={delay} onChange={(e) => setDelay(e.target.value)}
                className="text-sm mt-0.5" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Interval (sec)</label>
              <Input type="number" value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)}
                className="text-sm mt-0.5" />
            </div>
          </div>
        </div>
        <Button onClick={schedule} disabled={loading || !toolName.trim()} className="w-full gap-2">
          <Clock className="h-4 w-4" /> Schedule
        </Button>
      </div>

      {/* Scheduled list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Scheduled Tasks</h4>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={listTasks} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {tasks.length > 0 ? (
          <div className="space-y-1.5">
            {tasks.map((t, i) => (
              <div key={t.id ?? t.task_id ?? i}
                className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
                <Clock className="h-4 w-4 text-orange-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.tool ?? t.tool_name ?? "Unknown"}</p>
                  {t.interval && (
                    <p className="text-[11px] text-muted-foreground">Every {t.interval}s</p>
                  )}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  t.status === "running"
                    ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                    : "border-border text-muted-foreground"
                }`}>
                  {t.status ?? "scheduled"}
                </span>
                <button onClick={() => cancel(t.id ?? t.task_id ?? "")}
                  className="text-muted-foreground hover:text-destructive transition-colors ml-1">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground px-1">No tasks scheduled. Click refresh or create one above.</p>
        )}
      </div>

      {/* Heartbeat */}
      <div className="rounded-2xl border bg-card/50 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            <h4 className="text-sm font-semibold">Heartbeat</h4>
          </div>
          <Button variant="ghost" size="sm" onClick={heartbeatStatus} disabled={loading} className="h-7 text-xs">
            Check
          </Button>
        </div>
        {heartbeat && (
          <pre className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-lg p-2 overflow-auto max-h-20">
            {heartbeat}
          </pre>
        )}
      </div>
    </div>
  );
}
