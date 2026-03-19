/**
 * CompactRecorderWindow — fills the entire shrunken (420 × 240) OS window.
 *
 * When the user enters compact mode the whole app window shrinks to a tiny
 * floating recorder. This component replaces the normal app shell for that
 * state. It renders a drag handle (so the user can move the window around),
 * a live RMS meter, a rolling transcript preview, and mic controls.
 */

import { useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
  Loader2,
  Maximize2,
  GripHorizontal,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { isTauri } from "@/lib/sidecar";

interface CompactRecorderWindowProps {
  isRecording: boolean;
  isProcessingTail: boolean;
  isCalibrating: boolean;
  liveRms: number;
  /** Full accumulated transcript text for the current session. */
  transcript: string;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<void>;
  /** Called when the user clicks the expand icon — exits compact mode. */
  onExpand: () => void;
}

export function CompactRecorderWindow({
  isRecording,
  isProcessingTail,
  isCalibrating,
  liveRms,
  transcript,
  onStartRecording,
  onStopRecording,
  onExpand,
}: CompactRecorderWindowProps) {
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript to bottom as new words arrive.
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleCopy = useCallback(() => {
    if (!transcript) return;
    navigator.clipboard.writeText(transcript).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [transcript]);

  // Drag the OS window via Tauri's startDragging.
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    } catch {
      // Non-fatal — window just won't drag in browser dev mode.
    }
  }, []);

  const mic = isRecording ? (
    <MicOff className="h-5 w-5" />
  ) : isProcessingTail ? (
    <Loader2 className="h-5 w-5 animate-spin" />
  ) : (
    <Mic className="h-5 w-5" />
  );

  const displayText =
    transcript.length > 300 ? "…" + transcript.slice(-300) : transcript;

  const rmsWidth = `${Math.min(liveRms * 10000, 100)}%`;
  const rmsColor =
    liveRms > 0.001
      ? "bg-green-400"
      : liveRms > 0.0001
      ? "bg-yellow-400"
      : "bg-red-400";

  return (
    <div className="flex flex-col h-screen w-screen bg-card text-foreground select-none overflow-hidden">
      {/* ── Drag handle / title bar ───────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 cursor-grab active:cursor-grabbing shrink-0"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-1.5">
          <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <span className="text-[11px] font-medium text-muted-foreground leading-none">
            {isRecording
              ? "Recording…"
              : isProcessingTail
              ? "Processing…"
              : isCalibrating
              ? "Calibrating…"
              : "AI Matrx · Recorder"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Copy button */}
          {transcript.length > 0 && (
            <button
              onClick={handleCopy}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Copy transcript"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
          {/* Expand button */}
          <button
            onClick={onExpand}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Expand to full app"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Transcript area ───────────────────────────────────────────────── */}
      <div
        ref={textRef}
        className="flex-1 overflow-y-auto px-3 py-2 min-h-0"
      >
        {displayText ? (
          <p className="text-[12px] leading-relaxed text-foreground/90 break-words whitespace-pre-wrap">
            {displayText}
          </p>
        ) : (
          <p className="text-[12px] text-muted-foreground/60 italic">
            {isRecording
              ? isCalibrating
                ? "Calibrating microphone…"
                : "Listening — speak now"
              : "Click the mic to begin recording"}
          </p>
        )}
      </div>

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-3 py-2 border-t border-border/50 shrink-0">
        {/* Mic button */}
        <button
          onClick={
            isRecording
              ? onStopRecording
              : isProcessingTail
              ? undefined
              : onStartRecording
          }
          disabled={isProcessingTail}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 shrink-0",
            isRecording
              ? "bg-red-500 text-white hover:bg-red-600"
              : isProcessingTail
              ? "bg-amber-500 text-white cursor-wait"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
          style={
            isRecording && liveRms > 0.00005
              ? {
                  boxShadow: `0 0 ${6 + Math.min(liveRms * 6000, 24)}px ${2 + Math.min(liveRms * 3000, 12)}px rgba(239,68,68,${Math.min(0.25 + liveRms * 150, 0.55)})`,
                }
              : undefined
          }
        >
          {mic}
        </button>

        {/* RMS meter or status */}
        <div className="flex-1 flex flex-col gap-1">
          {isRecording ? (
            <>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                <span className="text-[10px] text-red-500 font-medium">REC</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-75", rmsColor)}
                  style={{ width: rmsWidth }}
                />
              </div>
            </>
          ) : isProcessingTail ? (
            <span className="text-[11px] text-amber-500">Finishing transcript…</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {transcript.length > 0
                ? `${transcript.length} chars captured`
                : "Ready"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
