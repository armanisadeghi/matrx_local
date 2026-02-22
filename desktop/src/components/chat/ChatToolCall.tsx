import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
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
      className="rounded-lg text-xs"
      style={{
        border: `1px solid ${
          isSuccess
            ? "rgba(120, 140, 93, 0.25)"
            : isError
            ? "rgba(217, 119, 87, 0.25)"
            : "var(--chat-border)"
        }`,
        background: isSuccess
          ? "rgba(120, 140, 93, 0.06)"
          : isError
          ? "rgba(217, 119, 87, 0.06)"
          : "var(--chat-code-bg)",
      }}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {isPending && (
          <Loader2
            className="h-3.5 w-3.5 animate-spin"
            style={{ color: "var(--chat-text-faint)" }}
          />
        )}
        {isSuccess && (
          <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "#788c5d" }} />
        )}
        {isError && (
          <XCircle className="h-3.5 w-3.5" style={{ color: "#d97757" }} />
        )}

        <Wrench
          className="h-3 w-3"
          style={{ color: "var(--chat-text-faint)" }}
        />
        <span className="font-medium" style={{ color: "var(--chat-text)" }}>
          {toolCall.name}
        </span>

        <span className="ml-auto" style={{ color: "var(--chat-text-faint)" }}>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded && (
        <div
          className="space-y-2 px-3 py-2"
          style={{ borderTop: "1px solid var(--chat-border)" }}
        >
          <div>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--chat-text-faint)" }}
            >
              Input
            </span>
            <pre
              className="mt-1 overflow-x-auto rounded p-2 font-mono text-[11px] leading-relaxed"
              style={{
                background: "var(--chat-code-bg)",
                color: "var(--chat-text)",
              }}
            >
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>

          {result && (
            <div>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--chat-text-faint)" }}
              >
                Output
              </span>
              <pre
                className="mt-1 overflow-x-auto rounded p-2 font-mono text-[11px] leading-relaxed"
                style={{
                  background: isSuccess
                    ? "rgba(120, 140, 93, 0.06)"
                    : "rgba(217, 119, 87, 0.06)",
                  color: isError ? "#d97757" : "var(--chat-text)",
                }}
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
