import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, Copy, CheckCheck } from "lucide-react";

interface ToolOutputProps {
  result: unknown;
  outputType?: string;
  elapsedMs?: number;
}

export function ToolOutput({ result, outputType, elapsedMs }: ToolOutputProps) {
  const [copied, setCopied] = useState(false);

  if (!result) return null;

  const toolResult = result as {
    type?: string;
    output?: string;
    metadata?: Record<string, unknown>;
  };

  const isError = toolResult.type === "error";
  const output = toolResult.output ?? (typeof result === "string" ? result : JSON.stringify(result, null, 2));

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Try to detect if output is JSON
  let parsedJson: unknown = null;
  if (outputType === "json" || (!outputType && !isError)) {
    try {
      parsedJson = JSON.parse(output);
    } catch {
      // Not JSON, render as text
    }
  }

  return (
    <div className="flex flex-col rounded-lg border overflow-hidden">
      {/* Output Header */}
      <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/30">
        <div className="flex items-center gap-2">
          <Badge variant={isError ? "destructive" : "success"} className="text-[10px]">
            {isError ? "Error" : "Success"}
          </Badge>
          {elapsedMs != null && elapsedMs > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={handleCopy}
        >
          {copied ? <CheckCheck className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {/* Output Body */}
      <ScrollArea className="max-h-[400px]">
        <div className="p-3">
          {parsedJson ? (
            <JsonTree data={parsedJson} />
          ) : (
            <pre className={`whitespace-pre-wrap break-words text-xs font-mono ${isError ? "text-destructive" : "text-foreground"}`}>
              {output}
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Collapsible JSON tree renderer */
function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) {
    return <span className="text-muted-foreground text-xs">null</span>;
  }

  if (typeof data === "string") {
    return <span className="text-emerald-500 text-xs font-mono">&quot;{data}&quot;</span>;
  }

  if (typeof data === "number" || typeof data === "boolean") {
    return <span className="text-amber-500 text-xs font-mono">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    return <JsonCollapsible label={`Array(${data.length})`} data={data} depth={depth} isArray />;
  }

  if (typeof data === "object") {
    const keys = Object.keys(data);
    return <JsonCollapsible label={`{${keys.length}}`} data={data} depth={depth} />;
  }

  return <span className="text-xs font-mono">{String(data)}</span>;
}

function JsonCollapsible({
  label,
  data,
  depth,
  isArray,
}: {
  label: string;
  data: unknown;
  depth: number;
  isArray?: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const entries = isArray
    ? (data as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(data as Record<string, unknown>);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-mono">{label}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-border pl-2 space-y-0.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-1">
              <span className="text-primary text-xs font-mono shrink-0">{key}:</span>
              <JsonTree data={value} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
