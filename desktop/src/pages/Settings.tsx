import { useState, useEffect, useCallback } from "react";
import {
  Settings as SettingsIcon,
  Server,
  Globe,
  Palette,
  RefreshCw,
  Power,
  FolderOpen,
  Download,
  Loader2,
  CheckCircle2,
  Cloud,
  CloudOff,
  ArrowUpFromLine,
  ArrowDownToLine,
  Shield,
  Monitor,
  Wifi,
  AlertCircle,
  Copy,
  CheckCheck,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SubTabBar } from "@/components/layout/SubTabBar";
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
import type { ProxyStatus, InstanceInfo } from "@/lib/api";
import type { useAuth } from "@/hooks/use-auth";
import type { Theme } from "@/hooks/use-theme";

declare const __APP_VERSION__: string;
import { isTauri, checkForUpdates, restartApp, type UpdateStatus } from "@/lib/sidecar";
import {
  loadSettings,
  saveSetting,
  settingsToCloud,
  type AppSettings,
} from "@/lib/settings";

type AuthActions = ReturnType<typeof useAuth>;

interface SettingsProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  engineVersion: string;
  onRefresh: () => void;
  auth: AuthActions;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export function Settings({
  engineStatus,
  engineUrl,
  engineVersion,
  onRefresh,
  auth,
  theme,
  setTheme,
}: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState("general");
  const [restarting, setRestarting] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  // Proxy state
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<string | null>(null);

  // Cloud sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfo | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
    loadProxyStatus();
    loadInstanceInfo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProxyStatus = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const status = await engine.proxyStatus();
      setProxyStatus(status);
    } catch {
      // Engine may not support proxy yet
    }
  }, [engineStatus]);

  const loadInstanceInfo = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const info = await engine.getInstanceInfo();
      setInstanceInfo(info);
    } catch {
      // Non-critical
    }
    try {
      const result = await engine.listInstances();
      setInstances(result.instances || []);
    } catch {
      // Non-critical
    }
  }, [engineStatus]);

  const handleCheckUpdate = async (install = false) => {
    setChecking(true);
    try {
      const status = await checkForUpdates(install);
      setUpdateStatus(status);
    } catch {
      setUpdateStatus({ status: "up_to_date" });
    } finally {
      setChecking(false);
    }
  };

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

  // Proxy handlers
  const handleProxyTest = async () => {
    setProxyTesting(true);
    setProxyTestResult(null);
    try {
      const result = await engine.proxyTest();
      if (result.success) {
        setProxyTestResult(`Connected via ${result.proxy_url}`);
      } else {
        setProxyTestResult(`Failed: ${result.error}`);
      }
    } catch (err) {
      setProxyTestResult(`Error: ${err}`);
    } finally {
      setProxyTesting(false);
      loadProxyStatus();
    }
  };

  // Cloud sync handlers
  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const result = await engine.triggerCloudSync();
      setSyncStatus(`Sync ${result.status}${result.reason ? `: ${result.reason}` : ""}`);
      if (result.settings) {
        const updated = await loadSettings();
        setSettings(updated);
      }
    } catch (err) {
      setSyncStatus(`Sync failed: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  const handlePushToCloud = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      if (settings) {
        await engine.updateCloudSettings(settingsToCloud(settings));
      }
      const result = await engine.pushCloudSettings();
      setSyncStatus(`Push ${result.status}`);
    } catch (err) {
      setSyncStatus(`Push failed: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  const handlePullFromCloud = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const result = await engine.pullCloudSettings();
      setSyncStatus(`Pull ${result.status}`);
      if (result.settings) {
        const updated = await loadSettings();
        setSettings(updated);
      }
    } catch (err) {
      setSyncStatus(`Pull failed: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleCopyProxyUrl = () => {
    if (proxyStatus?.proxy_url) {
      navigator.clipboard.writeText(proxyStatus.proxy_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!settings) return null;

  const settingsTabs = [
    { value: "general", label: "General" },
    { value: "proxy", label: "Proxy" },
    { value: "scraping", label: "Scraping" },
    { value: "cloud", label: "Cloud & Account" },
    { value: "about", label: "About" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Settings"
        description="Configure the desktop application and cloud sync"
      />

      <SubTabBar tabs={settingsTabs} value={activeTab} onValueChange={setActiveTab} />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl space-y-6 p-6">

          {/* ── General Tab ──────────────────────────────────── */}
          {activeTab === "general" && (
            <>
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
                      <Badge variant={engineStatus === "connected" ? "success" : "secondary"}>
                        {engineStatus}
                      </Badge>
                      {engineUrl && (
                        <span className="text-xs font-mono text-muted-foreground">{engineUrl}</span>
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
                    <Input value="22140" disabled className="w-24 text-right font-mono text-sm" />
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={onRefresh} className="flex-1">
                      <RefreshCw className="h-4 w-4" /> Reconnect
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleRestartEngine} disabled={restarting} className="flex-1">
                      <Power className="h-4 w-4" /> {restarting ? "Restarting..." : "Restart Engine"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Application Settings */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Palette className="h-4 w-4 text-primary" /> Application
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
                    <Select
                      value={theme}
                      onValueChange={(v) => {
                        setTheme(v as Theme);
                        updateSetting("theme", v as AppSettings["theme"]);
                      }}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
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
                      <p className="text-xs text-muted-foreground mt-0.5">Start AI Matrx when you log in</p>
                    </div>
                    <Switch id="startup" checked={settings.launchOnStartup} onCheckedChange={(v) => updateSetting("launchOnStartup", v)} />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="tray">Minimize to Tray</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">Keep running in system tray when window is closed</p>
                    </div>
                    <Switch id="tray" checked={settings.minimizeToTray} onCheckedChange={(v) => updateSetting("minimizeToTray", v)} />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Proxy Tab ────────────────────────────────────── */}
          {activeTab === "proxy" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-primary" /> Local Proxy
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="proxy-enabled">Enable Proxy Server</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Allow your computer to be used as an HTTP proxy for AI Matrx cloud services
                    </p>
                  </div>
                  <Switch
                    id="proxy-enabled"
                    checked={settings.proxyEnabled}
                    onCheckedChange={(v) => updateSetting("proxyEnabled", v)}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Proxy Status</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Current state of the local HTTP proxy</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={proxyStatus?.running ? "success" : "secondary"}>
                      {proxyStatus?.running ? "Running" : "Stopped"}
                    </Badge>
                    {proxyStatus?.running && (
                      <span className="text-xs font-mono text-muted-foreground">:{proxyStatus.port}</span>
                    )}
                  </div>
                </div>

                {proxyStatus?.running && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Proxy URL</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Use this URL to route traffic through your machine</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <code className="rounded bg-muted px-2 py-1 text-xs font-mono">{proxyStatus.proxy_url}</code>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCopyProxyUrl}>
                          {copied ? <CheckCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-lg font-semibold">{proxyStatus.request_count}</p>
                        <p className="text-xs text-muted-foreground">Requests</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-lg font-semibold">
                          {proxyStatus.bytes_forwarded > 1048576
                            ? `${(proxyStatus.bytes_forwarded / 1048576).toFixed(1)}MB`
                            : proxyStatus.bytes_forwarded > 1024
                              ? `${(proxyStatus.bytes_forwarded / 1024).toFixed(1)}KB`
                              : `${proxyStatus.bytes_forwarded}B`}
                        </p>
                        <p className="text-xs text-muted-foreground">Forwarded</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-lg font-semibold">{proxyStatus.active_connections}</p>
                        <p className="text-xs text-muted-foreground">Active</p>
                      </div>
                    </div>
                  </>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={handleProxyTest} disabled={proxyTesting || !proxyStatus?.running}>
                    {proxyTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                    Test Connection
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={loadProxyStatus}>
                    <RefreshCw className="h-4 w-4" /> Refresh Status
                  </Button>
                </div>

                {proxyTestResult && (
                  <div className={`rounded-lg border p-3 text-sm ${
                    proxyTestResult.startsWith("Connected")
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                      : "border-red-500/30 bg-red-500/5 text-red-400"
                  }`}>
                    {proxyTestResult.startsWith("Connected") ? (
                      <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
                    ) : (
                      <AlertCircle className="mr-1.5 inline h-4 w-4" />
                    )}
                    {proxyTestResult}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Scraping Tab ─────────────────────────────────── */}
          {activeTab === "scraping" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4 text-primary" /> Scraping
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
                      onChange={(e) => updateSetting("scrapeDelay", e.target.value)}
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
          )}

          {/* ── Cloud & Account Tab ──────────────────────────── */}
          {activeTab === "cloud" && (
            <>
              {/* Cloud Sync */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Cloud className="h-4 w-4 text-primary" /> Cloud Sync
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Sync Status</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Settings are synchronized between this device and the cloud
                      </p>
                    </div>
                    <Badge variant={auth.isAuthenticated ? "success" : "secondary"}>
                      {auth.isAuthenticated ? "Connected" : "Not Signed In"}
                    </Badge>
                  </div>

                  {instanceInfo && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>Instance ID</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">Unique identifier for this installation</p>
                        </div>
                        <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
                          {instanceInfo.instance_id.slice(0, 20)}...
                        </code>
                      </div>
                    </>
                  )}

                  {instances.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <Label>Registered Devices</Label>
                        <p className="text-xs text-muted-foreground mt-0.5 mb-2">All devices linked to your account</p>
                        <div className="space-y-2">
                          {instances.map((inst) => (
                            <div key={inst.instance_id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Monitor className="h-4 w-4 text-muted-foreground" />
                                <div>
                                  <p className="text-sm font-medium">{inst.instance_name || inst.hostname || "Unknown"}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {inst.platform} {inst.architecture}
                                    {inst.last_seen && ` · ${new Date(inst.last_seen).toLocaleDateString()}`}
                                  </p>
                                </div>
                              </div>
                              {inst.instance_id === instanceInfo?.instance_id && (
                                <Badge variant="outline" className="text-xs">This Device</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={handlePushToCloud} disabled={syncing || !auth.isAuthenticated}>
                      {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpFromLine className="h-4 w-4" />}
                      Save to Cloud
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={handlePullFromCloud} disabled={syncing || !auth.isAuthenticated}>
                      {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
                      Pull from Cloud
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || !auth.isAuthenticated}>
                      {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                  </div>

                  {syncStatus && (
                    <div className={`rounded-lg border p-3 text-sm ${
                      syncStatus.includes("error") || syncStatus.includes("failed")
                        ? "border-red-500/30 bg-red-500/5 text-red-400"
                        : "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                    }`}>
                      {syncStatus.includes("error") || syncStatus.includes("failed") ? (
                        <CloudOff className="mr-1.5 inline h-4 w-4" />
                      ) : (
                        <Cloud className="mr-1.5 inline h-4 w-4" />
                      )}
                      {syncStatus}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Account */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Server className="h-4 w-4 text-primary" /> Account
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {auth.user ? (
                    <>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={auth.user.user_metadata?.avatar_url} />
                          <AvatarFallback>{(auth.user.email?.[0] ?? "U").toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{auth.user.user_metadata?.full_name ?? auth.user.email}</p>
                          <p className="truncate text-xs text-muted-foreground">{auth.user.email}</p>
                        </div>
                        <Badge variant="success" className="shrink-0">{auth.user.app_metadata?.provider ?? "email"}</Badge>
                      </div>
                      <Separator />
                      <Button variant="outline" size="sm" className="w-full" onClick={auth.signOut} disabled={auth.loading}>
                        <Power className="h-4 w-4" /> Sign Out
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not signed in</p>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* ── About Tab ────────────────────────────────────── */}
          {activeTab === "about" && (
            <>
              {/* System Info */}
              {instanceInfo && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Monitor className="h-4 w-4 text-primary" /> System Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                      {([
                        ["Platform", instanceInfo.platform],
                        ["OS Version", instanceInfo.os_version],
                        ["Architecture", instanceInfo.architecture],
                        ["Hostname", instanceInfo.hostname],
                        ["CPU", instanceInfo.cpu_model],
                        ["CPU Cores", instanceInfo.cpu_cores?.toString()],
                        ["RAM", instanceInfo.ram_total_gb ? `${instanceInfo.ram_total_gb} GB` : undefined],
                        ["Python", instanceInfo.python_version],
                      ] as const)
                        .filter(([, v]) => v)
                        .map(([label, value]) => (
                          <div key={label} className="contents">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-mono text-xs">{value}</span>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* About */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <SettingsIcon className="h-4 w-4 text-primary" /> About
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Version</span>
                    <Badge variant="secondary">{__APP_VERSION__}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Engine Version</span>
                    <Badge variant="secondary">{engineVersion || "\u2014"}</Badge>
                  </div>
                  <Separator />

                  {isTauri() && (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>Updates</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {updateStatus?.status === "available"
                              ? `v${updateStatus.version} available`
                              : updateStatus?.status === "installed"
                                ? "Update installed \u2014 restart to apply"
                                : updateStatus?.status === "up_to_date"
                                  ? "You're on the latest version"
                                  : "Check for new releases"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {updateStatus?.status === "installed" ? (
                            <Button size="sm" onClick={restartApp}>
                              <RefreshCw className="h-4 w-4" /> Restart
                            </Button>
                          ) : updateStatus?.status === "available" ? (
                            <Button size="sm" onClick={() => handleCheckUpdate(true)} disabled={checking}>
                              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                              Install Update
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => handleCheckUpdate(false)} disabled={checking}>
                              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : updateStatus?.status === "up_to_date" ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                              Check for Updates
                            </Button>
                          )}
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handleOpenFolder("logs")} disabled={engineStatus !== "connected"}>
                      <FolderOpen className="h-4 w-4" /> Open Logs Folder
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handleOpenFolder("data")} disabled={engineStatus !== "connected"}>
                      <FolderOpen className="h-4 w-4" /> Open Data Folder
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

        </div>
      </ScrollArea>
    </div>
  );
}
