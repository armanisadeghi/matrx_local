import { useState, useEffect, useCallback, useRef } from "react";
import { engine, type SystemInfo, type BrowserStatus } from "@/lib/api";
import { isTauri, startSidecar, stopSidecar, waitForEngine, discoverEnginePort } from "@/lib/sidecar";
import { syncAllSettings } from "@/lib/settings";
import supabase from "@/lib/supabase";

export type EngineStatus = "discovering" | "starting" | "connected" | "disconnected" | "error";

interface EngineState {
  status: EngineStatus;
  url: string | null;
  tools: string[];
  systemInfo: SystemInfo | null;
  browserStatus: BrowserStatus | null;
  engineVersion: string;
  error: string | null;
  wsConnected: boolean;
}

export function useEngine(authenticated = true) {
  const [state, setState] = useState<EngineState>({
    status: "discovering",
    url: null,
    tools: [],
    systemInfo: null,
    browserStatus: null,
    engineVersion: "",
    error: null,
    wsConnected: false,
  });

  const mountedRef = useRef(true);
  // Prevents concurrent duplicate runs — but does NOT prevent future retries
  // like the old initRef did.
  const initializingRef = useRef(false);
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  // Timestamp when the engine was first discovered. Used to suppress false
  // "disconnected" flips during the engine's slow startup phase (~60s).
  const connectedAtRef = useRef<number | null>(null);

  const update = useCallback((partial: Partial<EngineState>) => {
    if (mountedRef.current) {
      setState((prev) => ({ ...prev, ...partial }));
    }
  }, []);

  /**
   * Core engine initialization.
   *
   * Key changes from the previous implementation:
   * 1. Uses a "currently running" mutex instead of a one-shot flag —
   *    subsequent calls are allowed once the prior one finishes.
   * 2. After startSidecar(), waits up to 60s for the engine health
   *    endpoint before running port discovery.
   * 3. On failure, sets status to "error" (not "disconnected") so the
   *    recovery modal activates.
   */
  const initialize = useCallback(async () => {
    // Already running — skip this call (will be retried later)
    if (initializingRef.current) return;
    initializingRef.current = true;

    try {
      update({ status: "discovering", error: null });

      // In Tauri, start the sidecar first
      if (isTauri()) {
        update({ status: "starting" });
        try {
          await startSidecar();
        } catch (err) {
          update({
            status: "error",
            error: `Failed to start engine: ${err}`,
          });
          return;
        }

        // ── KEY FIX: Wait for the sidecar to actually be ready ──────
        // startSidecar() returns as soon as the process is spawned.
        // The PyInstaller binary takes 5-30s to boot and bind a port.
        // We poll the default port (and the range) until it responds.
        const ready = await waitForEngine("http://127.0.0.1:22140", 60, 1000);
        if (!ready) {
          // Try the full port range in case it bound to a different port
          const altUrl = await discoverEnginePort();
          if (!altUrl) {
            update({
              status: "error",
              error: "Engine process started but never became reachable. The sidecar may have crashed during startup.",
            });
            return;
          }
        }
      }

      // Discover the engine (port scan)
      const url = await engine.discover();
      if (!url) {
        update({
          status: "error",
          error: "Engine not found on any port (22140-22159). Make sure the Python server is running.",
        });
        return;
      }

      connectedAtRef.current = Date.now();
      update({ url, status: "connected", error: null });

      // Load tools list
      try {
        const tools = await engine.listTools();
        update({ tools });
      } catch {
        // Non-critical
      }

      // Load engine version
      try {
        const engineVersion = await engine.getVersion();
        update({ engineVersion });
      } catch { /* non-critical */ }

      // Load system info
      try {
        const systemInfo = await engine.getSystemInfo();
        update({ systemInfo });
      } catch {
        // Non-critical
      }

      // Load browser status
      try {
        const browserStatus = await engine.getBrowserStatus();
        update({ browserStatus });
      } catch {
        // Non-critical
      }

      // Connect WebSocket
      try {
        await engine.connectWebSocket();
        update({ wsConnected: true });
      } catch {
        // WS is optional, REST still works
      }

      // Sync persisted settings to Tauri + engine.
      syncAllSettings().catch(() => {});

      // Configure cloud sync if already authenticated at connect time.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token && session?.user?.id) {
          await engine.configureCloudSync(session.access_token, session.user.id);
          engine.cloudHeartbeat().catch(() => {});
        }
      } catch {
        // Cloud sync configuration is non-critical
      }
    } finally {
      // Always release the mutex so future retries are possible
      initializingRef.current = false;
    }
  }, [update]);

  /**
   * Full restart: stop → start → wait → discover → init.
   * This is what all "Restart Engine" buttons should call.
   */
  const restartEngine = useCallback(async () => {
    // Don't restart if already initializing — but allow if "error" or "disconnected"
    if (initializingRef.current) return;

    update({ status: "starting", error: null });

    if (isTauri()) {
      try {
        await stopSidecar();
      } catch {
        // May already be stopped — that's fine
      }
      // Small delay to let the OS release the port
      await new Promise((r) => setTimeout(r, 500));
    }

    // Re-run initialization which handles start + wait + discover
    await initialize();
  }, [initialize, update]);

  /**
   * Reconnect / refresh: re-run the full initialization sequence.
   * Unlike the old version, this always re-runs (no one-shot gate).
   */
  const refresh = useCallback(async () => {
    await initialize();
  }, [initialize]);

  // Trigger initialize() whenever authentication state changes to true.
  useEffect(() => {
    if (authenticated) {
      initialize();
    }
  }, [authenticated, initialize]);

  // Belt-and-suspenders: also watch supabase auth state directly so we catch
  // the SIGNED_IN event that fires from setSession() in completeOAuthExchange,
  // in case the authenticated prop hasn't propagated yet when it fires.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        initialize();
      }
    });
    return () => subscription.unsubscribe();
  }, [initialize]);

  useEffect(() => {
    mountedRef.current = true;

    const offConnected = engine.on("connected", () =>
      update({ wsConnected: true })
    );
    const offDisconnected = engine.on("disconnected", () =>
      update({ wsConnected: false })
    );

    // Re-configure cloud sync whenever auth state changes.
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!engine.engineUrl) return;
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          if (session?.access_token && session?.user?.id) {
            try {
              await engine.configureCloudSync(session.access_token, session.user.id);
              engine.cloudHeartbeat().catch(() => {});
            } catch {
              // Non-critical
            }
          }
        } else if (event === "TOKEN_REFRESHED") {
          if (session?.access_token && session?.user?.id) {
            try {
              await engine.reconfigureCloudSync(session.access_token, session.user.id);
            } catch {
              // Non-critical
            }
          }
        }
      }
    );

    // Periodic health check — runs every 10s, but suppresses false "disconnected"
    // flips for 90s after first connection to allow for slow engine startup.
    const STARTUP_GRACE_MS = 90_000;
    const healthInterval = setInterval(async () => {
      const healthy = await engine.isHealthy();
      if (!healthy && statusRef.current === "connected") {
        const msSinceConnect = connectedAtRef.current
          ? Date.now() - connectedAtRef.current
          : Infinity;
        if (msSinceConnect > STARTUP_GRACE_MS) {
          update({ status: "disconnected" });
        }
        // Within grace period: engine is still booting, stay "connected"
      } else if (healthy && statusRef.current === "disconnected") {
        connectedAtRef.current = Date.now();
        update({ status: "connected" });
      }
    }, 10000);

    // Periodic cloud heartbeat (every 5 minutes)
    const heartbeatInterval = setInterval(() => {
      engine.cloudHeartbeat().catch(() => {});
    }, 300000);

    return () => {
      mountedRef.current = false;
      offConnected();
      offDisconnected();
      authSub.unsubscribe();
      clearInterval(healthInterval);
      clearInterval(heartbeatInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, refresh, restartEngine, engine };
}
