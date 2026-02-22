import { cn } from "@/lib/utils";
import type { LucideProps } from "lucide-react";

interface ToolSectionProps {
  title: string;
  icon?: React.ComponentType<LucideProps>;
  iconColor?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function ToolSection({
  title,
  icon: Icon,
  iconColor = "text-muted-foreground",
  description,
  actions,
  children,
  className,
  noPadding = false,
}: ToolSectionProps) {
  return (
    <div className={cn("rounded-2xl border bg-card/50", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className={cn("h-4 w-4 shrink-0", iconColor)} />}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-none">{title}</h3>
            {description && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-1.5 shrink-0 ml-3">{actions}</div>}
      </div>
      <div className={cn(!noPadding && "p-4")}>{children}</div>
    </div>
  );
}
