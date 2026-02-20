import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Globe,
  Wrench,
  Settings,
  Activity,
  FileText,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EngineStatus } from "@/hooks/use-engine";

interface SidebarProps {
  engineStatus: EngineStatus;
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/documents", icon: FileText, label: "Documents" },
  { to: "/scraping", icon: Globe, label: "Scraping" },
  { to: "/tools", icon: Wrench, label: "Tools" },
  { to: "/activity", icon: Activity, label: "Activity" },
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

export function Sidebar({ engineStatus }: SidebarProps) {
  return (
    <aside className="no-select flex h-full w-16 flex-col items-center border-r bg-background/50 py-4">
      {/* Logo */}
      <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
        <Zap className="h-5 w-5 text-primary" />
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <Tooltip key={to} delayDuration={0}>
            <TooltipTrigger asChild>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )
                }
              >
                <Icon className="h-5 w-5" />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>

      {/* Engine Status Indicator */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <div className="mt-auto flex h-10 w-10 items-center justify-center">
            <div
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                statusColors[engineStatus]
              )}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {statusLabels[engineStatus]}
        </TooltipContent>
      </Tooltip>
    </aside>
  );
}
