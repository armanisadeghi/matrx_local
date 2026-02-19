import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { Scraping } from "@/pages/Scraping";
import { Tools } from "@/pages/Tools";
import { Activity } from "@/pages/Activity";
import { Settings } from "@/pages/Settings";
import { useEngine } from "@/hooks/use-engine";

export default function App() {
  const {
    status,
    url,
    tools,
    systemInfo,
    browserStatus,
    refresh,
  } = useEngine();

  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
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
                  onRefresh={refresh}
                />
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  );
}
