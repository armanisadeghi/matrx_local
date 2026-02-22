import { useState, useEffect, useCallback } from "react";
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

type SortColumn = "port" | "name" | "pid" | "address" | "protocol";
type SortDirection = "asc" | "desc";

export function Ports({ engineStatus, engineUrl: _engineUrl }: PortsProps) {
  const [ports, setPorts] = useState<PortProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortColumn>("port");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [killDialogOpen, setKillDialogOpen] = useState(false);
  const [processToKill, setProcessToKill] = useState<PortProcess | null>(null);
  const [isKilling, setIsKilling] = useState(false);

  const fetchPorts = useCallback(async () => {
    if (engineStatus !== "connected") return;

    setLoading(true);
    try {
      const result = await engine.invokeToolWs("ListPorts", {
        limit: 500,
      });

      if (result.type === "success" && result.metadata?.ports) {
        setPorts(result.metadata.ports as PortProcess[]);
      }
    } catch (error) {
      console.error("Failed to fetch ports:", error);
    } finally {
      setLoading(false);
    }
  }, [engineStatus]);

  useEffect(() => {
    fetchPorts();
    const interval = setInterval(fetchPorts, 10000); // Auto refresh every 10s
    return () => clearInterval(interval);
  }, [fetchPorts]);

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
      "node",
      "python",
      "docker",
      "java",
      "ruby",
      "php",
      "go",
      "npm",
      "pnpm",
      "yarn",
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

  const filteredPorts = ports.filter((p) => {
    const term = search.toLowerCase();
    const pidStr = p.pid > 0 ? String(p.pid) : "";
    return (
      p.name.toLowerCase().includes(term) ||
      String(p.port).includes(term) ||
      p.address.toLowerCase().includes(term) ||
      p.protocol.toLowerCase().includes(term) ||
      pidStr.includes(term)
    );
  }).sort((a, b) => {
    let aVal: string | number = a[sortCol];
    let bVal: string | number = b[sortCol];
    
    // Sort strings case-insensitively
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Port Manager"
        description="Monitor and control listening network ports and services"
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Filter ports..."
              className="h-9 w-64 bg-background/50 pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(filteredPorts, null, 2));
            }}
            title="Copy Filtered Data (JSON)"
            className="h-9 w-9 bg-background/50 backdrop-blur-md"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchPorts()}
            disabled={loading}
            className="h-9 w-9 bg-background/50 backdrop-blur-md"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 p-6 overflow-hidden">
        <Tabs defaultValue="user" className="h-full flex flex-col">
          <TabsList className="w-full max-w-[400px] grid grid-cols-2 bg-background/40 backdrop-blur-xl border border-white/10 shadow-sm">
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
          </TabsList>

          <TabsContent value="user" className="flex-1 mt-4">
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

          <TabsContent value="all" className="flex-1 mt-4">
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
        </Tabs>
      </div>

      <Dialog open={killDialogOpen} onOpenChange={setKillDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-background/80 backdrop-blur-2xl border-white/10">
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
                <strong>{processToKill?.name}</strong> (PID: {processToKill?.pid})
                listening on port <strong>{processToKill?.port}</strong>?
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

function SortIcon({ col, sortCol, sortDir }: { col: SortColumn, sortCol: SortColumn, sortDir: SortDirection }) {
  if (col !== sortCol) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-20" />;
  return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
}

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
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-card/30 backdrop-blur-md rounded-xl border border-white/5">
        <Network className="h-12 w-12 opacity-20 mb-4" />
        <p>No listening ports found matching the criteria.</p>
      </div>
    );
  }

  return (
    <div className="h-full rounded-xl border border-white/10 bg-card/40 backdrop-blur-xl overflow-hidden shadow-sm">
      <div className="grid grid-cols-12 gap-4 border-b border-white/5 bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider select-none">
        <div className="col-span-2 flex items-center cursor-pointer hover:text-foreground transition-colors" onClick={() => onSort("port")}>
          Port <SortIcon col="port" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div className="col-span-3 flex items-center cursor-pointer hover:text-foreground transition-colors" onClick={() => onSort("name")}>
          Process <SortIcon col="name" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div className="col-span-3 flex items-center cursor-pointer hover:text-foreground transition-colors" onClick={() => onSort("address")}>
          Address <SortIcon col="address" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div className="col-span-1 flex items-center cursor-pointer hover:text-foreground transition-colors" onClick={() => onSort("pid")}>
          PID <SortIcon col="pid" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div className="col-span-1 flex items-center cursor-pointer hover:text-foreground transition-colors" onClick={() => onSort("protocol")}>
          Protocol <SortIcon col="protocol" sortCol={sortCol} sortDir={sortDir} />
        </div>
        <div className="col-span-2 text-right">Ext</div>
      </div>
      <ScrollArea className="h-[calc(100%-45px)]">
        <div className="divide-y divide-white/5">
          {ports.map((port) => {
            const rowKey = `${port.pid}-${port.port}-${port.protocol}`;
            const isExpanded = expandedPort === rowKey;
            
            return (
            <div key={rowKey}>
              <div
                className={`grid grid-cols-12 gap-4 items-center px-4 py-3 hover:bg-white/5 transition-colors group cursor-pointer ${isExpanded ? "bg-white/5" : ""}`}
                onClick={() => setExpandedPort(isExpanded ? null : rowKey)}
              >
                <div className="col-span-2">
                <span className="font-mono text-foreground/90 font-semibold text-sm">
                  {port.port}
                </span>
              </div>
              <div className="col-span-3 flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/5 border border-white/10 shadow-sm">
                  {getProcessIcon(port.name)}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-foreground/90 truncate">{port.name}</span>
                </div>
              </div>
              <div className="col-span-3 flex items-center">
                <span className="text-sm font-mono text-muted-foreground bg-white/5 px-2 py-0.5 rounded border border-white/10 truncate">
                  {port.address || "*"}
                </span>
              </div>
              <div className="col-span-1 text-sm text-muted-foreground font-mono">
                {port.pid > 0 ? port.pid : "-"}
              </div>
              <div className="col-span-1">
                <Badge
                  variant="outline"
                  className="text-[10px] bg-white/5 border-white/10 text-muted-foreground font-medium"
                >
                  {port.protocol}
                </Badge>
              </div>
              <div className="col-span-2 flex justify-end gap-1 opacity-50 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground font-medium" >
                {isExpanded ? "Close" : "Expand"}
              </div>
            </div>
            
            {isExpanded && (
              <div className="bg-black/20 border-t border-white/5 p-4 mx-4 mb-2 mt-[-2px] rounded-b-md shadow-inner">
                <div className="flex justify-between items-start gap-4">
                  <pre className="text-xs text-muted-foreground bg-black/40 p-3 rounded-md overflow-x-auto w-full font-mono border border-white/5">
                    {JSON.stringify(port, null, 2)}
                  </pre>
                  <div className="flex flex-col gap-2 min-w-[140px] shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full justify-start text-xs h-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(JSON.stringify(port, null, 2));
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
          )})}
        </div>
      </ScrollArea>
    </div>
  );
}
