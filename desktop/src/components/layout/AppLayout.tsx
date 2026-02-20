import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import type { EngineStatus } from "@/hooks/use-engine";

interface AppLayoutProps {
  engineStatus: EngineStatus;
}

export function AppLayout({ engineStatus }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar engineStatus={engineStatus} />
      <main className="flex flex-1 h-full flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
