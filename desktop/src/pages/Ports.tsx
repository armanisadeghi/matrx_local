import { useState, useEffect, useCallback, useRef } from "react";
import {
  Network,
  RefreshCw,
  ShieldAlert,
  Search,
  Server,
  Activity,
  Cpu,
  TerminalSquare,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  MonitorDot,
  FileText,
  Clock,
  FolderOpen,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { engine } from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";

interface PortsProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
}

interface PortProcess {
  pid: number;
  name: string;
  port: number;
  address: string;
  protocol: string;
  user: string;
}

interface TerminalProcess {
  pid: number;
  name: string;
  status: string;
  user: string;
  cwd: string;
  tty: string;
  cmdline: string;
  elapsed_s: number;
}

interface TailResult {
  output: string;
  source: string;
  open_files?: { path: string; fd: number }[];
  connections?: { fd: number; laddr: string; raddr: string; status: string }[];
  note?: string;
}

type SortColumn = "port" | "name" | "pid" | "address" | "protocol";
type SortDirection = "asc" | "desc";

export function Ports({ engineStatus, engineUrl: _engineUrl }: PortsProps) {
  const [ports, setPorts] = useState<PortProcess[]>([]);
  const [terminals, setTerminals] = useState<TerminalProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [terminalsLoading, setTerminalsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortColumn>("port");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [killDialogOpen, setKillDialogOpen] = useState(false);
  const [processToKill, setProcessToKill] = useState<PortProcess | null>(null);
  const [isKilling, setIsKilling] = useState(false);
  const [activeTab, setActiveTab] = useState("user");

  const fetchPorts = useCallback(async () => {
    if (engineStatus !== "connected") return;
    setLoading(true);
    try {
      const result = await engine.invokeToolWs("ListPorts", { limit: 500 });
      if (result.type === "success" && result.metadata?.ports) {
        setPorts(result.metadata.ports as PortProcess[]);
      }
    } catch (error) {
      console.error("Failed to fetch ports:", error);
    } finally {
      setLoading(false);
    }
  }, [engineStatus]);

  const fetchTerminals = useCallback(async () => {
    if (engineStatus !== "connected") return;
    setTerminalsLoading(true);
    try {
      const result = await engine.invokeToolWs("ListTerminals", {});
      if (result.type === "success" && result.metadata?.terminals) {
        setTerminals(result.metadata.terminals as TerminalProcess[]);
      }
    } catch (error) {
      console.error("Failed to fetch terminals:", error);
    } finally {
      setTerminalsLoading(false);
    }
  }, [engineStatus]);

  useEffect(() => {
    fetchPorts();
    const interval = setInterval(fetchPorts, 10000);
    return () => clearInterval(interval);
  }, [fetchPorts]);

  useEffect(() => {
    if (activeTab === "terminals") {
      fetchTerminals();
      const interval = setInterval(fetchTerminals, 15000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchTerminals]);

  const handleKill = async (force: boolean) => {
    if (!processToKill) return;
    setIsKilling(true);
    try {
      await engine.invokeToolWs("KillProcess", {
        pid: processToKill.pid,
        force,
      });
      fetchPorts();
      setKillDialogOpen(false);
    } catch (error) {
      console.error("Failed to kill process:", error);
    } finally {
      setIsKilling(false);
    }
  };

  const handleForceKillDirect = async (p: PortProcess) => {
    setIsKilling(true);
    try {
      await engine.invokeToolWs("KillProcess", { pid: p.pid, force: true });
      fetchPorts();
    } catch (error) {
      console.error("Failed to force kill process:", error);
    } finally {
      setIsKilling(false);
    }
  };

  const isUserItem = (p: PortProcess) => {
    const commonPorts = [
      3000, 3001, 8000, 8080, 5000, 5173, 4200, 8888, 5432, 6379, 27017, 3306,
      9200,
    ];
    const commonNames = [
      "node", "python", "docker", "java", "ruby", "php", "go", "npm", "pnpm", "yarn",
    ];
    return (
      commonPorts.includes(p.port) ||
      commonNames.some((name) => p.name.toLowerCase().includes(name))
    );
  };

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const filteredPorts = ports
    .filter((p) => {
      const term = search.toLowerCase();
      const pidStr = p.pid > 0 ? String(p.pid) : "";
      return (
        p.name.toLowerCase().includes(term) ||
        String(p.port).includes(term) ||
        p.address.toLowerCase().includes(term) ||
        p.protocol.toLowerCase().includes(term) ||
        pidStr.includes(term)
      );
    })
    .sort((a, b) => {
      let aVal: string | number = a[sortCol];
      let bVal: string | number = b[sortCol];
      if (typeof aVal === "string") aVal = aVal.toLowerCase();
      if (typeof bVal === "string") bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  const filteredTerminals = terminals.filter((t) => {
    const term = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(term) ||
      t.cmdline.toLowerCase().includes(term) ||
      t.cwd.toLowerCase().includes(term) ||
      t.tty.toLowerCase().includes(term) ||
      String(t.pid).includes(term)
    );
  });

  const userItems = filteredPorts.filter(isUserItem);

  const getProcessIcon = (name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes("node") || lowerName.includes("npm"))
      return <TerminalSquare className="h-4 w-4 text-green-500" />;
    if (lowerName.includes("python"))
      return <TerminalSquare className="h-4 w-4 text-blue-500" />;
    if (lowerName.includes("docker"))
      return <Server className="h-4 w-4 text-blue-400" />;
    if (lowerName.includes("java"))
      return <Cpu className="h-4 w-4 text-orange-500" />;
    return <Activity className="h-4 w-4 text-muted-foreground" />;
  };

  const isRefreshing = activeTab === "terminals" ? terminalsLoading : loading;

  const handleRefresh = () => {
    if (activeTab === "terminals") {
      fetchTerminals();
    } else {
      fetchPorts();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Port Manager"
        description="Monitor network ports, services, and terminal sessions"
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={activeTab === "terminals" ? "Filter terminals..." : "Filter ports..."}
              className="h-9 w-64 bg-background/50 pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const data = activeTab === "terminals" ? filteredTerminals : filteredPorts;
              navigator.clipboard.writeText(JSON.stringify(data, null, 2));
            }}
            title="Copy Filtered Data (JSON)"
            className="h-9 w-9 bg-background/50 backdrop-blur-md"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-9 w-9 bg-background/50 backdrop-blur-md"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 p-6 overflow-hidden">
        <Tabs
          defaultValue="user"
          className="h-full flex flex-col min-h-0"
          onValueChange={setActiveTab}
        >
          <TabsList className="w-full max-w-[600px] grid grid-cols-3 bg-background/40 backdrop-blur-xl border border-border shadow-sm">
            <TabsTrigger
              value="user"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <Server className="h-4 w-4 mr-2" />
              Dev & User Services
              <Badge variant="secondary" className="ml-2 bg-background/50">
                {userItems.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <Network className="h-4 w-4 mr-2" />
              All Ports
              <Badge variant="secondary" className="ml-2 bg-background/50">
                {filteredPorts.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="terminals"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <MonitorDot className="h-4 w-4 mr-2" />
              Terminals
              <Badge variant="secondary" className="ml-2 bg-background/50">
                {filteredTerminals.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="user" className="flex-1 mt-4 overflow-hidden">
            <PortTable
              ports={userItems}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
              getProcessIcon={getProcessIcon}
              onKill={(p) => {
                setProcessToKill(p);
                setKillDialogOpen(true);
              }}
              onForceKill={handleForceKillDirect}
            />
          </TabsContent>

          <TabsContent value="all" className="flex-1 mt-4 overflow-hidden">
            <PortTable
              ports={filteredPorts}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
              getProcessIcon={getProcessIcon}
              onKill={(p) => {
                setProcessToKill(p);
                setKillDialogOpen(true);
              }}
              onForceKill={handleForceKillDirect}
            />
          </TabsContent>

          <TabsContent value="terminals" className="flex-1 mt-4 overflow-hidden">
            <TerminalTable
              terminals={filteredTerminals}
              loading={terminalsLoading}
              engineStatus={engineStatus}
              onRefresh={fetchTerminals}
            />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={killDialogOpen} onOpenChange={setKillDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-background/80 backdrop-blur-2xl border-border">
          <DialogHeader>
            <DialogTitle asChild>
              <h2 className="flex items-center gap-2 text-destructive font-semibold">
                <ShieldAlert className="h-5 w-5" />
                Kill Process
              </h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>
                Are you sure you want to terminate{" "}
                <strong>{processToKill?.name}</strong> (PID:{" "}
                {processToKill?.pid}) listening on port{" "}
                <strong>{processToKill?.port}</strong>?
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-start">
            <Button variant="ghost" onClick={() => setKillDialogOpen(false)}>
              Cancel
            </Button>
            <div className="flex-1" />
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={() => handleKill(false)}
              disabled={isKilling}
            >
              Graceful Kill
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleKill(true)}
              disabled={isKilling}
            >
              Force Kill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({
  col,
  sortCol,
  sortDir,
}: {
  col: SortColumn;
  sortCol: SortColumn;
  sortDir: SortDirection;
}) {
  if (col !== sortCol)
    return <ArrowUpDown className="w-3 h-3 ml-1 opacity-20" />;
  return sortDir === "asc" ? (
    <ArrowUp className="w-3 h-3 ml-1" />
  ) : (
    <ArrowDown className="w-3 h-3 ml-1" />
  );
}

// ─── Port table ───────────────────────────────────────────────────────────────

function PortTable({
  ports,
  sortCol,
  sortDir,
  onSort,
  getProcessIcon,
  onKill,
  onForceKill,
}: {
  ports: PortProcess[];
  sortCol: SortColumn;
  sortDir: SortDirection;
  onSort: (col: SortColumn) => void;
  getProcessIcon: (name: string) => React.ReactNode;
  onKill: (p: PortProcess) => void;
  onForceKill: (p: PortProcess) => void;
}) {
  const [expandedPort, setExpandedPort] = useState<string | null>(null);

  if (ports.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-card/30 backdrop-blur-md rounded-xl border border-border">
        <Network className="h-12 w-12 opacity-20 mb-4" />
        <p>No listening ports found matching the criteria.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full rounded-xl border border-border bg-card/40 backdrop-blur-xl overflow-hidden shadow-sm">
      <div className="grid grid-cols-12 gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider select-none shrink-0">
        <div
          className="col-span-2 flex items-center cursor-pointer hover:text-foreground transition-colors"
          onClick={() => onSort("port")}
        >
          Port <SortIcon col="port" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div
          className="col-span-3 flex items-center cursor-pointer hover:text-foreground transition-colors"
          onClick={() => onSort("name")}
        >
          Process <SortIcon col="name" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div
          className="col-span-3 flex items-center cursor-pointer hover:text-foreground transition-colors"
          onClick={() => onSort("address")}
        >
          Address <SortIcon col="address" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div
          className="col-span-1 flex items-center cursor-pointer hover:text-foreground transition-colors"
          onClick={() => onSort("pid")}
        >
          PID <SortIcon col="pid" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div
          className="col-span-1 flex items-center cursor-pointer hover:text-foreground transition-colors"
          onClick={() => onSort("protocol")}
        >
          Protocol{" "}
          <SortIcon col="protocol" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div className="col-span-2 text-right">Ext</div>
      </div>
      <ScrollArea className="flex-1">
        <div className="divide-y divide-white/5">
          {ports.map((port) => {
            const rowKey = `${port.pid}-${port.port}-${port.protocol}`;
            const isExpanded = expandedPort === rowKey;

            return (
              <div key={rowKey}>
                <div
                  className={`grid grid-cols-12 gap-4 items-center px-4 py-3 hover:bg-muted/40 transition-colors group cursor-pointer ${isExpanded ? "bg-muted/40" : ""}`}
                  onClick={() => setExpandedPort(isExpanded ? null : rowKey)}
                >
                  <div className="col-span-2">
                    <span className="font-mono text-foreground/90 font-semibold text-sm">
                      {port.port}
                    </span>
                  </div>
                  <div className="col-span-3 flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted border border-border shadow-sm">
                      {getProcessIcon(port.name)}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-foreground/90 truncate">
                        {port.name}
                      </span>
                    </div>
                  </div>
                  <div className="col-span-3 flex items-center">
                    <span className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border truncate">
                      {port.address || "*"}
                    </span>
                  </div>
                  <div className="col-span-1 text-sm text-muted-foreground font-mono">
                    {port.pid > 0 ? port.pid : "-"}
                  </div>
                  <div className="col-span-1">
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-muted border-border text-muted-foreground font-medium"
                    >
                      {port.protocol}
                    </Badge>
                  </div>
                  <div className="col-span-2 flex justify-end gap-1 opacity-50 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground font-medium">
                    {isExpanded ? "Close" : "Expand"}
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-muted/30 border-t border-border p-4 mx-4 mb-2 mt-[-2px] rounded-b-md shadow-inner">
                    <div className="flex justify-between items-start gap-4">
                      <pre className="text-xs text-muted-foreground bg-muted p-3 rounded-md overflow-x-auto w-full font-mono border border-border">
                        {JSON.stringify(port, null, 2)}
                      </pre>
                      <div className="flex flex-col gap-2 min-w-[140px] shrink-0">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full justify-start text-xs h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(
                              JSON.stringify(port, null, 2),
                            );
                          }}
                        >
                          <Copy className="h-3 w-3 mr-2" /> Copy JSON
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start text-xs h-8 border-destructive/30 text-destructive hover:bg-destructive/10"
                          disabled={port.pid === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onKill(port);
                          }}
                        >
                          <ShieldAlert className="h-3 w-3 mr-2" /> Grace Kill
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="w-full justify-start text-xs h-8 hover:bg-red-600"
                          disabled={port.pid === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onForceKill(port);
                          }}
                        >
                          Force Kill
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Terminal table ───────────────────────────────────────────────────────────

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function TerminalTable({
  terminals,
  loading,
  onRefresh,
}: {
  terminals: TerminalProcess[];
  loading: boolean;
  engineStatus: EngineStatus;
  onRefresh: () => void;
}) {
  const [expandedPid, setExpandedPid] = useState<number | null>(null);
  const [tailData, setTailData] = useState<Record<number, TailResult | null>>({});
  const [tailLoading, setTailLoading] = useState<Record<number, boolean>>({});
  const tailScrollRef = useRef<HTMLDivElement>(null);

  const fetchTail = async (t: TerminalProcess) => {
    setTailLoading((prev) => ({ ...prev, [t.pid]: true }));
    try {
      const result = await engine.invokeToolWs("TailTerminal", {
        pid: t.pid,
        tty: t.tty || undefined,
        lines: 80,
      });
      if (result.type === "success") {
        setTailData((prev) => ({
          ...prev,
          [t.pid]: {
            output: result.output ?? "",
            source: (result.metadata?.source as string) ?? "unknown",
            open_files: result.metadata?.open_files as TailResult["open_files"],
            connections: result.metadata?.connections as TailResult["connections"],
            note: result.metadata?.note as string | undefined,
          },
        }));
      } else {
        setTailData((prev) => ({
          ...prev,
          [t.pid]: { output: result.output ?? "Error fetching output.", source: "error" },
        }));
      }
    } catch (err) {
      console.error("TailTerminal failed:", err);
      setTailData((prev) => ({
        ...prev,
        [t.pid]: { output: "Failed to fetch terminal output.", source: "error" },
      }));
    } finally {
      setTailLoading((prev) => ({ ...prev, [t.pid]: false }));
    }
  };

  const handleExpand = (t: TerminalProcess) => {
    if (expandedPid === t.pid) {
      setExpandedPid(null);
    } else {
      setExpandedPid(t.pid);
      if (!tailData[t.pid]) {
        fetchTail(t);
      }
    }
  };

  if (loading && terminals.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-card/30 backdrop-blur-md rounded-xl border border-border gap-3">
        <RefreshCw className="h-8 w-8 opacity-30 animate-spin" />
        <p className="text-sm">Discovering terminal sessions…</p>
      </div>
    );
  }

  if (!loading && terminals.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-card/30 backdrop-blur-md rounded-xl border border-border gap-3">
        <MonitorDot className="h-12 w-12 opacity-20" />
        <p>No terminal processes found.</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full rounded-xl border border-border bg-card/40 backdrop-blur-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="grid grid-cols-12 gap-3 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider select-none shrink-0">
        <div className="col-span-3">Process</div>
        <div className="col-span-2">TTY</div>
        <div className="col-span-4">Working Directory</div>
        <div className="col-span-1 flex items-center gap-1">
          <Clock className="h-3 w-3" /> Age
        </div>
        <div className="col-span-1">PID</div>
        <div className="col-span-1 text-right">Output</div>
      </div>

      <ScrollArea className="flex-1">
        <div className="divide-y divide-white/5">
          {terminals.map((t) => {
            const isExpanded = expandedPid === t.pid;
            const tail = tailData[t.pid];
            const isTailLoading = tailLoading[t.pid] ?? false;

            return (
              <div key={t.pid}>
                <div
                  className={`grid grid-cols-12 gap-3 items-center px-4 py-3 hover:bg-muted/40 transition-colors group cursor-pointer ${isExpanded ? "bg-muted/40" : ""}`}
                  onClick={() => handleExpand(t)}
                >
                  {/* Process name + cmd */}
                  <div className="col-span-3 flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted border border-border shadow-sm">
                      <TerminalSquare className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-foreground/90 truncate text-sm">
                        {t.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground truncate font-mono">
                        {t.cmdline.length > 40
                          ? t.cmdline.slice(0, 40) + "…"
                          : t.cmdline}
                      </span>
                    </div>
                  </div>

                  {/* TTY */}
                  <div className="col-span-2">
                    <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border truncate block">
                      {t.tty || "—"}
                    </span>
                  </div>

                  {/* CWD */}
                  <div className="col-span-4 flex items-center gap-1.5 min-w-0">
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-mono text-muted-foreground truncate" title={t.cwd}>
                      {t.cwd
                        ? t.cwd.replace(/^\/Users\/[^/]+/, "~")
                        : "—"}
                    </span>
                  </div>

                  {/* Elapsed */}
                  <div className="col-span-1 text-xs text-muted-foreground font-mono">
                    {formatElapsed(t.elapsed_s)}
                  </div>

                  {/* PID */}
                  <div className="col-span-1 text-xs text-muted-foreground font-mono">
                    {t.pid}
                  </div>

                  {/* Expand hint */}
                  <div className="col-span-1 flex justify-end gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 mx-4 mb-2 rounded-b-md shadow-inner overflow-hidden">
                    {/* Tail toolbar */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                      <span className="text-xs text-muted-foreground font-mono">
                        {tail?.source
                          ? `source: ${tail.source}`
                          : "fetching…"}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            fetchTail(t);
                          }}
                          disabled={isTailLoading}
                        >
                          <RefreshCw
                            className={`h-3 w-3 mr-1 ${isTailLoading ? "animate-spin" : ""}`}
                          />
                          Refresh
                        </Button>
                        {tail?.output && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(tail.output);
                            }}
                          >
                            <Copy className="h-3 w-3 mr-1" /> Copy
                          </Button>
                        )}
                      </div>
                    </div>

                    {isTailLoading && !tail && (
                      <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Reading terminal output…
                      </div>
                    )}

                    {tail && (
                      <div className="p-3 space-y-3">
                        {/* Note banner (shown when direct TTY read wasn't possible) */}
                        {tail.note && (
                          <p className="text-xs text-amber-400/80 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-2">
                            {tail.note}
                          </p>
                        )}

                        {/* Output block */}
                        {tail.output && (
                          <div ref={tailScrollRef}>
                            <pre className="text-xs text-foreground/80 bg-black/40 border border-border rounded-md p-3 overflow-x-auto font-mono max-h-64 overflow-y-auto whitespace-pre-wrap">
                              {tail.output}
                            </pre>
                          </div>
                        )}

                        {/* Open files */}
                        {tail.open_files && tail.open_files.length > 0 && (
                          <div>
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
                              Open Files ({tail.open_files.length})
                            </p>
                            <div className="grid grid-cols-1 gap-0.5 max-h-40 overflow-y-auto">
                              {tail.open_files.map((f) => (
                                <div
                                  key={`${f.fd}-${f.path}`}
                                  className="flex items-center gap-2 px-2 py-1 rounded text-xs font-mono bg-muted/30 hover:bg-muted/50"
                                >
                                  <span className="text-muted-foreground w-8 shrink-0">
                                    fd{f.fd}
                                  </span>
                                  <span className="text-foreground/70 truncate">{f.path}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Connections */}
                        {tail.connections && tail.connections.length > 0 && (
                          <div>
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
                              Network Connections ({tail.connections.length})
                            </p>
                            <div className="grid grid-cols-1 gap-0.5 max-h-32 overflow-y-auto">
                              {tail.connections.map((c, i) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-3 px-2 py-1 rounded text-xs font-mono bg-muted/30"
                                >
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] shrink-0"
                                  >
                                    {c.status}
                                  </Badge>
                                  <span className="text-muted-foreground">
                                    {c.laddr}
                                    {c.raddr ? ` → ${c.raddr}` : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
