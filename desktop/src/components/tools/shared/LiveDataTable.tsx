import { useState, useMemo } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Column<T> {
  key: string;
  label: string;
  width?: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  className?: string;
  render?: (row: T, index: number) => React.ReactNode;
}

interface LiveDataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField?: string;
  sortable?: boolean;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  compact?: boolean;
  striped?: boolean;
  hoverable?: boolean;
  onRowClick?: (row: T, index: number) => void;
  emptyMessage?: string;
  className?: string;
  maxHeight?: string;
}

export function LiveDataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField = "id",
  sortable = true,
  defaultSort,
  compact = false,
  hoverable = true,
  onRowClick,
  emptyMessage = "No data",
  className,
  maxHeight = "100%",
}: LiveDataTableProps<T>) {
  const [sortKey, setSortKey] = useState(defaultSort?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSort?.dir ?? "desc");

  const handleSort = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal ?? "");
      const bStr = String(bVal ?? "");
      return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [data, sortKey, sortDir]);

  const cellPad = compact ? "px-2 py-1" : "px-3 py-2";

  if (data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-8 text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn("overflow-auto", className)} style={{ maxHeight }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background/90 backdrop-blur-sm z-10">
          <tr className="border-b">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  cellPad,
                  "text-[10px] font-semibold text-muted-foreground uppercase tracking-wider",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  col.sortable !== false && sortable && "cursor-pointer hover:text-foreground select-none",
                  col.className,
                )}
                style={col.width ? { width: col.width } : undefined}
                onClick={() => col.sortable !== false && handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    sortDir === "asc"
                      ? <ArrowUp className="h-2.5 w-2.5" />
                      : <ArrowDown className="h-2.5 w-2.5" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={String(row[keyField] ?? i)}
              className={cn(
                "border-b border-border/20 transition-colors",
                hoverable && "hover:bg-muted/30",
                onRowClick && "cursor-pointer",
              )}
              onClick={() => onRowClick?.(row, i)}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    cellPad,
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    "tabular-nums",
                  )}
                >
                  {col.render ? col.render(row, i) : String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
