import { useState, useCallback } from "react";
import { Clipboard, ClipboardCopy, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AiBadge } from "@/components/tools/panels/AiBadge";

interface ClipboardPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

function parseOutput(result: unknown): string | null {
  try {
    if (!result) return null;
    const d = result as { output?: string; type?: string };
    if (d.type === "error") return null;
    if (d.output) {
      try { const j = JSON.parse(d.output); return typeof j === "string" ? j : JSON.stringify(j, null, 2); }
      catch { return d.output; }
    }
    return null;
  } catch { return null; }
}

export function ClipboardPanel({ onInvoke, loading, result }: ClipboardPanelProps) {
  const [writeText, setWriteText] = useState("");
  const [copied, setCopied]       = useState(false);
  const [wrote, setWrote]         = useState(false);

  const content = parseOutput(result);

  const handleRead = useCallback(() => {
    onInvoke("GetClipboard", {});
  }, [onInvoke]);

  const handleWrite = useCallback(() => {
    if (!writeText.trim()) return;
    onInvoke("SetClipboard", { text: writeText }).then(() => {
      setWrote(true);
      setTimeout(() => setWrote(false), 2000);
    });
  }, [onInvoke, writeText]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      <AiBadge text="Your AI can read and write your clipboard" />

      {/* Read Section */}
      <div className="rounded-2xl border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clipboard className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Read Clipboard</h3>
          </div>
          <Button size="sm" onClick={handleRead} disabled={loading} className="h-8 gap-2">
            <Clipboard className="h-3.5 w-3.5" />
            Read Now
          </Button>
        </div>

        {content ? (
          <div className="relative rounded-xl border bg-muted/40">
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <span className="text-[11px] text-muted-foreground">{content.length.toLocaleString()} characters</span>
              <button onClick={() => handleCopy(content)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <ClipboardCopy className="h-3 w-3" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="max-h-48 overflow-auto p-3">
              <pre className="whitespace-pre-wrap break-words text-xs text-foreground font-mono">{content}</pre>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/20 p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Clipboard className="h-8 w-8 opacity-30" />
            <p className="text-xs">Click "Read Now" to see what's on your clipboard</p>
          </div>
        )}
      </div>

      {/* Write Section */}
      <div className="rounded-2xl border bg-card/50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold">Write to Clipboard</h3>
        </div>
        <Textarea
          rows={4}
          placeholder="Type or paste text to send to clipboard…"
          value={writeText}
          onChange={(e) => setWriteText(e.target.value)}
          className="font-mono text-xs resize-none"
        />
        <Button
          onClick={handleWrite}
          disabled={loading || !writeText.trim()}
          className={`w-full gap-2 transition-all ${wrote ? "bg-emerald-600 hover:bg-emerald-600" : ""}`}
        >
          {wrote ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {wrote ? "Sent to Clipboard!" : "Send to Clipboard"}
        </Button>
      </div>
    </div>
  );
}
