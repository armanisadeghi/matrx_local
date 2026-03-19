/**
 * WakeWordControls
 *
 * A compact, VSCode status-bar-inspired control strip for the wake word system.
 * Lives at the bottom of the Voice page (or can be pinned anywhere).
 *
 * Layout (left → right):
 *   [status dot + label]  [Listen] [Mute] [Wake ↑] [Dismiss ✕]
 *
 * Behaviour:
 *   Listen   — starts wake-word detection (downloads model first if needed)
 *   Mute     — pauses detection without tearing down thread
 *   Wake ↑   — fires wake-word manually (like pressing a PTT button)
 *   Dismiss  — if the overlay is showing, closes it without reacting
 *
 * The strip also shows a tiny RMS meter in the status dot so the user can
 * confirm the microphone is alive even in "listening" mode.
 */

import { Mic, MicOff, Zap, X, Download, Loader2 } from "lucide-react";
import type { WakeWordUIMode } from "@/hooks/use-wake-word";
import type { DownloadProgress } from "@/lib/transcription/types";

interface WakeWordControlsProps {
  uiMode: WakeWordUIMode;
  listenRms: number;
  kmsModelReady: boolean;
  downloadProgress: DownloadProgress | null;
  onSetup: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onManualTrigger: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}

// ── Status indicator ─────────────────────────────────────────────────────────

function StatusDot({ uiMode, rms }: { uiMode: WakeWordUIMode; rms: number }) {
  const colors: Record<WakeWordUIMode, string> = {
    idle:      "bg-zinc-600",
    setup:     "bg-yellow-400",
    listening: "bg-emerald-400",
    muted:     "bg-zinc-500",
    dismissed: "bg-red-400",
    active:    "bg-sky-400",
  };

  const pulseClass =
    uiMode === "listening" || uiMode === "active"
      ? "animate-pulse"
      : "";

  // Scale the dot slightly with RMS when listening/active
  const scaleStyle =
    (uiMode === "listening" || uiMode === "active") && rms > 0.02
      ? { transform: `scale(${1 + rms * 0.8})`, transition: "transform 80ms linear" }
      : {};

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[uiMode]} ${pulseClass}`}
      style={scaleStyle}
    />
  );
}

function StatusLabel({ uiMode }: { uiMode: WakeWordUIMode }) {
  const labels: Record<WakeWordUIMode, string> = {
    idle:      "Wake word off",
    setup:     "Downloading…",
    listening: "Listening",
    muted:     "Muted",
    dismissed: "Dismissed (10 s)",
    active:    "Awake",
  };
  const textColors: Record<WakeWordUIMode, string> = {
    idle:      "text-zinc-500",
    setup:     "text-yellow-400",
    listening: "text-emerald-400",
    muted:     "text-zinc-400",
    dismissed: "text-red-400",
    active:    "text-sky-400",
  };
  return (
    <span className={`text-xs font-medium tabular-nums ${textColors[uiMode]}`}>
      {labels[uiMode]}
    </span>
  );
}

// ── Individual control button ─────────────────────────────────────────────────

interface CtrlBtnProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  variant?: "default" | "danger" | "accent";
  disabled?: boolean;
}

function CtrlBtn({ icon, label, title, onClick, variant = "default", disabled }: CtrlBtnProps) {
  const base =
    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all select-none disabled:opacity-40 disabled:cursor-not-allowed";

  const variants = {
    default: "text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700/60 active:bg-zinc-700",
    danger:  "text-red-400   hover:text-red-300   hover:bg-red-900/30  active:bg-red-900/50",
    accent:  "text-sky-400   hover:text-sky-300   hover:bg-sky-900/30  active:bg-sky-900/50",
  };

  return (
    <button
      className={`${base} ${variants[variant]}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ── Download progress mini-bar ────────────────────────────────────────────────

function DownloadBar({ progress }: { progress: DownloadProgress }) {
  const pct = Math.round(progress.percent);
  return (
    <div className="flex items-center gap-2 text-xs text-yellow-400">
      <Loader2 size={12} className="animate-spin flex-shrink-0" />
      <div className="w-20 h-1 rounded-full bg-zinc-700 overflow-hidden">
        <div
          className="h-full bg-yellow-400 rounded-full transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular-nums">{pct}%</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function WakeWordControls({
  uiMode,
  listenRms,
  kmsModelReady,
  downloadProgress,
  onSetup,
  onMute,
  onUnmute,
  onManualTrigger,
  onDismiss,
  disabled = false,
}: WakeWordControlsProps) {
  const isSetupRunning = uiMode === "setup";
  const isIdle = uiMode === "idle";
  const isListening = uiMode === "listening";
  const isMuted = uiMode === "muted";
  const isActive = uiMode === "active";
  const isDismissed = uiMode === "dismissed";

  return (
    <div
      className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-zinc-700/60 bg-zinc-900/80 backdrop-blur-sm"
      style={{ minHeight: 34 }}
    >
      {/* Status */}
      <div className="flex items-center gap-1.5 min-w-[120px]">
        <StatusDot uiMode={uiMode} rms={listenRms} />
        <StatusLabel uiMode={uiMode} />
      </div>

      {/* Download bar (replaces buttons during download) */}
      {downloadProgress && isSetupRunning && (
        <DownloadBar progress={downloadProgress} />
      )}

      {/* Separator */}
      <div className="w-px h-4 bg-zinc-700 mx-1" />

      {/* Controls */}
      {!isSetupRunning && (
        <div className="flex items-center gap-0.5">

          {/* Listen / Stop */}
          {isIdle && (
            <CtrlBtn
              icon={<Mic size={12} />}
              label={kmsModelReady ? "Listen" : "Setup"}
              title={kmsModelReady ? "Start wake-word detection" : "Download model and start"}
              onClick={onSetup}
              variant="accent"
              disabled={disabled}
            />
          )}

          {(isListening || isActive || isDismissed) && (
            <CtrlBtn
              icon={<MicOff size={12} />}
              label="Mute"
              title="Pause detection (keeps thread running)"
              onClick={onMute}
              disabled={disabled}
            />
          )}

          {isMuted && (
            <CtrlBtn
              icon={<Mic size={12} />}
              label="Listen"
              title="Resume wake-word detection"
              onClick={onUnmute}
              variant="accent"
              disabled={disabled}
            />
          )}

          {/* Manual trigger — only when thread is alive */}
          {!isIdle && !isSetupRunning && (
            <CtrlBtn
              icon={<Zap size={12} />}
              label="Wake"
              title="Activate as if you said the wake word"
              onClick={onManualTrigger}
              variant="accent"
              disabled={disabled}
            />
          )}

          {/* Dismiss — only when overlay is showing */}
          {isActive && (
            <CtrlBtn
              icon={<X size={12} />}
              label="Dismiss"
              title="Close overlay and suppress re-trigger for 10 s"
              onClick={onDismiss}
              variant="danger"
              disabled={disabled}
            />
          )}
        </div>
      )}

      {/* Setup spinner label */}
      {isSetupRunning && !downloadProgress && (
        <div className="flex items-center gap-1.5 text-xs text-yellow-400">
          <Loader2 size={12} className="animate-spin" />
          <span>Preparing…</span>
        </div>
      )}
    </div>
  );
}
