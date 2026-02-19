import { useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  Server,
  Globe,
  Palette,
  RefreshCw,
  Power,
  FolderOpen,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { EngineStatus } from "@/hooks/use-engine";
import { engine } from "@/lib/api";
import type { useAuth } from "@/hooks/use-auth";
import type { Theme } from "@/hooks/use-theme";
import { isTauri } from "@/lib/sidecar";
import {
  loadSettings,
  saveSetting,
  type AppSettings,
} from "@/lib/settings";

type AuthActions = ReturnType<typeof useAuth>;

interface SettingsProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  onRefresh: () => void;
  auth: AuthActions;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export function Settings({
  engineStatus,
  engineUrl,
  onRefresh,
  auth,
  theme,
  setTheme,
}: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    saveSetting(key, value);
  };

  const handleRestartEngine = async () => {
    if (!isTauri()) {
      onRefresh();
      return;
    }
    setRestarting(true);
    try {
      const { stopSidecar, startSidecar } = await import("@/lib/sidecar");
      await stopSidecar();
      await startSidecar();
      await onRefresh();
    } catch {
      onRefresh();
    } finally {
      setRestarting(false);
    }
  };

  const handleOpenFolder = async (folder: "logs" | "data") => {
    if (engineStatus !== "connected") return;
    const subpath = folder === "logs" ? "system/logs" : "system/data";
    try {
      await engine.invokeTool("OpenPath", { path: subpath });
    } catch {
      // Engine may not be reachable
    }
  };

  if (!settings) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        title="Settings"
        description="Configure the desktop application"
        engineStatus={engineStatus}
        engineUrl={engineUrl}
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          {/* Engine Connection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4 text-primary" />
                Engine Connection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Status</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Current engine connection state
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      engineStatus === "connected" ? "success" : "secondary"
                    }
                  >
                    {engineStatus}
                  </Badge>
                  {engineUrl && (
                    <span className="text-xs font-mono text-muted-foreground">
                      {engineUrl}
                    </span>
                  )}
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label>Engine Port</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Port range 22140-22159 is scanned automatically
                  </p>
                </div>
                <Input
                  value="22140"
                  disabled
                  className="w-24 text-right font-mono text-sm"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                  className="flex-1"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reconnect
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestartEngine}
                  disabled={restarting}
                  className="flex-1"
                >
                  <Power className="h-4 w-4" />
                  {restarting ? "Restarting..." : "Restart Engine"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Scraping Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4 text-primary" />
                Scraping
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="headless">Headless Mode</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Run browser without visible window during scraping
                  </p>
                </div>
                <Switch
                  id="headless"
                  checked={settings.headlessScraping}
                  onCheckedChange={(v) => updateSetting("headlessScraping", v)}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label>Request Delay</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Minimum seconds between requests to the same domain
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={settings.scrapeDelay}
                    onChange={(e) =>
                      updateSetting("scrapeDelay", e.target.value)
                    }
                    className="w-20 text-right font-mono text-sm"
                    type="number"
                    min="0.5"
                    max="30"
                    step="0.5"
                  />
                  <span className="text-xs text-muted-foreground">sec</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Application Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Palette className="h-4 w-4 text-primary" />
                Application
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Theme</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Choose the application color scheme
                  </p>
                </div>
                <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="startup">Launch on Startup</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Start AI Matrx when you log in
                  </p>
                </div>
                <Switch
                  id="startup"
                  checked={settings.launchOnStartup}
                  onCheckedChange={(v) => updateSetting("launchOnStartup", v)}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="tray">Minimize to Tray</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Keep running in system tray when window is closed
                  </p>
                </div>
                <Switch
                  id="tray"
                  checked={settings.minimizeToTray}
                  onCheckedChange={(v) => updateSetting("minimizeToTray", v)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Account */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4 text-primary" />
                Account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {auth.user ? (
                <>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={auth.user.user_metadata?.avatar_url} />
                      <AvatarFallback>
                        {(auth.user.email?.[0] ?? "U").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {auth.user.user_metadata?.full_name ?? auth.user.email}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {auth.user.email}
                      </p>
                    </div>
                    <Badge variant="success" className="shrink-0">
                      {auth.user.app_metadata?.provider ?? "email"}
                    </Badge>
                  </div>
                  <Separator />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={auth.signOut}
                    disabled={auth.loading}
                  >
                    <Power className="h-4 w-4" />
                    Sign Out
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Not signed in</p>
              )}
            </CardContent>
          </Card>

          {/* About */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <SettingsIcon className="h-4 w-4 text-primary" />
                About
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Version</span>
                <Badge variant="secondary">1.0.0</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Engine Version
                </span>
                <Badge variant="secondary">0.3.0</Badge>
              </div>
              <Separator />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleOpenFolder("logs")}
                  disabled={engineStatus !== "connected"}
                >
                  <FolderOpen className="h-4 w-4" />
                  Open Logs Folder
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleOpenFolder("data")}
                  disabled={engineStatus !== "connected"}
                >
                  <FolderOpen className="h-4 w-4" />
                  Open Data Folder
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
