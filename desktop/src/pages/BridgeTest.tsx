/**
 * Bridge Test — visual cockpit for the matrx-extend ↔ matrx-local bridge.
 *
 * Scope: drive every Phase 1+2 primitive from inside the desktop app
 * (no curl, no terminal). Five panels:
 *
 *   1. Engine self-check — health / version / capabilities via /extension/rpc
 *   2. Sessions          — live list of /extension/ws sessions with disconnect
 *   3. Invoke            — engine→browser dispatch via /extension/invoke
 *   4. Broadcast plumb   — feature-flag status + test publish
 *   5. Live event log    — fan-out from /extension/bridge-events WS
 *
 * All polling/WS hooks are gated on the page being mounted. The sessions
 * list polls every 2s; the live event log subscribes to a dedicated WS.
 *
 * Conventions followed (per CLAUDE.md):
 *   - actions wrapped in useMemo
 *   - useEffect deps name specific stable callbacks, never an "actions" object
 *   - polling intervals depend on narrow booleans, never broad objects
 *   - production-grade only — no stubs / placeholders
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  AlertCircle,
  Check,
  ChevronRight,
  Heart,
  ListTree,
  Pause,
  Play,
  Plug,
  Power,
  Radio,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  engine,
  type BridgeEvent,
  type ExtensionBroadcastStatus,
  type ExtensionInvokeResponse,
  type ExtensionRpcResponse,
  type ExtensionSessionInfo,
} from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface BridgeTestProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  user: SupabaseUser | null;
}

// Common browser tools the agent ships with — preset suggestions for the
// invoke panel. Not exhaustive; users can type any tool name.
const TOOL_PRESETS = [
  "take_screenshot",
  "read_page",
  "find",
  "get_active_tab",
  "list_open_tabs",
  "click_element",
  "type_into_element",
  "navigate_active_tab",
  "scroll_page",
  "ask_user",
];

const MAX_LOG_LINES = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(secsSinceEpoch: number): string {
  const ageSec = Math.max(0, Math.round(Date.now() / 1000 - secsSinceEpoch));
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ${ageSec % 60}s ago`;
  return `${Math.floor(ageSec / 3600)}h ago`;
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function levelClassFor(direction: BridgeEvent["direction"]): string {
  if (direction === "in") return "text-emerald-400";
  if (direction === "out") return "text-sky-400";
  return "text-zinc-400";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BridgeTest({
  engineStatus,
  engineUrl,
  user,
}: BridgeTestProps) {
  // Panel 1 — Engine self-check ---------------------------------------------
  const [healthResult, setHealthResult] = useState<ExtensionRpcResponse | null>(
    null,
  );
  const [versionResult, setVersionResult] =
    useState<ExtensionRpcResponse | null>(null);
  const [capsResult, setCapsResult] = useState<ExtensionRpcResponse | null>(
    null,
  );
  const [busyCmd, setBusyCmd] = useState<string | null>(null);

  // Panel 2 — Sessions -------------------------------------------------------
  const [sessions, setSessions] = useState<ExtensionSessionInfo[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [autoRefreshSessions, setAutoRefreshSessions] = useState(true);

  // Panel 3 — Invoke ---------------------------------------------------------
  const [invokeSessionId, setInvokeSessionId] = useState<string>("");
  const [invokeToolName, setInvokeToolName] = useState("take_screenshot");
  const [invokeArgs, setInvokeArgs] = useState("{}");
  const [invokeTimeout, setInvokeTimeout] = useState(30);
  const [invokeBusy, setInvokeBusy] = useState(false);
  const [invokeResult, setInvokeResult] =
    useState<ExtensionInvokeResponse | null>(null);
  const [invokeArgsError, setInvokeArgsError] = useState<string | null>(null);

  // Panel 4 — Broadcast plumb -----------------------------------------------
  const [broadcastStatus, setBroadcastStatus] =
    useState<ExtensionBroadcastStatus | null>(null);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{
    ok: boolean;
    sent: boolean;
    enabled: boolean;
    timestamp: number;
  } | null>(null);

  // Panel 5 — Live event log -------------------------------------------------
  const [logEvents, setLogEvents] = useState<BridgeEvent[]>([]);
  const [logPaused, setLogPaused] = useState(false);
  const [logConnected, setLogConnected] = useState(false);
  const logPausedRef = useRef(logPaused);
  logPausedRef.current = logPaused;

  const isEngineReady = engineStatus === "connected" && engineUrl !== null;

  // -------------------------------------------------------------------------
  // Stable callbacks (each defined once with useCallback so the actions
  // memo and effect deps stay narrow).
  // -------------------------------------------------------------------------

  const runHealth = useCallback(async () => {
    if (!isEngineReady) return;
    setBusyCmd("health");
    try {
      setHealthResult(await engine.extensionRpc("health"));
    } catch (e) {
      setHealthResult({ ok: false, error: String(e) });
    } finally {
      setBusyCmd(null);
    }
  }, [isEngineReady]);

  const runVersion = useCallback(async () => {
    if (!isEngineReady) return;
    setBusyCmd("version");
    try {
      setVersionResult(await engine.extensionRpc("version"));
    } catch (e) {
      setVersionResult({ ok: false, error: String(e) });
    } finally {
      setBusyCmd(null);
    }
  }, [isEngineReady]);

  const runCapabilities = useCallback(async () => {
    if (!isEngineReady) return;
    setBusyCmd("capabilities");
    try {
      setCapsResult(await engine.extensionRpc("capabilities"));
    } catch (e) {
      setCapsResult({ ok: false, error: String(e) });
    } finally {
      setBusyCmd(null);
    }
  }, [isEngineReady]);

  const refreshSessions = useCallback(async () => {
    if (!isEngineReady) return;
    try {
      const res = await engine.extensionListSessions();
      setSessions(res.sessions);
      setSessionsError(null);
    } catch (e) {
      setSessionsError(String(e));
    }
  }, [isEngineReady]);

  const disconnectSession = useCallback(
    async (sessionId: string) => {
      if (!isEngineReady) return;
      try {
        await engine.extensionDisconnectSession(
          sessionId,
          "Closed from Bridge Test panel",
        );
        await refreshSessions();
      } catch (e) {
        setSessionsError(String(e));
      }
    },
    [isEngineReady, refreshSessions],
  );

  const runInvoke = useCallback(async () => {
    if (!isEngineReady) return;
    if (!invokeSessionId) {
      setInvokeResult({ ok: false, error: "Select a session first" });
      return;
    }
    if (!invokeToolName.trim()) {
      setInvokeResult({ ok: false, error: "Tool name is required" });
      return;
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = invokeArgs.trim() ? JSON.parse(invokeArgs) : {};
      setInvokeArgsError(null);
    } catch (e) {
      setInvokeArgsError(`Args is not valid JSON: ${e}`);
      return;
    }
    setInvokeBusy(true);
    setInvokeResult(null);
    try {
      const res = await engine.extensionInvoke(
        invokeSessionId,
        invokeToolName.trim(),
        parsed,
        invokeTimeout,
      );
      setInvokeResult(res);
    } catch (e) {
      setInvokeResult({ ok: false, error: String(e) });
    } finally {
      setInvokeBusy(false);
    }
  }, [
    isEngineReady,
    invokeSessionId,
    invokeToolName,
    invokeArgs,
    invokeTimeout,
  ]);

  const refreshBroadcastStatus = useCallback(async () => {
    if (!isEngineReady) return;
    try {
      setBroadcastStatus(await engine.extensionBroadcastStatus());
    } catch {
      /* non-critical — UI shows "unknown" */
    }
  }, [isEngineReady]);

  const sendBroadcastTest = useCallback(async () => {
    if (!isEngineReady) return;
    if (!user?.id) return;
    setBroadcastBusy(true);
    try {
      const res = await engine.extensionBroadcastTest(user.id, "bridge.test", {
        from: "desktop-bridge-test-panel",
        timestamp: Date.now(),
      });
      setBroadcastResult({ ...res, timestamp: Date.now() });
    } catch (e) {
      setBroadcastResult({
        ok: false,
        sent: false,
        enabled: false,
        timestamp: Date.now(),
      });
      setSessionsError(String(e));
    } finally {
      setBroadcastBusy(false);
    }
  }, [isEngineReady, user?.id]);

  const clearLog = useCallback(() => {
    setLogEvents([]);
  }, []);

  // -------------------------------------------------------------------------
  // Effects — narrow deps, no broad "actions" objects
  // -------------------------------------------------------------------------

  // Initial loads when engine becomes ready
  useEffect(() => {
    if (!isEngineReady) return;
    void refreshSessions();
    void refreshBroadcastStatus();
  }, [isEngineReady, refreshSessions, refreshBroadcastStatus]);

  // Sessions auto-refresh — gated on the narrow boolean, not actions
  useEffect(() => {
    if (!isEngineReady || !autoRefreshSessions) return;
    const id = setInterval(() => void refreshSessions(), 2000);
    return () => clearInterval(id);
  }, [isEngineReady, autoRefreshSessions, refreshSessions]);

  // Default the invoke session dropdown to the first available session
  // whenever the list changes and the current selection is no longer valid.
  useEffect(() => {
    if (sessions.length === 0) {
      if (invokeSessionId) setInvokeSessionId("");
      return;
    }
    const stillValid = sessions.some((s) => s.session_id === invokeSessionId);
    if (!stillValid) {
      setInvokeSessionId(sessions[0].session_id);
    }
  }, [sessions, invokeSessionId]);

  // Live event log subscription
  useEffect(() => {
    if (!isEngineReady) return;
    let teardown: (() => void) | null = null;
    try {
      teardown = engine.subscribeBridgeEvents(
        (event) => {
          if (logPausedRef.current) return;
          setLogEvents((prev) => {
            const next = [...prev, event];
            if (next.length > MAX_LOG_LINES) {
              return next.slice(next.length - MAX_LOG_LINES);
            }
            return next;
          });
        },
        () => setLogConnected(false),
      );
      setLogConnected(true);
    } catch {
      setLogConnected(false);
    }
    return () => {
      try {
        teardown?.();
      } catch {
        /* ignore */
      }
      setLogConnected(false);
    };
  }, [isEngineReady]);

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const capabilityCount = useMemo(() => {
    if (!capsResult?.ok) return null;
    const data = capsResult.data as { tools?: unknown[] } | undefined;
    return Array.isArray(data?.tools) ? data!.tools!.length : null;
  }, [capsResult]);

  const capabilityToolNames = useMemo(() => {
    if (!capsResult?.ok) return [] as string[];
    const data = capsResult.data as
      | { tools?: Array<{ name?: string }> }
      | undefined;
    return Array.isArray(data?.tools)
      ? data!.tools!.map((t) => t.name ?? "<unnamed>")
      : [];
  }, [capsResult]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Bridge Test"
        description="Drive the matrx-extend ↔ matrx-local bridge from inside the desktop app."
      >
        {!isEngineReady && (
          <Badge variant="destructive" className="text-xs">
            Engine not connected
          </Badge>
        )}
        {isEngineReady && (
          <Badge variant="secondary" className="text-xs">
            {engineUrl}
          </Badge>
        )}
      </PageHeader>

      <ScrollArea className="flex-1">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
          {/* Panel 1 — Engine self-check ------------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Heart className="h-4 w-4 text-rose-400" />
                Engine self-check
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Resolved engine port:</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {engineUrl ?? "(not discovered)"}
                </code>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isEngineReady || busyCmd === "health"}
                  onClick={runHealth}
                >
                  {busyCmd === "health" ? (
                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Heart className="mr-2 h-3.5 w-3.5" />
                  )}
                  Health
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isEngineReady || busyCmd === "version"}
                  onClick={runVersion}
                >
                  {busyCmd === "version" ? (
                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ChevronRight className="mr-2 h-3.5 w-3.5" />
                  )}
                  Version
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isEngineReady || busyCmd === "capabilities"}
                  onClick={runCapabilities}
                >
                  {busyCmd === "capabilities" ? (
                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ListTree className="mr-2 h-3.5 w-3.5" />
                  )}
                  Capabilities
                </Button>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <RpcResultCard label="Health" result={healthResult} />
                <RpcResultCard label="Version" result={versionResult} />
                <CapabilitiesCard
                  result={capsResult}
                  count={capabilityCount}
                  names={capabilityToolNames}
                />
              </div>
            </CardContent>
          </Card>

          {/* Panel 2 — Sessions --------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Plug className="h-4 w-4 text-emerald-400" />
                Extension sessions
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {sessions.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={autoRefreshSessions}
                    onCheckedChange={setAutoRefreshSessions}
                    id="auto-refresh-sessions"
                  />
                  <Label
                    htmlFor="auto-refresh-sessions"
                    className="text-xs text-muted-foreground"
                  >
                    Auto-refresh every 2s
                  </Label>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!isEngineReady}
                  onClick={refreshSessions}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Refresh now
                </Button>
              </div>

              {sessionsError && (
                <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {sessionsError}
                </div>
              )}

              {sessions.length === 0 ? (
                <div className="rounded border border-dashed border-muted-foreground/30 px-3 py-6 text-center text-xs text-muted-foreground">
                  No extension sessions. Load the matrx-extend Chrome
                  extension and confirm it is reaching this engine.
                </div>
              ) : (
                <div className="overflow-hidden rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          Session ID
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Connected
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Last ping
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Pending
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr
                          key={s.session_id}
                          className="border-t hover:bg-muted/30"
                        >
                          <td
                            className="px-3 py-2 font-mono"
                            title={s.session_id}
                          >
                            {shortId(s.session_id)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatRelative(s.connected_at)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatRelative(s.last_seen_at)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {s.pending_calls}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => disconnectSession(s.session_id)}
                            >
                              <Power className="mr-1 h-3 w-3" />
                              Disconnect
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Panel 3 — Invoke ----------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Send className="h-4 w-4 text-sky-400" />
                Invoke extension tool
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Target session</Label>
                  <Select
                    value={invokeSessionId || undefined}
                    onValueChange={setInvokeSessionId}
                    disabled={sessions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          sessions.length === 0
                            ? "No sessions connected"
                            : "Select a session"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {sessions.map((s) => (
                        <SelectItem
                          key={s.session_id}
                          value={s.session_id}
                          className="font-mono"
                        >
                          {shortId(s.session_id)} ·{" "}
                          {formatRelative(s.connected_at)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Tool name</Label>
                  <Input
                    value={invokeToolName}
                    onChange={(e) => setInvokeToolName(e.target.value)}
                    placeholder="take_screenshot"
                    className="font-mono"
                    list="tool-presets"
                  />
                  <datalist id="tool-presets">
                    {TOOL_PRESETS.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Args (JSON)</Label>
                <Textarea
                  value={invokeArgs}
                  onChange={(e) => setInvokeArgs(e.target.value)}
                  rows={5}
                  className="font-mono text-xs"
                  placeholder="{}"
                />
                {invokeArgsError && (
                  <p className="text-xs text-red-400">{invokeArgsError}</p>
                )}
              </div>

              <div className="flex items-end justify-between gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Timeout (s)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={invokeTimeout}
                    onChange={(e) =>
                      setInvokeTimeout(Number(e.target.value) || 30)
                    }
                    className="w-24"
                  />
                </div>
                <Button
                  disabled={!isEngineReady || invokeBusy || !invokeSessionId}
                  onClick={runInvoke}
                >
                  {invokeBusy ? (
                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-3.5 w-3.5" />
                  )}
                  Invoke
                </Button>
              </div>

              {invokeResult && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    {invokeResult.ok ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-red-400" />
                    )}
                    <span className="text-muted-foreground">
                      Engine RPC {invokeResult.ok ? "succeeded" : "failed"}
                    </span>
                  </div>
                  <pre className="max-h-96 overflow-auto rounded border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                    {formatJson(invokeResult)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Panel 4 — Broadcast plumb -------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Radio className="h-4 w-4 text-amber-400" />
                Broadcast plumb
                {broadcastStatus?.enabled ? (
                  <Badge variant="default" className="text-[10px]">
                    enabled
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    disabled
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Env flag:</span>{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                    {broadcastStatus?.env_var ??
                      "MATRX_BRIDGE_BROADCAST_ENABLED"}
                  </code>
                </div>
                <div>
                  <span className="text-muted-foreground">Channel:</span>{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                    {user?.id
                      ? `matrx-local-bridge:${user.id}`
                      : (broadcastStatus?.channel_template ??
                        "matrx-local-bridge:<user_id>")}
                  </code>
                </div>
              </div>

              {!broadcastStatus?.enabled && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">
                  Broadcast plumb is OFF. Set{" "}
                  <code className="font-mono">
                    MATRX_BRIDGE_BROADCAST_ENABLED=true
                  </code>{" "}
                  in the engine env and restart to enable cross-machine fallback.
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !isEngineReady ||
                    !broadcastStatus?.enabled ||
                    broadcastBusy ||
                    !user?.id
                  }
                  onClick={sendBroadcastTest}
                >
                  {broadcastBusy ? (
                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-3.5 w-3.5" />
                  )}
                  Test publish
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!isEngineReady}
                  onClick={refreshBroadcastStatus}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Refresh status
                </Button>
              </div>

              {broadcastResult && (
                <div className="rounded border bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    {broadcastResult.sent ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-amber-400" />
                    )}
                    <span>
                      {broadcastResult.sent
                        ? "Publish sent successfully"
                        : broadcastResult.enabled
                          ? "Publish skipped — user channel not connected"
                          : "Publish skipped — feature flag is off"}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Panel 5 — Live event log --------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ActivityIcon className="h-4 w-4 text-cyan-400" />
                Live event log
                {logConnected ? (
                  <Badge variant="default" className="text-[10px]">
                    streaming
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    offline
                  </Badge>
                )}
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {logEvents.length} / {MAX_LOG_LINES}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">
                  RPC, WebSocket, invoke, and broadcast events. Newest at the
                  bottom.
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLogPaused((p) => !p)}
                  >
                    {logPaused ? (
                      <>
                        <Play className="mr-1.5 h-3 w-3" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="mr-1.5 h-3 w-3" />
                        Pause
                      </>
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearLog}>
                    <Trash2 className="mr-1.5 h-3 w-3" />
                    Clear
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="h-72 overflow-auto rounded border bg-zinc-950/50 p-2 font-mono text-[11px]">
                {logEvents.length === 0 ? (
                  <div className="px-2 py-6 text-center text-muted-foreground">
                    No events yet. Trigger an action above to see live
                    bridge traffic.
                  </div>
                ) : (
                  logEvents.map((evt, idx) => (
                    <div
                      key={`${evt.timestamp}-${idx}`}
                      className={cn(
                        "flex items-start gap-2 border-b border-white/5 px-1 py-0.5",
                      )}
                    >
                      <span className="shrink-0 text-zinc-500">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 w-12 text-center uppercase",
                          levelClassFor(evt.direction),
                        )}
                      >
                        {evt.direction}
                      </span>
                      <span className="shrink-0 w-44 truncate text-zinc-300">
                        {evt.kind}
                      </span>
                      <span
                        className="flex-1 truncate text-zinc-400"
                        title={formatJson(evt.payload)}
                      >
                        {formatJson(evt.payload)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — kept private to this file; not reused elsewhere.
// ---------------------------------------------------------------------------

function RpcResultCard({
  label,
  result,
}: {
  label: string;
  result: ExtensionRpcResponse | null;
}) {
  return (
    <div className="rounded border bg-muted/30 p-2 text-xs">
      <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
        <span className="font-medium">{label}</span>
        {result &&
          (result.ok ? (
            <Check className="h-3 w-3 text-emerald-400" />
          ) : (
            <X className="h-3 w-3 text-red-400" />
          ))}
      </div>
      {result ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]">
          {formatJson(result.data ?? result.error ?? result)}
        </pre>
      ) : (
        <div className="text-muted-foreground">Not run yet.</div>
      )}
    </div>
  );
}

function CapabilitiesCard({
  result,
  count,
  names,
}: {
  result: ExtensionRpcResponse | null;
  count: number | null;
  names: string[];
}) {
  if (!result) {
    return (
      <div className="rounded border bg-muted/30 p-2 text-xs">
        <div className="mb-1 font-medium text-muted-foreground">
          Capabilities
        </div>
        <div className="text-muted-foreground">Not run yet.</div>
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="rounded border bg-muted/30 p-2 text-xs">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">
            Capabilities
          </span>
          <X className="h-3 w-3 text-red-400" />
        </div>
        <pre className="overflow-auto font-mono text-[10px]">
          {formatJson(result.error ?? result)}
        </pre>
      </div>
    );
  }
  return (
    <div className="rounded border bg-muted/30 p-2 text-xs">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="font-medium text-muted-foreground">Capabilities</span>
        <Check className="h-3 w-3 text-emerald-400" />
        <Badge variant="outline" className="ml-auto text-[10px]">
          {count ?? "?"} tools
        </Badge>
      </div>
      <ScrollArea className="h-40 pr-2">
        <ul className="space-y-0.5 font-mono text-[10px] text-zinc-300">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
