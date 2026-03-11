import { ExternalLink, RefreshCw } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import supabase from "@/lib/supabase";

const WEB_ORIGIN = "https://www.aimatrx.com";
const TARGET_PATH = "/demos/local-tools";
const HANDOFF_PATH = "/auth/desktop-handoff";

/**
 * Build the initial URL the iframe loads.
 *
 * We always load the handoff page first. It signals READY, we send tokens,
 * and it redirects to TARGET_PATH automatically. On manual reload we do the
 * same thing — re-establishing a fresh session on every load.
 */
function buildHandoffUrl(): string {
    const redirect = encodeURIComponent(TARGET_PATH);
    return `${WEB_ORIGIN}${HANDOFF_PATH}?redirect=${redirect}`;
}

export function AiMatrx() {
    const [key, setKey] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    /**
     * Listen for MATRX_HANDOFF_READY from the iframe.
     * When received, read the desktop session and post tokens back.
     *
     * We re-register on every `key` change (i.e. every reload) so a fresh
     * listener is attached for each new iframe load.
     */
    const handleMessage = useCallback(async (event: MessageEvent) => {
        if (event.origin !== WEB_ORIGIN) return;
        if (
            typeof event.data !== "object" ||
            event.data === null ||
            event.data.type !== "MATRX_HANDOFF_READY"
        ) return;

        try {
            // Refresh the session first so we never hand off a near-expired token
            const { data: refreshData, error: refreshError } =
                await supabase.auth.refreshSession();

            const session = refreshError
                ? (await supabase.auth.getSession()).data.session
                : refreshData.session;

            if (!session) {
                console.warn("[AiMatrx] No active session — cannot complete handoff");
                return;
            }

            iframeRef.current?.contentWindow?.postMessage(
                {
                    type: "MATRX_HANDOFF_TOKENS",
                    access_token: session.access_token,
                    refresh_token: session.refresh_token,
                },
                WEB_ORIGIN
            );
        } catch (err) {
            console.error("[AiMatrx] Handoff failed:", err);
        }
    }, []);

    useEffect(() => {
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [handleMessage]);

    const reload = () => setKey((k) => k + 1);

    return (
        <div className="flex h-full flex-col">
            {/* Thin toolbar */}
            <div className="flex items-center gap-2 border-b bg-background/80 backdrop-blur px-4 py-2 shrink-0">
                <span className="text-xs font-medium text-muted-foreground truncate flex-1 select-text">
                    {WEB_ORIGIN}{TARGET_PATH}
                </span>
                <button
                    onClick={reload}
                    title="Reload"
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <a
                    href={`${WEB_ORIGIN}${TARGET_PATH}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in browser"
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
            </div>

            {/* iframe fills remaining space */}
            <iframe
                key={key}
                ref={iframeRef}
                src={buildHandoffUrl()}
                title="AiMatrx Local Tools"
                className="flex-1 w-full border-0"
                allow="camera; microphone; clipboard-read; clipboard-write"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            />
        </div>
    );
}
