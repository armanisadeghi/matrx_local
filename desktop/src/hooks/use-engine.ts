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

export function useEngine() {
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

    // Configure cloud sync if authenticated.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token && session?.user?.id) {
        await engine.configureCloudSync(session.access_token, session.user.id);
      }
    } catch {
      // Cloud sync configuration is non-critical
    }

    // Send periodic heartbeat (every 5 minutes)
    engine.cloudHeartbeat().catch(() => {});
  }, [update]);

  const refresh = useCallback(async () => {
    initRef.current = false;
    await initialize();
  }, [initialize]);

  useEffect(() => {
    mountedRef.current = true;
    initialize();

    const offConnected = engine.on("connected", () =>
      update({ wsConnected: true })
    );
    const offDisconnected = engine.on("disconnected", () =>
      update({ wsConnected: false })
    );

    // Periodic health check
    const healthInterval = setInterval(async () => {
      const healthy = await engine.isHealthy();
      if (!healthy && statusRef.current === "connected") {
        update({ status: "disconnected" });
      } else if (healthy && statusRef.current === "disconnected") {
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
      clearInterval(healthInterval);
      clearInterval(heartbeatInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, refresh, engine };
}
