import { useState, useMemo } from "react";
import {
  Search,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Terminal,
  Monitor,
  Clipboard,
  Bell,
  Globe,
  Download,
  Copy,
  AppWindow,
  Layout,
  Keyboard,
  Mic,
  Chrome,
  Wifi,
  Activity,
  Eye,
  Cpu,
  Timer,
  Image,
  Bluetooth,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useTool } from "@/hooks/use-tool";
import type { EngineStatus } from "@/hooks/use-engine";

interface ToolsProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
}

// Tool category mapping
const toolCategories: Record<string, { label: string; icon: typeof FileText }> =
  {
    // File Operations
    Read: { label: "File Ops", icon: FileText },
    Write: { label: "File Ops", icon: FileText },
    Edit: { label: "File Ops", icon: FileText },
    Glob: { label: "File Ops", icon: FileText },
    Grep: { label: "File Ops", icon: FileText },
    // Execution
    Bash: { label: "Execution", icon: Terminal },
    BashOutput: { label: "Execution", icon: Terminal },
    TaskStop: { label: "Execution", icon: Terminal },
    // System
    SystemInfo: { label: "System", icon: Monitor },
    Screenshot: { label: "System", icon: Monitor },
    ListDirectory: { label: "System", icon: Monitor },
    OpenUrl: { label: "System", icon: Monitor },
    OpenPath: { label: "System", icon: Monitor },
    // Clipboard
    ClipboardRead: { label: "Clipboard", icon: Clipboard },
    ClipboardWrite: { label: "Clipboard", icon: Clipboard },
    // Notifications
    Notify: { label: "Notifications", icon: Bell },
    // Network / Scraping
    FetchUrl: { label: "Network", icon: Globe },
    FetchWithBrowser: { label: "Network", icon: Globe },
    Scrape: { label: "Network", icon: Globe },
    Search: { label: "Network", icon: Globe },
    Research: { label: "Network", icon: Globe },
    // Transfer
    DownloadFile: { label: "Transfer", icon: Download },
    UploadFile: { label: "Transfer", icon: Download },
    // Process Management
    ListProcesses: { label: "Processes", icon: Cpu },
    LaunchApp: { label: "Processes", icon: Cpu },
    KillProcess: { label: "Processes", icon: Cpu },
    FocusApp: { label: "Processes", icon: Cpu },
    // Window Management
    ListWindows: { label: "Windows", icon: Layout },
    FocusWindow: { label: "Windows", icon: Layout },
    MoveWindow: { label: "Windows", icon: Layout },
    MinimizeWindow: { label: "Windows", icon: Layout },
    // Input Automation
    TypeText: { label: "Input", icon: Keyboard },
    Hotkey: { label: "Input", icon: Keyboard },
    MouseClick: { label: "Input", icon: Keyboard },
    MouseMove: { label: "Input", icon: Keyboard },
    // Audio
    ListAudioDevices: { label: "Audio", icon: Mic },
    RecordAudio: { label: "Audio", icon: Mic },
    PlayAudio: { label: "Audio", icon: Mic },
    TranscribeAudio: { label: "Audio", icon: Mic },
    // Browser Automation
    BrowserNavigate: { label: "Browser", icon: Chrome },
    BrowserClick: { label: "Browser", icon: Chrome },
    BrowserType: { label: "Browser", icon: Chrome },
    BrowserExtract: { label: "Browser", icon: Chrome },
    BrowserScreenshot: { label: "Browser", icon: Chrome },
    BrowserEval: { label: "Browser", icon: Chrome },
    BrowserTabs: { label: "Browser", icon: Chrome },
    // Network Discovery
    NetworkInfo: { label: "Discovery", icon: Wifi },
    NetworkScan: { label: "Discovery", icon: Wifi },
    PortScan: { label: "Discovery", icon: Wifi },
    MDNSDiscover: { label: "Discovery", icon: Wifi },
    // System Monitoring
    SystemResources: { label: "Monitoring", icon: Activity },
    BatteryStatus: { label: "Monitoring", icon: Activity },
    DiskUsage: { label: "Monitoring", icon: Activity },
    TopProcesses: { label: "Monitoring", icon: Activity },
    // File Watching
    WatchDirectory: { label: "File Watch", icon: Eye },
    WatchEvents: { label: "File Watch", icon: Eye },
    StopWatch: { label: "File Watch", icon: Eye },
    // OS Integration
    AppleScript: { label: "OS Integration", icon: AppWindow },
    PowerShellScript: { label: "OS Integration", icon: AppWindow },
    GetInstalledApps: { label: "OS Integration", icon: AppWindow },
    // Scheduler
    ScheduleTask: { label: "Scheduler", icon: Timer },
    ListScheduled: { label: "Scheduler", icon: Timer },
    CancelScheduled: { label: "Scheduler", icon: Timer },
    HeartbeatStatus: { label: "Scheduler", icon: Timer },
    PreventSleep: { label: "Scheduler", icon: Timer },
    // Media
    ImageOCR: { label: "Media", icon: Image },
    ImageResize: { label: "Media", icon: Image },
    PdfExtract: { label: "Media", icon: Image },
    ArchiveCreate: { label: "Media", icon: Image },
    ArchiveExtract: { label: "Media", icon: Image },
    // WiFi & Bluetooth
    WifiNetworks: { label: "Wireless", icon: Bluetooth },
    BluetoothDevices: { label: "Wireless", icon: Bluetooth },
    ConnectedDevices: { label: "Wireless", icon: Bluetooth },
  };

