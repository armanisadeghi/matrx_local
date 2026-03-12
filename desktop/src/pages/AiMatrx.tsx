import { ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import supabase from "@/lib/supabase";

const WEB_ORIGIN = "https://www.aimatrx.com";
const TARGET_PATH = "/demos/local-tools";
const HANDOFF_PATH = "/auth/desktop-handoff";

/**
 * Build the iframe src URL with a guaranteed-fresh access token.
 *
 * getSession() returns the cached session without checking expiry. If the
 * JWT has expired (Supabase JWTs last 1 hour), the handoff page receives a
 * dead token and can't authenticate. We pro-actively refresh when the token
 * is within 5 minutes of expiry or already expired.
 *
 * refreshSession() is safe to call here — firing TOKEN_REFRESHED on
 * onAuthStateChange is normal behaviour and does not disrupt the main app.
 * What must be avoided is calling it unnecessarily (which caused the old bug
 * where every tab switch re-triggered auth events). The expiry gate prevents that.
 */
async function buildIframeSrc(): Promise<string> {
    let { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        return `${WEB_ORIGIN}${TARGET_PATH}`;
    }

    // Refresh if the access token expires within the next 5 minutes.
    const expiresAt = session.expires_at ?? 0; // Unix seconds
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (expiresAt - nowSeconds < 300) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed.session) {
            session = refreshed.session;
        }
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
    const [loading, setLoading] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const location = useLocation();
    const isVisible = location.pathname === "/aimatrx";

    // Only build the iframe src when this page is actually visible.
    // This avoids a Supabase call (and potential token refresh) on every
    // app startup — the page is always mounted but auth should only run
    // when the user actually navigates here.
    useEffect(() => {
        if (!isVisible) return;
        setLoading(true);
        buildIframeSrc()
            .then(setIframeSrc)
            .finally(() => setLoading(false));
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
                    disabled={loading}
                    title="Reload"
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
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

            {/* Loading state while we fetch/refresh the session */}
            {loading && (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing you in…
                </div>
            )}

            {/* iframe fills remaining space — only rendered once src is ready */}
            {!loading && iframeSrc && (
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
