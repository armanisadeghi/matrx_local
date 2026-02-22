import { useState, useCallback, useEffect } from "react";
import { Search, RefreshCw, Grid3x3, List, AppWindow } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AiBadge } from "@/components/tools/panels/AiBadge";
import { cn } from "@/lib/utils";

interface AppsPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

interface AppEntry {
  name?: string;
  path?: string;
  bundle_id?: string;
}

const CACHE_KEY = "matrx:installed-apps";

function tryParse(result: unknown): AppEntry[] | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error") return null;
    if (d.output) {
      const arr = JSON.parse(d.output);
      if (Array.isArray(arr)) return arr;
    }
    return null;
  } catch { return null; }
}

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function hue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

export function InstalledAppsPanel({ onInvoke, loading, result }: AppsPanelProps) {
  const [apps, setApps]     = useState<AppEntry[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView]     = useState<"grid" | "list">("grid");
  const [cached, setCached] = useState(false);

  // Load from cache on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as AppEntry[];
        if (Array.isArray(data) && data.length > 0) {
          setApps(data);
          setCached(true);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Parse new result
  useEffect(() => {
    const parsed = tryParse(result);
    if (parsed && parsed.length > 0) {
      setApps(parsed);
      setCached(false);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(parsed)); } catch { /* ignore */ }
    }
  }, [result]);

  const refresh = useCallback(() => onInvoke("GetInstalledApps", {}), [onInvoke]);

  const filtered = apps
    .filter((a) => !search || (a.name?.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-hidden">
      <AiBadge text="Your AI can see all installed apps and launch them for you" />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…" className="pl-8 h-9" />
        </div>
        <button onClick={() => setView(v => v === "grid" ? "list" : "grid")}
          className="flex h-9 w-9 items-center justify-center rounded-lg border bg-muted/40 hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground">
          {view === "grid" ? <List className="h-4 w-4" /> : <Grid3x3 className="h-4 w-4" />}
        </button>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2 shrink-0">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {cached && (
        <p className="text-[11px] text-muted-foreground px-1">
          Showing cached results. Click Refresh to reload.
        </p>
      )}

      {apps.length === 0 && !loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <AppWindow className="h-12 w-12 opacity-20" />
          <p className="text-sm text-muted-foreground">Click Refresh to load installed apps</p>
          <Button onClick={refresh} disabled={loading}>Load Apps</Button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex-1 overflow-auto">
          {view === "grid" ? (
            <div className="grid grid-cols-4 gap-2">
              {filtered.map((app, i) => {
                const h = hue(app.name ?? String(i));
                return (
                  <div key={i} className="flex flex-col items-center gap-1.5 rounded-xl p-2 hover:bg-muted/40 transition-colors cursor-default">
                    <div
                      className="h-12 w-12 rounded-2xl flex items-center justify-center text-white text-sm font-bold shadow-sm"
                      style={{ background: `hsl(${h},50%,45%)` }}
                    >
                      {getInitials(app.name ?? "??")}
                    </div>
                    <span className="text-[10px] text-center text-foreground/80 leading-tight line-clamp-2 w-full">
                      {app.name}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((app, i) => {
                const h = hue(app.name ?? String(i));
                return (
                  <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors">
                    <div
                      className="h-8 w-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: `hsl(${h},50%,45%)` }}
                    >
                      {getInitials(app.name ?? "??")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{app.name}</p>
                      {app.bundle_id && <p className="text-[10px] text-muted-foreground font-mono truncate">{app.bundle_id}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className={cn("text-right text-[11px] text-muted-foreground", apps.length === 0 && "hidden")}>
        {filtered.length} of {apps.length} apps
      </div>
    </div>
  );
}