// Common tool parameter templates
const toolParams: Record<string, { placeholder: string; defaultInput: string }> = {
  Read: {
    placeholder: '{"file_path": "/path/to/file"}',
    defaultInput: '{\n  "file_path": ""\n}',
  },
  Write: {
    placeholder: '{"file_path": "/path/to/file", "content": "..."}',
    defaultInput: '{\n  "file_path": "",\n  "content": ""\n}',
  },
  Bash: {
    placeholder: '{"command": "echo hello"}',
    defaultInput: '{\n  "command": ""\n}',
  },
  Glob: {
    placeholder: '{"pattern": "**/*.py"}',
    defaultInput: '{\n  "pattern": ""\n}',
  },
  Grep: {
    placeholder: '{"pattern": "TODO", "files": "**/*.py"}',
    defaultInput: '{\n  "pattern": "",\n  "files": ""\n}',
  },
  SystemInfo: { placeholder: "{}", defaultInput: "{}" },
  ListDirectory: {
    placeholder: '{"path": "/path/to/dir"}',
    defaultInput: '{\n  "path": ""\n}',
  },
  Scrape: {
    placeholder: '{"urls": ["https://example.com"]}',
    defaultInput: '{\n  "urls": [""]\n}',
  },
  Search: {
    placeholder: '{"query": "your search query", "count": 10}',
    defaultInput: '{\n  "query": "",\n  "count": 10\n}',
  },
  FetchUrl: {
    placeholder: '{"url": "https://example.com"}',
    defaultInput: '{\n  "url": ""\n}',
  },
  Notify: {
    placeholder: '{"title": "Hello", "message": "World"}',
    defaultInput: '{\n  "title": "",\n  "message": ""\n}',
  },
  ClipboardRead: { placeholder: "{}", defaultInput: "{}" },
  ClipboardWrite: {
    placeholder: '{"text": "..."}',
    defaultInput: '{\n  "text": ""\n}',
  },
  Screenshot: { placeholder: "{}", defaultInput: "{}" },
  // Process Management
  ListProcesses: {
    placeholder: '{"filter": "chrome", "sort_by": "cpu", "limit": 50}',
    defaultInput: '{\n  "sort_by": "cpu",\n  "limit": 50\n}',
  },
  LaunchApp: {
    placeholder: '{"application": "Safari", "args": []}',
    defaultInput: '{\n  "application": ""\n}',
  },
  KillProcess: {
    placeholder: '{"pid": 1234}',
    defaultInput: '{\n  "pid": null,\n  "name": ""\n}',
  },
  FocusApp: {
    placeholder: '{"application": "Safari"}',
    defaultInput: '{\n  "application": ""\n}',
  },
  // Window Management
  ListWindows: { placeholder: '{"app_filter": ""}', defaultInput: "{}" },
  FocusWindow: {
    placeholder: '{"app_name": "Safari"}',
    defaultInput: '{\n  "app_name": ""\n}',
  },
  MoveWindow: {
    placeholder: '{"app_name": "Safari", "x": 100, "y": 100, "width": 800, "height": 600}',
    defaultInput: '{\n  "app_name": "",\n  "x": 100,\n  "y": 100,\n  "width": 800,\n  "height": 600\n}',
  },
  MinimizeWindow: {
    placeholder: '{"app_name": "Safari", "action": "minimize"}',
    defaultInput: '{\n  "app_name": "",\n  "action": "minimize"\n}',
  },
  // Input Automation
  TypeText: {
    placeholder: '{"text": "Hello world"}',
    defaultInput: '{\n  "text": ""\n}',
  },
  Hotkey: {
    placeholder: '{"keys": "cmd+c"}',
    defaultInput: '{\n  "keys": ""\n}',
  },
  MouseClick: {
    placeholder: '{"x": 500, "y": 300, "button": "left"}',
    defaultInput: '{\n  "x": 0,\n  "y": 0,\n  "button": "left"\n}',
  },
  MouseMove: {
    placeholder: '{"x": 500, "y": 300}',
    defaultInput: '{\n  "x": 0,\n  "y": 0\n}',
  },
  // Audio
  ListAudioDevices: { placeholder: "{}", defaultInput: "{}" },
  RecordAudio: {
    placeholder: '{"duration_seconds": 5}',
    defaultInput: '{\n  "duration_seconds": 5\n}',
  },
  PlayAudio: {
    placeholder: '{"file_path": "/path/to/audio.wav"}',
    defaultInput: '{\n  "file_path": ""\n}',
  },
  TranscribeAudio: {
    placeholder: '{"file_path": "/path/to/audio.wav", "model": "base"}',
    defaultInput: '{\n  "file_path": "",\n  "model": "base"\n}',
  },
  // Browser Automation
  BrowserNavigate: {
    placeholder: '{"url": "https://example.com"}',
    defaultInput: '{\n  "url": ""\n}',
  },
  BrowserClick: {
    placeholder: '{"selector": "button.submit"}',
    defaultInput: '{\n  "selector": ""\n}',
  },
  BrowserType: {
    placeholder: '{"selector": "input[name=q]", "text": "search query"}',
    defaultInput: '{\n  "selector": "",\n  "text": ""\n}',
  },
  BrowserExtract: {
    placeholder: '{"extract_type": "all_text"}',
    defaultInput: '{\n  "extract_type": "all_text"\n}',
  },
  BrowserScreenshot: {
    placeholder: '{"full_page": false}',
    defaultInput: '{\n  "full_page": false\n}',
  },
  BrowserEval: {
    placeholder: '{"javascript": "document.title"}',
    defaultInput: '{\n  "javascript": ""\n}',
  },
  BrowserTabs: {
    placeholder: '{"action": "list"}',
    defaultInput: '{\n  "action": "list"\n}',
  },
  // Network Discovery
  NetworkInfo: { placeholder: "{}", defaultInput: "{}" },
  NetworkScan: {
    placeholder: '{"subnet": "192.168.1.0/24"}',
    defaultInput: "{}",
  },
  PortScan: {
    placeholder: '{"host": "192.168.1.1", "ports": "common"}',
    defaultInput: '{\n  "host": "",\n  "ports": "common"\n}',
  },
  MDNSDiscover: {
    placeholder: '{"service_type": "_http._tcp"}',
    defaultInput: "{}",
  },
  // System Monitoring
  SystemResources: { placeholder: "{}", defaultInput: "{}" },
  BatteryStatus: { placeholder: "{}", defaultInput: "{}" },
  DiskUsage: { placeholder: '{"path": "/"}', defaultInput: "{}" },
  TopProcesses: {
    placeholder: '{"sort_by": "cpu", "limit": 15}',
    defaultInput: '{\n  "sort_by": "cpu",\n  "limit": 15\n}',
  },
  // File Watching
  WatchDirectory: {
    placeholder: '{"path": "/path/to/watch", "recursive": true}',
    defaultInput: '{\n  "path": "",\n  "recursive": true\n}',
  },
  WatchEvents: {
    placeholder: '{"watch_id": "watch_1"}',
    defaultInput: '{\n  "watch_id": ""\n}',
  },
  StopWatch: {
    placeholder: '{"watch_id": "watch_1"}',
    defaultInput: '{\n  "watch_id": ""\n}',
  },
  // OS Integration
  AppleScript: {
    placeholder: '{"script": "tell application \\"Finder\\" to get name of every file of desktop"}',
    defaultInput: '{\n  "script": ""\n}',
  },
  PowerShellScript: {
    placeholder: '{"script": "Get-Process | Sort-Object CPU -Descending | Select-Object -First 10"}',
    defaultInput: '{\n  "script": ""\n}',
  },
  GetInstalledApps: {
    placeholder: '{"filter": "chrome"}',
    defaultInput: "{}",
  },
  // Scheduler
  ScheduleTask: {
    placeholder: '{"name": "Health Check", "tool_name": "SystemResources", "tool_input": {}, "interval_seconds": 60}',
    defaultInput: '{\n  "name": "",\n  "tool_name": "",\n  "tool_input": {},\n  "interval_seconds": 60\n}',
  },
  ListScheduled: { placeholder: "{}", defaultInput: "{}" },
  CancelScheduled: {
    placeholder: '{"task_id": "sched_abc12345"}',
    defaultInput: '{\n  "task_id": ""\n}',
  },
  HeartbeatStatus: { placeholder: "{}", defaultInput: "{}" },
  PreventSleep: {
    placeholder: '{"enable": true, "reason": "Background agent tasks"}',
    defaultInput: '{\n  "enable": true,\n  "reason": "Background agent tasks"\n}',
  },
  // Media
  ImageOCR: {
    placeholder: '{"file_path": "/path/to/image.png"}',
    defaultInput: '{\n  "file_path": ""\n}',
  },
  ImageResize: {
    placeholder: '{"file_path": "/path/to/image.png", "width": 800}',
    defaultInput: '{\n  "file_path": "",\n  "width": 800\n}',
  },
  PdfExtract: {
    placeholder: '{"file_path": "/path/to/document.pdf"}',
    defaultInput: '{\n  "file_path": ""\n}',
  },
  ArchiveCreate: {
    placeholder: '{"source_paths": ["/path/to/dir"], "format": "zip"}',
    defaultInput: '{\n  "source_paths": [""],\n  "format": "zip"\n}',
  },
  ArchiveExtract: {
    placeholder: '{"file_path": "/path/to/archive.zip"}',
    defaultInput: '{\n  "file_path": ""\n}',
  },
  // WiFi & Bluetooth
  WifiNetworks: { placeholder: '{"rescan": false}', defaultInput: "{}" },
  BluetoothDevices: { placeholder: "{}", defaultInput: "{}" },
  ConnectedDevices: { placeholder: "{}", defaultInput: "{}" },
};

