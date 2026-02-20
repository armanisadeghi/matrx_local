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
} from "lucide-react";
import { Header } from "@/components/layout/Header";
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

export function Ports({ engineStatus, engineUrl }: PortsProps) {
  const [ports, setPorts] = useState<PortProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
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

  const filteredPorts = ports.filter((p) => {
    const term = search.toLowerCase();
    return p.name.toLowerCase().includes(term) || String(p.port).includes(term);
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
      <Header
        title="Port Manager"
        description="Monitor and control listening network ports and services"
        engineStatus={engineStatus}
        engineUrl={engineUrl}
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
            onClick={() => fetchPorts()}
            disabled={loading}
            className="h-9 w-9 bg-background/50 backdrop-blur-md"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </Header>

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
              getProcessIcon={getProcessIcon}
              onKill={(p) => {
                setProcessToKill(p);
                setKillDialogOpen(true);
              }}
            />
          </TabsContent>

          <TabsContent value="all" className="flex-1 mt-4">
            <PortTable
              ports={filteredPorts}
              getProcessIcon={getProcessIcon}
              onKill={(p) => {
                setProcessToKill(p);
                setKillDialogOpen(true);
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={killDialogOpen} onOpenChange={setKillDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-background/80 backdrop-blur-2xl border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Kill Process
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to terminate{" "}
              <strong>{processToKill?.name}</strong> (PID: {processToKill?.pid})
              listening on port <strong>{processToKill?.port}</strong>?
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

function PortTable({
  ports,
  getProcessIcon,
  onKill,
}: {
  ports: PortProcess[];
  getProcessIcon: (name: string) => React.ReactNode;
  onKill: (p: PortProcess) => void;
}) {
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
      <div className="grid grid-cols-12 gap-4 border-b border-white/5 bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <div className="col-span-2">Port</div>
        <div className="col-span-4">Process</div>
        <div className="col-span-2">PID</div>
        <div className="col-span-2">Protocol</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>
      <ScrollArea className="h-[calc(100%-45px)]">
        <div className="divide-y divide-white/5">
          {ports.map((port) => (
            <div
              key={`${port.pid}-${port.port}-${port.protocol}`}
              className="grid grid-cols-12 gap-4 items-center px-4 py-3 hover:bg-white/5 transition-colors group"
            >
              <div className="col-span-2">
                <Badge
                  variant="outline"
                  className="font-mono bg-primary/10 text-primary border-primary/20"
                >
                  {port.port}
                </Badge>
              </div>
              <div className="col-span-4 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-background/50 border border-white/5 shadow-sm">
                  {getProcessIcon(port.name)}
                </div>
                <div className="flex flex-col">
                  <span className="font-medium truncate">{port.name}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {port.address || "*"}
                  </span>
                </div>
              </div>
              <div className="col-span-2 text-sm text-muted-foreground font-mono">
                {port.pid > 0 ? port.pid : "-"}
              </div>
              <div className="col-span-2">
                <Badge
                  variant="secondary"
                  className="text-[10px] bg-background/50"
                >
                  {port.protocol}
                </Badge>
              </div>
              <div className="col-span-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                  onClick={() => onKill(port)}
                  disabled={port.pid === 0}
                >
                  Kill
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
