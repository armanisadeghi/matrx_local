import { useState, useCallback } from "react";
import {
  Globe,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { engine, type ScrapeResultData } from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";
import { formatDuration, truncateUrl } from "@/lib/utils";

interface ScrapingProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
}

interface ScrapeJob {
  id: string;
  urls: string[];
  status: "pending" | "running" | "completed" | "failed";
  results: ScrapeResultData[];
  startedAt: Date;
  completedAt?: Date;
  useCache: boolean;
  method: "engine" | "local-browser";
}

export function Scraping({ engineStatus, engineUrl }: ScrapingProps) {
  const [urlInput, setUrlInput] = useState("");
  const [useCache, setUseCache] = useState(true);
  const [method, setMethod] = useState<"engine" | "local-browser">("engine");
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<ScrapeResultData | null>(
    null
  );

  const parseUrls = useCallback((text: string): string[] => {
    return text
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter((u) => {
        try {
          new URL(u);
          return true;
        } catch {
          return u.startsWith("http://") || u.startsWith("https://");
        }
      });
  }, []);

  const startScrape = useCallback(async () => {
    const urls = parseUrls(urlInput);
    if (urls.length === 0) return;

    const job: ScrapeJob = {
      id: `job-${Date.now()}`,
      urls,
      status: "running",
      results: [],
      startedAt: new Date(),
      useCache,
      method,
    };

    setJobs((prev) => [job, ...prev]);
    setSelectedJob(job.id);
    setUrlInput("");

    try {
      let results: ScrapeResultData[];

      if (method === "local-browser") {
        const toolResult = await engine.invokeTool("FetchWithBrowser", {
          url: urls[0],
          extract_text: true,
        });
        results = [{
          url: urls[0],
          success: toolResult.type === "success",
          status_code: toolResult.metadata?.status_code as number ?? 0,
          content: toolResult.output,
          title: "",
          content_type: "text/html",
          response_url: toolResult.metadata?.url as string ?? urls[0],
          error: toolResult.type === "error" ? toolResult.output : null,
          elapsed_ms: toolResult.metadata?.elapsed_ms as number ?? 0,
        }];
      } else {
        const toolResult = await engine.invokeTool("Scrape", {
          urls,
          use_cache: useCache,
        });

        const meta = toolResult.metadata ?? {};
        if (meta.results && Array.isArray(meta.results)) {
          results = (meta.results as Record<string, unknown>[]).map((r) => ({
            url: String(r.url ?? ""),
            success: r.status === "success",
            status_code: (r.status_code as number) ?? 0,
            content: toolResult.output,
            title: "",
            content_type: String(r.content_type ?? ""),
            response_url: String(r.url ?? ""),
            error: r.error ? String(r.error) : null,
            elapsed_ms: (r.elapsed_ms as number) ?? (meta.elapsed_ms as number) ?? 0,
          }));
        } else {
          results = urls.map((url) => ({
            url,
            success: toolResult.type === "success",
            status_code: (meta.status_code as number) ?? 0,
            content: toolResult.output,
            title: "",
            content_type: String(meta.content_type ?? "text/html"),
            response_url: String(meta.url ?? url),
            error: toolResult.type === "error" ? toolResult.output : null,
            elapsed_ms: (meta.elapsed_ms as number) ?? 0,
          }));
        }
      }

      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: "completed",
                results,
                completedAt: new Date(),
              }
            : j
        )
      );
    } catch (err) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: "failed",
                completedAt: new Date(),
                results: urls.map((url) => ({
                  url,
                  success: false,
                  status_code: 0,
                  content: "",
                  title: "",
                  content_type: "",
                  response_url: url,
                  error: err instanceof Error ? err.message : String(err),
                  elapsed_ms: 0,
                })),
              }
            : j
        )
      );
    }
  }, [urlInput, useCache, method, parseUrls]);

  const activeJob = jobs.find((j) => j.id === selectedJob);
  const urlCount = parseUrls(urlInput).length;

  return (
    <>
      <Header
        title="Scraping"
        description="Scrape websites using multiple strategies"
        engineStatus={engineStatus}
        engineUrl={engineUrl}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Input & Job List */}
        <div className="flex w-[380px] flex-col border-r">
          {/* URL Input */}
          <div className="space-y-4 p-4">
            <Textarea
              placeholder="Enter URLs to scrape (one per line)&#10;&#10;https://example.com&#10;https://example.org/page"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="h-32 resize-none font-mono text-xs"
            />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  id="cache"
                  checked={useCache}
                  onCheckedChange={setUseCache}
                />
                <Label htmlFor="cache" className="text-xs">
                  Use cache
                </Label>
              </div>

              <div className="flex gap-1">
                <Button
                  variant={method === "engine" ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setMethod("engine")}
                >
                  Engine
                </Button>
                <Button
                  variant={method === "local-browser" ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setMethod("local-browser")}
                >
                  Local Browser
                </Button>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={startScrape}
              disabled={
                urlCount === 0 ||
                engineStatus !== "connected" ||
                jobs.some((j) => j.status === "running")
              }
            >
              {jobs.some((j) => j.status === "running") ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scraping...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Scrape {urlCount > 0 ? `${urlCount} URL${urlCount > 1 ? "s" : ""}` : ""}
                </>
              )}
            </Button>
          </div>

          <Separator />

          {/* Job History */}
          <div className="px-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                HISTORY
              </span>
              {jobs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    setJobs([]);
                    setSelectedJob(null);
                    setSelectedResult(null);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-1 px-4 pb-4">
              {jobs.map((job) => {
                const succeeded = job.results.filter(
                  (r) => r.success
                ).length;
                const total = job.urls.length;

                return (
                  <button
                    key={job.id}
                    onClick={() => {
                      setSelectedJob(job.id);
                      setSelectedResult(null);
                    }}
                    className={`w-full rounded-lg p-3 text-left transition-colors ${
                      selectedJob === job.id
                        ? "bg-accent"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {job.status === "running" && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        )}
                        {job.status === "completed" && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                        {job.status === "failed" && (
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                        )}
                        <span className="text-sm font-medium">
                          {total} URL{total > 1 ? "s" : ""}
                        </span>
                      </div>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5"
                      >
                        {job.method === "local-browser" ? "Browser" : "Engine"}
                      </Badge>
                    </div>
                    {job.status === "completed" && (
                      <div className="mt-1.5">
                        <Progress
                          value={(succeeded / total) * 100}
                          className="h-1"
                        />
                        <span className="mt-1 text-[10px] text-muted-foreground">
                          {succeeded}/{total} succeeded
                        </span>
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {job.startedAt.toLocaleTimeString()}
                    </div>
                  </button>
                );
              })}
              {jobs.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No scrape jobs yet
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel: Results */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {activeJob ? (
            <Tabs defaultValue="results" className="flex flex-1 flex-col">
              <div className="border-b px-4">
                <TabsList className="h-10">
                  <TabsTrigger value="results">
                    Results ({activeJob.results.length})
                  </TabsTrigger>
                  <TabsTrigger value="content">Content</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent
                value="results"
                className="flex-1 overflow-hidden mt-0"
              >
                <ScrollArea className="h-full">
                  <div className="space-y-2 p-4">
                    {activeJob.results.map((result, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedResult(result)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          selectedResult?.url === result.url
                            ? "border-primary bg-primary/5"
                            : "hover:bg-accent/50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {result.success ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                          )}
                          <span className="truncate text-sm font-mono">
                            {truncateUrl(result.url)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {result.status_code || "N/A"}
                          </span>
                          {result.elapsed_ms > 0 && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(result.elapsed_ms)}
                            </span>
                          )}
                          {result.title && (
                            <span className="truncate">{result.title}</span>
                          )}
                          {result.error && (
                            <span className="text-red-400 truncate">
                              {result.error}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                    {activeJob.status === "running" && (
                      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Scraping in progress...</span>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent
                value="content"
                className="flex-1 overflow-hidden mt-0"
              >
                {selectedResult ? (
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b px-4 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Globe className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm font-mono">
                          {selectedResult.url}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="text-xs">
                          {selectedResult.status_code}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            window.open(selectedResult.url, "_blank")
                          }
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <ScrollArea className="flex-1">
                      <pre className="whitespace-pre-wrap break-words p-4 text-xs font-mono text-muted-foreground">
                        {selectedResult.content || "(no content)"}
                      </pre>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <p className="text-sm">
                      Select a result to view its content
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
              <Globe className="h-12 w-12 opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium">No job selected</p>
                <p className="mt-1 text-xs">
                  Enter URLs and start a scrape job to see results here
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Suppress unused import warnings
void RotateCcw;
