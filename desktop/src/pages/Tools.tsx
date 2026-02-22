import { useState, useMemo, useEffect, useCallback } from "react";
import { Search, Code2, Sparkles, History, X, ChevronRight, Bot } from "lucide-react";
import * as LucideIcons from "lucide-react";
import type { LucideProps } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToolDetailPanel } from "@/components/tools/ToolDetailPanel";
import { MonitoringPanel }   from "@/components/tools/panels/MonitoringPanel";
import { ClipboardPanel }    from "@/components/tools/panels/ClipboardPanel";
import { AudioPanel }        from "@/components/tools/panels/AudioPanel";
import { NetworkPanel }      from "@/components/tools/panels/NetworkPanel";
import { ProcessPanel }      from "@/components/tools/panels/ProcessPanel";
import { InstalledAppsPanel } from "@/components/tools/panels/InstalledAppsPanel";
import { SchedulerPanel }    from "@/components/tools/panels/SchedulerPanel";
import { NotifyPanel }       from "@/components/tools/panels/NotifyPanel";
import { BrowserPanel }      from "@/components/tools/panels/BrowserPanel";
import { GenericToolPanel }  from "@/components/tools/panels/GenericToolPanel";
import { useToolExecution }  from "@/hooks/use-tool-execution";
import { fromEngineSchema, toolCategories, toolSchemas, categoryColorMap, getCategoryMeta } from "@/lib/tool-registry";
import type { EngineStatus } from "@/hooks/use-engine";
import type { ToolUISchema } from "@/types/tool-schema";
import { cn } from "@/lib/utils";

interface ToolsProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
}

interface EngineToolSchema {
  name: string;
  description: string;
  category?: string;
  input_schema?: {
    properties?: Record<string, { type?: string; description?: string; default?: unknown }>;
    required?: string[];
  };
}

function DynamicIcon({ name, ...props }: { name: string } & LucideProps) {
  const key = name.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  // @ts-expect-error dynamic lucide icon
  const Icon = LucideIcons[key] as React.ComponentType<LucideProps> | undefined;
  if (!Icon) return <LucideIcons.Wrench {...props} />;
  return <Icon {...props} />;
}

// Panel router — maps category panelType to the consumer component
function ConsumerPanel({
  schema, onInvoke, loading, result, error, elapsedMs, onReset,
}: {
  schema: ToolUISchema;
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
  error: string | null;
  elapsedMs: number;
  onReset: () => void;
}) {
  const meta = getCategoryMeta(schema.category);
  const sharedProps = { onInvoke, loading, result };

  switch (meta.panelType) {
    case "monitoring":  return <MonitoringPanel {...sharedProps} />;
    case "clipboard":   return <ClipboardPanel  {...sharedProps} />;
    case "audio":       return <AudioPanel       {...sharedProps} />;
    case "network":     return <NetworkPanel     {...sharedProps} />;
    case "process":     return <ProcessPanel     {...sharedProps} />;
    case "apps":        return <InstalledAppsPanel {...sharedProps} />;
    case "scheduler":   return <SchedulerPanel   {...sharedProps} />;
    case "notify":      return <NotifyPanel      {...sharedProps} />;
    case "browser":     return <BrowserPanel     {...sharedProps} />;
    default:
      return <GenericToolPanel schema={schema} onInvoke={onInvoke}
        loading={loading} result={result} error={error} elapsedMs={elapsedMs} onReset={onReset} />;
  }
}

