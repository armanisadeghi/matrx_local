import { cn } from "@/lib/utils";
import type { ToolUISchema } from "@/types/tool-schema";

interface ToolCardProps {
  schema: ToolUISchema;
  isSelected: boolean;
  onClick: () => void;
}

export function ToolCard({ schema, isSelected, onClick }: ToolCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg px-3 py-2.5 transition-colors",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-foreground"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{schema.displayName}</span>
      </div>
      {schema.description && (
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
          {schema.description}
        </p>
      )}
    </button>
  );
}
