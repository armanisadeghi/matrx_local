import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Globe,
  Wrench,
  Settings,
  FileText,
  MessageSquare,
  Zap,
  Network,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EngineStatus } from "@/hooks/use-engine";

interface AppSidebarProps {
  engineStatus: EngineStatus;
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/chat", icon: MessageSquare, label: "Chat" },
  { to: "/documents", icon: FileText, label: "Documents" },
  { to: "/scraping", icon: Globe, label: "Scraping" },
  { to: "/tools", icon: Wrench, label: "Tools" },
  { to: "/ports", icon: Network, label: "Ports" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

const statusColors: Record<EngineStatus, string> = {
  discovering: "bg-amber-500",
  starting: "bg-amber-500 animate-pulse-subtle",
  connected: "bg-emerald-500",
  disconnected: "bg-zinc-500",
  error: "bg-red-500",
};

const statusLabels: Record<EngineStatus, string> = {
  discovering: "Discovering engine...",
  starting: "Starting engine...",
  connected: "Engine connected",
  disconnected: "Engine offline",
  error: "Engine error",
};

export function AppSidebar({ engineStatus }: AppSidebarProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    return saved === "true";
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  };

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <aside
      className={cn(
        "no-select flex h-full flex-col border-r bg-sidebar transition-[width] duration-200 ease-in-out overflow-hidden backdrop-blur-xl",
        collapsed
          ? "w-[var(--sidebar-width-collapsed)]"
          : "w-[var(--sidebar-width)]",
      )}
    >
      {/* Top: Logo + Toggle */}
      <div className="flex items-center border-b h-14 px-3 gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
          <Zap className="h-4 w-4 text-primary" />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold text-sidebar-foreground flex-1 whitespace-nowrap overflow-hidden">
            Matrx Local
          </span>
        )}
        <button
          onClick={toggleCollapsed}
          className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors flex-shrink-0"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map(({ to, icon: Icon, label }) => {
          const active = isActive(to);
          return (
            <Tooltip key={to} delayDuration={collapsed ? 0 : 700}>
              <TooltipTrigger asChild>
                <Link
                  to={to}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors whitespace-nowrap overflow-hidden",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {!collapsed && <span>{label}</span>}
                </Link>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right">{label}</TooltipContent>}
            </Tooltip>
          );
        })}
      </nav>

      {/* Engine Status (bottom) */}
      <div className="border-t p-2">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 whitespace-nowrap overflow-hidden",
                collapsed && "justify-center px-0",
              )}
            >
              <div
                className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  statusColors[engineStatus],
                )}
              />
              {!collapsed && (
                <span className="text-xs text-sidebar-foreground/60">
                  {statusLabels[engineStatus]}
                </span>
              )}
            </div>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">
              {statusLabels[engineStatus]}
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </aside>
  );
}
