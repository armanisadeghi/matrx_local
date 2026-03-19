import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout, type PageEntry } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { Documents } from "@/pages/Documents";
import { Scraping } from "@/pages/Scraping";
import { Tools } from "@/pages/Tools";
import { Activity } from "@/pages/Activity";
import { Ports } from "@/pages/Ports";
import { Settings } from "@/pages/Settings";
import { Devices } from "@/pages/Devices";
import { Chat } from "@/pages/Chat";
import { Login } from "@/pages/Login";
import { OAuthPending } from "@/pages/OAuthPending";
import { AuthCallback } from "@/pages/AuthCallback";
import { AiMatrx } from "@/pages/AiMatrx";
import { BrowserLab } from "@/pages/BrowserLab";
import { Voice } from "@/pages/Voice";
import { LocalModels } from "@/pages/LocalModels";
import { TauriFetchBrowser } from "@/pages/TauriFetchBrowser";
import { useEngine } from "@/hooks/use-engine";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useNotifications } from "@/hooks/use-notifications";
import { useAutoUpdate } from "@/hooks/use-auto-update";
import { useTranscription } from "@/hooks/use-transcription";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EngineMonitor } from "@/components/EngineRecoveryModal";
import { UpdateDialog } from "@/components/UpdateDialog";
import { UpdateBanner } from "@/components/UpdateBanner";
import { NotificationToastContainer } from "@/components/notifications/NotificationCenter";
import { StartupScreen } from "@/components/StartupScreen";
import { FirstRunScreen } from "@/components/FirstRunScreen";
import { DevTerminalPanel, DevTerminalProvider } from "@/components/DevTerminalPanel";
import { CompactRecorderWindow } from "@/components/CompactRecorderWindow";
import { PermissionsProvider } from "@/contexts/PermissionsContext";
import { AudioDevicesProvider } from "@/contexts/AudioDevicesContext";
import { engine } from "@/lib/api";
import { isTauri } from "@/lib/sidecar";
import { initUnifiedLog, initTauriLogStream, stopEngineStreams } from "@/hooks/use-unified-log";
import supabase from "@/lib/supabase";
import { Mic } from "lucide-react";

const SETUP_DISMISSED_KEY = "matrx-setup-dismissed";

// ---------------------------------------------------------------------------
// HashRouter + OAuth callback bridge
//
// When Supabase redirects after OAuth approval it lands on the real URL:
//   http://localhost:1420/auth/callback?code=XXX&state=YYY
//
// HashRouter only reads window.location.hash, so "/auth/callback" as a real
// pathname is invisible to it — the app would render the "/" route instead.
//
// We detect this on every render (before anything mounts) and immediately
// redirect to the equivalent hash route, preserving the query string so
// AuthCallback.tsx can read window.location.search as normal.
if (
  typeof window !== "undefined" &&
  window.location.pathname === "/auth/callback" &&
  !window.location.hash.includes("/auth/callback")
) {
  const search = window.location.search; // "?code=XXX&state=YYY"
  window.location.replace(`/#/auth/callback${search}`);
}

