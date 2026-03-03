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
import { AuthCallback } from "@/pages/AuthCallback";
import { AiMatrx } from "@/pages/AiMatrx";
import { BrowserLab } from "@/pages/BrowserLab";
import { FetchProxyBrowser } from "@/pages/FetchProxyBrowser";
import { TauriFetchBrowser } from "@/pages/TauriFetchBrowser";
import { useEngine } from "@/hooks/use-engine";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useNotifications } from "@/hooks/use-notifications";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NotificationToastContainer } from "@/components/notifications/NotificationCenter";
import { Loader2 } from "lucide-react";

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
  } = useEngine();

  const notif = useNotifications();

  // Keep only the 3 most recent for the toast stack
  const toasts = notif.notifications.slice(0, 3);

  if (auth.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <HashRouter>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallback />} />

            {!auth.isAuthenticated ? (
              <Route path="*" element={<Login auth={auth} />} />
            ) : (
              <Route element={
                <AppLayout
                  engineStatus={status}
                  engineUrl={url}
                  engineVersion={engineVersion}
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
                <Route path="browser/fastapi" element={<FetchProxyBrowser />} />
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
