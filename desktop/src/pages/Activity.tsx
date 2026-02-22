import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity as ActivityIcon,
  Trash2,
  Pause,
  Play,
  ArrowDown,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { engine } from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";

interface ActivityProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
}

interface LogEntry {
  id: number;
  timestamp: Date;
  type: "request" | "response" | "event" | "error";
  tool?: string;
  message: string;
  data?: unknown;
}

let logIdCounter = 0;

export function Activity({ engineStatus, engineUrl: _engineUrl }: ActivityProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback(
    (entry: Omit<LogEntry, "id" | "timestamp">) => {
      if (paused) return;
      setLogs((prev) => [
        ...prev.slice(-500), // Keep last 500 entries
        { ...entry, id: ++logIdCounter, timestamp: new Date() },
      ]);
    },
    [paused]
  );

  useEffect(() => {
    const offMessage = engine.on("message", (data) => {
      const msg = data as Record<string, unknown>;
      if (msg.id && msg.tool) {
        addLog({
          type: "response",
          tool: msg.tool as string,
          message: `${msg.tool} completed (${msg.type})`,
          data: msg,
        });
      }
    });

    const offConnected = engine.on("connected", () => {
      addLog({ type: "event", message: "WebSocket connected to engine" });
    });

    const offDisconnected = engine.on("disconnected", () => {
      addLog({ type: "event", message: "WebSocket disconnected from engine" });
    });

    const offError = engine.on("error", (err) => {
      addLog({
        type: "error",
        message: `Connection error: ${err}`,
      });
    });

    return () => {
      offMessage();
      offConnected();
      offDisconnected();
      offError();
    };
  }, [addLog]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const typeColors: Record<LogEntry["type"], string> = {
    request: "text-blue-400",
    response: "text-emerald-400",
    event: "text-amber-400",
    error: "text-red-400",
  };

  const typeBadgeVariant: Record<
    LogEntry["type"],
    "default" | "success" | "warning" | "destructive"
  > = {
    request: "default",
    response: "success",
    event: "warning",
    error: "destructive",
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Activity"
        description="Real-time engine activity log"
      >
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPaused(!paused)}
          >
            {paused ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <ArrowDown
              className={`h-4 w-4 ${autoScroll ? "text-primary" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLogs([])}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-hidden" ref={scrollRef}>
        <ScrollArea className="h-full">
          <div className="p-4 space-y-1">
            {logs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <ActivityIcon className="h-12 w-12 opacity-20 mb-4" />
                <p className="text-sm font-medium">No activity yet</p>
                <p className="text-xs mt-1">
                  {engineStatus === "connected"
                    ? "Activity will appear here as you use tools"
                    : "Connect to the engine to see activity"}
                </p>
              </div>
            )}
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded-md px-3 py-1.5 hover:bg-accent/50 font-mono text-xs"
              >
                <span className="shrink-0 text-muted-foreground w-20">
                  {entry.timestamp.toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <Badge
                  variant={typeBadgeVariant[entry.type]}
                  className="shrink-0 text-[10px] w-16 justify-center"
                >
                  {entry.type}
                </Badge>
                {entry.tool && (
                  <span className="shrink-0 text-primary font-medium">
                    {entry.tool}
                  </span>
                )}
                <span className={typeColors[entry.type]}>
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
