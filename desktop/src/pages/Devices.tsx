import { useState, useEffect, useCallback } from "react";
import {
  Mic,
  Camera,
  Bluetooth,
  Wifi,
  Monitor,
  Network,
  Shield,
  Usb,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Cpu,
  Eye,
  Wrench,
  Code2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { engine } from "@/lib/api";
import type {
  PermissionInfo,
  PermissionStatusValue,
  DeviceProbeResult,
} from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";

interface DevicesProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
}

interface DeviceSection {
  key: string;
  label: string;
  icon: React.ReactNode;
  permissionKey: string;
  probeEndpoint: (() => Promise<DeviceProbeResult>) | null;
  description: string;
}

const DEVICE_SECTIONS: DeviceSection[] = [
  {
    key: "microphone",
    label: "Microphone",
    icon: <Mic className="h-5 w-5" />,
    permissionKey: "microphone",
    probeEndpoint: () => engine.getAudioDevices(),
    description: "Audio input for voice commands, recording, and transcription",
  },
  {
    key: "camera",
    label: "Camera",
    icon: <Camera className="h-5 w-5" />,
    permissionKey: "camera",
    probeEndpoint: null,
    description: "Video input for visual processing and video calls",
  },
  {
    key: "accessibility",
    label: "Accessibility",
    icon: <Shield className="h-5 w-5" />,
    permissionKey: "accessibility",
    probeEndpoint: null,
    description: "Keyboard/mouse automation, window management, and screen control",
  },
  {
    key: "screen_recording",
    label: "Screen Recording",
    icon: <Eye className="h-5 w-5" />,
    permissionKey: "screen_recording",
    probeEndpoint: null,
    description: "Screen capture for visual AI understanding and screenshots",
  },
  {
    key: "bluetooth",
    label: "Bluetooth",
    icon: <Bluetooth className="h-5 w-5" />,
    permissionKey: "bluetooth",
    probeEndpoint: () => engine.getBluetoothDevices(),
    description: "Connect to Bluetooth peripherals, speakers, and smart devices",
  },
  {
    key: "wifi",
    label: "WiFi Networks",
    icon: <Wifi className="h-5 w-5" />,
    permissionKey: "network",
    probeEndpoint: () => engine.getWifiNetworks(),
    description: "Scan and discover WiFi networks in range",
  },
  {
    key: "network",
    label: "Network Interfaces",
    icon: <Network className="h-5 w-5" />,
    permissionKey: "network",
    probeEndpoint: () => engine.getNetworkInfo(),
    description: "Network adapters, IP addresses, and connectivity status",
  },
  {
    key: "connected",
    label: "Connected Devices",
    icon: <Usb className="h-5 w-5" />,
    permissionKey: "",
    probeEndpoint: () => engine.getConnectedDevices(),
    description: "USB devices, peripherals, and connected hardware",
  },
];

const STATUS_CONFIG: Record<
  PermissionStatusValue,
  { icon: React.ReactNode; color: string; bgColor: string; label: string }
> = {
  granted: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10 border-emerald-500/20",
    label: "Granted",
  },
  denied: {
    icon: <XCircle className="h-4 w-4" />,
    color: "text-red-500",
    bgColor: "bg-red-500/10 border-red-500/20",
    label: "Denied",
  },
  not_determined: {
    icon: <AlertCircle className="h-4 w-4" />,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10 border-amber-500/20",
    label: "Not Set",
  },
  restricted: {
    icon: <XCircle className="h-4 w-4" />,
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-400/20",
    label: "Restricted",
  },
  unavailable: {
    icon: <HelpCircle className="h-4 w-4" />,
    color: "text-zinc-500",
    bgColor: "bg-zinc-500/10 border-zinc-500/20",
    label: "Unavailable",
  },
  unknown: {
    icon: <HelpCircle className="h-4 w-4" />,
    color: "text-zinc-400",
    bgColor: "bg-zinc-500/10 border-zinc-400/20",
    label: "Unknown",
  },
};