export default function App() {
  const auth = useAuth();
  const themeCtx = useTheme();
  const {
    status,
    url,
    tools,
    systemInfo,
    browserStatus,
    engineVersion,
    error: engineError,
    refresh,
    restartEngine,
  } = useEngine(auth.isAuthenticated);

  const notif = useNotifications();
  const [updateState, updateActions] = useAutoUpdate();

  // ---------------------------------------------------------------------------
  // Compact recorder mode — shrinks the OS window to a tiny floating recorder
  // ---------------------------------------------------------------------------
  const [isCompact, setIsCompact] = useState(false);
  const [transcriptionState, transcriptionActions] = useTranscription();

  // Accumulated transcript text — append segments as they arrive.
  const [compactTranscript, setCompactTranscript] = useState("");
  useEffect(() => {
    if (isCompact && transcriptionState.segments.length > 0) {
      setCompactTranscript(
        transcriptionState.segments.map((s) => s.text).join(" ").trim()
      );
    }
  }, [transcriptionState.segments, isCompact]);

  const invokeSetCompactMode = useCallback(async (enabled: boolean) => {
    if (!isTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_compact_mode", { enabled });
    } catch (e) {
      console.warn("[compact-mode] set_compact_mode failed:", e);
    }
  }, []);

  const enterCompactMode = useCallback(async () => {
    setCompactTranscript("");
    setIsCompact(true);
    await invokeSetCompactMode(true);
    // Auto-start recording immediately — the whole point of compact mode.
    // Small delay lets the window finish resizing before we invoke Tauri audio.
    if (!transcriptionState.isRecording && !transcriptionState.isProcessingTail) {
      setTimeout(() => {
        transcriptionActions.startRecording().catch(() => {
          // Silently ignore — CompactRecorderWindow also tries on mount.
        });
      }, 150);
    }
  }, [invokeSetCompactMode, transcriptionState.isRecording, transcriptionState.isProcessingTail, transcriptionActions]);

  const exitCompactMode = useCallback(async () => {
    if (transcriptionState.isRecording) {
      await transcriptionActions.stopRecording();
    }
    setIsCompact(false);
    await invokeSetCompactMode(false);
  }, [invokeSetCompactMode, transcriptionState.isRecording, transcriptionActions]);

  // ---------------------------------------------------------------------------
  // Unified log streams — self-initiating, independent of which page is open
  // ---------------------------------------------------------------------------

  // Tauri sidecar listener starts immediately on mount (no engine needed)
  useEffect(() => {
    initTauriLogStream();
  }, []);

  // Engine streams start/stop with engine connection state
  useEffect(() => {
    if (status === "connected" && url) {
      const getToken = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
      };
      initUnifiedLog(url, getToken);
    } else if (status !== "connected") {
      stopEngineStreams();
    }
  }, [status, url]);

  // Keep only the 3 most recent for the toast stack
  const toasts = notif.notifications.slice(0, 3);

  // First-run detection — fetch setup status once engine connects
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const setupCheckedRef = useRef(false);

  useEffect(() => {
    if (status === "connected" && url && !setupCheckedRef.current) {
      setupCheckedRef.current = true;
      engine.getSetupStatus().then((s) => {
        setSetupComplete(s?.setup_complete ?? true);
      }).catch(() => {
        // If we can't fetch status, assume complete to not block
        setSetupComplete(true);
      });
    }
  }, [status, url]);

  // Whether we should show the first-run installation screen
  const isFirstRun =
    status === "connected" &&
    url !== null &&
    setupComplete === false &&
    !localStorage.getItem(SETUP_DISMISSED_KEY);

  const handleFirstRunComplete = useCallback(() => {
    localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    setSetupComplete(true);
  }, []);

  // Engine Monitor — user-controlled but auto-opens on error
  const [monitorOpen, setMonitorOpen] = useState(false);
  const prevStatusRef = useRef(status);

  // Auto-open the monitor when engine enters error state (not on initial load)
  useEffect(() => {
    if (
      auth.isAuthenticated &&
      status === "error" &&
      prevStatusRef.current !== "error"
    ) {
      setMonitorOpen(true);
    }
    prevStatusRef.current = status;
  }, [status, auth.isAuthenticated]);

  const handleOpenMonitor = useCallback(() => setMonitorOpen(true), []);

  // Build the persistent pages array — these elements are always mounted once
  // the user is authenticated. AppLayout shows the active one and hides the
  // rest via display:none so no page ever unmounts on navigation. Downloads,
  // streams, and any ongoing work continue uninterrupted regardless of which
  // tab the user is viewing.
  //
  // useMemo keys on the values that legitimately need to cause page re-renders
  // (engine connection state, user identity, etc.). The page components
  // themselves receive up-to-date props on every render via their own hooks,
  // so this does not cause stale closures.
  const appPages: PageEntry[] = useMemo(() => [
    {
      path: "/",
      element: (
        <Dashboard
          engineStatus={status}
          engineUrl={url}
          tools={tools}
          systemInfo={systemInfo}
          browserStatus={browserStatus}
          onRefresh={refresh}
          user={auth.user}
          onSignOut={auth.signOut}
        />
      ),
    },
    {
      path: "/chat",
      element: (
        <Chat
          engineStatus={status}
          engineUrl={url}
          tools={tools}
        />
      ),
    },
    {
      path: "/notes",
      element: (
        <Documents
          engineStatus={status}
          userId={auth.user?.id ?? null}
        />
      ),
    },
    {
      path: "/scraping",
      element: <Scraping engineStatus={status} engineUrl={url} />,
    },
    {
      path: "/tools",
      element: (
        <Tools
          engineStatus={status}
          engineUrl={url}
          tools={tools}
        />
      ),
    },
    {
      path: "/activity",
      element: <Activity engineStatus={status} engineUrl={url} />,
    },
    {
      path: "/ports",
      element: <Ports engineStatus={status} engineUrl={url} />,
    },
    {
      path: "/devices",
      element: <Devices engineStatus={status} engineUrl={url} />,
    },
    { path: "/voice", element: <Voice /> },
    { path: "/local-models", element: <LocalModels /> },
    { path: "/aimatrx", element: <AiMatrx /> },
    { path: "/browser", element: <BrowserLab /> },
    { path: "/browser/tauri", element: <TauriFetchBrowser /> },
    {
      path: "/settings",
      element: (
        <Settings
          engineStatus={status}
          engineUrl={url}
          engineVersion={engineVersion}
          onRefresh={refresh}
          auth={auth}
          theme={themeCtx.theme}
          setTheme={themeCtx.setTheme}
          updateState={updateState}
          updateActions={updateActions}
        />
      ),
    },
  ], [
    status, url, tools, systemInfo, browserStatus,
    refresh, auth, engineVersion,
    themeCtx.theme, themeCtx.setTheme,
    updateState, updateActions,
  ]);

  // Allow /auth/callback to render before auth loads — it handles its own
  // loading state and must be reachable immediately after OAuth redirect.
  const isCallbackRoute =
    typeof window !== "undefined" &&
    window.location.hash.startsWith("#/auth/callback");

  // OAuthPending MUST be checked before any engine-state gate.
  // After completeOAuthExchange() sets isAuthenticated=true, the engine starts
  // discovering immediately. If we checked isEngineStarting first, StartupScreen
  // would replace OAuthPending and the deep-link event handler would lose its
  // listener before it could complete the exchange.
  if (auth.oauthPending) {
    return (
      <ErrorBoundary>
        <OAuthPending
          onCancel={auth.cancelOAuth}
          completeOAuthExchange={auth.completeOAuthExchange}
        />
      </ErrorBoundary>
    );
  }

  // Show startup screen while auth is loading OR engine is starting/discovering
  const isEngineStarting =
    auth.isAuthenticated &&
    (status === "discovering" || status === "starting") &&
    !isCallbackRoute;

  if ((auth.loading && !isCallbackRoute) || isEngineStarting) {
    return (
      <StartupScreen
        authLoading={auth.loading}
        engineStatus={status}
      />
    );
  }

  // First-run: engine is connected but setup is not complete — show dedicated install screen
  if (isFirstRun) {
    return (
      <ErrorBoundary>
        <FirstRunScreen
          engineUrl={url!}
          onComplete={handleFirstRunComplete}
        />
      </ErrorBoundary>
    );
  }

  // ── Compact recorder mode takeover ─────────────────────────────────────────
  // When compact mode is active the entire app is replaced by the tiny recorder
  // UI that perfectly fits the shrunken OS window.
  if (isCompact) {
    return (
      <ErrorBoundary>
        <CompactRecorderWindow
          isRecording={transcriptionState.isRecording}
          isProcessingTail={transcriptionState.isProcessingTail}
          isCalibrating={transcriptionState.isCalibrating}
          liveRms={transcriptionState.liveRms}
          transcript={compactTranscript}
          onStartRecording={transcriptionActions.startRecording}
          onStopRecording={transcriptionActions.stopRecording}
          onExpand={exitCompactMode}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <DevTerminalProvider>
      <PermissionsProvider>
      <AudioDevicesProvider>
      <TooltipProvider>
        <HashRouter>
          <Routes>
            {/* AuthCallback must be unconditional — renders before auth loads */}
            <Route path="/auth/callback" element={<AuthCallback />} />

            {!auth.isAuthenticated ? (
              <Route path="*" element={<Login auth={auth} />} />
            ) : (
              <>
                {/* AppLayout owns all page rendering. Routes here exist only
                    so that useLocation() and Link navigation work correctly.
                    No route renders content — AppLayout shows the right page
                    based on location.pathname while keeping all others mounted. */}
                <Route
                  path="/*"
                  element={
                    <AppLayout
                      engineStatus={status}
                      engineUrl={url}
                      engineVersion={engineVersion}
                      onRefresh={refresh}
                      user={auth.user}
                      onSignOut={auth.signOut}
                      notifications={notif.notifications}
                      unreadCount={notif.unreadCount}
                      onMarkRead={notif.markRead}
                      onMarkAllRead={notif.markAllRead}
                      onDismissNotification={notif.dismiss}
                      onClearAllNotifications={notif.clearAll}
                      onOpenMonitor={handleOpenMonitor}
                      pages={appPages}
                    />
                  }
                />
              </>
            )}
          </Routes>
        </HashRouter>
        <NotificationToastContainer toasts={toasts} onDismiss={notif.dismiss} />
        <EngineMonitor
          open={monitorOpen}
          onOpenChange={setMonitorOpen}
          engineStatus={status}
          engineError={engineError}
          onRestartEngine={restartEngine}
          onRefresh={refresh}
        />
        {/* Soft persistent notification — shown on any page without interrupting */}
        <UpdateBanner state={updateState} actions={updateActions} />
        {/* Full dialog — only opens when user clicks Details/Install in the banner, or from Settings */}
        <UpdateDialog state={updateState} actions={updateActions} />
        {/* Persistent debug terminal — toggled via TerminalToggleButton in AppLayout */}
        <DevTerminalPanel />
        {/* Global compact-mode trigger — visible from any page when authenticated */}
        {auth.isAuthenticated && (
          <button
            onClick={enterCompactMode}
            className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary/90 px-3 py-2 text-primary-foreground shadow-lg backdrop-blur-sm transition-all hover:bg-primary hover:scale-105 active:scale-95"
            title="Enter compact recorder mode"
          >
            <Mic className="h-4 w-4" />
            <span className="text-xs font-medium leading-none">Record</span>
          </button>
        )}
      </TooltipProvider>
      </AudioDevicesProvider>
      </PermissionsProvider>
      </DevTerminalProvider>
    </ErrorBoundary>
  );
}