export function Tools({ engineStatus, engineUrl, tools }: ToolsProps) {
  const [search, setSearch]               = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [engineSchemas, setEngineSchemas] = useState<ToolUISchema[]>([]);
  const [advancedMode, setAdvancedMode]   = useState(false);
  const [historyOpen, setHistoryOpen]     = useState(false);

  const { loading, result, error, elapsedMs, history, invoke, reset } = useToolExecution();

  // Load schemas from engine
  useEffect(() => {
    if (engineStatus !== "connected" || !engineUrl) return;
    const load = async () => {
      try {
        const resp = await fetch(`${engineUrl}/chat/tools`);
        if (!resp.ok) return;
        const data  = await resp.json();
        const schemas = ((data.tools ?? []) as EngineToolSchema[]).map(fromEngineSchema);
        setEngineSchemas(schemas);
        if (!selectedToolName && schemas.length > 0) setSelectedToolName(schemas[0].toolName);
      } catch { /* graceful fallback */ }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineStatus, engineUrl]);

  const schemas = useMemo(() => {
    if (engineSchemas.length > 0) return engineSchemas;
    if (tools.length > 0) return tools
      .map((t) => toolSchemas.find((s) => s.toolName === t))
      .filter((s): s is ToolUISchema => s != null);
    return toolSchemas;
  }, [tools, engineSchemas]);

  // Build category list from schemas
  const categoryList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of schemas) {
      counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    // Sort by toolCategories order, then alphabetically for unknowns
    const ordered = toolCategories
      .filter((c) => counts.has(c.id))
      .map((c) => ({ ...c, count: counts.get(c.id)! }));
    const extra = Array.from(counts.entries())
      .filter(([id]) => !toolCategories.find((c) => c.id === id))
      .map(([id, count]) => ({
        id, label: id, description: "", icon: "wrench",
        color: "slate", panelType: "generic" as const, count,
      }));
    return [...ordered, ...extra];
  }, [schemas]);

  // Set initial category
  useEffect(() => {
    if (!selectedCategory && categoryList.length > 0) {
      setSelectedCategory(categoryList[0].id);
    }
  }, [categoryList, selectedCategory]);

  // Filtered tools for the sidebar under search
  const filteredSchemas = useMemo(() => {
    if (!search) return schemas.filter((s) => s.category === selectedCategory);
    const q = search.toLowerCase();
    return schemas.filter((s) =>
      s.displayName.toLowerCase().includes(q) ||
      s.toolName.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  }, [schemas, selectedCategory, search]);

  const selectedSchema = selectedToolName
    ? schemas.find((s) => s.toolName === selectedToolName) ?? null
    : null;

  const handleCategorySelect = useCallback((catId: string) => {
    setSelectedCategory(catId);
    setSearch("");
    reset();
    // Auto-select first tool in the category
    const first = schemas.find((s) => s.category === catId);
    if (first) setSelectedToolName(first.toolName);
  }, [schemas, reset]);

  const handleToolSelect = useCallback((schema: ToolUISchema) => {
    setSelectedToolName(schema.toolName);
    reset();
    setAdvancedMode(false);
  }, [reset]);

  const invokeForPanel = useCallback(
    async (toolName: string, params: Record<string, unknown>) => {
      await invoke(toolName, params);
    },
    [invoke]
  );

  const activeCat = selectedCategory
    ? toolCategories.find((c) => c.id === selectedCategory) ?? { id: selectedCategory, label: selectedCategory, color: "slate", icon: "wrench" }
    : null;
  const catColors = categoryColorMap[activeCat?.color ?? "slate"] ?? categoryColorMap["slate"];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Tool Workbench"
        description={`${schemas.length} tools — your AI's full capability set`}
      />

      <div className="flex flex-1 overflow-hidden">

        {/* ===== LEFT CATEGORY NAV ===== */}
        <div className="flex w-[220px] shrink-0 flex-col border-r bg-sidebar">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search tools…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); if (e.target.value) setSelectedToolName(null); }}
                className="h-8 pl-8 text-xs bg-background/50"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {!search && categoryList.map((cat) => {
                const colors  = categoryColorMap[cat.color] ?? categoryColorMap["slate"];
                const isActive = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategorySelect(cat.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all group",
                      isActive
                        ? `${colors.bg} ${colors.border} border`
                        : "border border-transparent hover:bg-muted/40"
                    )}
                  >
                    <div className={cn(
                      "h-6 w-6 shrink-0 rounded-md flex items-center justify-center transition-colors",
                      isActive ? `${colors.text}` : "text-muted-foreground group-hover:text-foreground"
                    )}>
                      <DynamicIcon name={cat.icon} className="h-3.5 w-3.5" />
                    </div>
                    <span className={cn(
                      "flex-1 text-xs font-medium truncate",
                      isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                    )}>
                      {cat.label}
                    </span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0 tabular-nums">
                      {cat.count}
                    </Badge>
                  </button>
                );
              })}

              {/* Search results — flat list */}
              {search && filteredSchemas.map((s) => {
                const isActive = selectedToolName === s.toolName;
                const meta     = getCategoryMeta(s.category);
                const colors   = categoryColorMap[meta.color] ?? categoryColorMap["slate"];
                return (
                  <button key={s.toolName} onClick={() => handleToolSelect(s)}
                    className={cn(
                      "w-full text-left rounded-lg px-2.5 py-2 transition-all border",
                      isActive
                        ? `${colors.bg} ${colors.border}`
                        : "border-transparent hover:bg-muted/40"
                    )}>
                    <p className="text-xs font-medium truncate">{s.displayName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{s.category}</p>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          {/* AI tools count */}
          <div className="border-t p-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-primary" />
              <span>{schemas.length} tools available to AI</span>
            </div>
          </div>
        </div>

        {/* ===== MIDDLE TOOL LIST (when category selected, no search) ===== */}
        {!search && selectedCategory && (
          <div className="flex w-[220px] shrink-0 flex-col border-r">
            {/* Category header */}
            <div className={cn("border-b p-3", catColors.bg)}>
              <div className="flex items-center gap-2">
                <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", catColors.bg, catColors.text)}>
                  <DynamicIcon name={activeCat?.icon ?? "wrench"} className="h-3.5 w-3.5" />
                </div>
                <span className="text-sm font-semibold">{activeCat?.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {schemas.filter((s) => s.category === selectedCategory).length} tools
              </p>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2 space-y-0.5">
                {schemas.filter((s) => s.category === selectedCategory).map((s) => {
                  const isActive = selectedToolName === s.toolName;
                  return (
                    <button key={s.toolName} onClick={() => handleToolSelect(s)}
                      className={cn(
                        "w-full text-left rounded-lg px-3 py-2.5 transition-all border group",
                        isActive
                          ? `${catColors.bg} ${catColors.border}`
                          : "border-transparent hover:bg-muted/40"
                      )}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate flex-1">{s.displayName}</span>
                        {isActive && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{s.description}</p>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* ===== RIGHT PANEL ===== */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedSchema ? (
            <>
              {/* Panel header */}
              <div className="flex items-center justify-between border-b px-4 py-2.5 bg-card/30">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground truncate">{selectedSchema.displayName}</h2>
                  <p className="text-[11px] text-muted-foreground truncate max-w-md">{selectedSchema.description}</p>
                </div>
                <div className="flex items-center gap-1.5 ml-4 shrink-0">
                  <Badge variant="secondary" className="text-[10px]">
                    {selectedSchema.category}
                  </Badge>
                  <Button
                    variant={advancedMode ? "secondary" : "ghost"}
                    size="sm"
                    className={cn("h-7 gap-1 text-xs", advancedMode && "bg-muted")}
                    onClick={() => setAdvancedMode((v) => !v)}
                    title={advancedMode ? "Switch to Consumer View" : "Switch to Advanced (Raw JSON) Mode"}
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    {advancedMode ? "Simple" : "Advanced"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setHistoryOpen((v) => !v)}
                    title="Execution history"
                  >
                    <History className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Panel body */}
              <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-hidden">
                  {advancedMode ? (
                    <ToolDetailPanel
                      schema={selectedSchema}
                      loading={loading}
                      result={result}
                      error={error}
                      elapsedMs={elapsedMs}
                      onInvoke={invoke}
                      onReset={reset}
                    />
                  ) : (
                    <div className="h-full overflow-auto">
                      <ConsumerPanel
                        schema={selectedSchema}
                        onInvoke={invokeForPanel}
                        loading={loading}
                        result={result}
                        error={error}
                        elapsedMs={elapsedMs}
                        onReset={reset}
                      />
                    </div>
                  )}
                </div>

                {/* History drawer */}
                {historyOpen && (
                  <div className="w-[260px] shrink-0 border-l flex flex-col bg-card/30">
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <div className="flex items-center gap-2">
                        <History className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold">History</span>
                      </div>
                      <button onClick={() => setHistoryOpen(false)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-2 space-y-1">
                        {history.length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-6">No invocations yet</p>
                        )}
                        {history.map((entry) => (
                          <div key={entry.id} className="rounded-lg border bg-card/50 px-2.5 py-2 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <div className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0",
                                entry.status === "success" ? "bg-emerald-400" :
                                entry.status === "error"   ? "bg-destructive" :
                                "bg-amber-400 animate-pulse"
                              )} />
                              <span className="text-xs font-medium truncate">{entry.toolName}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">
                                {entry.startedAt.toLocaleTimeString()}
                              </span>
                              {entry.elapsedMs != null && (
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {entry.elapsedMs < 1000 ? `${entry.elapsedMs}ms` : `${(entry.elapsedMs / 1000).toFixed(1)}s`}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
              <div className="rounded-3xl bg-primary/5 border border-primary/10 p-6">
                <Sparkles className="h-12 w-12 text-primary/40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Select a category and tool</p>
                <p className="mt-1 text-xs max-w-xs">
                  {schemas.length} tools are available. Your AI model has access to all of them.
                </p>
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-primary/80 font-medium">AI-Ready • {schemas.length} tools</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
