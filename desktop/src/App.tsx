import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { Scraping } from "@/pages/Scraping";
import { Tools } from "@/pages/Tools";
import { Activity } from "@/pages/Activity";
import { Settings } from "@/pages/Settings";
import { Login } from "@/pages/Login";
import { AuthCallback } from "@/pages/AuthCallback";
import { useEngine } from "@/hooks/use-engine";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
        <BrowserRouter>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallback />} />

            {!auth.isAuthenticated ? (
              <Route path="*" element={<Login auth={auth} />} />
            ) : (
              <Route element={<AppLayout engineStatus={status} />}>
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
              </Route>
            )}
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ErrorBoundary>
  );
}
