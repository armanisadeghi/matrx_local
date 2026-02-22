import { useState } from "react";
import { Move, Maximize2, Minimize2, MousePointer, Keyboard, Type, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToolSection } from "@/components/tools/shared/ToolSection";
import { OutputCard } from "@/components/tools/shared/OutputCard";
import type { ToolUISchema } from "@/types/tool-schema";
import { cn } from "@/lib/utils";

interface AutomationPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
  tools?: ToolUISchema[];
}

function parseOutput(result: unknown): string | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error") return d?.output ?? null;
    return d.output ?? null;
  } catch { return null; }
}

interface WindowEntry {
  app_name?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function tryParseWindows(result: unknown): WindowEntry[] | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error" || !d.output) return null;
    const arr = JSON.parse(d.output);
    if (Array.isArray(arr)) return arr;
    return null;
  } catch { return null; }
}

export function AutomationPanel({ onInvoke, loading, result }: AutomationPanelProps) {
  const [view, setView] = useState<"windows" | "keyboard" | "mouse">("windows");
  const [appName, setAppName] = useState("");
  const [moveX, setMoveX] = useState("0");
  const [moveY, setMoveY] = useState("0");
  const [moveW, setMoveW] = useState("800");
  const [moveH, setMoveH] = useState("600");
  const [typeText, setTypeText] = useState("");
  const [hotkey, setHotkey] = useState("");
  const [mouseX, setMouseX] = useState("0");
  const [mouseY, setMouseY] = useState("0");
  const [windows, setWindows] = useState<WindowEntry[]>([]);

  const output = parseOutput(result);
  const parsedWindows = tryParseWindows(result);

  // Update windows from result
  if (parsedWindows && parsedWindows.length > 0 && parsedWindows !== windows) {
    setWindows(parsedWindows);
  }

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      {/* View switcher */}
      <div className="flex gap-1 rounded-xl border bg-muted/20 p-1">
        {([
          { key: "windows", label: "Windows", icon: Maximize2 },
          { key: "keyboard", label: "Keyboard", icon: Keyboard },
          { key: "mouse", label: "Mouse", icon: MousePointer },
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

      {/* ── WINDOWS ── */}
      {view === "windows" && (
        <>
          <ToolSection title="Window Management" icon={Maximize2} iconColor="text-indigo-400"
            actions={
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => onInvoke("ListWindows", {})} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            }>
            <div className="space-y-3">
              <Input value={appName} onChange={(e) => setAppName(e.target.value)}
                placeholder="Application name (e.g., Chrome)" className="text-xs" />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1 flex-1"
                  onClick={() => onInvoke("FocusWindow", { app_name: appName })} disabled={loading || !appName}>
                  <Maximize2 className="h-3.5 w-3.5" /> Focus
                </Button>
                <Button size="sm" variant="outline" className="gap-1 flex-1"
                  onClick={() => onInvoke("MinimizeWindow", { app_name: appName, action: "minimize" })} disabled={loading || !appName}>
                  <Minimize2 className="h-3.5 w-3.5" /> Minimize
                </Button>
              </div>

              {/* Move/resize */}
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">X</label>
                  <Input type="number" value={moveX} onChange={(e) => setMoveX(e.target.value)} className="text-xs mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Y</label>
                  <Input type="number" value={moveY} onChange={(e) => setMoveY(e.target.value)} className="text-xs mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Width</label>
                  <Input type="number" value={moveW} onChange={(e) => setMoveW(e.target.value)} className="text-xs mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Height</label>
                  <Input type="number" value={moveH} onChange={(e) => setMoveH(e.target.value)} className="text-xs mt-0.5" />
                </div>
              </div>
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("MoveWindow", {
                  app_name: appName,
                  x: parseInt(moveX), y: parseInt(moveY),
                  width: parseInt(moveW), height: parseInt(moveH),
                })} disabled={loading || !appName}>
                <Move className="h-3.5 w-3.5" /> Move & Resize
              </Button>
            </div>
          </ToolSection>

          {/* Window list */}
          {windows.length > 0 && (
            <ToolSection title="Open Windows" icon={Maximize2} iconColor="text-indigo-400" noPadding>
              <div className="divide-y divide-border/30 max-h-64 overflow-auto">
                {windows.map((w, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => { setAppName(w.app_name ?? ""); if (w.app_name) onInvoke("FocusWindow", { app_name: w.app_name }); }}>
                    <div className="h-6 w-6 rounded bg-indigo-500/10 flex items-center justify-center shrink-0">
                      <Maximize2 className="h-3 w-3 text-indigo-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{w.app_name ?? "Unknown"}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{w.title}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {w.width}x{w.height}
                    </span>
                  </div>
                ))}
              </div>
            </ToolSection>
          )}

          {output && !parsedWindows && <OutputCard title="Result" content={output} />}
        </>
      )}

      {/* ── KEYBOARD ── */}
      {view === "keyboard" && (
        <>
          <ToolSection title="Type Text" icon={Type} iconColor="text-indigo-400">
            <div className="space-y-3">
              <Input value={appName} onChange={(e) => setAppName(e.target.value)}
                placeholder="Target app (optional)" className="text-xs" />
              <Input value={typeText} onChange={(e) => setTypeText(e.target.value)}
                placeholder="Text to type..." className="text-xs" />
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("TypeText", { text: typeText, ...(appName ? { app_name: appName } : {}) })}
                disabled={loading || !typeText}>
                <Type className="h-3.5 w-3.5" /> Type
              </Button>
            </div>
          </ToolSection>

          <ToolSection title="Hotkey" icon={Keyboard} iconColor="text-indigo-400">
            <div className="space-y-3">
              <Input value={hotkey} onChange={(e) => setHotkey(e.target.value)}
                placeholder="e.g., cmd+c, ctrl+shift+s" className="text-xs font-mono" />
              <div className="flex flex-wrap gap-1.5">
                {["cmd+c", "cmd+v", "cmd+z", "cmd+s", "cmd+a", "cmd+tab"].map((k) => (
                  <button key={k} onClick={() => { setHotkey(k); onInvoke("Hotkey", { keys: k }); }}
                    className="text-[10px] px-2 py-1 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors font-mono">
                    {k}
                  </button>
                ))}
              </div>
              <Button size="sm" className="w-full gap-1.5"
                onClick={() => onInvoke("Hotkey", { keys: hotkey, ...(appName ? { app_name: appName } : {}) })}
                disabled={loading || !hotkey}>
                <Keyboard className="h-3.5 w-3.5" /> Send Hotkey
              </Button>
            </div>
          </ToolSection>

          {output && <OutputCard title="Result" content={output} />}
        </>
      )}

      {/* ── MOUSE ── */}
      {view === "mouse" && (
        <>
          <ToolSection title="Mouse Control" icon={MousePointer} iconColor="text-indigo-400">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">X</label>
                  <Input type="number" value={mouseX} onChange={(e) => setMouseX(e.target.value)} className="text-xs mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Y</label>
                  <Input type="number" value={mouseY} onChange={(e) => setMouseY(e.target.value)} className="text-xs mt-0.5" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1 flex-1"
                  onClick={() => onInvoke("MouseMove", { x: parseInt(mouseX), y: parseInt(mouseY) })} disabled={loading}>
                  <Move className="h-3.5 w-3.5" /> Move
                </Button>
                <Button size="sm" variant="outline" className="gap-1 flex-1"
                  onClick={() => onInvoke("MouseClick", { x: parseInt(mouseX), y: parseInt(mouseY), button: "left" })} disabled={loading}>
                  <MousePointer className="h-3.5 w-3.5" /> Click
                </Button>
                <Button size="sm" variant="outline" className="gap-1 flex-1"
                  onClick={() => onInvoke("MouseClick", { x: parseInt(mouseX), y: parseInt(mouseY), button: "right" })} disabled={loading}>
                  <MousePointer className="h-3.5 w-3.5" /> Right
                </Button>
              </div>
            </div>
          </ToolSection>

          {output && <OutputCard title="Result" content={output} />}
        </>
      )}
    </div>
  );
}
