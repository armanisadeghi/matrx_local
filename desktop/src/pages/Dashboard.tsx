import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { engine } from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";
import type { SystemInfo, BrowserStatus, PermissionInfo } from "@/lib/api";

interface DashboardProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
  systemInfo: SystemInfo | null;
  browserStatus: BrowserStatus | null;
  onRefresh: () => void;
}

export function Dashboard({
  engineStatus,
  engineUrl,
  tools,
  systemInfo,
  browserStatus,
  onRefresh,
}: DashboardProps) {
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);

  const loadPermissions = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const result = await engine.getDevicePermissions();
      setPermissions(result.permissions);
    } catch {
      // non-critical
    }
  }, [engineStatus]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

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
              title="Browser"
              value={browserStatus?.chrome_found ? "Ready" : "Not Found"}
              description={
                browserStatus?.chrome_version
                  ? `Chrome ${browserStatus.chrome_version}`
                  : "Install Chrome for local scraping"
              }
              icon={<Chrome className="h-4 w-4" />}
              variant={browserStatus?.chrome_found ? "success" : "warning"}
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

// Re-export for use in App
export { Progress, HardDrive };
