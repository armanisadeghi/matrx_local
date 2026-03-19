/**
 * WakeWordOverlay
 *
 * Full-screen overlay that appears for 2 seconds after wake-word detection,
 * then stays visible (with live pulse + transcript) while the active session
 * is open.  The screen-edge lighting animation communicates system state at
 * a glance:
 *
 *   Waking   — rapid inward pulse of blue/teal light from all four edges
 *   Listening — gentle steady glow + voice-amplitude beat on the border
 *   Dismissed — brief red flash → fade to nothing
 *
 * The overlay renders inside the Tauri window (we can't control the OS
 * screen outside our app window), so the lighting effect covers the full
 * app window borders.  This is intentional and gives a vivid "we heard you"
 * moment without any OS-level permissions.
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │  [glow border — 6–24 px animated]   │
 *   │                                     │
 *   │       BIG TRANSCRIPT TEXT           │
 *   │       in the centre                 │
 *   │                                     │
 *   │  [X dismiss]          [voice ring]  │
 *   └─────────────────────────────────────┘
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { WakeWordUIMode } from "@/hooks/use-wake-word";

interface WakeWordOverlayProps {
  uiMode: WakeWordUIMode;
  /** Live RMS from the microphone (0–1) — drives the pulse animation */
  rms: number;
  /** The full accumulated transcript text for the active session */
  transcript: string;
  onDismiss: () => void;
}

// ── Border glow colours per mode ──────────────────────────────────────────────
const BORDER_COLORS: Record<string, string> = {
  active: "rgba(99, 179, 237, ",     // sky blue
  listening: "rgba(129, 230, 217, ", // teal
  dismissed: "rgba(252, 129, 129, ", // soft red
};

// ── Keyframe CSS injected once ────────────────────────────────────────────────
const KEYFRAMES_ID = "ww-overlay-keyframes";

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes ww-wake-pulse {
      0%   { opacity: 0; transform: scale(0.96); }
      40%  { opacity: 1; transform: scale(1.01); }
      70%  { opacity: 0.7; transform: scale(1.0); }
      100% { opacity: 0.4; transform: scale(1.0); }
    }
    @keyframes ww-border-breathe {
      0%, 100% { opacity: 0.55; }
      50%       { opacity: 1.0; }
    }
    @keyframes ww-text-appear {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes ww-dismiss-flash {
      0%   { opacity: 1; }
      50%  { opacity: 0.6; }
      100% { opacity: 0; }
    }
    @keyframes ww-ring-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WakeWordOverlay({ uiMode, rms, transcript, onDismiss }: WakeWordOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const prevModeRef = useRef<WakeWordUIMode>("idle");

  useEffect(() => {
    ensureKeyframes();
  }, []);

  // ── Visibility control ────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = uiMode;

    if (uiMode === "active") {
      setExiting(false);
      setVisible(true);
    } else if (uiMode === "dismissed" && prev === "active") {
      // Flash red, then hide
      setExiting(true);
      setTimeout(() => {
        setVisible(false);
        setExiting(false);
      }, 600);
    } else if (uiMode !== "active" && prev === "active") {
      setExiting(true);
      setTimeout(() => {
        setVisible(false);
        setExiting(false);
      }, 400);
    }
  }, [uiMode]);

  // ── Canvas voice-ring animation ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let localRms = rms;

    const draw = () => {
      // Smoothly converge toward the live rms value
      localRms += (rms - localRms) * 0.15;

      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      ctx.clearRect(0, 0, W, H);

      // Draw concentric rings that pulse with RMS
      const baseRadius = Math.min(W, H) * 0.3;
      const rings = 4;
      for (let i = rings; i >= 1; i--) {
        const spread = localRms * 0.4 + 0.05;
        const r = baseRadius * (1 + (i / rings) * spread);
        const alpha = ((rings - i + 1) / rings) * (0.15 + localRms * 0.5);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(99, 179, 237, ${alpha})`;
        ctx.lineWidth = 2 + (localRms * 6 * (rings - i + 1)) / rings;
        ctx.stroke();
      }

      // Center dot pulses with voice
      const dotR = 6 + localRms * 20;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR);
      gradient.addColorStop(0, `rgba(129, 230, 217, ${0.8 + localRms * 0.2})`);
      gradient.addColorStop(1, `rgba(99, 179, 237, 0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [rms]);

  if (!visible) return null;

  const colorBase = exiting
    ? BORDER_COLORS.dismissed
    : BORDER_COLORS.active;

  const borderGlow = `0 0 0 3px ${colorBase}0.8), 0 0 40px 8px ${colorBase}0.4), inset 0 0 40px 8px ${colorBase}0.1)`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
      style={{
        animation: exiting
          ? "ww-dismiss-flash 0.4s ease-out forwards"
          : "ww-wake-pulse 0.5s ease-out forwards",
      }}
    >
      {/* Screen-edge glow border */}
      <div
        className="absolute inset-0 rounded-none pointer-events-none"
        style={{
          boxShadow: borderGlow,
          animation: exiting ? undefined : "ww-border-breathe 2s ease-in-out infinite",
        }}
      />

      {/* Main content area — pointer-events on so dismiss button works */}
      <div className="pointer-events-auto flex flex-col items-center gap-6 px-8 max-w-3xl w-full">

        {/* Voice ring canvas */}
        <canvas
          ref={canvasRef}
          width={180}
          height={180}
          className="flex-shrink-0"
        />

        {/* BIG transcript text */}
        <div
          className="text-center"
          style={{
            animation: "ww-text-appear 0.3s ease-out",
          }}
        >
          {transcript ? (
            <p
              className="font-bold leading-tight tracking-tight select-text"
              style={{
                fontSize: "clamp(1.5rem, 4vw, 3rem)",
                color: "rgba(226, 232, 240, 0.95)",
                textShadow: "0 0 30px rgba(99,179,237,0.6), 0 2px 8px rgba(0,0,0,0.8)",
                maxHeight: "40vh",
                overflowY: "auto",
                wordBreak: "break-word",
              }}
            >
              {transcript}
            </p>
          ) : (
            <p
              className="font-medium tracking-widest uppercase"
              style={{
                fontSize: "clamp(1rem, 2vw, 1.5rem)",
                color: "rgba(148, 210, 232, 0.7)",
                textShadow: "0 0 20px rgba(99,179,237,0.4)",
                letterSpacing: "0.2em",
                animation: "ww-border-breathe 2s ease-in-out infinite",
              }}
            >
              Listening…
            </p>
          )}
        </div>

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={{
            background: "rgba(30, 41, 59, 0.85)",
            border: "1px solid rgba(99,179,237,0.3)",
            color: "rgba(148, 210, 232, 0.9)",
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.25)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.5)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(30,41,59,0.85)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,179,237,0.3)";
          }}
        >
          <X size={14} />
          Not for me
        </button>
      </div>
    </div>
  );
}
