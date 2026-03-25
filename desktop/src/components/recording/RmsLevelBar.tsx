import { cn } from "@/lib/utils";

interface RmsLevelBarProps {
  liveRms: number;
  /** Bar height variant */
  height?: "sm" | "md";
  /** Show the pulsing red recording dot */
  showDot?: boolean;
  /** Show numeric RMS readout */
  showReadout?: boolean;
  /** Label text (e.g. "Recording", "Calibrating mic level…") */
  label?: string;
  /** Extra info shown after the label (e.g. device name) */
  detail?: string;
}

export function RmsLevelBar({
  liveRms,
  height = "md",
  showDot = true,
  showReadout = false,
  label,
  detail,
}: RmsLevelBarProps) {
  const barH = height === "sm" ? "h-1.5" : "h-2";
  const dotSize = height === "sm" ? "h-1.5 w-1.5" : "h-1.5 w-1.5";
  const fillColor =
    liveRms > 0.001
      ? "bg-green-500"
      : liveRms > 0.0001
        ? "bg-yellow-500"
        : "bg-red-400";

  return (
    <div className="w-full space-y-1.5">
      {(label || showReadout) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {showDot && (
              <div className={cn("rounded-full bg-red-500 animate-pulse", dotSize)} />
            )}
            {label}
            {detail && (
              <span className="text-muted-foreground/60">· {detail}</span>
            )}
          </span>
          {showReadout && (
            <span className="font-mono tabular-nums">
              {liveRms > 0 ? (liveRms * 1000).toFixed(2) : "—"}
            </span>
          )}
        </div>
      )}
      <div className={cn("w-full rounded-full bg-muted overflow-hidden", barH)}>
        <div
          className={cn("h-full rounded-full transition-all duration-75", fillColor)}
          style={{ width: `${Math.min(liveRms * 10000, 100)}%` }}
        />
      </div>
    </div>
  );
}
