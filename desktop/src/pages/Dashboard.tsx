import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Bluetooth,
  Chrome,
  Cpu,
  Globe,
  HardDrive,
  Mic,
  Monitor,
  Server,
  Shield,
  Wifi,
  Wrench,
  Zap,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ArrowRight,
  User,
  Mail,
  LogOut,
  Battery,
  MemoryStick,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { engine } from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";
import type { SystemInfo, BrowserStatus, PermissionInfo } from "@/lib/api";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface DashboardProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
  systemInfo: SystemInfo | null;
  browserStatus: BrowserStatus | null;
  onRefresh: () => void;
  user: SupabaseUser | null;
  onSignOut?: () => void;
}

interface ResourceMetrics {
  cpu_percent?: number;
  memory_percent?: number;
  memory_used_gb?: number;
  memory_total_gb?: number;
  disk_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  battery_percent?: number;
  battery_plugged?: boolean;
  uptime_seconds?: number;
}

export function Dashboard({
  engineStatus,
  engineUrl,
  tools,
  systemInfo,
  browserStatus,
  onRefresh,
  user,
  onSignOut,
}: DashboardProps) {
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);
  const [resources, setResources] = useState<ResourceMetrics | null>(null);
  const resourceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPermissions = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const result = await engine.getDevicePermissions();
      setPermissions(result.permissions);
    } catch {
      // non-critical
    }
  }, [engineStatus]);

  const loadResources = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const result = await engine.invokeTool("SystemResources", {});
      if (result.type !== "error" && result.metadata) {
        setResources(result.metadata as ResourceMetrics);
      }
    } catch {
      // non-critical
    }
  }, [engineStatus]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  useEffect(() => {
    loadResources();
    if (engineStatus === "connected") {
      resourceIntervalRef.current = setInterval(loadResources, 10000);
    }
    return () => {
      if (resourceIntervalRef.current) {
        clearInterval(resourceIntervalRef.current);
        resourceIntervalRef.current = null;
      }
    };
  }, [loadResources, engineStatus]);

  const grantedCount = permissions.filter((p) => p.status === "granted").length;
  const totalCount = permissions.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Dashboard"
        description="System overview and engine status"
      >
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <Activity className="h-4 w-4" />
          Refresh
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* User Profile Card */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="relative shrink-0">
                  {user?.user_metadata?.avatar_url ? (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt="Profile"
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <User className="h-6 w-6" />
                    </div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500" />
                </div>

                {/* User info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">
                    {user?.user_metadata?.full_name ??
                      user?.user_metadata?.name ??
                      user?.user_metadata?.user_name ??
                      "Signed In"}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                    <Mail className="h-3 w-3 shrink-0" />
                    {user?.email ?? "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground capitalize">
                    {user?.app_metadata?.provider ?? "email"}
                  </p>
                </div>

                {/* Sign out */}
                {onSignOut && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={onSignOut}
                    title="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Status Cards Row */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatusCard
              title="Engine"
              value={engineStatus === "connected" ? "Online" : "Offline"}
              description={engineUrl ?? "Not discovered"}
              icon={<Server className="h-4 w-4" />}
              variant={engineStatus === "connected" ? "success" : "warning"}
            />
            <StatusCard
              title="Tools Available"
              value={String(tools.length)}
              description="Registered tools"
              icon={<Wrench className="h-4 w-4" />}
              variant="default"
            />
            <StatusCard
              title="Browser (Playwright)"
              value={
                browserStatus === null
                  ? "Checking..."
                  : browserStatus.chrome_found
                    ? "Ready"
                    : "Not Installed"
              }
              description={
                browserStatus?.chrome_version
                  ? `Chromium ${browserStatus.chrome_version}`
                  : browserStatus?.chrome_found
                    ? "Playwright ready"
                    : "Run: uv sync --extra browser"
              }
              icon={<Chrome className="h-4 w-4" />}
              variant={
                browserStatus === null
                  ? "default"
                  : browserStatus.chrome_found
                    ? "success"
                    : "warning"
              }
            />
            <StatusCard
              title="Device Access"
              value={totalCount > 0 ? `${grantedCount}/${totalCount}` : "---"}
              description={
                totalCount > 0
                  ? `${grantedCount} permissions granted`
                  : "Checking..."
              }
              icon={<Shield className="h-4 w-4" />}
              variant={
                grantedCount === totalCount && totalCount > 0
                  ? "success"
                  : grantedCount > 0
                    ? "warning"
                    : "default"
              }
            />
          </div>

          {/* Live System Resources */}
          {(resources || engineStatus === "connected") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    System Resources
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={loadResources}>
                    <Activity className="h-3 w-3" />
                    Refresh
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {resources ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <ResourceGauge
                      label="CPU"
                      value={resources.cpu_percent}
                      icon={<Cpu className="h-4 w-4" />}
                      color="text-blue-400"
                    />
                    <ResourceGauge
                      label="Memory"
                      value={resources.memory_percent}
                      detail={
                        resources.memory_used_gb != null && resources.memory_total_gb != null
                          ? `${resources.memory_used_gb.toFixed(1)} / ${resources.memory_total_gb.toFixed(1)} GB`
                          : undefined
                      }
                      icon={<MemoryStick className="h-4 w-4" />}
                      color="text-violet-400"
                    />
                    <ResourceGauge
                      label="Disk"
                      value={resources.disk_percent}
                      detail={
                        resources.disk_used_gb != null && resources.disk_total_gb != null
                          ? `${resources.disk_used_gb.toFixed(0)} / ${resources.disk_total_gb.toFixed(0)} GB`
                          : undefined
                      }
                      icon={<HardDrive className="h-4 w-4" />}
                      color="text-amber-400"
                    />
                    {resources.battery_percent != null ? (
                      <ResourceGauge
                        label="Battery"
                        value={resources.battery_percent}
                        detail={resources.battery_plugged ? "Charging" : undefined}
                        icon={<Battery className="h-4 w-4" />}
                        color={
                          resources.battery_percent > 50
                            ? "text-emerald-400"
                            : resources.battery_percent > 20
                              ? "text-amber-400"
                              : "text-red-400"
                        }
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <Battery className="h-4 w-4 text-muted-foreground/30" />
                        <span className="text-xs text-muted-foreground">AC Power</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {engineStatus === "connected"
                      ? "Loading system resources..."
                      : "Connect to engine to view live resources"}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* System Information */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="h-4 w-4 text-primary" />
                  System Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {systemInfo ? (
                  <>
                    <InfoRow label="Hostname" value={systemInfo.hostname} />
                    <InfoRow label="Platform" value={systemInfo.platform} />
                    <InfoRow
                      label="Architecture"
                      value={systemInfo.architecture}
                    />
                    <InfoRow
                      label="Python"
                      value={systemInfo.python_version}
                    />
                    <InfoRow label="User" value={systemInfo.username} />
                    <InfoRow
                      label="Working Directory"
                      value={systemInfo.cwd}
                      mono
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {engineStatus === "connected"
                      ? "Loading system information..."
                      : "Connect to engine to view system information"}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Device Access Overview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Device Access
                  </span>
                  <Link to="/devices">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                      Manage
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {permissions.length > 0 ? (
                  <>
                    {permissions.map((p) => (
                      <DeviceStatusRow key={p.permission} perm={p} />
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {engineStatus === "connected"
                      ? "Checking device permissions..."
                      : "Connect to engine to check device access"}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Tools Overview */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4 text-primary" />
                  Available Tools ({tools.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {tools.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {tools.map((tool) => (
                      <Badge key={tool} variant="secondary" className="text-xs">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No tools loaded. Connect to the engine to see available
                    tools.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// Map permission keys to icons
const PERMISSION_ICONS: Record<string, React.ReactNode> = {
  microphone: <Mic className="h-3.5 w-3.5" />,
  camera: <Monitor className="h-3.5 w-3.5" />,
  accessibility: <Shield className="h-3.5 w-3.5" />,
  bluetooth: <Bluetooth className="h-3.5 w-3.5" />,
  network: <Wifi className="h-3.5 w-3.5" />,
  screen_recording: <Monitor className="h-3.5 w-3.5" />,
  location: <Globe className="h-3.5 w-3.5" />,
};

const PERMISSION_LABELS: Record<string, string> = {
  microphone: "Microphone",
  camera: "Camera",
  accessibility: "Accessibility",
  bluetooth: "Bluetooth",
  network: "Network",
  screen_recording: "Screen Recording",
  location: "Location",
};

function DeviceStatusRow({ perm }: { perm: PermissionInfo }) {
  const icon = PERMISSION_ICONS[perm.permission] ?? <HelpCircle className="h-3.5 w-3.5" />;
  const label = PERMISSION_LABELS[perm.permission] ?? perm.permission;

  const statusIcon =
    perm.status === "granted" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    ) : perm.status === "denied" ? (
      <XCircle className="h-3.5 w-3.5 text-red-500" />
    ) : (
      <HelpCircle className="h-3.5 w-3.5 text-zinc-400" />
    );

  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-sm">{label}</span>
      {statusIcon}
    </div>
  );
}

function StatusCard({
  title,
  value,
  description,
  icon,
  variant,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  variant: "success" | "warning" | "default";
}) {
  const indicatorColor =
    variant === "success"
      ? "text-emerald-500"
      : variant === "warning"
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{title}</span>
          <span className={indicatorColor}>{icon}</span>
        </div>
        <div className="mt-2">
          <span className="text-2xl font-bold">{value}</span>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm truncate max-w-[300px] ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function ResourceGauge({
  label,
  value,
  detail,
  icon,
  color,
}: {
  label: string;
  value?: number;
  detail?: string;
  icon: React.ReactNode;
  color: string;
}) {
  const pct = value ?? 0;
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-16 w-16">
        <svg className="h-16 w-16 -rotate-90" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r={radius} fill="none" stroke="currentColor"
            className="text-muted/30" strokeWidth="4" />
          <circle cx="28" cy="28" r={radius} fill="none" stroke="currentColor"
            className={color} strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xs font-bold tabular-nums ${value == null ? "text-muted-foreground" : color}`}>
            {value != null ? `${Math.round(value)}%` : "—"}
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className={`flex items-center justify-center gap-1 ${color}`}>{icon}</div>
        <p className="text-[11px] font-medium mt-0.5">{label}</p>
        {detail && <p className="text-[10px] text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

// Re-export for use in App
export { Progress, HardDrive };
