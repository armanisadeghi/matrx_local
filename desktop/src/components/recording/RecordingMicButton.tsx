import { Mic, MicOff, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type MicSize = "xs" | "sm" | "md" | "lg";

interface RecordingMicButtonProps {
  isRecording: boolean;
  isProcessingTail: boolean;
  liveRms: number;
  onToggle: () => void;
  disabled?: boolean;
  size?: MicSize;
  /** Use a square stop icon instead of MicOff when recording (CompactRecorder style) */
  stopIcon?: "micoff" | "square";
}

const sizeMap: Record<MicSize, { btn: string; icon: string; rmsScale: number; blurScale: number }> = {
  xs: { btn: "h-8 w-8",   icon: "h-4 w-4", rmsScale: 5000, blurScale: 3000 },
  sm: { btn: "h-9 w-9",   icon: "h-4 w-4", rmsScale: 6000, blurScale: 3000 },
  md: { btn: "h-14 w-14", icon: "h-6 w-6", rmsScale: 7000, blurScale: 3500 },
  lg: { btn: "h-20 w-20", icon: "h-8 w-8", rmsScale: 8000, blurScale: 4000 },
};

function computeGlow(rms: number, scale: number, blurScale: number): React.CSSProperties | undefined {
  if (rms <= 0.00005) return undefined;
  const blur = 8 + Math.min(rms * scale, 40);
  const spread = 4 + Math.min(rms * blurScale, 20);
  const opacity = Math.min(0.2 + rms * 200, 0.6);
  return { boxShadow: `0 0 ${blur}px ${spread}px rgba(239,68,68,${opacity})` };
}

export function RecordingMicButton({
  isRecording,
  isProcessingTail,
  liveRms,
  onToggle,
  disabled = false,
  size = "lg",
  stopIcon = "micoff",
}: RecordingMicButtonProps) {
  const s = sizeMap[size];
  const isDisabled = disabled || isProcessingTail;

  return (
    <button
      onClick={isDisabled ? undefined : onToggle}
      disabled={isDisabled}
      className={cn(
        "flex items-center justify-center rounded-full transition-all duration-300 shrink-0",
        s.btn,
        isRecording
          ? "bg-red-500 text-white shadow-lg shadow-red-500/25 hover:bg-red-600"
          : isProcessingTail
            ? "bg-amber-500 text-white shadow-lg shadow-amber-500/25 cursor-wait"
            : "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 disabled:opacity-40",
      )}
      style={isRecording ? computeGlow(liveRms, s.rmsScale, s.blurScale) : undefined}
    >
      {isProcessingTail ? (
        <Loader2 className={cn(s.icon, "animate-spin")} />
      ) : isRecording ? (
        stopIcon === "square" ? (
          <Square className={cn(s.icon, "fill-white")} />
        ) : (
          <MicOff className={s.icon} />
        )
      ) : (
        <Mic className={s.icon} />
      )}
    </button>
  );
}
