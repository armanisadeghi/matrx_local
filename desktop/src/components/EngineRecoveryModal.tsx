/**
 * EngineRecoveryModal — shown when the engine fails to connect after auth.
 *
 * Provides step-by-step diagnostics, real action buttons that actually
 * control the sidecar, and a live log console the user can copy/paste
 * to support.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw,
  Play,
  RotateCcw,
  Square,
  Copy,
  CheckCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  AlertTriangle,
  Terminal,
  Cpu,
} from "lucide-react";
import {
  isTauri,
  startSidecar,
  stopSidecar,
  getSidecarStatus,
  waitForEngine,
  discoverEnginePort,
} from "@/lib/sidecar";
import type { EngineStatus } from "@/hooks/use-engine";

type StepStatus = "pending" | "running" | "pass" | "fail" | "skip";

interface DiagnosticStep {
  label: string;
  status: StepStatus;
  detail?: string;
}

interface EngineRecoveryModalProps {
  open: boolean;
  engineStatus: EngineStatus;
  engineError: string | null;
  onRestartEngine: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function EngineRecoveryModal({
  open,
  engineStatus,
  engineError,
  onRestartEngine,
  onRefresh,
}: EngineRecoveryModalProps) {
  const [steps, setSteps] = useState<DiagnosticStep[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [actionRunning, setActionRunning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-200), `[${ts}] ${line}`]);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Run diagnostics automatically when modal opens
  useEffect(() => {
    if (open) {
      runDiagnostics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateStep = (index: number, patch: Partial<DiagnosticStep>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  };

  const runDiagnostics = async () => {
    const initialSteps: DiagnosticStep[] = [
      { label: "Check if running in Tauri (desktop)", status: "pending" },
      { label: "Query sidecar process status", status: "pending" },
      { label: "Scan port range 22140–22159", status: "pending" },
      { label: "Test engine health endpoint", status: "pending" },
    ];
    setSteps(initialSteps);
    addLog("Starting engine diagnostics...");

    // Step 1: Tauri check
    updateStep(0, { status: "running" });
    const inTauri = isTauri();
    updateStep(0, {
      status: "pass",
      detail: inTauri
        ? "Running inside Tauri desktop app"
        : "Running in browser (dev mode) — sidecar management unavailable",
    });
    addLog(`Environment: ${inTauri ? "Tauri desktop" : "Browser dev mode"}`);

    // Step 2: Sidecar status
    updateStep(1, { status: "running" });
    if (inTauri) {
      const sidecarInfo = await getSidecarStatus();
      if (sidecarInfo) {
        updateStep(1, {
          status: sidecarInfo.running ? "pass" : "fail",
          detail: sidecarInfo.running
            ? `Sidecar process is running (port config: ${sidecarInfo.port})`
            : "Sidecar process is NOT running",
        });
        addLog(
          sidecarInfo.running
            ? `Sidecar running, configured port: ${sidecarInfo.port}`
            : "Sidecar is not running"
        );
      } else {
        updateStep(1, {
          status: "fail",
          detail: "Could not query sidecar status from Rust backend",
        });
        addLog("Failed to query sidecar status");
      }
    } else {
      updateStep(1, {
        status: "skip",
        detail: "Not applicable in browser dev mode — start the Python server manually",
      });
      addLog("Sidecar check skipped (not in Tauri)");
    }

    // Step 3: Port scan
    updateStep(2, { status: "running" });
    addLog("Scanning ports 22140–22159...");
    const engineUrl = await discoverEnginePort();
    if (engineUrl) {
      updateStep(2, {
        status: "pass",
        detail: `Engine found at ${engineUrl}`,
      });
      addLog(`Engine discovered at ${engineUrl}`);
    } else {
      updateStep(2, {
        status: "fail",
        detail: "No engine responded on any port in range 22140–22159",
      });
      addLog("Port scan: no engine found on any port");
    }

    // Step 4: Health check
    updateStep(3, { status: "running" });
    if (engineUrl) {
      try {
        const resp = await fetch(`${engineUrl}/tools/list`, {
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          const data = await resp.json();
          const toolCount = Array.isArray(data?.tools) ? data.tools.length : Array.isArray(data) ? data.length : "?";
          updateStep(3, {
            status: "pass",
            detail: `Health OK — ${toolCount} tools available`,
          });
          addLog(`Health check passed: ${toolCount} tools`);
        } else {
          updateStep(3, {
            status: "fail",
            detail: `Health endpoint returned HTTP ${resp.status}`,
          });
          addLog(`Health check failed: HTTP ${resp.status}`);
        }
      } catch (err) {
        updateStep(3, {
          status: "fail",
          detail: `Health check error: ${err}`,
        });
        addLog(`Health check error: ${err}`);
      }
    } else {
      updateStep(3, {
        status: "skip",
        detail: "Skipped — no engine found in port scan",
      });
      addLog("Health check skipped (no engine found)");
    }

    addLog("Diagnostics complete.");
  };

  const handleStartEngine = async () => {
    setActionRunning("start");
    addLog("Starting engine sidecar...");
    try {
      await startSidecar();
      addLog("Sidecar process spawned. Waiting for engine to become ready...");

      // Wait for it to be reachable
      const ready = await waitForEngine("http://127.0.0.1:22140", 60, 1000);
      if (ready) {
        addLog("Engine is ready! Reconnecting...");
        await onRefresh();
        addLog("Connected successfully.");
      } else {
        // Try full port range
        const altUrl = await discoverEnginePort();
        if (altUrl) {
          addLog(`Engine found at ${altUrl}. Reconnecting...`);
          await onRefresh();
          addLog("Connected successfully.");
        } else {
          addLog("ERROR: Engine started but never became reachable after 60s.");
        }
      }
    } catch (err) {
      addLog(`ERROR starting engine: ${err}`);
    } finally {
      setActionRunning(null);
      await runDiagnostics();
    }
  };

  const handleRestartEngine = async () => {
    setActionRunning("restart");
    addLog("Restarting engine...");
    try {
      addLog("Stopping current sidecar...");
      await stopSidecar();
      addLog("Sidecar stopped. Waiting 1s for port release...");
      await new Promise((r) => setTimeout(r, 1000));
      addLog("Starting fresh sidecar...");
      await onRestartEngine();
      addLog("Restart complete.");
    } catch (err) {
      addLog(`ERROR during restart: ${err}`);
    } finally {
      setActionRunning(null);
      await runDiagnostics();
    }
  };

  const handleKillEngine = async () => {
    setActionRunning("kill");
    addLog("Killing sidecar process...");
    try {
      await stopSidecar();
      addLog("Sidecar killed successfully.");
    } catch (err) {
      addLog(`ERROR killing sidecar: ${err}`);
    } finally {
      setActionRunning(null);
      await runDiagnostics();
    }
  };

  const handleRetryConnection = async () => {
    setActionRunning("retry");
    addLog("Retrying engine connection...");
    try {
      await onRefresh();
      addLog("Connection retry complete.");
    } catch (err) {
      addLog(`ERROR retrying connection: ${err}`);
    } finally {
      setActionRunning(null);
      await runDiagnostics();
    }
  };

  const buildDiagnosticDump = (): string => {
    const lines = [
      "=== AI Matrx Engine Diagnostic Report ===",
      `Timestamp: ${new Date().toISOString()}`,
      `Engine Status: ${engineStatus}`,
      `Engine Error: ${engineError || "none"}`,
      `Environment: ${isTauri() ? "Tauri Desktop" : "Browser Dev Mode"}`,
      `User Agent: ${navigator.userAgent}`,
      "",
      "=== Diagnostic Steps ===",
      ...steps.map(
        (s) => `  [${s.status.toUpperCase()}] ${s.label}${s.detail ? ` — ${s.detail}` : ""}`
      ),
      "",
      "=== Recent Logs ===",
      ...logs.slice(-50),
      "",
      "=== End Report ===",
    ];
    return lines.join("\n");
  };

  const handleCopyDiagnostics = () => {
    navigator.clipboard.writeText(buildDiagnosticDump());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs.join("\n"));
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 2000);
  };

  const StepIcon = ({ status }: { status: StepStatus }) => {
    switch (status) {
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
      case "pass":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "fail":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "skip":
        return <Circle className="h-4 w-4 text-zinc-500" />;
      default:
        return <Circle className="h-4 w-4 text-zinc-600" />;
    }
  };

  const isInTauri = isTauri();
  const isRunningAction = actionRunning !== null;

  return (
    <Dialog open={open} onOpenChange={() => { /* controlled externally */ }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Engine Connection Issue
          </DialogTitle>
          <DialogDescription>
            The engine failed to start or cannot be reached. Use the tools below
            to diagnose and fix the problem.
          </DialogDescription>
        </DialogHeader>

        {/* Error banner */}
        {engineError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {engineError}
          </div>
        )}

        {/* Diagnostic Steps */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-primary" />
              Diagnostics
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={runDiagnostics}
              disabled={isRunningAction}
              className="h-7 px-2 text-xs"
            >
              <RefreshCw className="h-3 w-3" />
              Re-run
            </Button>
          </div>
          <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="mt-0.5">
                  <StepIcon status={step.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{step.label}</div>
                  {step.detail && (
                    <div className="text-xs text-muted-foreground mt-0.5 break-words">
                      {step.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            {isInTauri && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartEngine}
                  disabled={isRunningAction}
                >
                  {actionRunning === "start" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Start Engine
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestartEngine}
                  disabled={isRunningAction}
                >
                  {actionRunning === "restart" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Restart Engine
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleKillEngine}
                  disabled={isRunningAction}
                  className="text-red-400 hover:text-red-300"
                >
                  {actionRunning === "kill" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  Kill Engine
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetryConnection}
              disabled={isRunningAction}
            >
              {actionRunning === "retry" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Retry Connection
            </Button>
          </div>
          {!isInTauri && (
            <p className="text-xs text-muted-foreground">
              Start/Restart/Kill are only available in the desktop app.
              In dev mode, start the Python engine manually: <code className="text-xs">uv run python run.py</code>
            </p>
          )}
        </div>

        <Separator />

        {/* Log Console */}
        <div className="flex-1 min-h-0 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <Terminal className="h-4 w-4 text-primary" />
              Console
            </h3>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyLogs}
                className="h-7 px-2 text-xs"
              >
                {logsCopied ? (
                  <CheckCheck className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Copy Logs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyDiagnostics}
                className="h-7 px-2 text-xs"
              >
                {copied ? (
                  <CheckCheck className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Copy Full Report
              </Button>
            </div>
          </div>
          <ScrollArea className="h-40 rounded-lg border border-border/50 bg-zinc-950 p-3">
            <div className="font-mono text-xs text-zinc-400 space-y-0.5">
              {logs.length === 0 && (
                <div className="text-zinc-600 italic">No logs yet</div>
              )}
              {logs.map((line, i) => (
                <div key={i} className="break-words leading-relaxed">
                  {line}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Status badge */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Engine status:</span>
            <Badge
              variant={
                engineStatus === "connected"
                  ? "success"
                  : engineStatus === "error"
                  ? "destructive"
                  : "secondary"
              }
            >
              {engineStatus}
            </Badge>
          </div>
          {engineStatus === "connected" && (
            <span className="text-xs text-emerald-500">
              ✓ Connected — this dialog will close automatically
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
