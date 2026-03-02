import { useState, useCallback, useRef, useEffect } from "react";
import {
  Globe,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Trash2,
  StopCircle,
  Plus,
  History,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { engine, type ScrapeResultData } from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";
import { formatDuration, truncateUrl } from "@/lib/utils";
import { cn } from "@/lib/utils";

const HISTORY_KEY = "matrx:scrape-history";
const MAX_HISTORY = 100;

interface ScrapeHistoryEntry {
  url: string;
  success: boolean;
  title: string;
  elapsed_ms: number;
  savedAt: string;
  content?: string;
}

function loadHistory(): ScrapeHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ScrapeHistoryEntry[]) : [];
  } catch { return []; }
}

function saveToHistory(entries: ScrapeHistoryEntry[]) {
  try {
    const existing = loadHistory();
    const existingUrls = new Set(existing.map((e) => e.url + e.savedAt));
    const newEntries = entries.filter((e) => !existingUrls.has(e.url + e.savedAt));
    const merged = [...newEntries, ...existing].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
  } catch { /* quota exceeded — ignore */ }
}

interface ScrapingProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
}

interface ScrapeEntry {
  url: string;
  status: "pending" | "running" | "success" | "error";
  result: ScrapeResultData | null;
  startedAt: Date;
  completedAt?: Date;
}

