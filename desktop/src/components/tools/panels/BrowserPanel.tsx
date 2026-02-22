import { useState, useCallback, useEffect } from "react";
import { Globe, ArrowRight, Camera, Code2, RefreshCw, ExternalLink, MousePointer, Type, Layers, Play } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToolSection } from "@/components/tools/shared/ToolSection";
import { OutputCard } from "@/components/tools/shared/OutputCard";
import { cn } from "@/lib/utils";

interface BrowserPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

function parseOutput(result: unknown): { text?: string; image?: string; type?: string } | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d) return null;
    if (d.type === "error") return { text: d?.output ?? "Error", type: "error" };
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

interface TabEntry { id?: string; url?: string; title?: string; active?: boolean }

function tryParseTabs(result: unknown): TabEntry[] | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error" || !d.output) return null;
    const arr = JSON.parse(d.output);
    if (Array.isArray(arr)) return arr;
    return null;
  } catch { return null; }
}

export function BrowserPanel({ onInvoke, loading, result }: BrowserPanelProps) {
  const [view, setView] = useState<"navigate" | "interact" | "console">("navigate");
  const [url, setUrl]           = useState("https://");
  const [selector, setSelector] = useState("");
  const [typeText, setTypeText] = useState("");
  const [extractSel, setExtractSel] = useState("");
  const [evalCode, setEvalCode] = useState("document.title");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TabEntry[]>([]);

  const parsed = parseOutput(result);
  const parsedTabs = tryParseTabs(result);

  useEffect(() => {
    if (parsedTabs && parsedTabs.length > 0) setTabs(parsedTabs);
  }, [parsedTabs]);

  const navigate = useCallback(() => {
    let target = url.trim();
    if (!target.startsWith("http")) target = "https://" + target;
    setUrl(target);
    onInvoke("BrowserNavigate", { url: target });
  }, [onInvoke, url]);

  const takeScreenshot = useCallback(async () => {
    await onInvoke("BrowserScreenshot", {});
  }, [onInvoke]);

  // Check if result contains screenshot data
  const imgData = parsed?.image ?? screenshot;
  const textOut = parsed?.text;

  // Persist screenshot from results
  useEffect(() => {
    if (parsed?.image) setScreenshot(parsed.image);
  }, [parsed?.image]);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      {/* View switcher */}
      <div className="flex gap-1 rounded-xl border bg-muted/20 p-1">
        {([
          { key: "navigate", label: "Navigate", icon: Globe },
          { key: "interact", label: "Interact", icon: MousePointer },
          { key: "console",  label: "Console",  icon: Code2 },
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

      {/* ── NAVIGATE ── */}
      {view === "navigate" && (
        <>
          <ToolSection title="Browser Navigation" icon={Globe} iconColor="text-cyan-400">
            <div className="space-y-3">
              {/* URL bar */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={url} onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="pl-9 font-mono text-xs"
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
                  <Layers className="h-3.5 w-3.5" /> Tabs
                </Button>
              </div>
            </div>
          </ToolSection>

          {/* Screenshot preview */}
          {imgData && (
            <ToolSection title="Screenshot" icon={Camera} iconColor="text-cyan-400">
              <div className="rounded-lg overflow-hidden border">
                <img src={`data:image/png;base64,${imgData}`} alt="Browser screenshot" className="w-full" />
              </div>
            </ToolSection>
          )}

          {/* Tabs list */}
          {tabs.length > 0 && (
            <ToolSection title="Open Tabs" icon={Layers} iconColor="text-cyan-400" noPadding>
              <div className="divide-y divide-border/30 max-h-48 overflow-auto">
                {tabs.map((t, i) => (
                  <div key={t.id ?? i} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20 transition-colors">
                    <Globe className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{t.title ?? "Untitled"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{t.url}</p>
                    </div>
                    {t.active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-cyan-500/30 text-cyan-400 bg-cyan-500/10">Active</span>
                    )}
                  </div>
                ))}
              </div>
            </ToolSection>
          )}

          {textOut && !imgData && !parsedTabs && <OutputCard title="Result" content={textOut} />}
        </>
      )}

      {/* ── INTERACT ── */}
      {view === "interact" && (
        <>
          <ToolSection title="Click Element" icon={MousePointer} iconColor="text-cyan-400">
            <div className="space-y-3">
              <Input value={selector} onChange={(e) => setSelector(e.target.value)}
                placeholder="CSS selector (e.g., #submit-btn, .nav-link)" className="text-xs font-mono" />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("BrowserClick", { selector })} disabled={loading || !selector}>
                <MousePointer className="h-3.5 w-3.5" /> Click
              </Button>
            </div>
          </ToolSection>

          <ToolSection title="Type into Element" icon={Type} iconColor="text-cyan-400">
            <div className="space-y-3">
              <Input value={selector} onChange={(e) => setSelector(e.target.value)}
                placeholder="CSS selector" className="text-xs font-mono" />
              <Input value={typeText} onChange={(e) => setTypeText(e.target.value)}
                placeholder="Text to type..." className="text-xs" />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("BrowserType", { selector, text: typeText })}
                disabled={loading || !selector || !typeText}>
                <Type className="h-3.5 w-3.5" /> Type
              </Button>
            </div>
          </ToolSection>

          <ToolSection title="Extract Content" icon={ExternalLink} iconColor="text-cyan-400">
            <div className="space-y-3">
              <Input value={extractSel} onChange={(e) => setExtractSel(e.target.value)}
                placeholder="CSS selector (optional, extracts full page if empty)" className="text-xs font-mono" />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("BrowserExtract", extractSel ? { selector: extractSel } : {})}
                disabled={loading}>
                <ExternalLink className="h-3.5 w-3.5" /> Extract
              </Button>
            </div>
          </ToolSection>

          {textOut && <OutputCard title="Result" content={textOut} maxHeight={300} />}
        </>
      )}

      {/* ── CONSOLE ── */}
      {view === "console" && (
        <>
          <ToolSection title="JavaScript Console" icon={Code2} iconColor="text-cyan-400">
            <div className="space-y-3">
              <Textarea value={evalCode} onChange={(e) => setEvalCode(e.target.value)}
                rows={6} className="resize-none font-mono text-xs bg-zinc-950/50 text-emerald-400"
                placeholder="// JavaScript to evaluate in page context..." />
              <div className="flex gap-2">
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {["document.title", "document.URL", "document.querySelectorAll('a').length"].map((snippet) => (
                    <button key={snippet} onClick={() => setEvalCode(snippet)}
                      className="text-[10px] px-2 py-1 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors font-mono truncate max-w-[150px]">
                      {snippet}
                    </button>
                  ))}
                </div>
                <Button onClick={() => onInvoke("BrowserEval", { script: evalCode })}
                  disabled={loading || !evalCode} className="shrink-0 gap-1.5">
                  <Play className="h-3.5 w-3.5" /> Run
                </Button>
              </div>
            </div>
          </ToolSection>

          {textOut && (
            <OutputCard title="Console Output" content={textOut} format="code" maxHeight={300} />
          )}
        </>
      )}
    </div>
  );
}