export function Tools({ engineStatus, engineUrl, tools }: ToolsProps) {
  const [search, setSearch] = useState("");
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [inputJson, setInputJson] = useState("{}");
  const { loading, result, error, invoke, reset } = useTool();

  const filteredTools = useMemo(() => {
    if (!search) return tools;
    const q = search.toLowerCase();
    return tools.filter(
      (t) =>
        t.toLowerCase().includes(q) ||
        (toolCategories[t]?.label.toLowerCase().includes(q) ?? false)
    );
  }, [tools, search]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const tool of filteredTools) {
      const cat = toolCategories[tool]?.label ?? "Other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(tool);
    }
    return groups;
  }, [filteredTools]);

  const handleSelectTool = (tool: string) => {
    setSelectedTool(tool);
    setInputJson(toolParams[tool]?.defaultInput ?? "{}");
    reset();
  };

  const handleInvoke = async () => {
    if (!selectedTool) return;
    try {
      const input = JSON.parse(inputJson);
      await invoke(selectedTool, input);
    } catch (err) {
      if (err instanceof SyntaxError) {
        // JSON parse error handled separately
      }
    }
  };

  const copyResult = () => {
    if (result) {
      navigator.clipboard.writeText(result.output);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        title="Tools"
        description={`${tools.length} tools available`}
        engineStatus={engineStatus}
        engineUrl={engineUrl}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Tool Browser */}
        <div className="flex w-[280px] flex-col border-r">
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tools..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="px-3 pb-3 space-y-4">
              {Object.entries(grouped).map(([category, categoryTools]) => {
                const CategoryIcon =
                  toolCategories[categoryTools[0]]?.icon ?? Globe;
                return (
                  <div key={category}>
                    <div className="flex items-center gap-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <CategoryIcon className="h-3 w-3" />
                      {category}
                    </div>
                    <div className="space-y-0.5">
                      {categoryTools.map((tool) => (
                        <button
                          key={tool}
                          onClick={() => handleSelectTool(tool)}
                          className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                            selectedTool === tool
                              ? "bg-primary/15 text-primary font-medium"
                              : "text-foreground hover:bg-accent"
                          }`}
                        >
                          {tool}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Right: Tool Invocation */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedTool ? (
            <>
              <div className="border-b p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedTool}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {toolCategories[selectedTool]?.label ?? "Tool"} &middot;
                      Enter JSON input below
                    </p>
                  </div>
                  <Button
                    onClick={handleInvoke}
                    disabled={loading || engineStatus !== "connected"}
                    size="sm"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        Run
                      </>
                    )}
                  </Button>
                </div>

                <div className="mt-3">
                  <Textarea
                    value={inputJson}
                    onChange={(e) => setInputJson(e.target.value)}
                    placeholder={
                      toolParams[selectedTool]?.placeholder ?? "{}"
                    }
                    className="font-mono text-xs h-24 resize-none"
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* Result */}
              <div className="flex-1 overflow-hidden">
                {result && (
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b px-4 py-2">
                      <div className="flex items-center gap-2">
                        {result.type === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <Badge
                          variant={
                            result.type === "success" ? "success" : "destructive"
                          }
                        >
                          {result.type}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={copyResult}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </Button>
                    </div>
                    <ScrollArea className="flex-1">
                      <pre className="whitespace-pre-wrap break-words p-4 text-xs font-mono">
                        {result.output}
                      </pre>
                    </ScrollArea>
                  </div>
                )}
                {error && !result && (
                  <div className="p-4">
                    <Card className="border-red-500/20 bg-red-500/5">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-500" />
                          <span className="text-sm font-medium text-red-500">
                            Error
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-red-400 font-mono">
                          {error}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}
                {!result && !error && !loading && (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <p className="text-sm">
                      Click Run to invoke {selectedTool}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
              <Terminal className="h-12 w-12 opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium">Select a tool</p>
                <p className="mt-1 text-xs">
                  Choose a tool from the sidebar to invoke it
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Suppress unused import warning
void Separator;
