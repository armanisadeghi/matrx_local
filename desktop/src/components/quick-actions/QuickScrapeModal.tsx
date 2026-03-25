import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { ScrapeResultViewer } from "@/components/scraping/ScrapeResultViewer";
import { MethodSelector } from "@/components/scraping/MethodSelector";
import { useScrapeOne, normalizeUrl, type ScrapeMethod } from "@/hooks/use-scrape";

interface QuickScrapeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickScrapeModal({ open, onOpenChange }: QuickScrapeModalProps) {
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<ScrapeMethod>("engine");
  const [useCache, setUseCache] = useState(true);
  const { scrape, loading, result, error, reset } = useScrapeOne();

  const handleScrape = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    await scrape(normalizeUrl(trimmed), method, useCache);
  }, [url, method, useCache, scrape]);

  const handleClose = useCallback(
    (open: boolean) => {
      if (!open) {
        setUrl("");
        reset();
      }
      onOpenChange(open);
    },
    [onOpenChange, reset],
  );

  const hasResult = result !== null || error !== null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-5 pb-0">
          <DialogTitle>Quick Scrape</DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="shrink-0 space-y-3 border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (hasResult) reset();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) handleScrape();
              }}
              disabled={loading}
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 placeholder:text-muted-foreground/60"
              autoFocus
            />
            <Button
              onClick={handleScrape}
              disabled={loading || !url.trim()}
              size="sm"
              className="shrink-0 gap-1.5"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Scrape"
              )}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <MethodSelector value={method} onChange={setMethod} />
            <div className="ml-auto flex items-center gap-2">
              <Switch
                id="qs-cache"
                checked={useCache}
                onCheckedChange={setUseCache}
              />
              <Label htmlFor="qs-cache" className="text-xs cursor-pointer">
                Cache
              </Label>
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="flex min-h-[200px] flex-1 flex-col overflow-hidden">
          {error ? (
            <div className="p-6">
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <p className="mb-1.5 text-sm font-semibold text-red-400">Scrape failed</p>
                <pre className="whitespace-pre-wrap font-mono text-xs text-red-300/80 leading-relaxed">
                  {error}
                </pre>
              </div>
            </div>
          ) : (
            <ScrapeResultViewer
              url={url ? normalizeUrl(url) : undefined}
              result={result}
              loading={loading}
              className="flex-1"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
