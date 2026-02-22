import { useState, useCallback } from "react";
import { Bell, Send, CheckCircle2, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AiBadge } from "@/components/tools/panels/AiBadge";

interface NotifyPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

export function NotifyPanel({ onInvoke, loading, result }: NotifyPanelProps) {
  const [title, setTitle]   = useState("Matrx Notification");
  const [body, setBody]     = useState("");
  const [sent, setSent]     = useState(false);

  const isSuccess = result && (result as { type?: string }).type !== "error";

  const send = useCallback(async () => {
    if (!body.trim()) return;
    await onInvoke("Notify", { title, body });
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }, [onInvoke, title, body]);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      <AiBadge text="Your AI can send native desktop notifications" />

      {/* Preview card */}
      <div className="rounded-2xl border bg-card/50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Notification Preview</span>
        </div>

        {/* Fake macOS notification preview */}
        <div className="rounded-xl border border-border/60 bg-background/80 backdrop-blur-sm shadow-lg p-3 flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{title || "Title…"}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">{body || "Notification body will appear here…"}</p>
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">now</span>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Notification title" className="mt-1" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Body</label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Write your notification message…"
            rows={4} className="mt-1 resize-none" />
        </div>

        <Button onClick={send} disabled={loading || !body.trim()}
          className={`w-full gap-2 transition-all duration-200 ${
            sent || isSuccess
              ? "bg-emerald-600 hover:bg-emerald-600 text-white"
              : ""
          }`}>
          {sent || isSuccess ? (
            <><CheckCircle2 className="h-4 w-4" /> Notification Sent!</>
          ) : (
            <><Send className="h-4 w-4" /> Send Notification</>
          )}
        </Button>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-dashed border-muted-foreground/20 p-3 text-center">
        <p className="text-xs text-muted-foreground">
          Notifications appear in your OS notification center. Make sure permission is granted.
        </p>
      </div>
    </div>
  );
}
