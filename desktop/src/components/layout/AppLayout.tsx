import { useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { StatusBar } from "./StatusBar";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { useDevTerminalHeight } from "@/components/DevTerminalPanel";
import type { EngineStatus } from "@/hooks/use-engine";
import type { AppNotification } from "@/hooks/use-notifications";
import type { User } from "@supabase/supabase-js";

export interface PageEntry {
  /** The hash path this page owns, e.g. "/" or "/voice" */
  path: string;
  /** The fully constructed React element to keep alive */
  element: React.ReactNode;
}

interface AppLayoutProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  engineVersion?: string;
  onRefresh: () => void;
  onOpenMonitor?: () => void;
  user: User | null;
  onSignOut: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismissNotification: (id: string) => void;
  onClearAllNotifications: () => void;
  /** All app pages — rendered permanently, shown/hidden by route */
  pages: PageEntry[];
}

/**
 * Returns true when the current pathname matches a page's registered path.
 * The root "/" only matches exactly; all others use prefix matching so that
 * sub-routes (e.g. "/browser/tauri") remain visible under their parent.
 */
function pageIsActive(pagePath: string, currentPathname: string): boolean {
  if (pagePath === "/") return currentPathname === "/";
  return currentPathname === pagePath || currentPathname.startsWith(pagePath + "/");
}

export function AppLayout({
  engineStatus,
  engineUrl,
  engineVersion,
  onRefresh,
  onOpenMonitor,
  user,
  onSignOut,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onDismissNotification,
  onClearAllNotifications,
  pages,
}: AppLayoutProps) {
  const location = useLocation();
  const terminalHeight = useDevTerminalHeight();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar engineStatus={engineStatus} user={user} onSignOut={onSignOut} />
      <div
        className="flex flex-1 flex-col overflow-hidden transition-[padding-bottom] duration-150"
        style={{ paddingBottom: terminalHeight }}
      >
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
          {pages.map(({ path, element }) => (
            <div
              key={path}
              className="flex h-full flex-col overflow-hidden"
              style={{ display: pageIsActive(path, location.pathname) ? "contents" : "none" }}
            >
              {element}
            </div>
          ))}
        </main>
        <StatusBar
          engineStatus={engineStatus}
          engineUrl={engineUrl}
          engineVersion={engineVersion}
          onRefresh={onRefresh}
          onOpenMonitor={onOpenMonitor}
        />
      </div>
    </div>
  );
}
