import { useState } from "react";
import { Wifi, Globe, Network, RefreshCw, Bluetooth, Usb, Search as SearchIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToolSection } from "@/components/tools/shared/ToolSection";
import { OutputCard } from "@/components/tools/shared/OutputCard";
import { StatusBadge } from "@/components/tools/shared/StatusBadge";
import { cn } from "@/lib/utils";

interface NetworkPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

function tryParse(result: unknown): unknown {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error") return null;
    if (d.output) return JSON.parse(d.output);
    return null;
  } catch { return null; }
}

function parseText(result: unknown): string | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error") return d?.output ?? null;
    return d.output ?? null;
  } catch { return null; }
}

export function NetworkPanel({ onInvoke, loading, result }: NetworkPanelProps) {
  const [scanHost, setScanHost] = useState("127.0.0.1");
  const [view, setView] = useState<"interfaces" | "ports" | "wifi" | "bluetooth" | "web">("interfaces");
  const [fetchUrl, setFetchUrl] = useState("https://");
  const [searchQuery, setSearchQuery] = useState("");

  const data = tryParse(result);
  const textOutput = parseText(result);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      {/* View switcher */}
      <div className="flex gap-1 rounded-xl border bg-muted/20 p-1">
        {([
          { key: "interfaces", label: "Interfaces", icon: Network },
          { key: "ports", label: "Ports", icon: Globe },
          { key: "wifi", label: "WiFi", icon: Wifi },
          { key: "bluetooth", label: "Bluetooth", icon: Bluetooth },
          { key: "web", label: "Web", icon: ExternalLink },
        ] as const).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-all",
              view === v.key ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            <v.icon className="h-3 w-3" />
            {v.label}
          </button>
        ))}
      </div>

      {view === "interfaces" && (
        <ToolSection title="Network Interfaces" icon={Network} iconColor="text-sky-400"
          actions={
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onInvoke("NetworkInfo", {})} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          }>
          {Array.isArray(data) && data.length > 0 ? (
            <div className="space-y-2">
              {(data as Array<{ name?: string; ip?: string; mac?: string; type?: string }>).map((iface, i) => (
                <div key={i} className="rounded-xl border bg-card/50 p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge status="success" label="Up" />
                    <span className="text-sm font-semibold">{iface.name ?? "Unknown"}</span>
                    {iface.type && <span className="ml-auto text-[10px] text-muted-foreground uppercase">{iface.type}</span>}
                  </div>
                  {iface.ip  && <p className="text-xs font-mono text-sky-400 pl-4">IP: {iface.ip}</p>}
                  {iface.mac && <p className="text-xs font-mono text-muted-foreground pl-4">MAC: {iface.mac}</p>}
                </div>
              ))}
            </div>
          ) : (
            <button onClick={() => onInvoke("NetworkInfo", {})} disabled={loading}
              className="w-full rounded-xl border border-dashed bg-muted/20 p-6 flex flex-col items-center gap-2 text-muted-foreground hover:bg-muted/30 transition-colors">
              <Globe className="h-8 w-8 opacity-30" />
              <p className="text-xs">Click to load network interfaces</p>
            </button>
          )}
        </ToolSection>
      )}

      {view === "ports" && (
        <ToolSection title="Port Scanner" icon={Globe} iconColor="text-sky-400">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={scanHost} onChange={(e) => setScanHost(e.target.value)}
                placeholder="Host (e.g., 127.0.0.1)" className="text-xs font-mono" />
              <Button onClick={() => onInvoke("PortScan", { host: scanHost, ports: "common" })} disabled={loading}
                className="shrink-0 gap-1.5">
                {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null} Scan
              </Button>
            </div>
            {Array.isArray(data) && data.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(data as Array<{ port?: number; status?: string; service?: string }>).map((p, i) => (
                  <span key={i} className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-mono font-medium border",
                    p.status === "open"
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : "bg-muted/40 text-muted-foreground border-border/50"
                  )}>
                    {p.port}
                    {p.service && <span className="text-[9px] opacity-70">{p.service}</span>}
                    {p.status === "open" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                  </span>
                ))}
              </div>
            )}
          </div>
        </ToolSection>
      )}

      {view === "wifi" && (
        <ToolSection title="WiFi Networks" icon={Wifi} iconColor="text-sky-400"
          actions={
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onInvoke("WifiNetworks", {})} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          }>
          {Array.isArray(data) && data.length > 0 ? (
            <div className="space-y-1.5">
              {(data as Array<{ ssid?: string; signal?: number; security?: string; channel?: number }>).map((net, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
                  <Wifi className="h-4 w-4 text-sky-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">{net.ssid ?? "Hidden"}</span>
                    {net.channel && <span className="text-[10px] text-muted-foreground">Ch {net.channel}</span>}
                  </div>
                  {net.security && <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">{net.security}</span>}
                  {net.signal != null && (
                    <div className="flex gap-px items-end h-4">
                      {[25, 50, 75, 100].map((threshold) => (
                        <div key={threshold}
                          className={cn("w-1 rounded-sm", net.signal! >= threshold ? "bg-sky-400" : "bg-muted")}
                          style={{ height: `${threshold / 25 * 25}%` }} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <button onClick={() => onInvoke("WifiNetworks", {})} disabled={loading}
              className="w-full rounded-xl border border-dashed bg-muted/20 p-6 flex flex-col items-center gap-2 text-muted-foreground hover:bg-muted/30 transition-colors">
              <Wifi className="h-8 w-8 opacity-30" />
              <p className="text-xs">Click to scan WiFi networks</p>
            </button>
          )}
        </ToolSection>
      )}

      {view === "bluetooth" && (
        <>
          <ToolSection title="Bluetooth Devices" icon={Bluetooth} iconColor="text-sky-400"
            actions={
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onInvoke("BluetoothDevices", {})} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            }>
            {Array.isArray(data) && data.length > 0 ? (
              <div className="space-y-1.5">
                {(data as Array<{ name?: string; address?: string; connected?: boolean; battery?: number }>).map((dev, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
                    <Bluetooth className="h-4 w-4 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{dev.name ?? "Unknown"}</span>
                      {dev.address && <span className="text-[10px] text-muted-foreground font-mono">{dev.address}</span>}
                    </div>
                    <StatusBadge status={dev.connected ? "success" : "neutral"}
                      label={dev.connected ? "Connected" : "Paired"} />
                    {dev.battery != null && <span className="text-[10px] text-muted-foreground tabular-nums">{dev.battery}%</span>}
                  </div>
                ))}
              </div>
            ) : (
              <button onClick={() => onInvoke("BluetoothDevices", {})} disabled={loading}
                className="w-full rounded-xl border border-dashed bg-muted/20 p-6 flex flex-col items-center gap-2 text-muted-foreground hover:bg-muted/30 transition-colors">
                <Bluetooth className="h-8 w-8 opacity-30" />
                <p className="text-xs">Click to scan Bluetooth devices</p>
              </button>
            )}
          </ToolSection>

          <ToolSection title="Connected Peripherals" icon={Usb} iconColor="text-sky-400"
            actions={
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onInvoke("ConnectedDevices", {})} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            }>
            {textOutput ? (
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap max-h-40 overflow-auto">{textOutput}</pre>
            ) : (
              <p className="text-xs text-muted-foreground">Click refresh to list connected devices</p>
            )}
          </ToolSection>
        </>
      )}

      {view === "web" && (
        <>
          <ToolSection title="Fetch URL" icon={ExternalLink} iconColor="text-sky-400">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input value={fetchUrl} onChange={(e) => setFetchUrl(e.target.value)}
                  placeholder="https://example.com" className="text-xs font-mono flex-1" />
                <Button onClick={() => onInvoke("FetchUrl", { url: fetchUrl })} disabled={loading || !fetchUrl}
                  className="shrink-0">Fetch</Button>
              </div>
            </div>
          </ToolSection>

          <ToolSection title="Web Search" icon={SearchIcon} iconColor="text-sky-400">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search the web..." className="text-xs flex-1" />
                <Button onClick={() => onInvoke("Search", { keywords: searchQuery.split(" ") })}
                  disabled={loading || !searchQuery} className="shrink-0 gap-1.5">
                  <SearchIcon className="h-3.5 w-3.5" /> Search
                </Button>
              </div>
            </div>
          </ToolSection>

          {textOutput && <OutputCard title="Result" content={textOutput} maxHeight={400} />}
        </>
      )}
    </div>
  );
}
