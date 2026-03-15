/**
 * StartupScreen — Full-screen branded loading screen shown during:
 *   1. auth.loading (checking session from local storage)
 *   2. engineStatus "discovering" | "starting" (engine starting up)
 *
 * Shows a live checklist driven by [phase:X] prefixed stdout lines from the
 * Python engine, received via the sidecar-log Tauri event. Also has a
 * collapsible raw log section for debugging.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { isTauri } from "@/lib/sidecar";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { CheckCircle2, Circle, Loader2, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EngineStatus } from "@/hooks/use-engine";

// ---------------------------------------------------------------------------
// Phase definitions — order matters (displayed top-to-bottom)
// ---------------------------------------------------------------------------

interface PhaseStep {
  id: string;
  label: string;
  detail?: string;
  status: "pending" | "active" | "done" | "error";
}

const AUTH_PHASE: PhaseStep = {
  id: "auth",
  label: "Authenticating",
  detail: "Checking your session...",
  status: "pending",
};

const ENGINE_PHASES: PhaseStep[] = [
  { id: "starting",  label: "Starting engine",          detail: "Initializing binary...",      status: "pending" },
  { id: "port",      label: "Selecting port",           detail: "Finding available port...",   status: "pending" },
  { id: "server",    label: "Starting server",          detail: "Launching FastAPI server...", status: "pending" },
  { id: "database",  label: "Opening local database",   detail: "Connecting to SQLite...",     status: "pending" },
  { id: "browsers",  label: "Checking browser engine",  detail: "Verifying Playwright...",     status: "pending" },
  { id: "ai",        label: "Initializing AI engine",   detail: "Loading AI configuration...", status: "pending" },
  { id: "tools",     label: "Loading tool registry",    detail: "Registering 79+ tools...",    status: "pending" },
  { id: "scraper",   label: "Starting scraper",         detail: "Launching browser engine...", status: "pending" },
  { id: "proxy",     label: "Starting HTTP proxy",      detail: "Binding local proxy...",      status: "pending" },
  { id: "tunnel",    label: "Setting up tunnel",        detail: "Connecting Cloudflare...",    status: "pending" },
  { id: "ready",     label: "Engine ready",             detail: "Connecting...",               status: "pending" },
];

// Map [phase:X] prefix → step id
const PHASE_MAP: Record<string, string> = {
  starting: "starting",
  port:     "port",
  server:   "server",
  database: "database",
  browsers: "browsers",
  ai:       "ai",
  tools:    "tools",
  scraper:  "scraper",
  proxy:    "proxy",
  tunnel:   "tunnel",
  ready:    "ready",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StartupScreenProps {
  authLoading: boolean;
  engineStatus: EngineStatus;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StartupScreen({ authLoading, engineStatus }: StartupScreenProps) {
  const [steps, setSteps] = useState<PhaseStep[]>(() => [
    { ...AUTH_PHASE },
    ...ENGINE_PHASES.map((p) => ({ ...p })),
  ]);
  const [rawLogs, setRawLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Mark auth step based on prop
  useEffect(() => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== "auth") return s;
        if (authLoading) return { ...s, status: "active" };
        return { ...s, status: "done", detail: "Session verified" };
      })
    );
  }, [authLoading]);

  // Mark "starting" as active once engine starts initializing
  useEffect(() => {
    if (engineStatus === "starting" || engineStatus === "discovering") {
      setSteps((prev) =>
        prev.map((s) => {
          if (s.id === "starting" && s.status === "pending") {
            return { ...s, status: "active" };
          }
          return s;
        })
      );
    }
  }, [engineStatus]);

  // Subscribe to sidecar-log Tauri events
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<string>("sidecar-log", (event) => {
          if (cancelled) return;
          const line = typeof event.payload === "string" ? event.payload : String(event.payload);
          setRawLogs((prev) => [...prev.slice(-499), line]);

          // Parse [phase:X] prefix
          const match = line.match(/\[phase:([^\]]+)\]/);
          if (!match) return;
          const phaseKey = match[1].toLowerCase();
          const stepId = PHASE_MAP[phaseKey];
          if (!stepId) return;

          // Extract detail message (text after the prefix tag)
          const detail = line.replace(/^\[[^\]]+\]\s*/, "").trim() || undefined;
          const isError = line.toLowerCase().includes("failed") || line.toLowerCase().includes("error");

          setSteps((prev) => {
            const idx = prev.findIndex((s) => s.id === stepId);
            if (idx === -1) return prev;

            const next = prev.map((s, i) => {
              if (i < idx && s.status === "active") {
                return { ...s, status: "done" as const };
              }
              if (i === idx) {
                if (isError) return { ...s, status: "error" as const, detail: detail ?? s.detail };
                // If we already got a "done" signal (contains "ready" or "complete"), mark done
                const isDone =
                  line.toLowerCase().includes("ready") ||
                  line.toLowerCase().includes("complete") ||
                  line.toLowerCase().includes("started") ||
                  line.toLowerCase().includes("loaded") ||
                  line.toLowerCase().includes("initialized");
                return {
                  ...s,
                  status: isDone ? ("done" as const) : ("active" as const),
                  detail: detail ?? s.detail,
                };
              }
              return s;
            });
            return next;
          });
        });
        unlistenRef.current = unlisten;
      } catch {
        // Not in Tauri or listen unavailable
      }
    })();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  // Auto-scroll raw logs
  useEffect(() => {
    if (logsOpen && logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [rawLogs, logsOpen]);

  // Mark "ready" step as done when engine connects
  useEffect(() => {
    if (engineStatus === "connected") {
      setSteps((prev) =>
        prev.map((s) => ({
          ...s,
          status: s.status === "pending" || s.status === "active" ? "done" : s.status,
        }))
      );
    }
  }, [engineStatus]);

  const copyLogs = useCallback(async () => {
    if (rawLogs.length === 0) return;
    const text = `=== Matrx Startup Log — ${new Date().toLocaleString()} ===\n${rawLogs.join("\n")}\n=== END ===`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [rawLogs]);

  // Determine current label for the animated subtitle
  const activeStep = steps.find((s) => s.status === "active");
  const subtitle = activeStep?.detail ?? activeStep?.label ?? "Starting up...";

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-background px-6">
      {/* Branding */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <span className="text-3xl font-bold text-primary">M</span>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Matrx Local</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI-powered local engine</p>
        </div>
      </div>

      {/* Step checklist */}
      <div className="w-full max-w-sm space-y-2">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </div>

      {/* Animated subtitle */}
      <p className="mt-6 text-sm text-muted-foreground animate-pulse">{subtitle}</p>

      {/* Raw log toggle */}
      <div className="mt-8 w-full max-w-sm">
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-950/60">
          <button
            onClick={() => setLogsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <span>Show startup logs</span>
            <div className="flex items-center gap-2">
              {rawLogs.length > 0 && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {rawLogs.length}
                </span>
              )}
              {logsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </div>
          </button>
          {logsOpen && (
            <div className="border-t border-zinc-700/50">
              <div className="flex justify-end px-2 py-1 border-b border-zinc-800/60">
                <button
                  onClick={copyLogs}
                  disabled={rawLogs.length === 0}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-40"
                  title="Copy logs to clipboard"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div
                ref={logScrollRef}
                className="max-h-48 overflow-y-auto p-2 font-mono text-[10px] leading-relaxed text-zinc-500 space-y-0.5"
              >
                {rawLogs.length === 0 ? (
                  <p className="text-center text-zinc-700">No logs yet</p>
                ) : (
                  rawLogs.map((line, i) => (
                    <div key={i} className={cn(
                      "break-all whitespace-pre-wrap",
                      line.includes("FAILED") || line.includes("ERROR") ? "text-red-400" :
                      line.includes("ready") || line.includes("✓") ? "text-emerald-400" :
                      "text-zinc-500"
                    )}>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepRow sub-component
// ---------------------------------------------------------------------------

function StepRow({ step }: { step: PhaseStep }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="flex-shrink-0">
        {step.status === "done" && (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        )}
        {step.status === "active" && (
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
        )}
        {step.status === "error" && (
          <CheckCircle2 className="h-4 w-4 text-red-500" />
        )}
        {step.status === "pending" && (
          <Circle className="h-4 w-4 text-zinc-600" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span className={cn(
          "text-sm",
          step.status === "done"    ? "text-foreground" :
          step.status === "active"  ? "text-foreground font-medium" :
          step.status === "error"   ? "text-red-400" :
          "text-muted-foreground"
        )}>
          {step.label}
        </span>
        {step.status === "active" && step.detail && (
          <p className="text-[11px] text-muted-foreground truncate">{step.detail}</p>
        )}
        {step.status === "error" && step.detail && (
          <p className="text-[11px] text-red-400 truncate">{step.detail}</p>
        )}
      </div>
    </div>
  );
}
