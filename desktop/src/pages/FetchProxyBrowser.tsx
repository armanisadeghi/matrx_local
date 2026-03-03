/**
 * FastAPI Fetch-Proxy Browser
 *
 * Points the iframe at our local FastAPI /fetch-proxy/page?url=... endpoint.
 * The Python server fetches the target page with httpx (no browser security
 * model), strips X-Frame-Options / CSP headers, rewrites relative links to
 * absolute, and serves the cleaned HTML.  Works for any site — no JS needed.
 *
 * A secondary "Extract" panel lets you pull raw text from any URL, feeding
 * directly into scraping workflows.
 */
import { useState, useRef, useCallback, KeyboardEvent } from "react";
import {
    ChevronLeft,
    ChevronRight,
    RefreshCw,
    ExternalLink,
    FileText,
    Copy,
    Check,
    AlertCircle,
    Loader2,
} from "lucide-react";
import { engine } from "@/lib/api";

const DEFAULT_URL = "https://www.aimatrx.com";

interface ExtractResult {
    title: string;
    text: string;
    url: string;
    final_url: string;
    status_code: number;
    byte_count: number;
}

export function FetchProxyBrowser() {
    const [inputUrl, setInputUrl] = useState(DEFAULT_URL);
    const [proxyUrl, setProxyUrl] = useState<string | null>(null);
    const [displayedUrl, setDisplayedUrl] = useState(DEFAULT_URL);
    const [iframeKey, setIframeKey] = useState(0);
    const historyRef = useRef<string[]>([]);
    const historyIdxRef = useRef(-1);

    // Extract panel state
    const [showExtract, setShowExtract] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
    const [extractError, setExtractError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Build the proxy URL from the current engine base URL
    const buildProxyUrl = useCallback((targetUrl: string): string | null => {
        const base = engine.engineUrl;
        if (!base) return null;
        return `${base}/fetch-proxy/page?url=${encodeURIComponent(targetUrl)}`;
    }, []);

    const navigate = useCallback((target: string) => {
        let finalUrl = target.trim();
        if (finalUrl && !/^https?:\/\//i.test(finalUrl)) {
            finalUrl = "https://" + finalUrl;
        }
        // Trim forward history
        historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
        historyRef.current.push(finalUrl);
        historyIdxRef.current = historyRef.current.length - 1;

        const px = buildProxyUrl(finalUrl);
        setProxyUrl(px);
        setDisplayedUrl(finalUrl);
        setInputUrl(finalUrl);
        setIframeKey((k) => k + 1);
        setExtractResult(null);
        setExtractError(null);
    }, [buildProxyUrl]);

    const goBack = () => {
        if (historyIdxRef.current <= 0) return;
        historyIdxRef.current -= 1;
        const prev = historyRef.current[historyIdxRef.current];
        const px = buildProxyUrl(prev);
        setProxyUrl(px);
        setDisplayedUrl(prev);
        setInputUrl(prev);
        setIframeKey((k) => k + 1);
    };

    const goForward = () => {
        if (historyIdxRef.current >= historyRef.current.length - 1) return;
        historyIdxRef.current += 1;
        const next = historyRef.current[historyIdxRef.current];
        const px = buildProxyUrl(next);
        setProxyUrl(px);
        setDisplayedUrl(next);
        setInputUrl(next);
        setIframeKey((k) => k + 1);
    };

    const reload = () => setIframeKey((k) => k + 1);

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") navigate(inputUrl);
    };

    // Initialise on mount — load the default URL
    const initialised = useRef(false);
    if (!initialised.current) {
        initialised.current = true;
        // Defer until engine URL is available
        const tryInit = () => {
            const px = buildProxyUrl(DEFAULT_URL);
            if (px) {
                historyRef.current = [DEFAULT_URL];
                historyIdxRef.current = 0;
                setProxyUrl(px);
            } else {
                setTimeout(tryInit, 500);
            }
        };
        setTimeout(tryInit, 200);
    }

    const extractText = async () => {
        setExtracting(true);
        setExtractError(null);
        setExtractResult(null);
        try {
            const base = engine.engineUrl;
            if (!base) throw new Error("Engine not connected");
            const resp = await fetch(`${base}/fetch-proxy/extract`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: displayedUrl, include_html: false }),
            });
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(`${resp.status}: ${txt}`);
            }
            const data: ExtractResult = await resp.json();
            setExtractResult(data);
        } catch (e) {
            setExtractError(String(e));
        } finally {
            setExtracting(false);
        }
    };

    const copyText = () => {
        if (!extractResult) return;
        navigator.clipboard.writeText(extractResult.text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const canBack = historyIdxRef.current > 0;
    const canForward = historyIdxRef.current < historyRef.current.length - 1;

    return (
        <div className="flex h-full flex-col">
            {/* Toolbar */}
            <div className="flex items-center gap-1.5 border-b bg-background/80 backdrop-blur px-3 py-2 shrink-0">
                <button
                    onClick={goBack}
                    disabled={!canBack}
                    title="Back"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    onClick={goForward}
                    disabled={!canForward}
                    title="Forward"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
                <button
                    onClick={reload}
                    title="Reload"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                </button>

                {/* Badge */}
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                    FastAPI Proxy
                </span>

                <input
                    type="text"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="Enter URL and press Enter…"
                    className="flex-1 h-7 rounded-md border border-input bg-muted/50 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />

                {/* Extract text button */}
                <button
                    onClick={() => { setShowExtract(!showExtract); if (!showExtract && !extractResult) extractText(); }}
                    title="Extract page text for scraping"
                    className={`flex h-7 items-center gap-1.5 px-2 rounded text-xs font-medium transition-colors ${showExtract
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                >
                    <FileText className="h-3.5 w-3.5" />
                    {showExtract ? "Hide" : "Extract"}
                </button>

                <a
                    href={displayedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in system browser"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
            </div>

            {/* Main area — iframe + optional extract panel */}
            <div className="flex flex-1 overflow-hidden">
                {/* iframe */}
                <div className={`flex flex-col ${showExtract ? "flex-1" : "w-full"} overflow-hidden`}>
                    {!proxyUrl ? (
                        <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Waiting for engine…
                        </div>
                    ) : (
                        <iframe
                            key={iframeKey}
                            src={proxyUrl}
                            title="FastAPI Proxy Browser"
                            className="flex-1 w-full border-0"
                            allow="camera; microphone; clipboard-read; clipboard-write"
                        />
                    )}
                </div>

                {/* Extract panel */}
                {showExtract && (
                    <div className="w-96 flex flex-col border-l bg-muted/30 overflow-hidden shrink-0">
                        <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
                            <span className="text-xs font-semibold text-foreground">Extracted Text</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={extractText}
                                    disabled={extracting}
                                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                                    title="Re-extract"
                                >
                                    {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                </button>
                                {extractResult && (
                                    <button
                                        onClick={copyText}
                                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                        title="Copy text"
                                    >
                                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-3 text-xs">
                            {extractError && (
                                <div className="flex items-start gap-2 text-destructive">
                                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <span>{extractError}</span>
                                </div>
                            )}
                            {extractResult && (
                                <div className="space-y-2">
                                    <div className="space-y-0.5">
                                        <p className="font-medium text-foreground truncate">{extractResult.title || "(no title)"}</p>
                                        <p className="text-muted-foreground">{extractResult.byte_count.toLocaleString()} bytes · HTTP {extractResult.status_code}</p>
                                    </div>
                                    <hr className="border-border" />
                                    <pre className="whitespace-pre-wrap font-sans text-foreground/80 leading-relaxed break-words">
                                        {extractResult.text}
                                    </pre>
                                </div>
                            )}
                            {!extractResult && !extractError && extracting && (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Fetching page…
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
