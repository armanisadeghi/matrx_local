import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { StatusBar } from "./StatusBar";
import type { EngineStatus } from "@/hooks/use-engine";

interface AppLayoutProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  engineVersion?: string;
}

export function AppLayout({ engineStatus, engineUrl, engineVersion }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar engineStatus={engineStatus} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
        <StatusBar
          engineStatus={engineStatus}
          engineUrl={engineUrl}
          engineVersion={engineVersion}
        />
      </div>
    </div>
  );
}
