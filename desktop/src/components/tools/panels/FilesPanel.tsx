import { useState, useEffect } from "react";
import { FolderOpen, FileText, Search, Download, Upload, Eye, RefreshCw, FolderTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToolSection } from "@/components/tools/shared/ToolSection";
import { OutputCard } from "@/components/tools/shared/OutputCard";
import type { ToolUISchema } from "@/types/tool-schema";
import { cn } from "@/lib/utils";

interface FilesPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
  tools?: ToolUISchema[];
}

function parseOutput(result: unknown): { text?: string; metadata?: Record<string, unknown> } | null {
  try {
    const d = result as { output?: string; type?: string; metadata?: Record<string, unknown> };
    if (!d || d.type === "error") return { text: d?.output ?? "Error" };
    return { text: d.output ?? "", metadata: d.metadata };
  } catch { return null; }
}

export function FilesPanel({ onInvoke, loading, result }: FilesPanelProps) {
  const [view, setView] = useState<"browse" | "search" | "transfer" | "watch">("browse");
  const [filePath, setFilePath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [searchPattern, setSearchPattern] = useState("");
  const [searchPath, setSearchPath] = useState("");
  const [grepPattern, setGrepPattern] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [uploadPath, setUploadPath] = useState("");
  const [uploadUrl, setUploadUrl] = useState("");
  const [watchPath, setWatchPath] = useState("");
  const [watchId, setWatchId] = useState<string | null>(null);

  const output = parseOutput(result);

  // Track watch ID from results
  useEffect(() => {
    if (output?.text) {
      try {
        const parsed = JSON.parse(output.text);
        if (parsed.watch_id) setWatchId(parsed.watch_id);
      } catch { /* ignore */ }
    }
  }, [output]);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      {/* View switcher */}
      <div className="flex gap-1 rounded-xl border bg-muted/20 p-1">
        {([
          { key: "browse", label: "Browse", icon: FolderOpen },
          { key: "search", label: "Search", icon: Search },
          { key: "transfer", label: "Transfer", icon: Download },
          { key: "watch", label: "Watch", icon: Eye },
        ] as const).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all",
              view === v.key ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            <v.icon className="h-3.5 w-3.5" />
            {v.label}
          </button>
        ))}
      </div>

      {/* ── BROWSE ── */}
      {view === "browse" && (
        <>
          <ToolSection title="File Operations" icon={FileText} iconColor="text-teal-400">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/path/to/file"
                  className="text-xs font-mono flex-1"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                  onClick={() => onInvoke("Read", { file_path: filePath })} disabled={loading || !filePath}>
                  <FileText className="h-3.5 w-3.5" /> Read
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                  onClick={() => onInvoke("ListDirectory", { path: filePath })} disabled={loading || !filePath}>
                  <FolderTree className="h-3.5 w-3.5" /> List Dir
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                  onClick={() => onInvoke("OpenPath", { path: filePath })} disabled={loading || !filePath}>
                  <FolderOpen className="h-3.5 w-3.5" /> Open
                </Button>
              </div>
            </div>
          </ToolSection>

          {/* Write file */}
          <ToolSection title="Write File" icon={FileText} iconColor="text-teal-400">
            <div className="space-y-3">
              <Input
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="/path/to/file"
                className="text-xs font-mono"
              />
              <Textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                placeholder="File content..."
                rows={6}
                className="font-mono text-xs resize-none"
              />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("Write", { file_path: filePath, content: fileContent })}
                disabled={loading || !filePath || !fileContent}>
                <FileText className="h-3.5 w-3.5" /> Write File
              </Button>
            </div>
          </ToolSection>

          {output?.text && <OutputCard title="Result" content={output.text} maxHeight={300} />}
        </>
      )}

      {/* ── SEARCH ── */}
      {view === "search" && (
        <>
          <ToolSection title="Find Files (Glob)" icon={Search} iconColor="text-teal-400">
            <div className="space-y-3">
              <Input value={searchPattern} onChange={(e) => setSearchPattern(e.target.value)}
                placeholder="**/*.tsx" className="text-xs font-mono" />
              <Input value={searchPath} onChange={(e) => setSearchPath(e.target.value)}
                placeholder="Search directory (optional)" className="text-xs font-mono" />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("Glob", { pattern: searchPattern, ...(searchPath ? { path: searchPath } : {}) })}
                disabled={loading || !searchPattern}>
                <Search className="h-3.5 w-3.5" /> Search Files
              </Button>
            </div>
          </ToolSection>

          <ToolSection title="Search File Contents (Grep)" icon={Search} iconColor="text-teal-400">
            <div className="space-y-3">
              <Input value={grepPattern} onChange={(e) => setGrepPattern(e.target.value)}
                placeholder="Regex pattern" className="text-xs font-mono" />
              <Input value={searchPath} onChange={(e) => setSearchPath(e.target.value)}
                placeholder="Search directory (optional)" className="text-xs font-mono" />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("Grep", { pattern: grepPattern, ...(searchPath ? { path: searchPath } : {}) })}
                disabled={loading || !grepPattern}>
                <Search className="h-3.5 w-3.5" /> Search Contents
              </Button>
            </div>
          </ToolSection>

          {output?.text && <OutputCard title="Results" content={output.text} maxHeight={400} />}
        </>
      )}

      {/* ── TRANSFER ── */}
      {view === "transfer" && (
        <>
          <ToolSection title="Download File" icon={Download} iconColor="text-teal-400">
            <div className="space-y-3">
              <Input value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)}
                placeholder="https://example.com/file.zip" className="text-xs font-mono" />
              <Input value={filePath} onChange={(e) => setFilePath(e.target.value)}
                placeholder="Save to (optional)" className="text-xs font-mono" />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("DownloadFile", { url: downloadUrl, ...(filePath ? { save_path: filePath } : {}) })}
                disabled={loading || !downloadUrl}>
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
            </div>
          </ToolSection>

          <ToolSection title="Upload File" icon={Upload} iconColor="text-teal-400">
            <div className="space-y-3">
              <Input value={uploadPath} onChange={(e) => setUploadPath(e.target.value)}
                placeholder="/path/to/file" className="text-xs font-mono" />
              <Input value={uploadUrl} onChange={(e) => setUploadUrl(e.target.value)}
                placeholder="https://upload-endpoint.com/upload" className="text-xs font-mono" />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("UploadFile", { file_path: uploadPath, upload_url: uploadUrl })}
                disabled={loading || !uploadPath || !uploadUrl}>
                <Upload className="h-3.5 w-3.5" /> Upload
              </Button>
            </div>
          </ToolSection>

          {output?.text && <OutputCard title="Result" content={output.text} />}
        </>
      )}

      {/* ── WATCH ── */}
      {view === "watch" && (
        <>
          <ToolSection title="File Watcher" icon={Eye} iconColor="text-teal-400">
            <div className="space-y-3">
              <Input value={watchPath} onChange={(e) => setWatchPath(e.target.value)}
                placeholder="/path/to/watch" className="text-xs font-mono" />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                  onClick={() => onInvoke("WatchDirectory", { path: watchPath })}
                  disabled={loading || !watchPath || !!watchId}>
                  <Eye className="h-3.5 w-3.5" /> Start Watching
                </Button>
                {watchId && (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                      onClick={() => onInvoke("WatchEvents", { watch_id: watchId })} disabled={loading}>
                      <RefreshCw className="h-3.5 w-3.5" /> Get Events
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1.5"
                      onClick={() => { onInvoke("StopWatch", { watch_id: watchId }); setWatchId(null); }} disabled={loading}>
                      Stop
                    </Button>
                  </>
                )}
              </div>
              {watchId && (
                <p className="text-xs text-emerald-400">Watching: {watchId}</p>
              )}
            </div>
          </ToolSection>

          {output?.text && <OutputCard title="Watch Events" content={output.text} maxHeight={300} />}
        </>
      )}
    </div>
  );
}
