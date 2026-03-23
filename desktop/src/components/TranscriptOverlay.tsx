/**
 * TranscriptOverlay
 *
 * Renders in the always-on-top floating Tauri window (label "transcript-overlay").
 * Receives live transcript text via Tauri events ("overlay-transcript") emitted
 * from Voice.tsx whenever the wake word session is active.
 *
 * The window is transparent, decoration-free, and draggable via the title bar.
 * The user can dismiss the session or copy the transcript.
 *
 * Mounted at the /#/overlay hash route — the Tauri overlay window loads
 * index.html which routes here immediately.
 */

import { useEffect, useState, useCallback } from "react";
import { X, Copy, Check, GripHorizontal, Mic } from "lucide-react";

// ── Keyframes injected once ───────────────────────────────────────────────────

const KEYFRAMES_ID = "overlay-kf";
function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const s = document.createElement("style");
  s.id = KEYFRAMES_ID;
  s.textContent = `
    @keyframes ov-slide-in {
      from { opacity: 0; transform: translateY(-12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes ov-pulse-border {
      0%, 100% { box-shadow: 0 0 0 1px rgba(99,179,237,0.4), 0 4px 24px rgba(0,0,0,0.5); }
      50%       { box-shadow: 0 0 0 2px rgba(99,179,237,0.7), 0 4px 32px rgba(99,179,237,0.2), 0 4px 24px rgba(0,0,0,0.5); }
    }
    @keyframes ov-breathe {
      0%, 100% { opacity: 0.5; }
      50%       { opacity: 1.0; }
    }
  `;
  document.head.appendChild(s);
}

async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<T>(event, (e) => handler(e.payload));
    return unlisten;
  } catch {
    return () => {};
  }
}

async function tauriInvoke(cmd: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd);
  } catch { /* ok */ }
}

export function TranscriptOverlay() {
  const [transcript, setTranscript] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ensureKeyframes();

    // Apply dark background to the entire page so the transparent window
    // shows our custom dark glass style rather than the white SPA default.
    document.documentElement.classList.add("dark");
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";

    let unlisten: (() => void) | null = null;

    tauriListen<string>("overlay-transcript", (text) => {
      setTranscript(text);
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  const handleDismiss = useCallback(async () => {
    await tauriInvoke("hide_transcript_overlay");
  }, []);

  const handleCopy = useCallback(() => {
    if (!transcript) return;
    navigator.clipboard.writeText(transcript).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [transcript]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "ov-slide-in 0.25s ease-out",
      }}
    >
      {/* Glass card — fills the entire window */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "rgba(10, 16, 30, 0.88)",
          border: "1px solid rgba(99,179,237,0.3)",
          borderRadius: 12,
          backdropFilter: "blur(20px)",
          animation: "ov-pulse-border 2.5s ease-in-out infinite",
          overflow: "hidden",
        }}
      >
        {/* ── Title bar (drag handle) ── */}
        <div
          data-tauri-drag-region
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderBottom: "1px solid rgba(99,179,237,0.15)",
            cursor: "grab",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* RMS dot indicator */}
            <Mic size={12} style={{ color: "rgba(99,179,237,0.8)" }} />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: "rgba(148,210,232,0.85)",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              AI Matrx — Listening
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <GripHorizontal size={12} style={{ color: "rgba(99,179,237,0.4)" }} />
            {transcript && (
              <button
                onClick={handleCopy}
                title="Copy transcript"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  borderRadius: 4,
                  color: copied ? "rgba(134,239,172,0.9)" : "rgba(148,210,232,0.6)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            )}
            <button
              onClick={handleDismiss}
              title="Dismiss"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 4px",
                borderRadius: 4,
                color: "rgba(148,210,232,0.5)",
                display: "flex",
                alignItems: "center",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(239,68,68,0.9)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(148,210,232,0.5)";
              }}
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* ── Transcript body ── */}
        <div
          style={{
            flex: 1,
            padding: "12px 14px",
            overflowY: "auto",
            display: "flex",
            alignItems: transcript ? "flex-start" : "center",
            justifyContent: transcript ? "flex-start" : "center",
          }}
        >
          {transcript ? (
            <p
              style={{
                margin: 0,
                fontSize: "clamp(1rem, 2.5vw, 1.35rem)",
                fontWeight: 600,
                lineHeight: 1.45,
                color: "rgba(241,245,249,0.97)",
                textShadow: "0 0 16px rgba(99,179,237,0.45), 0 1px 3px rgba(0,0,0,0.8)",
                wordBreak: "break-word",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {transcript}
            </p>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "rgba(148,210,232,0.6)",
                animation: "ov-breathe 1.8s ease-in-out infinite",
                letterSpacing: "0.06em",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              Speak now…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
