import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
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
import { TauriFetchBrowser } from "@/pages/TauriFetchBrowser";
import { useEngine } from "@/hooks/use-engine";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useNotifications } from "@/hooks/use-notifications";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NotificationToastContainer } from "@/components/notifications/NotificationCenter";
import { Loader2 } from "lucide-react";

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
    refresh,
  } = useEngine(auth.isAuthenticated);

  const notif = useNotifications();

  // Keep only the 3 most recent for the toast stack
  const toasts = notif.notifications.slice(0, 3);

  // Allow /auth/callback to render before auth loads — it handles its own
  // loading state and must be reachable immediately after OAuth redirect.
  const isCallbackRoute =
    typeof window !== "undefined" &&
    window.location.hash.startsWith("#/auth/callback");

  if (auth.loading && !isCallbackRoute && !auth.oauthPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // OAuthPending is rendered at the App level (not inside Login) so it
  // survives the app being backgrounded and re-activated by the OS deep link.
  // oauthPending is persisted to localStorage so it's still true after the
  // app window comes back to front following browser-side OAuth approval.
  if (auth.oauthPending && !auth.isAuthenticated) {
    return (
      <ErrorBoundary>
        <OAuthPending
          onCancel={auth.cancelOAuth}
          completeOAuthExchange={auth.completeOAuthExchange}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <HashRouter>
          <Routes>
            {/* AuthCallback MUST be listed unconditionally — before the auth
                check — so it renders regardless of authentication state.
                After OAuth approval the user lands here with ?code= and is
                not yet authenticated. */}
            <Route path="/auth/callback" element={<AuthCallback />} />

            {!auth.isAuthenticated ? (
              <Route path="*" element={<Login auth={auth} />} />
            ) : (
              <Route element={
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
                />
              }>
                <Route
                  index
                  element={
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
                  }
                />
                <Route
                  path="chat"
                  element={
                    <Chat
                      engineStatus={status}
                      engineUrl={url}
                      tools={tools}
                    />
                  }
                />
                <Route
                  path="notes"
                  element={
                    <Documents
                      engineStatus={status}
                      userId={auth.user?.id ?? null}
                    />
                  }
                />
                <Route
                  path="scraping"
                  element={
                    <Scraping engineStatus={status} engineUrl={url} />
                  }
                />
                <Route
                  path="tools"
                  element={
                    <Tools
                      engineStatus={status}
                      engineUrl={url}
                      tools={tools}
                    />
                  }
                />
                <Route
                  path="activity"
                  element={
                    <Activity engineStatus={status} engineUrl={url} />
                  }
                />
                <Route
                  path="ports"
                  element={
                    <Ports engineStatus={status} engineUrl={url} />
                  }
                />
                <Route
                  path="devices"
                  element={
                    <Devices engineStatus={status} engineUrl={url} />
                  }
                />
                <Route path="aimatrx" element={<AiMatrx />} />
                <Route path="browser" element={<BrowserLab />} />
                <Route path="browser/tauri" element={<TauriFetchBrowser />} />
                <Route
                  path="settings"
                  element={
                    <Settings
                      engineStatus={status}
                      engineUrl={url}
                      engineVersion={engineVersion}
                      onRefresh={refresh}
                      auth={auth}
                      theme={themeCtx.theme}
                      setTheme={themeCtx.setTheme}
                    />
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            )}
          </Routes>
        </HashRouter>
        <NotificationToastContainer toasts={toasts} onDismiss={notif.dismiss} />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
