/**
 * SetupWizard — First-run setup experience for Matrx Local.
 * 
 * Shows installation status, runs automatic setup (browser engine, storage dirs),
 * and offers optional configuration (transcription, preferences).
 *
 * Designed to be embedded in the Dashboard page. Shows automatically when setup
 * is incomplete, and can be re-opened via a "Setup" button when complete.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckCircle2, Circle, Loader2, AlertCircle, ChevronRight,
  Chrome, FolderOpen, Shield, Mic, Cpu, Sparkles, Settings2,
  Download, Play, RotateCcw, ChevronDown, ChevronUp, X,
  Terminal,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { engine } from "@/lib/api";
import type {
  SetupStatus, SetupComponentStatus, SetupProgressEvent,
} from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETUP_DISMISSED_KEY = "matrx-setup-dismissed";

const COMPONENT_ICONS: Record<string, React.ReactNode> = {
  core_packages: <Cpu className="h-5 w-5" />,
  browser_engine: <Chrome className="h-5 w-5" />,
  storage_dirs: <FolderOpen className="h-5 w-5" />,
  permissions: <Shield className="h-5 w-5" />,
  transcription: <Mic className="h-5 w-5" />,
};

const COMPONENT_ORDER = [
  "core_packages",
  "browser_engine",
  "storage_dirs",
  "permissions",
  "transcription",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardPhase = "checking" | "ready" | "installing" | "complete" | "configure";

interface ComponentProgress {
  status: string;
  message: string;
  percent: number;
}

interface LogEntry {
  time: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SetupWizardProps {
  engineStatus: EngineStatus;
  onSetupComplete?: () => void;
}

export function SetupWizard({ engineStatus, onSetupComplete }: SetupWizardProps) {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [phase, setPhase] = useState<WizardPhase>("checking");
  const [progress, setProgress] = useState<Record<string, ComponentProgress>>({});
  const [overallPercent, setOverallPercent] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [transcriptionProgress, setTranscriptionProgress] = useState<ComponentProgress | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(SETUP_DISMISSED_KEY) === "true";
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Logging helper ─────────────────────────────────────────────────────

  const addLog = useCallback((level: LogEntry["level"], message: string) => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev, { time, level, message }]);
  }, []);

  // Auto-scroll debug console
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Load setup status ──────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    if (engineStatus !== "connected") return;
    setPhase("checking");
    setStatusError(null);
    addLog("info", "Checking system setup status...");
    try {
      const status = await engine.getSetupStatus();
      setSetupStatus(status);

      addLog("info", `Platform: ${status.platform} ${status.architecture}`);
      if (status.gpu_available) addLog("info", `GPU detected: ${status.gpu_name}`);

      // Initialize progress from status
      const initial: Record<string, ComponentProgress> = {};
      for (const comp of status.components) {
        initial[comp.id] = {
          status: comp.status,
          message: comp.detail || "",
          percent: comp.status === "ready" ? 100 : 0,
        };
        addLog(
          comp.status === "ready" ? "success" : comp.status === "error" ? "error" : "warn",
          `${comp.label}: ${comp.status}${comp.detail ? ` — ${comp.detail}` : ""}`
        );
      }
      setProgress(initial);

      if (status.setup_complete) {
        setPhase("complete");
        addLog("success", "All core components are ready");
      } else {
        setPhase("ready");
        const notReady = status.components.filter((c) => !c.optional && c.status !== "ready");
        addLog("warn", `${notReady.length} component(s) need setup`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusError(msg);
      setPhase("ready");
      addLog("error", `Failed to check status: ${msg}`);
    }
  }, [engineStatus, addLog]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // ── Run setup installation ─────────────────────────────────────────────

  const runInstall = useCallback(async () => {
    setPhase("installing");
    setInstallError(null);
    setOverallPercent(0);
    addLog("info", "Starting setup installation...");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await engine.runSetupInstall({
        signal: controller.signal,
        onProgress: (data: SetupProgressEvent) => {
          setProgress((prev) => ({
            ...prev,
            [data.component]: {
              status: data.status,
              message: data.message,
              percent: data.percent,
            },
          }));

          // Log every progress event
          const level: LogEntry["level"] =
            data.status === "ready" ? "success" :
            data.status === "error" ? "error" : "info";
          addLog(level, `[${data.component}] ${data.message} (${data.percent}%)`);

          // Calculate overall progress
          if (data.component !== "_system") {
            setOverallPercent((prev) => {
              const components = setupStatus?.components.filter((c) => !c.optional) || [];
              const total = components.length;
              if (total === 0) return 0;
              const idx = components.findIndex((c) => c.id === data.component);
              if (idx < 0) return prev;
              const base = (idx / total) * 100;
              const contribution = (data.percent / 100) * (100 / total);
              return Math.min(Math.round(base + contribution), 99);
            });
          }
        },
        onComplete: () => {
          setOverallPercent(100);
          setPhase("complete");
          addLog("success", "Setup complete — all core systems ready");
          checkStatus().then(() => {
            onSetupComplete?.();
          });
        },
        onError: (error: string) => {
          setInstallError(error);
          setPhase("ready");
          addLog("error", `Setup failed: ${error}`);
        },
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        addLog("warn", "Setup cancelled by user");
        setPhase("ready");
      } else {
        const msg = (e as Error).message;
        setInstallError(msg);
        setPhase("ready");
        addLog("error", `Setup error: ${msg}`);
      }
    }
  }, [setupStatus, checkStatus, onSetupComplete, addLog]);

  const cancelInstall = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("ready");
    addLog("warn", "Setup cancelled");
  }, [addLog]);

  // ── Transcription install ──────────────────────────────────────────────

  const installTranscription = useCallback(async () => {
    setTranscriptionProgress({ status: "installing", message: "Starting download...", percent: 0 });
    addLog("info", "Starting transcription model download...");

    const controller = new AbortController();

    try {
      await engine.runTranscriptionInstall("base.en", {
        signal: controller.signal,
        onProgress: (data: SetupProgressEvent) => {
          setTranscriptionProgress({
            status: data.status,
            message: data.message,
            percent: data.percent,
          });
          setProgress((prev) => ({
            ...prev,
            transcription: {
              status: data.status,
              message: data.message,
              percent: data.percent,
            },
          }));
          addLog(data.status === "error" ? "error" : "info", `[transcription] ${data.message}`);
        },
        onComplete: () => {
          setTranscriptionProgress({ status: "ready", message: "Transcription engine ready", percent: 100 });
          setProgress((prev) => ({
            ...prev,
            transcription: { status: "ready", message: "Transcription engine ready", percent: 100 },
          }));
          addLog("success", "Transcription model installed successfully");
        },
        onError: (error: string) => {
          setTranscriptionProgress({ status: "error", message: error, percent: 0 });
          addLog("error", `Transcription install failed: ${error}`);
        },
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        const msg = (e as Error).message;
        setTranscriptionProgress({ status: "error", message: msg, percent: 0 });
        addLog("error", `Transcription error: ${msg}`);
      }
    }
  }, [addLog]);

  // ── Dismiss handler ────────────────────────────────────────────────────

  const dismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem(SETUP_DISMISSED_KEY, "true");
  }, []);

  const undismiss = useCallback(() => {
    setDismissed(false);
    localStorage.removeItem(SETUP_DISMISSED_KEY);
  }, []);

  // ── Don't render if engine not connected ───────────────────────────────

  if (engineStatus !== "connected") return null;

  // ── Collapsed state when setup is complete and dismissed ───────────────

  if (phase === "complete" && dismissed) {
    return (
      <button
        onClick={undismiss}
        className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 px-4 py-2 text-xs text-muted-foreground hover:bg-card hover:text-foreground transition-all"
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span>Setup & Configuration</span>
      </button>
    );
  }

  // ── Sorted components ──────────────────────────────────────────────────

  const sorted = [...(setupStatus?.components || [])].sort(
    (a, b) => COMPONENT_ORDER.indexOf(a.id) - COMPONENT_ORDER.indexOf(b.id)
  );
  const requiredComponents = sorted.filter((c) => !c.optional);
  const optionalComponents = sorted.filter((c) => c.optional);
  const allRequiredReady = requiredComponents.every(
    (c) => (progress[c.id]?.status || c.status) === "ready"
  );

  return (
    <Card className="relative overflow-hidden border-primary/20">
      {/* Gradient accent bar */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-violet-500 to-emerald-500" />

      <CardHeader className="pb-2 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-violet-500/20">
              {phase === "checking" ? (
                <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
              ) : (
                <Sparkles className="h-5 w-5 text-blue-400" />
              )}
            </div>
            <div>
              <CardTitle className="text-lg font-semibold">
                {phase === "complete" ? "Matrx Local is Ready" : "Welcome to Matrx Local"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {phase === "checking" && "Checking your system..."}
                {phase === "ready" && "Let's get everything set up for you"}
                {phase === "installing" && "Setting up your system — this only happens once"}
                {phase === "complete" && "All core systems are configured and operational"}
                {phase === "configure" && "Customize your setup"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => setShowDebug((v) => !v)}
              title="Toggle debug console"
            >
              <Terminal className={`h-4 w-4 ${showDebug ? "text-blue-400" : ""}`} />
            </Button>
            {phase === "complete" && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={dismiss} title="Dismiss">
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Overall progress bar during installation */}
        {phase === "installing" && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Setting up...</span>
              <span className="tabular-nums">{overallPercent}%</span>
            </div>
            <Progress value={overallPercent} className="h-2" />
          </div>
        )}

        {/* Action buttons when collapsed */}
        {phase === "ready" && !expanded && (
          <div className="mt-3">
            <Button size="sm" className="gap-1.5" onClick={runInstall}>
              <Play className="h-3.5 w-3.5" /> Set Up Now
            </Button>
          </div>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pb-5">
          {/* ── Loading/checking state ─────────────────────────── */}
          {phase === "checking" && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing your system...
            </div>
          )}

          {/* ── Status check error ─────────────────────────────── */}
          {statusError && phase === "ready" && !setupStatus && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Could not check setup status: {statusError}</span>
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                You can still try running setup, or click Re-check to try again.
              </p>
              <div className="flex gap-2 ml-6">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={checkStatus}>
                  <RotateCcw className="h-3.5 w-3.5" /> Re-check
                </Button>
                <Button size="sm" className="gap-1.5" onClick={runInstall}>
                  <Play className="h-3.5 w-3.5" /> Try Setup Anyway
                </Button>
              </div>
            </div>
          )}

          {/* ── Required components ────────────────────────────── */}
          {phase !== "checking" && requiredComponents.length > 0 && (
            <div className="space-y-1">
              {requiredComponents.map((comp) => (
                <ComponentRow
                  key={comp.id}
                  component={comp}
                  progress={progress[comp.id]}
                />
              ))}
            </div>
          )}

          {/* ── Action buttons ─────────────────────────────────── */}
          {phase === "ready" && setupStatus && (
            <div className="flex items-center gap-3 pt-1">
              <Button className="gap-2" onClick={runInstall}>
                <Download className="h-4 w-4" />
                {allRequiredReady ? "Verify Setup" : "Set Up Now"}
              </Button>
              {installError && (
                <div className="flex items-center gap-1.5 text-xs text-red-400 max-w-sm">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{installError}</span>
                </div>
              )}
            </div>
          )}

          {phase === "installing" && (
            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={cancelInstall}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <span className="text-xs text-muted-foreground">
                Please keep the app open while setup completes
              </span>
            </div>
          )}

          {phase === "complete" && (
            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={checkStatus}>
                <RotateCcw className="h-3.5 w-3.5" /> Re-check
              </Button>
            </div>
          )}

          {/* ── Optional: Transcription ───────────────────────── */}
          {(phase === "complete" || phase === "configure") && optionalComponents.length > 0 && (
            <div className="border-t border-border/50 pt-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-medium">Optional Enhancements</span>
              </div>

              {optionalComponents.map((comp) => {
                const p = progress[comp.id];
                const isTranscription = comp.id === "transcription";
                const isReady = (p?.status || comp.status) === "ready";
                const isInstalling = p?.status === "installing";
                const isError = (p?.status || comp.status) === "error";

                return (
                  <div key={comp.id} className="space-y-2">
                    <ComponentRow component={comp} progress={p} />
                    {isTranscription && !isReady && !isInstalling && (
                      <div className="ml-9 space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Enable local speech-to-text transcription.
                          {setupStatus?.gpu_available
                            ? ` GPU detected (${setupStatus.gpu_name}) — transcription will be fast.`
                            : " No GPU detected — transcription will use CPU (slower but functional)."}
                        </p>
                        <Button
                          size="sm" variant="outline" className="gap-1.5"
                          onClick={installTranscription}
                        >
                          <Download className="h-3.5 w-3.5" />
                          {isError ? "Retry" : "Install"} Transcription ({comp.size_hint || "~150 MB"})
                        </Button>
                      </div>
                    )}
                    {isTranscription && isInstalling && transcriptionProgress && (
                      <div className="ml-9 space-y-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{transcriptionProgress.message}</span>
                          <span className="tabular-nums">{transcriptionProgress.percent}%</span>
                        </div>
                        <Progress value={transcriptionProgress.percent} className="h-1.5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Debug Console ─────────────────────────────────── */}
          {showDebug && (
            <div className="border-t border-border/50 pt-3 mt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Terminal className="h-3.5 w-3.5" />
                  Setup Log ({logs.length} entries)
                </div>
                <Button
                  variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                  onClick={() => setLogs([])}
                >
                  Clear
                </Button>
              </div>
              <div className="rounded-md bg-black/40 border border-border/30 p-2 max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed">
                {logs.length === 0 && (
                  <div className="text-muted-foreground/50 py-2 text-center">No log entries yet</div>
                )}
                {logs.map((entry, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-muted-foreground/50 shrink-0 select-none">{entry.time}</span>
                    <span
                      className={
                        entry.level === "success" ? "text-emerald-400" :
                        entry.level === "error" ? "text-red-400" :
                        entry.level === "warn" ? "text-amber-400" :
                        "text-muted-foreground"
                      }
                    >
                      {entry.message}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* ── System info footer ────────────────────────────── */}
          {setupStatus && (
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground/60 pt-2 border-t border-border/30">
              <span>{setupStatus.platform} {setupStatus.architecture}</span>
              {setupStatus.gpu_available && (
                <span className="flex items-center gap-1">
                  <Cpu className="h-3 w-3" /> {setupStatus.gpu_name}
                </span>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ComponentRow — shows status for one setup component
// ---------------------------------------------------------------------------

function ComponentRow({
  component,
  progress: p,
}: {
  component: SetupComponentStatus;
  progress?: ComponentProgress;
}) {
  const effectiveStatus = p?.status || component.status;
  const effectiveMessage = p?.message || component.detail || "";
  const icon = COMPONENT_ICONS[component.id] || <Circle className="h-5 w-5" />;

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/30">
      {/* Status indicator */}
      <div className="shrink-0">
        {effectiveStatus === "ready" ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          </div>
        ) : effectiveStatus === "installing" ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
            <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
          </div>
        ) : effectiveStatus === "error" ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
            <AlertCircle className="h-5 w-5 text-red-400" />
          </div>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
            {icon}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{component.label}</span>
          {component.optional && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground border-muted-foreground/30">
              Optional
            </Badge>
          )}
          {component.size_hint && effectiveStatus !== "ready" && (
            <span className="text-[10px] text-muted-foreground">{component.size_hint}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {effectiveStatus === "installing" ? effectiveMessage : component.description}
        </p>
        {effectiveStatus === "ready" && effectiveMessage && (
          <p className="text-[11px] text-emerald-500/70 mt-0.5">{effectiveMessage}</p>
        )}
        {effectiveStatus === "error" && effectiveMessage && (
          <p className="text-[11px] text-red-400/70 mt-0.5">{effectiveMessage}</p>
        )}
      </div>

      {/* Progress bar for installing state */}
      {effectiveStatus === "installing" && p && (
        <div className="w-16 shrink-0">
          <Progress value={p.percent} className="h-1.5" />
        </div>
      )}

      {/* Status indicator icon */}
      <div className="shrink-0">
        {effectiveStatus === "ready" && (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        )}
        {effectiveStatus === "not_ready" && (
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
    </div>
  );
}
