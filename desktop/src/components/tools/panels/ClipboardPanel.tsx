import { useState, useCallback } from "react";
import { Clipboard, ClipboardCopy, Check, Send, Bell, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToolSection } from "@/components/tools/shared/ToolSection";
import { cn } from "@/lib/utils";

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
  const [view, setView]           = useState<"clipboard" | "notify">("clipboard");
  const [notifyTitle, setNotifyTitle] = useState("Matrx Notification");
  const [notifyBody, setNotifyBody]   = useState("");
  const [notifySent, setNotifySent]   = useState(false);

  const content = parseOutput(result);

  const handleRead = useCallback(() => {
    onInvoke("ClipboardRead", {});
  }, [onInvoke]);

  const handleWrite = useCallback(() => {
    if (!writeText.trim()) return;
    onInvoke("ClipboardWrite", { content: writeText }).then(() => {
      setWrote(true);
      setTimeout(() => setWrote(false), 2000);
    });
  }, [onInvoke, writeText]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const sendNotification = useCallback(async () => {
    if (!notifyBody.trim()) return;
    await onInvoke("Notify", { title: notifyTitle, message: notifyBody });
    setNotifySent(true);
    setTimeout(() => setNotifySent(false), 3000);
  }, [onInvoke, notifyTitle, notifyBody]);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      {/* View switcher */}
      <div className="flex gap-1 rounded-xl border bg-muted/20 p-1">
        <button onClick={() => setView("clipboard")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all",
            view === "clipboard" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
          )}>
          <Clipboard className="h-3.5 w-3.5" /> Clipboard
        </button>
        <button onClick={() => setView("notify")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all",
            view === "notify" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
          )}>
          <Bell className="h-3.5 w-3.5" /> Notifications
        </button>
      </div>

      {view === "clipboard" && (
        <>
          {/* Read Section */}
          <ToolSection title="Read Clipboard" icon={Clipboard} iconColor="text-amber-400"
            actions={
              <Button size="sm" onClick={handleRead} disabled={loading} className="h-7 gap-1.5 text-xs">
                <Clipboard className="h-3 w-3" /> Read
              </Button>
            }>
            {content ? (
              <div className="rounded-xl border bg-muted/40">
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
                <p className="text-xs">Click Read to see clipboard contents</p>
              </div>
            )}
          </ToolSection>

          {/* Write Section */}
          <ToolSection title="Write to Clipboard" icon={Send} iconColor="text-amber-400">
            <div className="space-y-3">
              <Textarea
                rows={4}
                placeholder="Type or paste text to send to clipboard..."
                value={writeText}
                onChange={(e) => setWriteText(e.target.value)}
                className="font-mono text-xs resize-none"
              />
              <Button
                onClick={handleWrite}
                disabled={loading || !writeText.trim()}
                className={cn("w-full gap-2 transition-all", wrote && "bg-emerald-600 hover:bg-emerald-600")}
              >
                {wrote ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {wrote ? "Sent to Clipboard!" : "Send to Clipboard"}
              </Button>
            </div>
          </ToolSection>
        </>
      )}

      {view === "notify" && (
        <>
          {/* Notification preview */}
          <ToolSection title="Desktop Notification" icon={Bell} iconColor="text-amber-400">
            <div className="space-y-4">
              {/* Preview card */}
              <div className="rounded-xl border border-border/60 bg-background/80 backdrop-blur-sm shadow-lg p-3 flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                  <Bell className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{notifyTitle || "Title..."}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">{notifyBody || "Body text..."}</p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">now</span>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <Input value={notifyTitle} onChange={(e) => setNotifyTitle(e.target.value)}
                  placeholder="Notification title" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Body</label>
                <Textarea value={notifyBody} onChange={(e) => setNotifyBody(e.target.value)}
                  placeholder="Write your notification message..."
                  rows={3} className="mt-1 resize-none" />
              </div>

              <Button onClick={sendNotification} disabled={loading || !notifyBody.trim()}
                className={cn("w-full gap-2 transition-all", notifySent && "bg-emerald-600 hover:bg-emerald-600")}>
                {notifySent
                  ? <><CheckCircle2 className="h-4 w-4" /> Sent!</>
                  : <><Send className="h-4 w-4" /> Send Notification</>
                }
              </Button>
            </div>
          </ToolSection>
        </>
      )}
    </div>
  );
}
