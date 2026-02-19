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
    Read: { label: "File Ops", icon: FileText },
    Write: { label: "File Ops", icon: FileText },
    Edit: { label: "File Ops", icon: FileText },
    Glob: { label: "File Ops", icon: FileText },
    Grep: { label: "File Ops", icon: FileText },
    Bash: { label: "Execution", icon: Terminal },
    BashOutput: { label: "Execution", icon: Terminal },
    TaskStop: { label: "Execution", icon: Terminal },
    SystemInfo: { label: "System", icon: Monitor },
    Screenshot: { label: "System", icon: Monitor },
    ListDirectory: { label: "System", icon: Monitor },
    OpenUrl: { label: "System", icon: Monitor },
    OpenPath: { label: "System", icon: Monitor },
    ClipboardRead: { label: "Clipboard", icon: Clipboard },
    ClipboardWrite: { label: "Clipboard", icon: Clipboard },
    Notify: { label: "Notifications", icon: Bell },
    FetchUrl: { label: "Network", icon: Globe },
    FetchWithBrowser: { label: "Network", icon: Globe },
    Scrape: { label: "Network", icon: Globe },
    Search: { label: "Network", icon: Globe },
    Research: { label: "Network", icon: Globe },
    DownloadFile: { label: "Transfer", icon: Download },
    UploadFile: { label: "Transfer", icon: Download },
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
    <>
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
    </>
  );
}

// Suppress unused import warning
void Separator;
