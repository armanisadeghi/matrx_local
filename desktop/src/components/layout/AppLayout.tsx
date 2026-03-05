import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { StatusBar } from "./StatusBar";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import type { EngineStatus } from "@/hooks/use-engine";
import type { AppNotification } from "@/hooks/use-notifications";
import type { User } from "@supabase/supabase-js";

interface AppLayoutProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  engineVersion?: string;
  onRefresh: () => void;
  user: User | null;
  onSignOut: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismissNotification: (id: string) => void;
  onClearAllNotifications: () => void;
}

export function AppLayout({
  engineStatus,
  engineUrl,
  engineVersion,
  onRefresh,
  user,
  onSignOut,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onDismissNotification,
  onClearAllNotifications,
}: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar engineStatus={engineStatus} user={user} onSignOut={onSignOut} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top-right notification bell */}
        <div className="flex justify-end px-4 pt-2 pb-0">
          <NotificationCenter
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onDismiss={onDismissNotification}
            onClearAll={onClearAllNotifications}
          />
        </div>
        <main className="flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
        <StatusBar
          engineStatus={engineStatus}
          engineUrl={engineUrl}
          engineVersion={engineVersion}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}
