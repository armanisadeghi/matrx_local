import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { engine } from "@/lib/api";

type ScrapeMethod = "engine" | "browser" | "remote";

interface QuickScrapeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickScrapeModal({ open, onOpenChange }: QuickScrapeModalProps) {
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<ScrapeMethod>("engine");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScrape = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const toolName = method === "browser" ? "FetchWithBrowser" : "Scrape";
      const args =
        method === "browser"
          ? { url: trimmed, extract_text: true }
          : { urls: [trimmed] };
      const res = await engine.invokeTool(toolName, args);
      const text =
        typeof res === "string"
          ? res
          : JSON.stringify(res, null, 2).slice(0, 5000);
      setResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scrape failed");
    } finally {
      setLoading(false);
    }
  }, [url, method]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setUrl("");
          setResult(null);
          setError(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[70vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-3">
          <DialogTitle>Quick Scrape</DialogTitle>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-2 border-b px-6 pb-3">
          <input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleScrape()}
            className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as ScrapeMethod)}
            className="rounded-lg border bg-transparent px-2 py-2 text-xs outline-none"
          >
            <option value="engine">Engine</option>
            <option value="browser">Browser</option>
            <option value="remote">Remote</option>
          </select>
          <Button onClick={handleScrape} disabled={loading || !url.trim()} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Go"}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-3">
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {result && (
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
              {result}
            </pre>
          )}
          {!result && !error && !loading && (
            <p className="text-sm text-muted-foreground">
              Enter a URL and click Go to scrape.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
