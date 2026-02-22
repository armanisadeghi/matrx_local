import { useEffect, useRef, useState } from "react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

interface GaugeRingProps {
  value: number;
  max?: number;
  label: string;
  icon?: React.ComponentType<LucideProps>;
  size?: "sm" | "md" | "lg";
  color?: string;
  thresholds?: { warn: number; critical: number };
  animated?: boolean;
  showValue?: boolean;
  unit?: string;
  className?: string;
}

const sizes = {
  sm: { svg: 72, r: 28, stroke: 6, textSize: "text-sm", iconSize: "h-3 w-3" },
  md: { svg: 96, r: 36, stroke: 7, textSize: "text-lg", iconSize: "h-4 w-4" },
  lg: { svg: 120, r: 46, stroke: 8, textSize: "text-2xl", iconSize: "h-5 w-5" },
};

export function GaugeRing({
  value,
  max = 100,
  label,
  icon: Icon,
  size = "md",
  color = "violet",
  thresholds = { warn: 75, critical: 90 },
  animated = true,
  showValue = true,
  unit = "%",
  className,
}: GaugeRingProps) {
  const s = sizes[size];
  const circ = 2 * Math.PI * s.r;
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const offset = circ - (pct / 100) * circ;

  const [animatedOffset, setAnimatedOffset] = useState(circ);
  const mounted = useRef(false);

  useEffect(() => {
    if (animated && !mounted.current) {
      mounted.current = true;
      requestAnimationFrame(() => setAnimatedOffset(offset));
    } else {
      setAnimatedOffset(offset);
    }
  }, [offset, animated]);

  const resolvedColor =
    pct >= thresholds.critical
      ? "text-red-500"
      : pct >= thresholds.warn
        ? "text-amber-500"
        : `text-${color}-500`;

  const strokeColor =
    pct >= thresholds.critical
      ? "stroke-red-500"
      : pct >= thresholds.warn
        ? "stroke-amber-500"
        : `stroke-${color}-500`;

  const displayVal = max === 100 ? Math.round(pct) : value;

  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div className="relative">
        <svg width={s.svg} height={s.svg} className="-rotate-90">
          <circle
            cx={s.svg / 2}
            cy={s.svg / 2}
            r={s.r}
            fill="none"
            stroke="currentColor"
            strokeWidth={s.stroke}
            className="text-muted/20"
          />
          <circle
            cx={s.svg / 2}
            cy={s.svg / 2}
            r={s.r}
            fill="none"
            strokeWidth={s.stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={animatedOffset}
            className={cn(strokeColor, "transition-all duration-700 ease-out")}
          />
        </svg>
        {showValue && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {Icon && <Icon className={cn(s.iconSize, "mb-0.5", resolvedColor)} />}
            <span className={cn(s.textSize, "font-bold tabular-nums leading-none", resolvedColor)}>
              {displayVal}
            </span>
            <span className="text-[9px] text-muted-foreground">{unit}</span>
          </div>
        )}
      </div>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
