import { useState, useCallback } from "react";
import { Wifi, Globe, Network, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiBadge } from "@/components/tools/panels/AiBadge";
import { cn } from "@/lib/utils";

interface NetworkPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

interface NetworkInterface {
  name?: string;
  ip?: string;
  mac?: string;
  type?: string;
}

interface PortResult {
  port?: number;
  status?: "open" | "closed" | string;
}

function tryParse(result: unknown): unknown {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error") return null;
    if (d.output) return JSON.parse(d.output);
    return null;
  } catch { return null; }
}

export function NetworkPanel({ onInvoke, loading, result }: NetworkPanelProps) {
  const [scanHost, setScanHost] = useState("127.0.0.1");
  const [view, setView]         = useState<"interfaces" | "ports" | "wifi">("interfaces");

  const data = tryParse(result);

  const fetchInterfaces = useCallback(() => onInvoke("NetworkInfo", {}),       [onInvoke]);
  const scanPorts       = useCallback(() => onInvoke("PortScan",    { host: scanHost, ports: "common" }), [onInvoke, scanHost]);
  const fetchWifi       = useCallback(() => onInvoke("WifiNetworks", {}),      [onInvoke]);

  const interfaces: NetworkInterface[] = Array.isArray(data) ? data : [];
  const ports: PortResult[]            = Array.isArray(data) ? data : [];

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      <AiBadge text="Your AI can inspect network interfaces and scan for open ports" />

      {/* View switcher */}
      <div className="flex gap-1 rounded-xl border bg-muted/20 p-1">
        {(["interfaces", "ports", "wifi"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-xs font-medium transition-all capitalize",
              view === v ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            {v}
          </button>
        ))}
      </div>

      {/* Interfaces */}
      {view === "interfaces" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-sky-400" />
              <h3 className="text-sm font-semibold">Network Interfaces</h3>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchInterfaces} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {interfaces.length > 0 ? (
            <div className="space-y-2">
              {interfaces.map((iface, i) => (
                <div key={i} className="rounded-xl border bg-card/50 p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-sm font-semibold">{iface.name ?? "Unknown"}</span>
                    {iface.type && <span className="ml-auto text-[10px] text-muted-foreground uppercase">{iface.type}</span>}
                  </div>
                  {iface.ip  && <p className="text-xs font-mono text-sky-400 pl-4">IP: {iface.ip}</p>}
                  {iface.mac && <p className="text-xs font-mono text-muted-foreground pl-4">MAC: {iface.mac}</p>}
                </div>
              ))}
            </div>
          ) : (
            <button onClick={fetchInterfaces} disabled={loading}
              className="w-full rounded-xl border border-dashed bg-muted/20 p-8 flex flex-col items-center gap-2 text-muted-foreground hover:bg-muted/30 transition-colors">
              <Globe className="h-8 w-8 opacity-30" />
              <p className="text-xs">Click to load network interfaces</p>
            </button>
          )}
        </div>
      )}

      {/* Port Scan */}
      {view === "ports" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input value={scanHost} onChange={(e) => setScanHost(e.target.value)}
              placeholder="Host (e.g., 127.0.0.1)" className="text-xs font-mono" />
            <Button onClick={scanPorts} disabled={loading} className="shrink-0 gap-1.5">
              {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              Scan
            </Button>
          </div>
          {ports.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ports.map((p, i) => (
                <span key={i} className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-mono font-medium border",
                  p.status === "open"
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "bg-muted/40 text-muted-foreground border-border/50"
                )}>
                  {p.port}
                  {p.status === "open" && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Open</span>
            <span className="flex items-center gap-1 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-muted" /> Closed</span>
          </div>
        </div>
      )}

      {/* WiFi */}
      {view === "wifi" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-sky-400" />
              <h3 className="text-sm font-semibold">WiFi Networks</h3>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchWifi} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {Array.isArray(data) && data.length > 0 ? (
            <div className="space-y-1">
              {(data as Array<{ ssid?: string; signal?: number; security?: string }>).map((net, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
                  <Wifi className="h-4 w-4 text-sky-400 shrink-0" />
                  <span className="flex-1 text-sm font-medium">{net.ssid ?? "Unknown"}</span>
                  {net.security && <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">{net.security}</span>}
                  {net.signal != null && (
                    <div className="flex gap-px items-end h-4">
                      {[25, 50, 75, 100].map((threshold) => (
                        <div key={threshold} className={`w-1 rounded-sm ${net.signal! >= threshold ? "bg-sky-400" : "bg-muted"}`}
                          style={{ height: `${threshold / 25 * 25}%` }} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <button onClick={fetchWifi} disabled={loading}
              className="w-full rounded-xl border border-dashed bg-muted/20 p-8 flex flex-col items-center gap-2 text-muted-foreground hover:bg-muted/30 transition-colors">
              <Wifi className="h-8 w-8 opacity-30" />
              <p className="text-xs">Click to scan WiFi networks</p>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
