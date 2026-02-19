import {
  Activity,
  Chrome,
  Cpu,
  Globe,
  HardDrive,
  Monitor,
  Server,
  Wrench,
  Zap,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import type { EngineStatus } from "@/hooks/use-engine";
import type { SystemInfo, BrowserStatus } from "@/lib/api";

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
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        title="Dashboard"
        description="System overview and engine status"
        engineStatus={engineStatus}
        engineUrl={engineUrl}
      >
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <Activity className="h-4 w-4" />
          Refresh
        </Button>
      </Header>

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
              title="Platform"
              value={systemInfo?.platform ?? "Unknown"}
              description={systemInfo?.architecture ?? ""}
              icon={<Monitor className="h-4 w-4" />}
              variant="default"
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

            {/* Browser Status */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4 text-primary" />
                  Local Browser Scraping
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {browserStatus ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Chrome Detected
                      </span>
                      <Badge
                        variant={
                          browserStatus.chrome_found ? "success" : "warning"
                        }
                      >
                        {browserStatus.chrome_found ? "Yes" : "No"}
                      </Badge>
                    </div>
                    {browserStatus.chrome_path && (
                      <InfoRow
                        label="Path"
                        value={browserStatus.chrome_path}
                        mono
                      />
                    )}
                    {browserStatus.chrome_version && (
                      <InfoRow
                        label="Version"
                        value={browserStatus.chrome_version}
                      />
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        User Profile
                      </span>
                      <Badge
                        variant={
                          browserStatus.profile_found ? "success" : "secondary"
                        }
                      >
                        {browserStatus.profile_found
                          ? "Available"
                          : "Not Found"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Browser Engine
                      </span>
                      <Badge
                        variant={
                          browserStatus.browser_running
                            ? "success"
                            : "secondary"
                        }
                      >
                        {browserStatus.browser_running ? "Running" : "Standby"}
                      </Badge>
                    </div>
                    <Separator />
                    <p className="text-xs text-muted-foreground">
                      Local browser scraping uses your installed Chrome with
                      your real cookies and IP address. This is the most
                      effective approach for sites with aggressive anti-bot
                      protection.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {engineStatus === "connected"
                      ? "Loading browser status..."
                      : "Connect to engine to view browser status"}
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
