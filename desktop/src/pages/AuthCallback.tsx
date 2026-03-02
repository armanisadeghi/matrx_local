import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "@/lib/supabase";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    async function handleCallback() {
      try {
        // HashRouter creates: /#/auth/callback#access_token=...&refresh_token=...
        // The browser sees one big fragment: "/auth/callback#access_token=..."
        // Supabase's detectSessionInUrl can't parse this, so we do it manually.
        const fullHash = window.location.hash; // e.g. "#/auth/callback#access_token=XYZ&refresh_token=ABC..."
        const tokenFragment = fullHash.split("#").pop() ?? ""; // last fragment after final #
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

        // No tokens in URL — maybe a direct visit. Redirect to login after a short wait.
        console.warn("[AuthCallback] No tokens found in URL hash");
        setTimeout(() => navigate("/login", { replace: true }), 3000);
      } catch (err) {
        console.error("[AuthCallback] Unexpected error:", err);
        navigate("/login", { replace: true });
      }
    }

    handleCallback();
  }, [navigate]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}

