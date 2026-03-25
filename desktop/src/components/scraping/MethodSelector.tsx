/**
 * MethodSelector — pill-style selector for scrape method with tooltip
 * explaining what each option does and what the selector controls.
 */

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ScrapeMethod } from "@/hooks/use-scrape";

interface MethodSelectorProps {
  value: ScrapeMethod;
  onChange: (method: ScrapeMethod) => void;
  className?: string;
}

const METHODS: { id: ScrapeMethod; label: string; description: string }[] = [
  {
    id: "engine",
    label: "Engine",
    description:
      "Local Python engine using your residential IP. Best for most sites. Supports Playwright fallback for JS-heavy pages.",
  },
  {
    id: "local-browser",
    label: "Browser",
    description:
      "Playwright headless browser. Slower but handles JavaScript-rendered pages and aggressive anti-bot measures.",
  },
  {
    id: "remote",
    label: "Remote",
    description:
      "Cloud scraper server (scraper.app.matrxserver.com). Uses server-side proxy pool. Results are cached server-side for all your devices.",
  },
];

export function MethodSelector({ value, onChange, className }: MethodSelectorProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5",
            className,
          )}
        >
          {METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-all",
                value === m.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="mb-1 font-semibold">Scrape method</p>
        {METHODS.map((m) => (
          <p key={m.id} className={cn("text-xs mt-1", value === m.id ? "text-foreground" : "text-muted-foreground")}>
            <span className="font-medium">{m.label}:</span> {m.description}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
