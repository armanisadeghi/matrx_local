import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { EngineStatus } from "@/hooks/use-engine";

interface StatusBarProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  engineVersion?: string;
}

const statusVariants: Record<
  EngineStatus,
  "success" | "warning" | "destructive" | "secondary"
> = {
  discovering: "warning",
  starting: "warning",
  connected: "success",
  disconnected: "secondary",
  error: "destructive",
};

const statusText: Record<EngineStatus, string> = {
  discovering: "Discovering",
  starting: "Starting",
  connected: "Connected",
  disconnected: "Offline",
  error: "Error",
};

export function StatusBar({ engineStatus, engineUrl, engineVersion }: StatusBarProps) {
  return (
    <footer className="no-select flex h-8 items-center justify-between border-t bg-background/80 px-4">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            engineStatus === "connected" && "bg-emerald-500",
            engineStatus === "disconnected" && "bg-zinc-500",
            engineStatus === "error" && "bg-red-500",
            (engineStatus === "discovering" || engineStatus === "starting") &&
              "bg-amber-500 animate-pulse-subtle"
          )}
        />
        <Badge variant={statusVariants[engineStatus]} className="h-5 text-[10px] px-1.5">
          {statusText[engineStatus]}
        </Badge>
        {engineUrl && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {engineUrl.replace("http://", "")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {engineVersion && (
          <span className="text-[10px] text-muted-foreground">
            v{engineVersion}
          </span>
        )}
      </div>
    </footer>
  );
}
