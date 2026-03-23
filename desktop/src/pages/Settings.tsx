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
  Cpu,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Ban,
  Plus,
  X,
  HardDrive,
  RotateCcw,
  Pencil,
  Check,
  Radio,
  QrCode,
  Link,
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
import type { ProxyStatus, InstanceInfo, Capability } from "@/lib/api";
import type { useAuth } from "@/hooks/use-auth";
import type { Theme } from "@/hooks/use-theme";

declare const __APP_VERSION__: string;
import { isTauri } from "@/lib/sidecar";
import type { AutoUpdateState, AutoUpdateActions } from "@/hooks/use-auto-update";
import {
  loadSettings,
  saveSetting,
  settingsToCloud,
  type AppSettings,
} from "@/lib/settings";
import type { StoragePath } from "@/lib/api";

type AuthActions = ReturnType<typeof useAuth>;

interface SettingsProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  engineVersion: string;
  onRefresh: () => void;
  auth: AuthActions;
  theme: Theme;
  setTheme: (t: Theme) => void;
  updateState?: AutoUpdateState;
  updateActions?: AutoUpdateActions;
}

export function Settings({
  engineStatus,
  engineUrl,
  engineVersion,
  onRefresh,
  auth,
  theme,
  setTheme,
  updateState,
  updateActions,
}: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState("general");
  const [restarting, setRestarting] = useState(false);

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

  // Capabilities state
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<Record<string, { success: boolean; message: string }>>({});

  // Tunnel / remote access state
  const [tunnelStatus, setTunnelStatus] = useState<{
    running: boolean;
    url: string | null;
    ws_url: string | null;
    uptime_seconds: number;
    mode: string;
  } | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelCopied, setTunnelCopied] = useState(false);

  // Forbidden URLs state
  const [forbiddenUrls, setForbiddenUrls] = useState<string[]>([]);

  // Storage paths state
  const [storagePaths, setStoragePaths] = useState<StoragePath[]>([]);
  const [pathEditing, setPathEditing] = useState<string | null>(null);  // name of path being edited
  const [pathEditValue, setPathEditValue] = useState("");
  const [pathSaving, setPathSaving] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [newForbiddenUrl, setNewForbiddenUrl] = useState("");
  const [forbiddenSaving, setForbiddenSaving] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
    loadForbiddenUrls();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (engineStatus !== "connected") return;
    loadProxyStatus();
    loadInstanceInfo();
    loadCapabilities();
    loadStoragePaths();
    loadTunnelStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineStatus]);

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

  const loadForbiddenUrls = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const data = await engine.get("/settings/forbidden-urls") as { urls?: string[] };
      setForbiddenUrls(data?.urls ?? []);
    } catch { /* non-critical */ }
  }, [engineStatus]);

  const loadStoragePaths = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const paths = await engine.getStoragePaths();
      setStoragePaths(paths);
    } catch { /* non-critical */ }
  }, [engineStatus]);

  const startEditPath = useCallback((p: StoragePath) => {
    setPathEditing(p.name);
    setPathEditValue(p.current);
    setPathError(null);
  }, []);

  const cancelEditPath = useCallback(() => {
    setPathEditing(null);
    setPathEditValue("");
    setPathError(null);
  }, []);

  const savePathEdit = useCallback(async (name: string) => {
    setPathSaving(name);
    setPathError(null);
    try {
      const updated = await engine.setStoragePath(name, pathEditValue);
      setStoragePaths(prev => prev.map(p => p.name === name ? updated : p));
      setPathEditing(null);
    } catch (err) {
      setPathError(err instanceof Error ? err.message : "Failed to set path");
    } finally {
      setPathSaving(null);
    }
  }, [pathEditValue]);

  const resetPathToDefault = useCallback(async (name: string) => {
    setPathSaving(name);
    setPathError(null);
    try {
      const updated = await engine.resetStoragePath(name);
      setStoragePaths(prev => prev.map(p => p.name === name ? updated : p));
    } catch (err) {
      setPathError(err instanceof Error ? err.message : "Failed to reset path");
    } finally {
      setPathSaving(null);
    }
  }, []);

  const addForbiddenUrl = useCallback(async () => {
    const url = newForbiddenUrl.trim();
    if (!url) return;
    setForbiddenSaving(true);
    try {
      const data = await engine.post("/settings/forbidden-urls", { url }) as { urls?: string[] };
      setForbiddenUrls(data?.urls ?? []);
      setNewForbiddenUrl("");
    } catch { /* ignore */ }
    finally { setForbiddenSaving(false); }
  }, [newForbiddenUrl]);

  const removeForbiddenUrl = useCallback(async (url: string) => {
    try {
      const encoded = encodeURIComponent(url);
      const data = await engine.delete(`/settings/forbidden-urls/${encoded}`) as { urls?: string[] };
      setForbiddenUrls(data?.urls ?? []);
    } catch { /* ignore */ }
  }, []);

  // Update state is now managed by the useAutoUpdate hook in App.tsx.
  // Derive convenience variables from the props.
  const updateStatus = updateState?.status ?? null;
  const checking = updateState?.busy ?? false;

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    saveSetting(key, value);
  };

  const handleRestartEngine = async () => {
    setRestarting(true);
    try {
      // onRefresh now does a proper stop → start → wait → discover cycle
      // via restartEngine() in use-engine.ts when called from Settings.
      // The restart logic is centralized there.
      if (isTauri()) {
        const { stopSidecar, startSidecar } = await import("@/lib/sidecar");
        const { waitForEngine } = await import("@/lib/sidecar");
        await stopSidecar();
        // Small delay for port release
        await new Promise((r) => setTimeout(r, 500));
        await startSidecar();
        // Wait for engine to actually be ready before refreshing
        await waitForEngine("http://127.0.0.1:22140", 60, 1000);
      }
      await onRefresh();
    } catch {
      // Still try to reconnect even if restart failed
      onRefresh();
    } finally {
      setRestarting(false);
    }
  };

  const handleOpenFolder = async (folder: "logs" | "data") => {
    if (engineStatus !== "connected") return;
    try {
      await engine.openSystemFolder(folder);
    } catch {
      // Engine may not be reachable
    }
  };

  const loadCapabilities = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const result = await engine.getCapabilities();
      setCapabilities(result.capabilities);
    } catch (err) {
      console.error("[Settings] Failed to load capabilities:", err);
    }
  }, [engineStatus]);

  const handleInstallCapability = async (capabilityId: string) => {
    setInstallingId(capabilityId);
    setInstallResult((prev) => {
      const next = { ...prev };
      delete next[capabilityId];
      return next;
    });
    try {
      const result = await engine.installCapability(capabilityId);
      setInstallResult((prev) => ({ ...prev, [capabilityId]: result }));
      if (result.success) {
        // Refresh capability status after successful install
        await loadCapabilities();
      }
    } catch (err) {
      setInstallResult((prev) => ({
        ...prev,
        [capabilityId]: { success: false, message: String(err) },
      }));
    } finally {
      setInstallingId(null);
    }
  };

  const loadTunnelStatus = useCallback(async () => {
    if (engineStatus !== "connected") return;
    try {
      const status = await engine.get("/tunnel/status") as typeof tunnelStatus;
      setTunnelStatus(status);
    } catch {
      // Non-critical
    }
  }, [engineStatus]);

  const handleTunnelToggle = async (enable: boolean) => {
    setTunnelLoading(true);
    try {
      const result = await engine.post(enable ? "/tunnel/start" : "/tunnel/stop", {}) as typeof tunnelStatus;
      setTunnelStatus(result);
    } catch (err) {
      console.error("[Settings] Tunnel toggle failed:", err);
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleCopyTunnelUrl = () => {
    if (tunnelStatus?.url) {
      navigator.clipboard.writeText(tunnelStatus.url);
      setTunnelCopied(true);
      setTimeout(() => setTunnelCopied(false), 2000);
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
    { value: "storage", label: "Storage" },
    { value: "proxy", label: "Proxy" },
    { value: "remote", label: "Remote Access" },
    { value: "scraping", label: "Scraping" },
    { value: "capabilities", label: "Capabilities" },
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

                  <Separator />

                  {/* ── Wake Word / Listen Mode ───────────────────── */}
                  <div>
                    <p className="text-sm font-medium mb-3">Wake Word / Listen Mode</p>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="ww-enabled">Enable Listen Mode</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Master switch — turn off to disable wake-word detection entirely
                          </p>
                        </div>
                        <Switch
                          id="ww-enabled"
                          checked={settings.wakeWordEnabled}
                          onCheckedChange={(v) => updateSetting("wakeWordEnabled", v)}
                        />
                      </div>
                      {settings.wakeWordEnabled && (
                        <div className="flex items-center justify-between">
                          <div>
                            <Label htmlFor="ww-startup">Listen on Startup</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Automatically enter listen mode when the app launches
                            </p>
                          </div>
                          <Switch
                            id="ww-startup"
                            checked={settings.wakeWordListenOnStartup}
                            onCheckedChange={(v) => updateSetting("wakeWordListenOnStartup", v)}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <Separator />

                  {/* ── Notification Preferences ─────────────────── */}
                  <div>
                    <p className="text-sm font-medium mb-3">Notification Preferences</p>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="notif-sound">Sound Notifications</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Play a sound when a notification arrives — important for long-running tasks
                          </p>
                        </div>
                        <Switch
                          id="notif-sound"
                          checked={settings.notificationSound}
                          onCheckedChange={(v) => updateSetting("notificationSound", v)}
                        />
                      </div>

                      {settings.notificationSound && (
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Sound Style</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">Tone used for incoming notifications</p>
                          </div>
                          <Select
                            value={settings.notificationSoundStyle}
                            onValueChange={(v) => updateSetting("notificationSoundStyle", v as AppSettings["notificationSoundStyle"])}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="chime">Chime</SelectItem>
                              <SelectItem value="alert">Alert</SelectItem>
                              <SelectItem value="success">Success</SelectItem>
                              <SelectItem value="error">Error</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Storage Tab ────────────────────────────────── */}
          {activeTab === "storage" && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <HardDrive className="h-4 w-4 text-primary" /> Storage Locations
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Customise where Matrx stores your files. Changes take effect immediately — the engine creates the directory if it doesn't exist, and falls back to the default if the path is inaccessible.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {engineStatus !== "connected" && (
                    <p className="text-xs text-muted-foreground">Connect to the engine to manage storage paths.</p>
                  )}

                  {pathError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
                      <AlertCircle className="mr-1.5 inline h-4 w-4" />
                      {pathError}
                    </div>
                  )}

                  {storagePaths.filter(p => p.user_visible).map((p, i) => (
                    <div key={p.name}>
                      {i > 0 && <Separator className="my-3" />}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm font-medium">{p.label}</Label>
                            {p.is_custom && (
                              <Badge variant="secondary" className="ml-2 text-xs">Custom</Badge>
                            )}
                          </div>
                          <div className="flex gap-1.5">
                            {p.is_custom && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                disabled={pathSaving === p.name}
                                onClick={() => resetPathToDefault(p.name)}
                                title="Reset to default"
                              >
                                {pathSaving === p.name ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => pathEditing === p.name ? cancelEditPath() : startEditPath(p)}
                            >
                              {pathEditing === p.name ? (
                                <X className="h-3.5 w-3.5" />
                              ) : (
                                <Pencil className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        </div>

                        {pathEditing === p.name ? (
                          <div className="flex gap-2">
                            <Input
                              value={pathEditValue}
                              onChange={e => setPathEditValue(e.target.value)}
                              placeholder={p.default}
                              className="h-8 font-mono text-xs flex-1"
                              onKeyDown={e => {
                                if (e.key === "Enter") savePathEdit(p.name);
                                if (e.key === "Escape") cancelEditPath();
                              }}
                            />
                            <Button
                              size="sm"
                              className="h-8 px-3"
                              disabled={pathSaving === p.name || !pathEditValue.trim()}
                              onClick={() => savePathEdit(p.name)}
                            >
                              {pathSaving === p.name ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <code className="block truncate rounded bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                            {p.current}
                          </code>
                        )}

                        {!p.is_custom && (
                          <p className="text-xs text-muted-foreground">Default location</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {storagePaths.length > 0 && (
                    <div className="pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={loadStoragePaths}
                        disabled={engineStatus !== "connected"}
                      >
                        <RefreshCw className="h-4 w-4" /> Refresh
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {storagePaths.filter(p => !p.user_visible).length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
                      <HardDrive className="h-4 w-4" /> Internal Directories
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Engine internals — only change these if you have a specific reason to.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {storagePaths.filter(p => !p.user_visible).map((p, i) => (
                      <div key={p.name}>
                        {i > 0 && <Separator className="my-3" />}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium text-muted-foreground">{p.label}</Label>
                            {p.is_custom && <Badge variant="secondary" className="text-xs">Custom</Badge>}
                          </div>
                          <code className="block truncate rounded bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                            {p.current}
                          </code>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
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

          {/* ── Remote Access Tab ────────────────────────────── */}
          {activeTab === "remote" && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Radio className="h-4 w-4 text-primary" /> Remote Access
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Open this engine to the internet so you can connect from your phone,
                    tablet, or any browser — without port forwarding or a static IP.
                    Powered by Cloudflare Tunnel.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {engineStatus !== "connected" && (
                    <p className="text-xs text-muted-foreground">
                      Connect to the engine to manage remote access.
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="tunnel-enabled">Enable Remote Access</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Start a secure tunnel so remote devices can connect to this engine
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {tunnelLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Switch
                        id="tunnel-enabled"
                        checked={tunnelStatus?.running ?? false}
                        disabled={tunnelLoading || engineStatus !== "connected"}
                        onCheckedChange={handleTunnelToggle}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Tunnel Status</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tunnelStatus?.running
                          ? `Active · ${tunnelStatus.mode === "named" ? "Named tunnel (stable URL)" : "Quick tunnel (URL changes on restart)"}`
                          : "Tunnel is not running"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={tunnelStatus?.running ? "success" : "secondary"}>
                        {tunnelStatus?.running ? "Running" : "Stopped"}
                      </Badge>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={loadTunnelStatus}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {tunnelStatus?.running && tunnelStatus.url && (
                    <>
                      <Separator />

                      <div className="space-y-2">
                        <Label>Public URL</Label>
                        <p className="text-xs text-muted-foreground">
                          Share this URL with any authorized device to connect remotely
                        </p>
                        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                          <Link className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <code className="flex-1 truncate text-xs font-mono text-foreground">
                            {tunnelStatus.url}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 shrink-0"
                            onClick={handleCopyTunnelUrl}
                            title="Copy URL"
                          >
                            {tunnelCopied
                              ? <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
                              : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                          <a
                            href={tunnelStatus.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            title="Open in browser"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>WebSocket URL</Label>
                        <p className="text-xs text-muted-foreground">
                          Use this in your mobile app or custom client
                        </p>
                        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                          <code className="flex-1 truncate text-xs font-mono text-muted-foreground">
                            {tunnelStatus.ws_url}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 shrink-0"
                            onClick={() => {
                              if (tunnelStatus.ws_url) {
                                navigator.clipboard.writeText(tunnelStatus.ws_url);
                              }
                            }}
                            title="Copy WebSocket URL"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <QrCode className="h-3.5 w-3.5" />
                          <span>Scan on mobile to connect instantly</span>
                        </div>
                        <span className="font-mono text-muted-foreground">
                          {tunnelStatus.uptime_seconds > 3600
                            ? `${Math.floor(tunnelStatus.uptime_seconds / 3600)}h up`
                            : tunnelStatus.uptime_seconds > 60
                              ? `${Math.floor(tunnelStatus.uptime_seconds / 60)}m up`
                              : `${Math.floor(tunnelStatus.uptime_seconds)}s up`}
                        </span>
                      </div>
                    </>
                  )}

                  {!tunnelStatus?.running && (
                    <div className="rounded-lg border border-muted bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                      <p className="font-medium text-foreground/70">How it works</p>
                      <p>
                        Enabling remote access starts a secure outbound tunnel via Cloudflare.
                        Each installation gets its own unique URL — no port forwarding, no firewall changes, works on every network.
                      </p>
                      <p>
                        The URL is a random <code className="font-mono bg-muted px-1 rounded">*.trycloudflare.com</code> address that is saved to your account so your phone and other devices can always find this PC automatically.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Monitor className="h-4 w-4 text-primary" /> Connected Devices
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Devices linked to your account that can connect remotely.
                    Active tunnel URLs are stored in the cloud and visible to your mobile app.
                  </p>
                </CardHeader>
                <CardContent>
                  {instances.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      No registered devices found. Sign in and configure cloud sync to register this device.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {instances.map((inst) => {
                        const isThis = inst.instance_id === instanceInfo?.instance_id;
                        const hasTunnel = !!(inst as { tunnel_url?: string }).tunnel_url;
                        return (
                          <div
                            key={inst.instance_id}
                            className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {inst.instance_name || inst.hostname || "Unknown"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {inst.platform} {inst.architecture}
                                  {inst.last_seen && ` · ${new Date(inst.last_seen).toLocaleDateString()}`}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {hasTunnel && (
                                <Badge variant="success" className="text-xs gap-1">
                                  <Radio className="h-2.5 w-2.5" /> Tunnel Active
                                </Badge>
                              )}
                              {isThis && (
                                <Badge variant="outline" className="text-xs">This Device</Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Scraping Tab ─────────────────────────────────── */}
          {activeTab === "scraping" && (
            <>
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

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Ban className="h-4 w-4 text-destructive" /> Forbidden URLs
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  These domains or patterns are blocked from scraping, even if requested by an AI.
                  Use <code className="font-mono bg-muted px-1 rounded">*.example.com</code> to block all subdomains.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={newForbiddenUrl}
                    onChange={(e) => setNewForbiddenUrl(e.target.value)}
                    placeholder="example.com or *.ads-tracker.io"
                    className="font-mono text-xs flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter") addForbiddenUrl(); }}
                  />
                  <Button
                    size="sm"
                    onClick={addForbiddenUrl}
                    disabled={forbiddenSaving || !newForbiddenUrl.trim() || engineStatus !== "connected"}
                    className="gap-1.5 shrink-0"
                  >
                    {forbiddenSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Add
                  </Button>
                </div>

                {forbiddenUrls.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">
                    No forbidden URLs configured. All domains are allowed.
                  </p>
                ) : (
                  <ScrollArea className="max-h-48">
                    <div className="space-y-1">
                      {forbiddenUrls.map((url) => (
                        <div
                          key={url}
                          className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
                        >
                          <Ban className="h-3 w-3 text-destructive/60 shrink-0" />
                          <code className="flex-1 text-xs font-mono text-foreground/80 truncate">{url}</code>
                          <button
                            onClick={() => removeForbiddenUrl(url)}
                            className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                            title="Remove"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                {engineStatus !== "connected" && (
                  <p className="text-xs text-muted-foreground">
                    Connect to the engine to manage forbidden URLs.
                  </p>
                )}
              </CardContent>
            </Card>
            </>
          )}

          {/* ── Capabilities Tab ─────────────────────────────── */}
          {activeTab === "capabilities" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="h-4 w-4 text-primary" /> Capabilities
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Most capabilities are bundled and ready to use. Only large AI models (e.g. Whisper) require separate installation.
                </p>
              </CardHeader>
              <CardContent className="space-y-1 p-0">
                {capabilities.length === 0 && engineStatus !== "connected" && (
                  <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                    Engine not connected — capability status unavailable.
                  </div>
                )}
                {capabilities.length === 0 && engineStatus === "connected" && (
                  <div className="flex items-center justify-center gap-2 px-6 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                  </div>
                )}
                {capabilities.map((cap, idx) => {
                  const isInstalled = cap.status === "installed";
                  const isInstalling = installingId === cap.id;
                  const result = installResult[cap.id];
                  return (
                    <div key={cap.id}>
                      {idx > 0 && <Separator />}
                      <div className="px-6 py-4 space-y-2">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="mt-0.5 shrink-0">
                              {isInstalled ? (
                                <CircleCheck className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <CircleDashed className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">{cap.name}</span>
                                <Badge variant={isInstalled ? "success" : "secondary"} className="text-xs">
                                  {isInstalled ? "Installed" : "Not installed"}
                                </Badge>
                                {cap.size_warning && !isInstalled && (
                                  <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/40">
                                    {cap.size_warning}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                {cap.description}
                              </p>
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {cap.packages.map((pkg) => (
                                  <code key={pkg} className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                                    {pkg}
                                  </code>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {cap.docs_url && (
                              <a
                                href={cap.docs_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                            {!isInstalled && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleInstallCapability(cap.id)}
                                disabled={isInstalling || engineStatus !== "connected"}
                              >
                                {isInstalling ? (
                                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing...</>
                                ) : (
                                  <><Download className="h-3.5 w-3.5" /> Install</>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                        {result && (
                          <div className={`rounded-md border px-3 py-2 text-xs ${
                            result.success
                              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                              : "border-red-500/30 bg-red-500/5 text-red-400"
                          }`}>
                            {result.success ? (
                              <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
                            ) : (
                              <AlertCircle className="mr-1.5 inline h-3.5 w-3.5" />
                            )}
                            {result.message}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {capabilities.length > 0 && (
                  <div className="px-6 py-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={loadCapabilities}
                    >
                      <RefreshCw className="h-3 w-3" /> Refresh Status
                    </Button>
                  </div>
                )}
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
                                : updateStatus?.status === "downloading"
                                  ? "Downloading update..."
                                  : updateStatus?.status === "up_to_date"
                                    ? "You're on the latest version"
                                    : "Check for new releases"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {updateStatus?.status === "installed" ? (
                            <Button size="sm" onClick={() => updateActions?.restart()}>
                              <RefreshCw className="h-4 w-4" /> Restart
                            </Button>
                          ) : updateStatus?.status === "available" ? (
                            <Button size="sm" onClick={() => updateActions?.openDialog()} disabled={checking}>
                              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                              Install Update
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => updateActions?.check()} disabled={checking}>
                              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : updateStatus?.status === "up_to_date" ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                              Check for Updates
                            </Button>
                          )}
                        </div>
                      </div>

                      {settings && (
                        <div className="flex items-center justify-between">
                          <div>
                            <Label htmlFor="auto-check-updates">Automatic Updates</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Check for updates every {settings.updateCheckInterval >= 60 ? `${Math.round(settings.updateCheckInterval / 60)}h` : `${settings.updateCheckInterval}m`}
                            </p>
                          </div>
                          <Switch
                            id="auto-check-updates"
                            checked={settings.autoCheckUpdates}
                            onCheckedChange={(v) => updateSetting("autoCheckUpdates", v)}
                          />
                        </div>
                      )}

                      {settings?.autoCheckUpdates && (
                        <div className="flex items-center justify-between">
                          <Label htmlFor="update-interval">Check Interval</Label>
                          <Select
                            value={String(settings.updateCheckInterval)}
                            onValueChange={(v) => updateSetting("updateCheckInterval", Number(v))}
                          >
                            <SelectTrigger className="w-32" id="update-interval">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="60">1 hour</SelectItem>
                              <SelectItem value="240">4 hours</SelectItem>
                              <SelectItem value="720">12 hours</SelectItem>
                              <SelectItem value="1440">24 hours</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

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
