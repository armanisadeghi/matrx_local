import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { StatusBar } from "./StatusBar";
import type { EngineStatus } from "@/hooks/use-engine";
import type { User } from "@supabase/supabase-js";

interface AppLayoutProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  engineVersion?: string;
  user: User | null;
  onSignOut: () => void;
}

export function AppLayout({ engineStatus, engineUrl, engineVersion, user, onSignOut }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar engineStatus={engineStatus} user={user} onSignOut={onSignOut} />
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
