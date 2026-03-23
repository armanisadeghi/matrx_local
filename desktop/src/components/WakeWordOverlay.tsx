/**
 * WakeWordOverlay
 *
 * Two-phase UI on wake-word detection:
 *
 * Phase 1 — FLASH (2.5 s)
 *   A full-screen high-visibility pulse covers the entire app window with an
 *   expanding ring of light, confirming the system heard the user.
 *   A short "ding" tone plays at the same instant.
 *
 * Phase 2 — TRANSCRIPT PANEL
 *   After the flash fades, a compact draggable panel appears in the upper-right
 *   corner.  It shows live transcription text in bright, legible white and stays
 *   on screen until the active session ends or the user dismisses it.
 *
 * Dismissed state
 *   A brief red flash confirms dismissal, then both elements disappear.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { X, GripHorizontal, FileText } from "lucide-react";
import type { WakeWordUIMode } from "@/hooks/use-wake-word";

// ── Props ─────────────────────────────────────────────────────────────────────

interface WakeWordOverlayProps {
  uiMode: WakeWordUIMode;
  rms: number;
  transcript: string;
  onDismiss: () => void;
  onPublishToNote?: (text: string) => Promise<void>;
}

// ── Keyframes injected once ───────────────────────────────────────────────────

const KEYFRAMES_ID = "ww-overlay-keyframes-v2";

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `
    /* Phase 1: full-screen flash ring */
    @keyframes ww-flash-ring {
      0%   { transform: scale(0.3); opacity: 0.9; }
      60%  { transform: scale(1.05); opacity: 0.7; }
      100% { transform: scale(1.3); opacity: 0; }
    }
    @keyframes ww-flash-glow {
      0%   { opacity: 0.95; }
      40%  { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes ww-flash-bg {
      0%   { opacity: 0.55; }
      30%  { opacity: 0.35; }
      100% { opacity: 0; }
    }

    /* Phase 2: transcript panel slide-in */
    @keyframes ww-panel-in {
      from { opacity: 0; transform: translateX(24px); }
      to   { opacity: 1; transform: translateX(0); }
    }

    /* Dismiss */
    @keyframes ww-dismiss {
      0%   { opacity: 1; }
      40%  { opacity: 0.5; background: rgba(239,68,68,0.3); }
      100% { opacity: 0; }
    }

    /* Transcript text breathing when empty */
    @keyframes ww-breathe {
      0%, 100% { opacity: 0.5; }
      50%       { opacity: 1.0; }
    }

    /* RMS bar pulse */
    @keyframes ww-rms-pulse {
      0%   { transform: scaleY(0.6); }
      50%  { transform: scaleY(1.0); }
      100% { transform: scaleY(0.6); }
    }

    /* Border edge glow on the app window during listening */
    @keyframes ww-edge-breathe {
      0%, 100% { box-shadow: 0 0 0 3px rgba(99,179,237,0.6), 0 0 40px 8px rgba(99,179,237,0.25), inset 0 0 30px 4px rgba(99,179,237,0.08); }
      50%       { box-shadow: 0 0 0 4px rgba(99,179,237,0.9), 0 0 60px 12px rgba(99,179,237,0.40), inset 0 0 40px 6px rgba(99,179,237,0.12); }
    }
    @keyframes ww-edge-dismiss {
      0%   { box-shadow: 0 0 0 4px rgba(239,68,68,0.8), 0 0 50px 10px rgba(239,68,68,0.4); }
      100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
    }
  `;
  document.head.appendChild(style);
}

// ── Audio ding (generated via Web Audio API — no asset file needed) ──────────

let _audioCtx: AudioContext | null = null;

function playDing() {
  try {
    if (!_audioCtx) {
      _audioCtx = new AudioContext();
    }
    const ctx = _audioCtx;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    // Two-tone pleasant chime: root note + fifth
    const now = ctx.currentTime;
    const tones = [
      { freq: 880, gain: 0.22, start: 0,    dur: 0.55 },
      { freq: 1320, gain: 0.15, start: 0.06, dur: 0.50 },
    ];

    for (const { freq, gain, start, dur } of tones) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, now + start);
      env.gain.linearRampToValueAtTime(gain, now + start + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    }
  } catch {
    // AudioContext blocked (e.g. no prior user gesture) — ignore silently
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WakeWordOverlay({
  uiMode,
  rms,
  transcript,
  onDismiss,
  onPublishToNote,
}: WakeWordOverlayProps) {
  useEffect(() => { ensureKeyframes(); }, []);

  // Phase tracking
  const [phase, setPhase] = useState<"hidden" | "flash" | "panel" | "exiting">("hidden");
  const prevModeRef = useRef<WakeWordUIMode>("idle");
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state for the transcript panel
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 }); // offsets from default top-right
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Publishing feedback
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const clearTimers = useCallback(() => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (exitTimerRef.current)  clearTimeout(exitTimerRef.current);
    flashTimerRef.current = null;
    exitTimerRef.current  = null;
  }, []);

  // ── Mode → phase transitions ───────────────────────────────────────────────
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = uiMode;

    if (uiMode === "active" && prev !== "active") {
      // Wake detected — play ding, show flash, transition to panel after 2.5 s
      clearTimers();
      setPhase("flash");
      setPublished(false);
      playDing();
      flashTimerRef.current = setTimeout(() => {
        setPhase("panel");
      }, 2500);
    } else if (uiMode !== "active" && prev === "active") {
      // Session ended — exit
      clearTimers();
      setPhase("exiting");
      exitTimerRef.current = setTimeout(() => {
        setPhase("hidden");
      }, uiMode === "dismissed" ? 600 : 400);
    }
  }, [uiMode, clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // ── Drag handlers for the transcript panel ────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: panelPos.x,
      origY: panelPos.y,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPanelPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelPos]);

  // ── Publish to note ───────────────────────────────────────────────────────
  const handlePublish = useCallback(async () => {
    if (!onPublishToNote || !transcript || publishing) return;
    setPublishing(true);
    try {
      await onPublishToNote(transcript);
      setPublished(true);
    } catch {
      // non-critical — user can try again
    } finally {
      setPublishing(false);
    }
  }, [onPublishToNote, transcript, publishing]);

  if (phase === "hidden") return null;

  const isExiting = phase === "exiting";

  return (
    <>
      {/* ── Phase 1: Full-screen flash ─────────────────────────────────── */}
      {phase === "flash" && (
        <div
          className="fixed inset-0 z-[60] pointer-events-none overflow-hidden"
          style={{
            animation: "ww-flash-bg 2.5s ease-out forwards",
            background: "radial-gradient(ellipse at center, rgba(99,179,237,0.18) 0%, rgba(99,179,237,0.04) 60%, transparent 100%)",
          }}
        >
          {/* Expanding ring 1 */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ animation: "ww-flash-ring 2.2s cubic-bezier(0.2,0.8,0.3,1) forwards" }}
          >
            <div
              className="rounded-full"
              style={{
                width: "min(90vw, 90vh)",
                height: "min(90vw, 90vh)",
                border: "3px solid rgba(99,179,237,0.85)",
                boxShadow: "0 0 60px 20px rgba(99,179,237,0.4), inset 0 0 60px 10px rgba(99,179,237,0.1)",
              }}
            />
          </div>
          {/* Expanding ring 2 (offset) */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ animation: "ww-flash-ring 2.5s 0.15s cubic-bezier(0.2,0.8,0.3,1) forwards" }}
          >
            <div
              className="rounded-full"
              style={{
                width: "min(70vw, 70vh)",
                height: "min(70vw, 70vh)",
                border: "2px solid rgba(129,230,217,0.6)",
                boxShadow: "0 0 40px 10px rgba(129,230,217,0.25)",
              }}
            />
          </div>
          {/* Edge glow on the window border */}
          <div
            className="absolute inset-0"
            style={{ animation: "ww-flash-glow 2.5s ease-out forwards", boxShadow: "0 0 0 4px rgba(99,179,237,0.9), 0 0 80px 20px rgba(99,179,237,0.45), inset 0 0 80px 10px rgba(99,179,237,0.15)" }}
          />
          {/* Central "heard you" text */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ animation: "ww-flash-glow 2.5s ease-out forwards" }}
          >
            <p
              className="font-bold tracking-widest uppercase select-none"
              style={{
                fontSize: "clamp(1.4rem, 3vw, 2.4rem)",
                color: "rgba(226,232,240,0.95)",
                textShadow: "0 0 40px rgba(99,179,237,0.9), 0 2px 12px rgba(0,0,0,0.7)",
                letterSpacing: "0.25em",
              }}
            >
              Listening
            </p>
          </div>
        </div>
      )}

      {/* ── Window-edge glow during active phase ─────────────────────────── */}
      {(phase === "panel" || phase === "flash") && !isExiting && (
        <div
          className="fixed inset-0 z-[55] pointer-events-none"
          style={{
            animation: phase === "panel"
              ? "ww-edge-breathe 2s ease-in-out infinite"
              : undefined,
            boxShadow: phase === "flash"
              ? "0 0 0 4px rgba(99,179,237,0.9), 0 0 80px 20px rgba(99,179,237,0.45)"
              : undefined,
          }}
        />
      )}
      {isExiting && (
        <div
          className="fixed inset-0 z-[55] pointer-events-none"
          style={{ animation: "ww-edge-dismiss 0.6s ease-out forwards" }}
        />
      )}

      {/* ── Phase 2: Draggable transcript panel ───────────────────────────── */}
      {(phase === "panel" || isExiting) && (
        <div
          className="fixed z-[58] select-none"
          style={{
            top: 64,
            right: 20,
            transform: `translate(${panelPos.x}px, ${panelPos.y}px)`,
            animation: isExiting
              ? "ww-dismiss 0.5s ease-out forwards"
              : "ww-panel-in 0.3s ease-out",
            width: "min(420px, calc(100vw - 48px))",
          }}
        >
          <div
            className="flex flex-col overflow-hidden"
            style={{
              background: "rgba(15, 23, 42, 0.92)",
              border: "1px solid rgba(99,179,237,0.35)",
              borderRadius: "12px",
              boxShadow: "0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,179,237,0.1)",
              backdropFilter: "blur(16px)",
            }}
          >
            {/* Drag handle / title bar */}
            <div
              className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing"
              style={{ borderBottom: "1px solid rgba(99,179,237,0.15)" }}
              onMouseDown={handleDragStart}
            >
              <div className="flex items-center gap-2">
                {/* RMS bars */}
                <RmsBars rms={rms} />
                <span
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "rgba(148,210,232,0.85)", letterSpacing: "0.18em" }}
                >
                  Listening
                </span>
              </div>
              <div className="flex items-center gap-1">
                <GripHorizontal size={14} style={{ color: "rgba(99,179,237,0.5)" }} />
                <button
                  onClick={onDismiss}
                  className="ml-1 rounded p-1 transition-colors"
                  style={{ color: "rgba(148,210,232,0.6)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(239,68,68,0.9)";
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.15)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(148,210,232,0.6)";
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Transcript text */}
            <div className="px-4 py-3" style={{ minHeight: 60, maxHeight: "40vh", overflowY: "auto" }}>
              {transcript ? (
                <p
                  className="font-semibold leading-snug break-words"
                  style={{
                    fontSize: "clamp(1.1rem, 2.5vw, 1.7rem)",
                    color: "rgba(241, 245, 249, 0.97)",
                    textShadow: "0 0 20px rgba(99,179,237,0.5), 0 1px 4px rgba(0,0,0,0.8)",
                    lineHeight: 1.4,
                  }}
                >
                  {transcript}
                </p>
              ) : (
                <p
                  className="font-medium"
                  style={{
                    fontSize: "clamp(0.9rem, 2vw, 1.1rem)",
                    color: "rgba(148,210,232,0.65)",
                    animation: "ww-breathe 1.8s ease-in-out infinite",
                    letterSpacing: "0.05em",
                  }}
                >
                  Speak now…
                </p>
              )}
            </div>

            {/* Footer actions */}
            {onPublishToNote && transcript && (
              <div
                className="flex items-center justify-end gap-2 px-3 py-2"
                style={{ borderTop: "1px solid rgba(99,179,237,0.12)" }}
              >
                <button
                  onClick={handlePublish}
                  disabled={publishing || published}
                  className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-60"
                  style={{
                    background: published ? "rgba(34,197,94,0.15)" : "rgba(99,179,237,0.1)",
                    border: `1px solid ${published ? "rgba(34,197,94,0.4)" : "rgba(99,179,237,0.3)"}`,
                    color: published ? "rgba(134,239,172,0.9)" : "rgba(148,210,232,0.9)",
                  }}
                >
                  <FileText size={12} />
                  {publishing ? "Saving…" : published ? "Saved to note" : "Publish to note"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── RMS bars visualiser ───────────────────────────────────────────────────────

function RmsBars({ rms }: { rms: number }) {
  const bars = 4;
  return (
    <div className="flex items-end gap-0.5" style={{ height: 16 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i + 1) / bars;
        const active = rms >= threshold * 0.25;
        return (
          <div
            key={i}
            style={{
              width: 3,
              height: `${(i + 1) * 25}%`,
              borderRadius: 1,
              background: active
                ? `rgba(99,179,237,${0.5 + rms * 0.5})`
                : "rgba(99,179,237,0.18)",
              transition: "background 0.08s",
            }}
          />
        );
      })}
    </div>
  );
}
