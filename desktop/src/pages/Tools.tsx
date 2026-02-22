import { useState, useMemo, useEffect } from "react";
import { Search, Sparkles, Terminal, Gauge, AppWindow } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToolCard } from "@/components/tools/ToolCard";
import { ToolDetailPanel } from "@/components/tools/ToolDetailPanel";
import { useToolExecution } from "@/hooks/use-tool-execution";
import { fromEngineSchema, toolCategories, toolSchemas } from "@/lib/tool-registry";
import type { EngineStatus } from "@/hooks/use-engine";
import type { ToolUISchema } from "@/types/tool-schema";

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

export function Tools({ engineStatus, engineUrl, tools }: ToolsProps) {
  const [search, setSearch] = useState("");
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [engineSchemas, setEngineSchemas] = useState<ToolUISchema[]>([]);
  const { loading, result, error, elapsedMs, invoke, reset } = useToolExecution();

  useEffect(() => {
    if (engineStatus !== "connected" || !engineUrl) return;

    const loadSchemas = async () => {
      try {
        const resp = await fetch(`${engineUrl}/chat/tools`);
        if (!resp.ok) return;
        const data = await resp.json();
        const schemas = ((data.tools ?? []) as EngineToolSchema[]).map(fromEngineSchema);
        setEngineSchemas(schemas);
        if (!selectedToolName && schemas.length > 0) {
          setSelectedToolName(schemas[0].toolName);
        }
      } catch {
        // graceful fallback to local registry
      }
    };

    loadSchemas();
  }, [engineStatus, engineUrl, selectedToolName]);

  const schemas = useMemo(() => {
    if (engineSchemas.length > 0) return engineSchemas;
    if (tools.length > 0) {
      return tools
        .map((toolName) => toolSchemas.find((schema) => schema.toolName === toolName))
        .filter((schema): schema is ToolUISchema => schema != null);
    }
    return toolSchemas;
  }, [tools, engineSchemas]);

  const categories = useMemo(() => {
    const fromTools = Array.from(new Set(schemas.map((schema) => schema.category)));
    return ["all", ...fromTools];
  }, [schemas]);

  const filtered = useMemo(() => {
    const source = activeCategory === "all"
      ? schemas
      : schemas.filter((schema) => schema.category === activeCategory);

    if (!search) return source;

    const q = search.toLowerCase();
    return source.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.toolName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
  }, [schemas, search, activeCategory]);

  const grouped = useMemo(() => {
    const groups: Record<string, ToolUISchema[]> = {};
    for (const schema of filtered) {
      const catLabel =
        toolCategories.find((c) => c.id === schema.category)?.label ??
        schema.category;
      if (!groups[catLabel]) groups[catLabel] = [];
      groups[catLabel].push(schema);
    }
    return groups;
  }, [filtered]);

  const selectedSchema = selectedToolName
    ? schemas.find((s) => s.toolName === selectedToolName)
    : null;

  const selectedCategoryCount = activeCategory === "all"
    ? schemas.length
    : schemas.filter((schema) => schema.category === activeCategory).length;

  const handleSelect = (schema: ToolUISchema) => {
    setSelectedToolName(schema.toolName);
    reset();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Tool Workbench"
        description={`${schemas.length} tools available with guided views`}
      />

      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-3">
        <Card className="border-border/60 bg-gradient-to-br from-background to-muted/20">
          <CardHeader className="pb-3">
            <CardDescription>Total Tools</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Sparkles className="h-5 w-5 text-primary" />
              {schemas.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60 bg-gradient-to-br from-background to-muted/20">
          <CardHeader className="pb-3">
            <CardDescription>Current Category</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <AppWindow className="h-5 w-5 text-primary" />
              {selectedCategoryCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60 bg-gradient-to-br from-background to-muted/20">
          <CardHeader className="pb-3">
            <CardDescription>Execution Status</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Gauge className="h-5 w-5 text-primary" />
              {loading ? "Running" : "Ready"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex flex-1 overflow-hidden px-3 pb-3">
        <div className="flex w-[330px] flex-col rounded-xl border bg-card">
          <div className="border-b p-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tools..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8"
              />
            </div>

            <Tabs value={activeCategory} onValueChange={setActiveCategory}>
              <TabsList className="w-full overflow-x-auto justify-start">
                {categories.map((category) => (
                  <TabsTrigger key={category} value={category} className="text-xs">
                    {category === "all"
                      ? "All"
                      : toolCategories.find((item) => item.id === category)?.label ?? category}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <ScrollArea className="flex-1">
            <div className="px-3 pb-3 pt-2 space-y-4">
              {Object.entries(grouped).map(([category, categorySchemas]) => (
                <div key={category}>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {category}
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {categorySchemas.length}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {categorySchemas.map((schema) => (
                      <ToolCard
                        key={schema.toolName}
                        schema={schema}
                        isSelected={selectedToolName === schema.toolName}
                        onClick={() => handleSelect(schema)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="ml-3 flex flex-1 flex-col overflow-hidden rounded-xl border bg-card">
          <Tabs defaultValue="interact" className="flex h-full flex-col">
            <div className="border-b px-3 py-2">
              <TabsList>
                <TabsTrigger value="interact">Interactive</TabsTrigger>
                <TabsTrigger value="overview">Category Overview</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="interact" className="mt-0 flex-1 overflow-hidden">
              {selectedSchema ? (
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
                <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
                  <Terminal className="h-12 w-12 opacity-20" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Select a tool</p>
                    <p className="mt-1 text-xs">Choose a tool from the left workbench to get started.</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="overview" className="m-0 flex-1 overflow-auto p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {categories.filter((category) => category !== "all").map((category) => {
                  const count = schemas.filter((schema) => schema.category === category).length;
                  const meta = toolCategories.find((item) => item.id === category);
                  return (
                    <Card key={category} className="border-border/60">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">{meta?.label ?? category}</CardTitle>
                        <CardDescription>{meta?.description ?? "Tool category"}</CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="text-2xl font-semibold">{count}</div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
