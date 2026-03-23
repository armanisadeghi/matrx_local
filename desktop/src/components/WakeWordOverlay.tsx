/**
 * WakeWordOverlay
 *
 * A lightweight in-app ambient indicator that the wake word system is active.
 * It renders a subtle animated glow around the window border so users who are
 * already inside the AI Matrx window can tell at a glance that listening is live.
 *
 * This is NOT the primary user-facing feedback channel.  The primary feedback is:
 *   1. OS-level native notification (fires even when the app is in the background)
 *   2. Always-on-top floating transcript window (TranscriptOverlay component)
 *
 * This component only handles the in-app window-edge glow which is appropriate
 * regardless of which tab the user is on.  No full-screen flash, no transcript
 * text — all of that lives in the floating overlay window.
 *
 * States:
 *   active    — bright animated teal/blue border pulse
 *   dismissed — brief red flash, then nothing
 *   others    — nothing rendered
 */

import { useEffect, useRef } from "react";
import type { WakeWordUIMode } from "@/hooks/use-wake-word";

// ── Keyframes injected once ───────────────────────────────────────────────────

const KEYFRAMES_ID = "ww-glow-kf";
function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const s = document.createElement("style");
  s.id = KEYFRAMES_ID;
  s.textContent = `
    @keyframes ww-glow-breathe {
      0%, 100% { box-shadow: 0 0 0 2px rgba(99,179,237,0.55), 0 0 28px 6px rgba(99,179,237,0.18); }
      50%       { box-shadow: 0 0 0 3px rgba(99,179,237,0.85), 0 0 48px 10px rgba(99,179,237,0.30); }
    }
    @keyframes ww-glow-dismiss {
      0%   { box-shadow: 0 0 0 3px rgba(239,68,68,0.85), 0 0 40px 8px rgba(239,68,68,0.35); }
      100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
    }
  `;
  document.head.appendChild(s);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface WakeWordOverlayProps {
  uiMode: WakeWordUIMode;
  /** Unused — kept for API compatibility with existing callers */
  rms?: number;
  /** Unused — transcript lives in the floating overlay window */
  transcript?: string;
  onDismiss: () => void;
  /** Unused — publish lives in the floating overlay window */
  onPublishToNote?: (text: string) => Promise<void>;
}

export function WakeWordOverlay({ uiMode, onDismiss }: WakeWordOverlayProps) {
  const prevModeRef = useRef<WakeWordUIMode>("idle");

  useEffect(() => { ensureKeyframes(); }, []);

  prevModeRef.current = uiMode;

  // Only render in "active" or "dismissed" states
  if (uiMode !== "active" && uiMode !== "dismissed") return null;

  const isDismissed = uiMode === "dismissed";

  return (
    <>
      {/* Window-edge glow — fixed inset-0, pointer-events:none so it doesn't block clicks */}
      <div
        className="fixed inset-0 z-[50] pointer-events-none"
        style={{
          animation: isDismissed
            ? "ww-glow-dismiss 0.6s ease-out forwards"
            : "ww-glow-breathe 2s ease-in-out infinite",
        }}
      />
      {/* Minimal "Shut it up" button — always visible while active so user can dismiss from any tab */}
      {!isDismissed && (
        <button
          onClick={onDismiss}
          className="fixed bottom-4 right-4 z-[51] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all"
          style={{
            background: "rgba(15,23,42,0.85)",
            border: "1px solid rgba(99,179,237,0.3)",
            color: "rgba(148,210,232,0.85)",
            backdropFilter: "blur(12px)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.2)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.5)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(15,23,42,0.85)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,179,237,0.3)";
          }}
          title="Stop listening"
        >
          ✕ Stop
        </button>
      )}
    </>
  );
}
