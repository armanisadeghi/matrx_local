import { ExternalLink, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import supabase from "@/lib/supabase";

const WEB_ORIGIN = "https://www.aimatrx.com";
const TARGET_PATH = "/demos/local-tools";
const HANDOFF_PATH = "/auth/desktop-handoff";

/**
 * Build the iframe src URL.
 *
 * Uses getSession() (read-only, no network call, no auth events) rather than
 * refreshSession() which fires onAuthStateChange and can disrupt the session
 * state of the main app. The handoff page handles token freshness on its end.
 */
async function buildIframeSrc(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        return `${WEB_ORIGIN}${TARGET_PATH}`;
    }

    const params = new URLSearchParams({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        redirect: TARGET_PATH,
    });

    return `${WEB_ORIGIN}${HANDOFF_PATH}?${params.toString()}`;
}

export function AiMatrx() {
    const [iframeSrc, setIframeSrc] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const location = useLocation();
    const isVisible = location.pathname === "/aimatrx";

    // Only build the iframe src when this page is actually visible.
    // This prevents a Supabase call on every app startup (the page is
    // always mounted but should not run auth operations until the user
    // actually navigates here).
    useEffect(() => {
        if (!isVisible) return;
        buildIframeSrc().then(setIframeSrc);
    }, [reloadKey, isVisible]);

    const reload = () => {
        setIframeSrc(null);
        setReloadKey((k) => k + 1);
    };

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

            {/* iframe fills remaining space — only rendered once src is ready */}
            {iframeSrc && (
                <iframe
                    key={reloadKey}
                    src={iframeSrc}
                    title="AiMatrx Local Tools"
                    className="flex-1 w-full border-0"
                    allow="camera; microphone; clipboard-read; clipboard-write"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
                />
            )}
        </div>
    );
}
