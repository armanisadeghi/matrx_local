/**
 * Circular progress ring component.
 *
 * Uses SVG stroke-dasharray/stroke-dashoffset for smooth animated fill.
 * The label prop renders text in the center of the ring.
 */

interface CircularProgressProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  /** Text shown in the center. Defaults to "{percent}%" */
  label?: string;
  /** Show percentage text in center even when label is provided */
  showPercent?: boolean;
  className?: string;
}

export function CircularProgress({
  percent,
  size = 64,
  strokeWidth = 5,
  label,
  showPercent = false,
  className = "",
}: CircularProgressProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const center = size / 2;
  const fontSize = size * 0.22;

  const displayLabel = label ?? `${Math.round(clamped)}%`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-label={`Download progress: ${Math.round(clamped)}%`}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Track */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/30"
        opacity={0.3}
      />
      {/* Progress arc */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-primary transition-[stroke-dashoffset] duration-300 ease-in-out"
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
        }}
      />
      {/* Center label */}
      <text
        x={center}
        y={center}
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={fontSize}
        className="fill-foreground font-semibold tabular-nums select-none"
      >
        {displayLabel}
      </text>
      {showPercent && label && (
        <text
          x={center}
          y={center + fontSize * 1.2}
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={fontSize * 0.75}
          className="fill-muted-foreground tabular-nums select-none"
        >
          {Math.round(clamped)}%
        </text>
      )}
    </svg>
  );
}
