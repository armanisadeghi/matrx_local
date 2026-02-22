import { useState, useCallback } from "react";
import { Globe, ArrowRight, Camera, Code2, RefreshCw, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AiBadge } from "@/components/tools/panels/AiBadge";

interface BrowserPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

function parseOutput(result: unknown): { text?: string; image?: string; type?: string } | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d) return null;
    if (d.type === "error") return null;
    if (d.output) {
      try {
        const j = JSON.parse(d.output);
        if (typeof j === "object" && j !== null) return j;
        return { text: d.output };
      } catch {
        return { text: d.output };
      }
    }
    return null;
  } catch { return null; }
}

export function BrowserPanel({ onInvoke, loading, result }: BrowserPanelProps) {
  const [url, setUrl]          = useState("https://");
  const [evalCode, setEvalCode] = useState("document.title");
  const [screenshot, setScreenshot] = useState<string | null>(null);

  const parsed = parseOutput(result);

  const navigate = useCallback(() => {
    let target = url.trim();
    if (!target.startsWith("http")) target = "https://" + target;
    setUrl(target);
    onInvoke("BrowserNavigate", { url: target });
  }, [onInvoke, url]);

  const takeScreenshot = useCallback(async () => {
    const r = await onInvoke("BrowserScreenshot", {});
    // Screenshot result will be available via result prop
    const p = parseOutput(r);
    if (p?.image) setScreenshot(p.image);
  }, [onInvoke]);

  const evalScript = useCallback(() => {
    onInvoke("BrowserEval", { script: evalCode });
  }, [onInvoke, evalCode]);

  // Check if result contains screenshot data
  const imgData = parsed?.image ?? screenshot;
  const textOut = parsed?.text;

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      <AiBadge text="Your AI can control a real browser — navigate, click, extract and screenshot" />

      {/* URL bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="pl-9 font-mono text-sm"
            onKeyDown={(e) => { if (e.key === "Enter") navigate(); }}
          />
        </div>
        <Button onClick={navigate} disabled={loading} className="gap-1.5 shrink-0">
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Go
        </Button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={takeScreenshot} disabled={loading} className="gap-1.5 flex-1">
          <Camera className="h-3.5 w-3.5" /> Screenshot
        </Button>
        <Button variant="outline" size="sm"
          onClick={() => onInvoke("BrowserTabs", {})} disabled={loading} className="gap-1.5 flex-1">
          <ExternalLink className="h-3.5 w-3.5" /> List Tabs
        </Button>
      </div>

      {/* Screenshot preview */}
      {imgData && (
        <div className="rounded-xl overflow-hidden border">
          <div className="flex items-center gap-2 border-b px-3 py-1.5 bg-muted/30">
            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Browser Screenshot</span>
          </div>
          <img src={`data:image/png;base64,${imgData}`} alt="Browser screenshot" className="w-full" />
        </div>
      )}

      {/* Text output */}
      {textOut && !imgData && (
        <div className="rounded-xl border overflow-hidden">
          <div className="flex items-center gap-2 border-b px-3 py-1.5 bg-muted/30">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Browser Output</span>
          </div>
          <div className="max-h-48 overflow-auto p-3">
            <pre className="whitespace-pre-wrap break-words text-xs font-mono">{textOut}</pre>
          </div>
        </div>
      )}

      {/* Eval console */}
      <div className="rounded-2xl border bg-card/50 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-cyan-400" />
          <h4 className="text-sm font-semibold">JS Console</h4>
        </div>
        <div className="flex gap-2">
          <Textarea value={evalCode} onChange={(e) => setEvalCode(e.target.value)}
            rows={2} className="flex-1 resize-none font-mono text-xs"
            placeholder="JavaScript to evaluate…" />
          <Button variant="outline" onClick={evalScript} disabled={loading} className="self-end shrink-0">
            Run
          </Button>
        </div>
      </div>
    </div>
  );
}
