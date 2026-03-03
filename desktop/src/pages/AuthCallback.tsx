import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "@/lib/supabase";
import { Loader2 } from "lucide-react";

/**
 * AuthCallback — Web browser fallback only.
 *
 * In the **Tauri desktop app**, OAuth callbacks are handled entirely inside
 * OAuthPending.tsx (which listens for the `oauth-callback` event emitted by
 * the Rust deep-link plugin). This component is never reached in Tauri.
 *
 * In the **web browser**, HashRouter produces:
 *   /#/auth/callback#access_token=XXX&refresh_token=YYY
 * Supabase can't parse the double-hash, so we extract the token fragment
 * manually from everything after the second '#' and call setSession().
 *
 * IMPORTANT: We also let Supabase's own detectSessionInUrl do its job by
 * calling getSession() first. If it already picked up the session from the
 * URL (which newer Supabase JS versions do automatically), we skip setSession
 * entirely to avoid a double-call that causes a silent no-op.
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    async function handleWebCallback() {
      try {
        // 1. Check if Supabase already picked up the session from the URL hash
        //    (supabase-js v2 with detectSessionInUrl:true does this automatically).
        const { data: existing } = await supabase.auth.getSession();
        if (existing.session) {
          console.log("[AuthCallback] Session already established by Supabase client");
          navigate("/", { replace: true });
          return;
        }

        // 2. Manual extraction: URL looks like:
        //    http://localhost:1420/#/auth/callback#access_token=XYZ&...
        //    We want everything after the LAST '#'.
        const fullHash = window.location.hash;
        const lastHash = fullHash.indexOf("#", 1); // find second '#'
        const tokenFragment = lastHash !== -1 ? fullHash.slice(lastHash + 1) : "";
        const params = new URLSearchParams(tokenFragment);

        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });

          if (error) {
            console.error("[AuthCallback] setSession failed:", error.message);
            navigate("/login", { replace: true });
            return;
          }

          navigate("/", { replace: true });
          return;
        }

        console.warn("[AuthCallback] No tokens found in URL hash:", tokenFragment);
        setTimeout(() => navigate("/login", { replace: true }), 3000);
      } catch (err) {
        console.error("[AuthCallback] Unexpected error:", err);
        navigate("/login", { replace: true });
      }
    }

    handleWebCallback();
  }, [navigate]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Completing sign in…</p>
      </div>
    </div>
  );
}
