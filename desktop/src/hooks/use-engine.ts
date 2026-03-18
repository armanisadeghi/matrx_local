import { useState, useEffect, useCallback, useRef } from "react";
import { engine, type SystemInfo, type BrowserStatus } from "@/lib/api";
import { isTauri, startSidecar, stopSidecar, waitForEngine, discoverEnginePort } from "@/lib/sidecar";
import { initPlatformCtx } from "@/lib/platformCtx";
import { syncAllSettings } from "@/lib/settings";
import supabase from "@/lib/supabase";
import { emitClientLog } from "@/hooks/use-client-log";

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
  // Timestamp of the last successful cloud configure call. Used to deduplicate
  // the configure call that fires from onAuthStateChange(INITIAL_SESSION) when
  // initialize() has already done it within the last 10 seconds.
  const lastCloudConfigureRef = useRef<number>(0);

  // Wire up the token provider immediately so all authenticated calls have
  // access to the current JWT. This must happen before initialize() runs.
  // We always register it — the provider handles the case where no session
  // exists by returning null, which authHeaders() converts to no header.
  useEffect(() => {
    engine.setTokenProvider(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    });
  }, []);

  const update = useCallback((partial: Partial<EngineState>) => {
    if (mountedRef.current) {
      setState((prev) => {
        if (partial.status && partial.status !== prev.status) {
          emitClientLog("info", `Engine status: ${prev.status} → ${partial.status}`, "engine");
        }
        if (partial.error && partial.error !== prev.error) {
          emitClientLog("error", `Engine error: ${partial.error}`, "engine");
        }
        return { ...prev, ...partial };
      });
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
      emitClientLog("cmd", "Engine initialization started", "engine");

      // Holds the engine URL confirmed via Rust IPC (bypasses Windows loopback restriction).
      // Set inside the Tauri block below; used to skip the JS fetch port scan.
      let tauriConfirmedUrl: string | null = null;

      // In Tauri, start the sidecar first
      if (isTauri()) {
        update({ status: "starting" });
        emitClientLog("info", "Starting sidecar process...", "engine");
        try {
          await startSidecar();
          emitClientLog("success", "Sidecar process spawned", "engine");
        } catch (err) {
          emitClientLog("error", `startSidecar failed: ${err}`, "engine");
          update({
            status: "error",
            error: `Failed to start engine: ${err}`,
          });
          return;
        }

        // ── KEY FIX: Wait for the sidecar to actually be ready ──────
        // startSidecar() returns as soon as the process is spawned.
        // The PyInstaller binary takes 5-30s to boot and bind a port.
        // We poll via Rust IPC (check_engine_health) which is NOT subject to
        // the Windows WebView2 loopback network isolation that blocks JS fetch()
        // calls to 127.0.0.1 from within the WebView sandbox.
        emitClientLog("info", "Waiting for engine to become reachable (up to 60s)...", "engine");
        const ready = await waitForEngine("http://127.0.0.1:22140", 60, 1000);
        let confirmedUrl: string | null = ready ? "http://127.0.0.1:22140" : null;
        if (!ready) {
          emitClientLog("warn", "Default port not responding — scanning port range...", "engine");
          // discoverEnginePort() uses Rust IPC when in Tauri — not blocked by WebView2
          confirmedUrl = await discoverEnginePort();
          if (!confirmedUrl) {
            emitClientLog("error", "Engine never became reachable — sidecar may have crashed", "engine");
            update({
              status: "error",
              error: "Engine process started but never became reachable. The sidecar may have crashed during startup.",
            });
            return;
          }
          emitClientLog("success", `Engine found at alternate URL: ${confirmedUrl}`, "engine");
        } else {
          emitClientLog("success", "Engine is responding on port 22140", "engine");
        }

        // Pass the confirmed URL directly so engine.discover() doesn't do another
        // round of JS fetch() scans (which are blocked on Windows by WebView2).
        tauriConfirmedUrl = confirmedUrl;
      }

      // Discover the engine URL. In Tauri we pass the Rust-confirmed URL to skip
      // JS fetch() port scanning (blocked on Windows by WebView2 loopback isolation).
      // In browser dev mode, fall through to the standard JS port scan.
      emitClientLog("info", "Discovering engine URL...", "engine");
      const url = tauriConfirmedUrl
        ? await engine.discover(tauriConfirmedUrl)
        : await engine.discover();
      if (!url) {
        emitClientLog("error", "Engine not found on any port 22140-22159", "engine");
        update({
          status: "error",
          error: "Engine not found on any port (22140-22159). Make sure the Python server is running.",
        });
        return;
      }

      emitClientLog("success", `Engine discovered at ${url}`, "engine");
      connectedAtRef.current = Date.now();
      update({ url, status: "connected", error: null });

      // Populate the frontend platform context from the engine
      try {
        const ctx = await engine.getPlatformContext();
        initPlatformCtx(ctx);
        emitClientLog("info", "Platform context initialised from engine", "engine");
      } catch {
        emitClientLog("warn", "Could not load platform context (browser fallback active)", "engine");
      }

      // Load tools list
      try {
        const tools = await engine.listTools();
        update({ tools });
        emitClientLog("info", `Loaded ${tools.length} tools`, "engine");
      } catch {
        emitClientLog("warn", "Could not load tools list (non-critical)", "engine");
      }

      // Load engine version
      try {
        const engineVersion = await engine.getVersion();
        update({ engineVersion });
        emitClientLog("info", `Engine version: ${engineVersion}`, "engine");
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

      // Connect WebSocket — only when we have a token; the server rejects
      // unauthenticated WS connections with 403 and the auto-reconnect loop
      // would hammer the server until auth is available.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          await engine.connectWebSocket();
          update({ wsConnected: true });
          emitClientLog("success", "WebSocket connected", "engine");
        } else {
          emitClientLog("warn", "No session token — skipping WebSocket (REST still works)", "engine");
        }
      } catch (err) {
        emitClientLog("warn", `WebSocket connection failed (non-critical): ${err}`, "engine");
      }

      // Sync persisted settings to Tauri + engine.
      syncAllSettings().catch(() => {});

      // Configure cloud sync if already authenticated at connect time.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token && session?.user?.id) {
          lastCloudConfigureRef.current = Date.now();
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

    // Re-configure cloud sync and sync JWT to Python whenever auth state changes.
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!engine.engineUrl) return;
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          if (session?.access_token && session?.user?.id) {
            // Push the JWT to Python so it persists across restarts.
            engine.syncTokenToPython(
              session.access_token,
              session.user.id,
              session.refresh_token ?? undefined,
              session.expires_in ?? undefined,
            ).catch(() => {});

            // Skip if initialize() already sent configure within the last 10s
            // to avoid a duplicate call on the INITIAL_SESSION event.
            if (Date.now() - lastCloudConfigureRef.current < 10_000) return;
            try {
              lastCloudConfigureRef.current = Date.now();
              await engine.configureCloudSync(session.access_token, session.user.id);
              engine.cloudHeartbeat().catch(() => {});
            } catch {
              // Non-critical
            }
          }
        } else if (event === "TOKEN_REFRESHED") {
          if (session?.access_token && session?.user?.id) {
            // Push refreshed JWT to Python immediately.
            engine.syncTokenToPython(
              session.access_token,
              session.user.id,
              session.refresh_token ?? undefined,
              session.expires_in ?? undefined,
            ).catch(() => {});
            try {
              await engine.reconfigureCloudSync(session.access_token, session.user.id);
            } catch {
              // Non-critical
            }
          }
        } else if (event === "SIGNED_OUT") {
          engine.clearPythonToken().catch(() => {});
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
