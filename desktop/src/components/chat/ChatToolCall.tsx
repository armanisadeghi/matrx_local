import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCall, ToolCallResult } from "@/hooks/use-chat";

interface ChatToolCallProps {
  toolCall: ToolCall;
  result?: ToolCallResult;
}

export function ChatToolCall({ toolCall, result }: ChatToolCallProps) {
  const [expanded, setExpanded] = useState(false);

  const isSuccess = result?.type === "success";
  const isError = result?.type === "error";
  const isPending = !result;

  return (
    <div
      className={cn(
        "rounded-lg border text-xs",
        isSuccess && "border-emerald-500/20 bg-emerald-500/5",
        isError && "border-destructive/20 bg-destructive/5",
        isPending && "border-border/50 bg-muted/30"
      )}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status icon */}
        {isPending && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
        {isSuccess && (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        )}
        {isError && <XCircle className="h-3.5 w-3.5 text-destructive" />}

        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">{toolCall.name}</span>

        <span className="ml-auto text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 space-y-2">
          {/* Input */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Input
            </span>
            <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>

          {/* Output */}
          {result && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Output
              </span>
              <pre
                className={cn(
                  "mt-1 overflow-x-auto rounded p-2 font-mono text-[11px] leading-relaxed",
                  isSuccess
                    ? "bg-emerald-500/5"
                    : "bg-destructive/5 text-destructive"
                )}
              >
                {result.output.length > 500
                  ? result.output.slice(0, 500) + "\n... [truncated]"
                  : result.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