/** Normalize a URL — prefix bare domains with https:// */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function Scraping({ engineStatus, engineUrl: _engineUrl }: ScrapingProps) {
  const [urlDraft, setUrlDraft] = useState("");
  const [useCache, setUseCache] = useState(true);
  const [method, setMethod] = useState<"engine" | "local-browser" | "remote">("engine");
  const [entries, setEntries] = useState<ScrapeEntry[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<ScrapeHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load history from localStorage on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Persist successful entries to history when they complete
  useEffect(() => {
    const completed = entries.filter(
      (e) => (e.status === "success" || e.status === "error") && e.result
    );
    if (completed.length === 0) return;
    const toSave: ScrapeHistoryEntry[] = completed.map((e) => ({
      url: e.url,
      success: e.status === "success",
      title: e.result?.title ?? "",
      elapsed_ms: e.result?.elapsed_ms ?? 0,
      savedAt: (e.completedAt ?? new Date()).toISOString(),
      content: e.result?.content?.slice(0, 2000),
    }));
    saveToHistory(toSave);
    setHistory(loadHistory());
  }, [entries]);

  const selectedEntry = entries.find((e) => e.url === selectedUrl) ?? null;

  /** Parse multi-line URL input into a normalized list */
  const parseUrlDraft = useCallback((text: string): string[] => {
    return text
      .split(/[\n,]+/)
      .map((u) => normalizeUrl(u))
      .filter(Boolean);
  }, []);

  const addUrls = useCallback(() => {
    const urls = parseUrlDraft(urlDraft);
    if (urls.length === 0) return;
    setEntries((prev) => {
      const existingUrls = new Set(prev.map((e) => e.url));
      const newEntries: ScrapeEntry[] = urls
        .filter((u) => !existingUrls.has(u))
        .map((url) => ({
          url,
          status: "pending",
          result: null,
          startedAt: new Date(),
        }));
      return [...prev, ...newEntries];
    });
    setUrlDraft("");
  }, [urlDraft, parseUrlDraft]);

  const removeEntry = useCallback((url: string) => {
    setEntries((prev) => prev.filter((e) => e.url !== url));
    setSelectedUrl((prev) => (prev === url ? null : prev));
  }, []);

  const clearAll = useCallback(() => {
    abortRef.current?.abort();
    setEntries([]);
    setSelectedUrl(null);
    setRunning(false);
  }, []);

  const stopScrape = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setEntries((prev) =>
      prev.map((e) =>
        e.status === "running" || e.status === "pending"
          ? { ...e, status: "error", result: { ...makeFallbackResult(e.url), error: "Stopped by user" } }
          : e,
      ),
    );
  }, []);

  const startScrape = useCallback(async () => {
    // Determine URLs to scrape: pending entries, or all if none pending
    const toScrape = entries.filter((e) => e.status === "pending");
    if (toScrape.length === 0) return;

    setRunning(true);
    abortRef.current = new AbortController();

    if (method === "remote") {
      const urls = toScrape.map((e) => e.url);
      // Mark them all as running
      setEntries((prev) =>
        prev.map((e) =>
          urls.includes(e.url) ? { ...e, status: "running" } : e,
        ),
      );

      const controller = await engine.scrapeRemotelyStream(
        urls,
        { use_cache: useCache },
        (event, data) => {
          const d = data as Record<string, unknown>;
          if (event === "page_result") {
            const url = String(d.url ?? "");
            const result: ScrapeResultData = {
              url,
              success: d.status === "success",
              status_code: (d.status_code as number) ?? 0,
              content: String(d.text_data ?? d.content ?? ""),
              title: String(d.title ?? ""),
              content_type: String(d.content_type ?? ""),
              response_url: String(d.url ?? ""),
              error: d.error ? String(d.error) : null,
              elapsed_ms: (d.elapsed_ms as number) ?? 0,
            };
            setEntries((prev) =>
              prev.map((e) =>
                e.url === url
                  ? { ...e, status: result.success ? "success" : "error", result, completedAt: new Date() }
                  : e,
              ),
            );
            setSelectedUrl((prev) => prev ?? url);
          }
        },
        () => {
          abortRef.current = null;
          setRunning(false);
        },
        () => {
          abortRef.current = null;
          setRunning(false);
        },
      );
      abortRef.current = controller;
      return;
    }

    // Sequential scraping for engine / local-browser
    for (const entry of toScrape) {
      if (abortRef.current?.signal.aborted) break;

      setEntries((prev) =>
        prev.map((e) => (e.url === entry.url ? { ...e, status: "running" } : e)),
      );

      try {
        let result: ScrapeResultData;

        if (method === "local-browser") {
          const toolResult = await engine.invokeTool("FetchWithBrowser", {
            url: entry.url,
            extract_text: true,
          });
          result = {
            url: entry.url,
            success: toolResult.type === "success",
            status_code: (toolResult.metadata?.status_code as number) ?? 0,
            content: toolResult.output,
            title: "",
            content_type: "text/html",
            response_url: (toolResult.metadata?.url as string) ?? entry.url,
            error: toolResult.type === "error" ? toolResult.output : null,
            elapsed_ms: (toolResult.metadata?.elapsed_ms as number) ?? 0,
          };
        } else {
          const toolResult = await engine.invokeTool("Scrape", {
            urls: [entry.url],
            use_cache: useCache,
          });
          const meta = toolResult.metadata ?? {};
          const results = meta.results as Record<string, unknown>[] | undefined;
          const r = results?.[0];
          result = {
            url: entry.url,
            success: r ? r.status === "success" : toolResult.type === "success",
            status_code: (r?.status_code as number) ?? (meta.status_code as number) ?? 0,
            content: toolResult.output,
            title: (r?.title as string) ?? "",
            content_type: (r?.content_type as string) ?? "text/html",
            response_url: (r?.url as string) ?? entry.url,
            error: r?.error ? String(r.error) : toolResult.type === "error" ? toolResult.output : null,
            elapsed_ms: (r?.elapsed_ms as number) ?? (meta.elapsed_ms as number) ?? 0,
          };
        }

        setEntries((prev) =>
          prev.map((e) =>
            e.url === entry.url
              ? { ...e, status: result.success ? "success" : "error", result, completedAt: new Date() }
              : e,
          ),
        );
        setSelectedUrl((prev) => prev ?? entry.url);
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) =>
            e.url === entry.url
              ? {
                  ...e,
                  status: "error",
                  result: { ...makeFallbackResult(e.url), error: err instanceof Error ? err.message : String(err) },
                  completedAt: new Date(),
                }
              : e,
          ),
        );
      }
    }

    setRunning(false);
    abortRef.current = null;
  }, [entries, useCache, method]);

  const urlCount = parseUrlDraft(urlDraft).filter(
    (u) => !entries.find((e) => e.url === u),
  ).length;

  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const doneCount = entries.filter((e) => e.status === "success" || e.status === "error").length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Scraping"
        description="Scrape websites using multiple strategies"
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel: URL list + controls ── */}
        <div className="flex w-[320px] shrink-0 flex-col border-r">
          {/* Input area */}
          <div className="space-y-3 p-3">
            <div className="flex gap-1">
              <textarea
                placeholder={
                  "Paste URLs (one per line)\nyahoo.com\nhttps://example.com"
                }
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    addUrls();
                  }
                }}
                className="h-24 w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={addUrls}
                disabled={urlCount === 0}
              >
                <Plus className="h-3.5 w-3.5" />
                Add {urlCount > 0 ? `${urlCount}` : ""}
              </Button>

              {/* Method selector */}
              <div className="ml-auto flex gap-0.5">
                {(["engine", "local-browser", "remote"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={cn(
                      "rounded px-2 py-1 text-[10px] font-medium transition-colors",
                      method === m
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {m === "engine" ? "Engine" : m === "local-browser" ? "Browser" : "Remote"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch id="cache" checked={useCache} onCheckedChange={setUseCache} />
                <Label htmlFor="cache" className="text-xs">Cache</Label>
              </div>

              {running ? (
                <Button size="sm" variant="destructive" className="gap-1.5 text-xs h-7" onClick={stopScrape}>
                  <StopCircle className="h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="gap-1.5 text-xs h-7"
                  onClick={startScrape}
                  disabled={pendingCount === 0 || engineStatus !== "connected"}
                >
                  <Play className="h-3.5 w-3.5" />
                  Scrape {pendingCount > 0 ? pendingCount : ""}
                </Button>
              )}
            </div>

            {running && entries.some((e) => e.status === "running") && (
              <Progress
                value={(doneCount / entries.length) * 100}
                className="h-1"
              />
            )}
          </div>

          <Separator />

          {/* URL list header */}
          <div className="flex items-center justify-between px-3 py-1.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHistory(false)}
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide transition-colors",
                  !showHistory ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Queue ({entries.length})
              </button>
              <span className="text-muted-foreground/30 text-[10px]">|</span>
              <button
                onClick={() => setShowHistory(true)}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                  showHistory ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <History className="h-3 w-3" />
                History ({history.length})
              </button>
            </div>
            {!showHistory && entries.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            )}
            {showHistory && history.length > 0 && (
              <button
                onClick={() => {
                  localStorage.removeItem(HISTORY_KEY);
                  setHistory([]);
                }}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>

          {/* Flat URL list or History */}
          <ScrollArea className="flex-1">
            {showHistory && (
              <div className="space-y-0.5 px-2 pb-3">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                    <History className="h-8 w-8 opacity-20" />
                    <p className="text-xs">No scrape history yet</p>
                  </div>
                ) : (
                  history.map((h) => (
                    <button
                      key={h.url + h.savedAt}
                      onClick={() => {
                        const existing = entries.find((e) => e.url === h.url);
                        if (!existing && h.content) {
                          const restored: ScrapeEntry = {
                            url: h.url,
                            status: h.success ? "success" : "error",
                            result: {
                              url: h.url,
                              success: h.success,
                              status_code: 0,
                              content: h.content ?? "",
                              title: h.title,
                              content_type: "text/html",
                              response_url: h.url,
                              error: h.success ? null : "Historical error",
                              elapsed_ms: h.elapsed_ms,
                            },
                            startedAt: new Date(h.savedAt),
                            completedAt: new Date(h.savedAt),
                          };
                          setEntries((prev) => [restored, ...prev]);
                        }
                        setSelectedUrl(h.url);
                        setShowHistory(false);
                      }}
                      className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
                    >
                      <span className="shrink-0">
                        {h.success
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          : <XCircle className="h-3.5 w-3.5 text-red-400" />
                        }
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-mono text-xs">{truncateUrl(h.url)}</span>
                        {h.title && <span className="block truncate text-[10px] text-muted-foreground">{h.title}</span>}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(h.savedAt).toLocaleDateString()}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
            <div className={cn("space-y-0.5 px-2 pb-3", showHistory && "hidden")}>
              {entries.map((entry) => (
                <button
                  key={entry.url}
                  onClick={() => setSelectedUrl(entry.url)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                    selectedUrl === entry.url
                      ? "bg-accent"
                      : "hover:bg-accent/50",
                  )}
                >
                  {/* Status icon */}
                  <span className="shrink-0">
                    {entry.status === "running" && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    )}
                    {entry.status === "success" && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                    {entry.status === "error" && (
                      <XCircle className="h-3.5 w-3.5 text-red-400" />
                    )}
                    {entry.status === "pending" && (
                      <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 inline-block" />
                    )}
                  </span>

                  {/* URL */}
                  <span className="flex-1 truncate font-mono text-xs">
                    {truncateUrl(entry.url)}
                  </span>

                  {/* Meta */}
                  <span className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                    {entry.result?.elapsed_ms ? (
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDuration(entry.result.elapsed_ms)}
                      </span>
                    ) : null}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeEntry(entry.url); }}
                      className="opacity-0 group-hover:opacity-100 ml-0.5 hover:text-destructive transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </button>
              ))}

              {entries.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <Globe className="h-8 w-8 opacity-20" />
                  <p className="text-xs">No URLs added yet</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Right Panel: Content viewer ── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedEntry?.result ? (
            <>
              {/* Content header */}
              <div className="flex items-center gap-3 border-b px-4 py-2.5 shrink-0">
                {selectedEntry.result.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                )}
                <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                  {selectedEntry.url}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedEntry.result.status_code > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {selectedEntry.result.status_code}
                    </Badge>
                  )}
                  {selectedEntry.result.elapsed_ms > 0 && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(selectedEntry.result.elapsed_ms)}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => window.open(selectedEntry.url, "_blank")}
                    title="Open in browser"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-auto">
                {selectedEntry.result.error ? (
                  <div className="p-4">
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                      <p className="text-sm font-medium text-red-400 mb-1">Scrape failed</p>
                      <pre className="text-xs text-red-300/80 whitespace-pre-wrap font-mono">
                        {selectedEntry.result.error}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <pre className="p-4 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                    {selectedEntry.result.content || "(no content)"}
                  </pre>
                )}
              </div>
            </>
          ) : selectedEntry?.status === "running" ? (
            <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">Scraping {selectedEntry.url}...</span>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Globe className="h-12 w-12 opacity-15" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {entries.length === 0 ? "Add URLs to get started" : "Select a URL to view content"}
                </p>
                <p className="mt-1 text-xs opacity-70">
                  {entries.length === 0
                    ? "Paste one or more URLs in the left panel"
                    : "Click any URL in the list to view its scraped content"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function makeFallbackResult(url: string): ScrapeResultData {
  return {
    url,
    success: false,
    status_code: 0,
    content: "",
    title: "",
    content_type: "",
    response_url: url,
    error: null,
    elapsed_ms: 0,
  };
}
