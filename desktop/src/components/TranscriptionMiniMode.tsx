/**
 * TranscriptionMiniMode — compact floating overlay for live transcription.
 *
 * Renders as a small draggable panel (similar in size to the update banner)
 * in the bottom-right corner. The user can resize it by dragging the resize
 * handle. All transcription controls are intact in this mode.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Loader2, X, Maximize2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface MiniModeProps {
  isRecording: boolean;
  isProcessingTail: boolean;
  isCalibrating: boolean;
  liveRms: number;
  recentText: string;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<void>;
  onExpand: () => void;
  onClose: () => void;
}

const MIN_WIDTH = 280;
const MIN_HEIGHT = 120;
const DEFAULT_WIDTH = 340;
const DEFAULT_HEIGHT = 160;

export function TranscriptionMiniMode({
  isRecording,
  isProcessingTail,
  isCalibrating,
  liveRms,
  recentText,
  onStartRecording,
  onStopRecording,
  onExpand,
  onClose,
}: MiniModeProps) {
  const [pos, setPos] = useState({ x: -1, y: -1 }); // -1 = use default (bottom-right via CSS)
  const [size, setSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizeStartRef = useRef({ mx: 0, my: 0, w: 0, h: 0 });

  // Position defaults to bottom-right via fixed CSS; once dragged, use explicit coords
  const posStyle: React.CSSProperties =
    pos.x === -1
      ? { bottom: 24, right: 24 }
      : { top: pos.y, left: pos.x };

  // Drag: move the panel
  const handleDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (pos.x === -1) {
        // Initialise position from the panel's current screen rect
        const rect = panelRef.current?.getBoundingClientRect();
        if (rect) {
          setPos({ x: rect.left, y: rect.top });
        }
      }
      setIsDragging(true);
      dragStartRef.current = { mx: e.clientX, my: e.clientY, px: pos.x === -1 ? (panelRef.current?.getBoundingClientRect().left ?? 0) : pos.x, py: pos.y === -1 ? (panelRef.current?.getBoundingClientRect().top ?? 0) : pos.y };
      e.preventDefault();
    },
    [pos]
  );

  // Resize: drag the bottom-right corner
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    resizeStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      w: size.w,
      h: size.h,
    };
    e.preventDefault();
    e.stopPropagation();
  }, [size]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStartRef.current.mx;
        const dy = e.clientY - dragStartRef.current.my;
        setPos({
          x: Math.max(0, dragStartRef.current.px + dx),
          y: Math.max(0, dragStartRef.current.py + dy),
        });
      }
      if (isResizing) {
        const dx = e.clientX - resizeStartRef.current.mx;
        const dy = e.clientY - resizeStartRef.current.my;
        setSize({
          w: Math.max(MIN_WIDTH, resizeStartRef.current.w + dx),
          h: Math.max(MIN_HEIGHT, resizeStartRef.current.h + dy),
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing]);

  // Keep only the last ~3 lines of text visible
  const displayText = recentText.length > 200 ? "…" + recentText.slice(-200) : recentText;

  return (
    <div
      ref={panelRef}
      className="fixed z-50 rounded-2xl border border-border/80 bg-card/95 shadow-2xl backdrop-blur-sm select-none"
      style={{
        ...posStyle,
        width: size.w,
        height: size.h,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      {/* Drag handle bar */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing rounded-t-2xl border-b border-border/50"
        onMouseDown={handleDragMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="text-xs font-medium text-muted-foreground">
            {isRecording
              ? "Recording…"
              : isProcessingTail
              ? "Processing…"
              : "Transcription"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onExpand}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Expand"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Close mini mode"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-col h-[calc(100%-36px)] px-3 py-2 gap-2">
        {/* Text preview */}
        <div className="flex-1 overflow-hidden">
          {displayText ? (
            <p className="text-xs text-foreground/90 leading-relaxed line-clamp-3 break-words">
              {displayText}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/60 italic">
              {isRecording
                ? isCalibrating
                  ? "Calibrating mic…"
                  : "Listening…"
                : "Click the mic to start"}
            </p>
          )}
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2 shrink-0">
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
              "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 shrink-0",
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
            {isProcessingTail ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isRecording ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          {/* Live RMS meter */}
          {isRecording && (
            <div className="flex-1 flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-75",
                    liveRms > 0.001
                      ? "bg-green-500"
                      : liveRms > 0.0001
                      ? "bg-yellow-500"
                      : "bg-red-400"
                  )}
                  style={{ width: `${Math.min(liveRms * 10000, 100)}%` }}
                />
              </div>
            </div>
          )}
          {!isRecording && !isProcessingTail && (
            <p className="text-xs text-muted-foreground">
              {recentText.length > 0
                ? `${recentText.length} chars`
                : "Ready"}
            </p>
          )}
          {isProcessingTail && (
            <p className="text-xs text-amber-500">Finishing…</p>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-br-2xl flex items-end justify-end pr-1 pb-1"
        onMouseDown={handleResizeMouseDown}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" className="text-muted-foreground/40">
          <path d="M7 1L1 7M7 4L4 7M7 7H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
