import { useState, useEffect, useCallback, useRef } from "react";
import { engine, type SystemInfo, type BrowserStatus } from "@/lib/api";
import { isTauri, startSidecar } from "@/lib/sidecar";
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
  const initRef = useRef(false);
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

  const initialize = useCallback(async () => {
    if (initRef.current) return;
    initRef.current = true;

    engine.setTokenProvider(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    });

    update({ status: "discovering" });

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
        initRef.current = false;
        return;
      }
    }

    // Discover the engine
    const url = await engine.discover();
    if (!url) {
      update({
        status: "disconnected",
        error: "Engine not found. Make sure the Python server is running.",
      });
      initRef.current = false;
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
  }, [update]);

  const refresh = useCallback(async () => {
    initRef.current = false;
    await initialize();
  }, [initialize]);

  // Trigger initialize() whenever authentication state changes from false → true.
  // The [] effect below sets up long-lived listeners; this separate effect handles
  // the one-shot initialization that must wait for a valid session.
  useEffect(() => {
    if (authenticated) {
      initialize();
    }
  }, [authenticated, initialize]);

  useEffect(() => {
    mountedRef.current = true;

    const offConnected = engine.on("connected", () =>
      update({ wsConnected: true })
    );
    const offDisconnected = engine.on("disconnected", () =>
      update({ wsConnected: false })
    );

    // Re-configure cloud sync whenever auth state changes.
    // This covers: login after engine connects, token refresh, logout.
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
        // SIGNED_OUT: cloud sync stays configured until next restart — harmless,
        // all Supabase calls will 401 with an expired JWT anyway.
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

  return { ...state, refresh, engine };
}
