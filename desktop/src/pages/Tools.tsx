import { useState, useMemo } from "react";
import { Search, Terminal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToolCard } from "@/components/tools/ToolCard";
import { ToolDetailPanel } from "@/components/tools/ToolDetailPanel";
import { useToolExecution } from "@/hooks/use-tool-execution";
import { toolSchemas, toolCategories, getToolSchema } from "@/data/tool-registry";
import type { EngineStatus } from "@/hooks/use-engine";
import type { ToolUISchema } from "@/types/tool-schema";

interface ToolsProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
}

export function Tools({ engineStatus: _engineStatus, engineUrl: _engineUrl, tools }: ToolsProps) {
  const [search, setSearch] = useState("");
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const { loading, result, error, elapsedMs, invoke, reset } = useToolExecution();

  // Build schemas, falling back to registry when engine tools are known
  const schemas = useMemo(() => {
    if (tools.length > 0) {
      // Use engine-reported tools, look up schemas from registry
      return tools
        .map((t) => getToolSchema(t))
        .filter((s): s is ToolUISchema => s != null);
    }
    // Fallback: show all registered schemas
    return toolSchemas;
  }, [tools]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search) return schemas;
    const q = search.toLowerCase();
    return schemas.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.toolName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
  }, [schemas, search]);

  // Group by category
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

  const handleSelect = (schema: ToolUISchema) => {
    setSelectedToolName(schema.toolName);
    reset();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Tools"
        description={`${schemas.length} tools available`}
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
              {Object.entries(grouped).map(([category, categorySchemas]) => (
                <div key={category}>
                  <div className="flex items-center gap-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {category}
                  </div>
                  <div className="space-y-0.5">
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

        {/* Right: Tool Detail */}
        <div className="flex flex-1 flex-col overflow-hidden">
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