export function Devices({ engineStatus }: DevicesProps) {
  const [permissions, setPermissions] = useState<
    Record<string, PermissionInfo>
  >({});
  const [probeResults, setProbeResults] = useState<
    Record<string, DeviceProbeResult>
  >({});
  const [loading, setLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );
  const [probing, setProbing] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<Set<string>>(new Set());
  const [showDevInfo, setShowDevInfo] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState<string>("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadPermissions = useCallback(async () => {
    if (engineStatus !== "connected") return;
    setLoading(true);
    try {
      const result = await engine.getDevicePermissions();
      setPlatform(result.platform);
      const map: Record<string, PermissionInfo> = {};
      for (const p of result.permissions) {
        map[p.permission] = p;
      }
      setPermissions(map);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to load permissions:", err);
    } finally {
      setLoading(false);
    }
  }, [engineStatus]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const handleProbe = async (section: DeviceSection) => {
    if (!section.probeEndpoint) return;
    setProbing((prev) => new Set([...prev, section.key]));
    try {
      const result = await section.probeEndpoint();
      setProbeResults((prev) => ({ ...prev, [section.key]: result }));
      // Auto-expand the section to show results
      setExpandedSections((prev) => new Set([...prev, section.key]));
    } catch (err) {
      setProbeResults((prev) => ({
        ...prev,
        [section.key]: {
          output: `Probe failed: ${err}`,
          metadata: null,
          type: "error",
        },
      }));
      setExpandedSections((prev) => new Set([...prev, section.key]));
    } finally {
      setProbing((prev) => {
        const next = new Set(prev);
        next.delete(section.key);
        return next;
      });
    }
  };

  const handleFix = async (section: DeviceSection) => {
    const perm = getPermission(section.permissionKey);
    const capId = perm?.fix_capability_id;
    if (!capId) return;
    setFixing((prev) => new Set([...prev, section.key]));
    try {
      const result = await engine.installCapability(capId);
      if (result.success) {
        // Re-check permissions after successful install
        await loadPermissions();
      }
    } catch (err) {
      console.error("Fix failed:", err);
    } finally {
      setFixing((prev) => {
        const next = new Set(prev);
        next.delete(section.key);
        return next;
      });
    }
  };

  const toggleDevInfo = (key: string) => {
    setShowDevInfo((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleExpand = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getPermission = (key: string): PermissionInfo | null => {
    return permissions[key] ?? null;
  };

  const grantedCount = Object.values(permissions).filter(
    (p) => p.status === "granted"
  ).length;
  const totalCount = Object.keys(permissions).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Devices & Permissions"
        description={
          platform
            ? `${platform} — ${grantedCount}/${totalCount} permissions granted`
            : "Device access and system permissions"
        }
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={loadPermissions}
          disabled={loading || engineStatus !== "connected"}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh All
        </Button>
      </PageHeader>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-4xl space-y-4 p-6">
          {engineStatus !== "connected" ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Monitor className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Connect to the engine to check device permissions and
                  capabilities
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary bar */}
              {totalCount > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.values(permissions).map((p) => {
                    const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.unknown;
                    return (
                      <Badge
                        key={p.permission}
                        variant="outline"
                        className={`gap-1.5 ${cfg.bgColor} ${cfg.color} border`}
                      >
                        <span className={cfg.color}>{cfg.icon}</span>
                        {p.permission.replace("_", " ")}
                      </Badge>
                    );
                  })}
                  {lastRefresh && (
                    <span className="ml-auto self-center text-xs text-muted-foreground">
                      Last checked:{" "}
                      {lastRefresh.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              )}

              {/* Device cards */}
              {DEVICE_SECTIONS.map((section) => {
                const perm = getPermission(section.permissionKey);
                const status: PermissionStatusValue =
                  perm?.status ?? "unknown";
                const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
                const isExpanded = expandedSections.has(section.key);
                const isProbing = probing.has(section.key);
                const probeResult = probeResults[section.key];

                return (
                  <Card
                    key={section.key}
                    className={`transition-all ${status === "denied"
                        ? "border-red-500/20"
                        : status === "granted"
                          ? "border-emerald-500/10"
                          : ""
                      }`}
                  >
                    <CardContent className="p-0">
                      {/* Main row */}
                      <div className="flex items-center gap-4 p-4">
                        {/* Icon */}
                        <div
                          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${cfg.bgColor}`}
                        >
                          <span className={cfg.color}>{section.icon}</span>
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-sm">
                              {section.label}
                            </h3>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${cfg.color} ${cfg.bgColor}`}
                            >
                              {cfg.label}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {perm?.user_details || section.description}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5">
                          {/* Fix It button for fixable issues */}
                          {perm?.fixable && perm.fix_capability_id && status !== "granted" && (
                            <Button
                              variant="default"
                              size="sm"
                              className="h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white"
                              onClick={() => handleFix(section)}
                              disabled={fixing.has(section.key)}
                            >
                              {fixing.has(section.key) ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Wrench className="h-3.5 w-3.5" />
                              )}
                              Fix It
                            </Button>
                          )}
                          {/* Active indicator for granted */}
                          {status === "granted" && (
                            <Badge
                              variant="outline"
                              className="h-8 gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-xs"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Active
                            </Badge>
                          )}
                          {section.probeEndpoint && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => handleProbe(section)}
                              disabled={isProbing}
                            >
                              {isProbing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                              Scan
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => toggleExpand(section.key)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t bg-muted/30 px-4 py-3 space-y-3">
                          {/* User-friendly instructions */}
                          {perm?.user_instructions &&
                            status !== "granted" && (
                              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                                <div>
                                  <p className="text-xs font-medium text-amber-500">
                                    What to do
                                  </p>
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {perm.user_instructions}
                                  </p>
                                </div>
                              </div>
                            )}

                          {/* Discovered devices */}
                          {perm?.devices && perm.devices.length > 0 && (
                            <div>
                              <p className="mb-2 text-xs font-medium text-muted-foreground">
                                Discovered Devices
                              </p>
                              <div className="space-y-1">
                                {perm.devices.map((dev, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-xs"
                                  >
                                    <span className="font-medium">
                                      {String(
                                        dev.name || dev.ssid || `Device ${i + 1}`
                                      )}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {dev.connected
                                        ? "Connected"
                                        : dev.status
                                          ? String(dev.status)
                                          : dev.type
                                            ? String(dev.type)
                                            : dev.channels
                                              ? `${dev.channels}ch`
                                              : ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Live probe results — summarized */}
                          {probeResult && (
                            <div>
                              <p className="mb-2 text-xs font-medium text-muted-foreground">
                                Scan Results
                              </p>
                              <div className="rounded-md bg-background p-3 text-xs">
                                <p className="text-muted-foreground">
                                  {probeResult.type === "error"
                                    ? "Scan encountered an issue. Expand developer info for details."
                                    : probeResult.metadata
                                      ? `Found ${Object.keys(probeResult.metadata).length} result(s)`
                                      : "Scan complete"}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* If nothing to show */}
                          {!perm?.devices?.length &&
                            !probeResult &&
                            !perm?.user_instructions && (
                              <p className="text-xs text-muted-foreground">
                                No additional details available. Click "Scan" to
                                probe this capability.
                              </p>
                            )}

                          {/* Developer details toggle  */}
                          <div className="border-t border-border/50 pt-2">
                            <button
                              className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                              onClick={() => toggleDevInfo(section.key)}
                            >
                              <Code2 className="h-3 w-3" />
                              {showDevInfo.has(section.key)
                                ? "Hide Developer Info"
                                : "Show Developer Info"}
                            </button>
                            {showDevInfo.has(section.key) && (
                              <div className="mt-2 space-y-2 rounded-md border border-border/30 bg-background/50 p-3">
                                {perm?.details && (
                                  <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">Status Details</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground font-mono">{perm.details}</p>
                                  </div>
                                )}
                                {perm?.grant_instructions && (
                                  <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">Technical Instructions</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground font-mono">{perm.grant_instructions}</p>
                                  </div>
                                )}
                                {probeResult && (
                                  <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">Raw Scan Output</p>
                                    <pre className="mt-0.5 max-h-48 overflow-auto text-xs font-mono leading-relaxed text-muted-foreground">
                                      {probeResult.output}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {/* System Resources card */}
              <SystemResourcesCard engineStatus={engineStatus} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Resources card — shows CPU, RAM, disk in a compact visual format
// ---------------------------------------------------------------------------

function SystemResourcesCard({
  engineStatus,
}: {
  engineStatus: EngineStatus;
}) {
  const [resources, setResources] = useState<Record<string, unknown> | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (engineStatus !== "connected") return;
    setLoading(true);
    try {
      const result = await engine.getSystemResources();
      setResources(result.metadata);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [engineStatus]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, [load]);

  if (!resources) return null;

  const cpuPercent = Number(resources.cpu_percent ?? 0);
  const ramPercent = Number(resources.memory_percent ?? 0);
  const ramUsed = Number(resources.memory_used_gb ?? 0);
  const ramTotal = Number(resources.memory_total_gb ?? 0);
  const diskPercent = Number(resources.disk_percent ?? 0);
  const diskUsed = Number(resources.disk_used_gb ?? 0);
  const diskTotal = Number(resources.disk_total_gb ?? 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-primary" />
          System Resources
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 text-xs"
            onClick={load}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <ResourceBar label="CPU" percent={cpuPercent} detail={`${cpuPercent.toFixed(0)}%`} />
          <ResourceBar
            label="RAM"
            percent={ramPercent}
            detail={`${ramUsed.toFixed(1)} / ${ramTotal.toFixed(0)} GB`}
          />
          <ResourceBar
            label="Disk"
            percent={diskPercent}
            detail={`${diskUsed.toFixed(0)} / ${diskTotal.toFixed(0)} GB`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ResourceBar({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  const barColor =
    percent > 90
      ? "bg-red-500"
      : percent > 70
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}
