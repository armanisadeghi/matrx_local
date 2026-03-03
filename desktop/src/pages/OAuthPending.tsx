import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "@/lib/supabase";
import { engine } from "@/lib/api";
import { Zap, ArrowLeft, ExternalLink, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Provider = "google" | "github" | "apple";

interface OAuthPendingProps {
    provider: Provider;
    onCancel: () => void;
}

const PROVIDER_META: Record<Provider, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    google: {
        label: "Google",
        color: "#4285F4",
        bg: "rgba(66, 133, 244, 0.12)",
        icon: (
            <svg viewBox="0 0 24 24" className="h-5 w-5">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
        ),
    },
    github: {
        label: "GitHub",
        color: "#f0f6fc",
        bg: "rgba(240, 246, 252, 0.08)",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-[#f0f6fc]">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
        ),
    },
    apple: {
        label: "Apple",
        color: "#f5f5f7",
        bg: "rgba(245, 245, 247, 0.08)",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-[#f5f5f7]">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
        ),
    },
};

// Animated dot-dot-dot
function WaitingDots() {
    return (
        <span className="inline-flex gap-1 items-center ml-1">
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s`, animationDuration: "1s" }}
                />
            ))}
        </span>
    );
}

// Animated ring / orbit
function OrbitRing({ color }: { color: string }) {
    return (
        <div className="relative flex items-center justify-center">
            {/* Outer glow */}
            <div
                className="absolute h-40 w-40 rounded-full opacity-20 blur-2xl animate-pulse"
                style={{ background: color }}
            />
            {/* Rotating ring */}
            <svg className="h-36 w-36 animate-spin" style={{ animationDuration: "3s" }} viewBox="0 0 144 144">
                <circle cx="72" cy="72" r="64" fill="none" stroke={color} strokeWidth="2" strokeOpacity="0.15" />
                <circle
                    cx="72"
                    cy="72"
                    r="64"
                    fill="none"
                    stroke={color}
                    strokeWidth="2.5"
                    strokeDasharray="100 303"
                    strokeLinecap="round"
                />
            </svg>
            {/* Counter-rotating inner ring */}
            <svg
                className="absolute h-24 w-24 animate-spin"
                style={{ animationDuration: "2s", animationDirection: "reverse" }}
                viewBox="0 0 96 96"
            >
                <circle cx="48" cy="48" r="40" fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.25" />
                <circle
                    cx="48"
                    cy="48"
                    r="40"
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray="45 206"
                    strokeLinecap="round"
                    strokeOpacity="0.7"
                />
            </svg>
        </div>
    );
}

export function OAuthPending({ provider, onCancel }: OAuthPendingProps) {
    const meta = PROVIDER_META[provider];
    const navigate = useNavigate();
    const handled = useRef(false);
    const [completed, setCompleted] = useState(false);
    const [elapsed, setElapsed] = useState(0);

    // Elapsed timer
    useEffect(() => {
        const t = setInterval(() => setElapsed((e) => e + 1), 1000);
        return () => clearInterval(t);
    }, []);

    // Listen for the oauth-callback message broadcast by the FastAPI sidecar.
    // When the external browser hits http://localhost:22140/auth/callback the
    // sidecar pushes { type: "oauth-callback", code?: string,
    // access_token?: string, refresh_token?: string } over WebSocket to every
    // connected client (the Tauri webview is one of them).
    useEffect(() => {
        if (handled.current) return;

        const off = engine.on("message", async (data: unknown) => {
            const msg = data as Record<string, string>;
            if (msg?.type !== "oauth-callback") return;
            if (handled.current) return;
            handled.current = true;
            off();

            try {
                if (msg.code) {
                    // PKCE flow: exchange the short-lived code for a session.
                    // The Supabase JS client stored the code_verifier in localStorage
                    // when signInWithOAuth was called, so this call retrieves it
                    // automatically.
                    const { error } = await supabase.auth.exchangeCodeForSession(msg.code);
                    if (!error) {
                        setCompleted(true);
                        setTimeout(() => navigate("/", { replace: true }), 800);
                        return;
                    }
                    console.error("[OAuthPending] exchangeCodeForSession error:", error.message);
                } else if (msg.access_token && msg.refresh_token) {
                    // Implicit flow: tokens arrived directly (older Supabase projects).
                    const { error } = await supabase.auth.setSession({
                        access_token: msg.access_token,
                        refresh_token: msg.refresh_token,
                    });
                    if (!error) {
                        setCompleted(true);
                        setTimeout(() => navigate("/", { replace: true }), 800);
                        return;
                    }
                    console.error("[OAuthPending] setSession error:", error.message);
                } else {
                    console.warn("[OAuthPending] oauth-callback message missing expected fields:", msg);
                }
            } catch (err) {
                console.error("[OAuthPending] unexpected error handling oauth-callback:", err);
            }

            navigate("/login", { replace: true });
        });

        return () => { off(); };
    }, [navigate]);

    return (
        <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background">
            {/* ── Ambient background gradient ───────────────────── */}
            <div
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{
                    background: `radial-gradient(ellipse 80% 60% at 50% -10%, ${meta.color}55 0%, transparent 70%)`,
                }}
            />

            {/* ── Grid lines (subtle) ───────────────────────────── */}
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.03]"
                style={{
                    backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
                    backgroundSize: "48px 48px",
                }}
            />

            {/* ── Top bar — Back / Branding ──────────────────────── */}
            <header className="relative z-10 flex items-center justify-between px-6 py-4">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onCancel}
                    className="gap-2 text-muted-foreground hover:text-foreground"
                    disabled={completed}
                >
                    <ArrowLeft className="h-4 w-4" />
                    Cancel
                </Button>

                {/* Logo / Brand */}
                <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                        <Zap className="h-4 w-4 text-primary" />
                    </div>
                    <span className="text-sm font-semibold tracking-tight">AI Matrx</span>
                </div>

                {/* Elapsed time */}
                <div className="w-24 text-right text-xs text-muted-foreground/50 tabular-nums">
                    {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
                </div>
            </header>

            {/* ── Main content ──────────────────────────────────── */}
            <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-10 px-6 text-center">

                {completed ? (
                    // Success state
                    <div className="flex flex-col items-center gap-4 animate-fade-in">
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10">
                            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold">Signed in!</h2>
                            <p className="mt-1 text-sm text-muted-foreground">Taking you to your workspace…</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Animated orbit rings */}
                        <div className="relative flex items-center justify-center">
                            <OrbitRing color={meta.color} />
                            {/* Provider icon in center */}
                            <div
                                className="absolute flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
                                style={{ background: meta.bg, border: `1px solid ${meta.color}30` }}
                            >
                                {meta.icon}
                            </div>
                        </div>

                        {/* Status text */}
                        <div className="max-w-xs space-y-2">
                            <h1 className="text-2xl font-bold tracking-tight">
                                Signing in with {meta.label}
                                <WaitingDots />
                            </h1>
                            <p className="text-sm leading-relaxed text-muted-foreground">
                                A {meta.label} sign-in page has opened in your browser.
                                <br />
                                Complete it there and you'll be brought right back.
                            </p>
                        </div>

                        {/* Info card */}
                        <div className="glass w-full max-w-xs rounded-2xl px-5 py-4 text-left space-y-3">
                            <Step
                                number={1}
                                done
                                text={`${meta.label} sign-in window opened`}
                            />
                            <Step
                                number={2}
                                active
                                text="Waiting for you to complete sign-in"
                            />
                            <Step
                                number={3}
                                text="You'll be returned here automatically"
                            />
                        </div>

                        {/* Hint */}
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                            <ExternalLink className="h-3 w-3" />
                            Don't see the browser window? Check your taskbar.
                        </p>
                    </>
                )}
            </main>

            {/* ── Bottom bar ──────────────────────────────────────── */}
            <footer className="relative z-10 flex items-center justify-center gap-2 px-6 py-4">
                {!completed && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-xs text-muted-foreground/60 hover:text-muted-foreground"
                        onClick={onCancel}
                    >
                        <RefreshCw className="h-3 w-3" />
                        Try a different method
                    </Button>
                )}
            </footer>
        </div>
    );
}

// Step indicator row
function Step({
    number,
    text,
    done = false,
    active = false,
}: {
    number: number;
    text: string;
    done?: boolean;
    active?: boolean;
}) {
    return (
        <div className="flex items-center gap-3">
            <div
                className={[
                    "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all",
                    done
                        ? "bg-primary text-primary-foreground"
                        : active
                            ? "bg-primary/20 text-primary ring-2 ring-primary/30 animate-pulse"
                            : "bg-muted text-muted-foreground",
                ].join(" ")}
            >
                {done ? "✓" : number}
            </div>
            <span
                className={[
                    "text-sm",
                    done
                        ? "text-foreground/70 line-through"
                        : active
                            ? "text-foreground font-medium"
                            : "text-muted-foreground/60",
                ].join(" ")}
            >
                {text}
            </span>
        </div>
    );
}
