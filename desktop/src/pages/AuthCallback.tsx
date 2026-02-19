import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const supabase = getSupabase();

    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        navigate("/", { replace: true });
      }
    });

    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      // Supabase client picks up tokens from URL automatically via detectSessionInUrl
    } else {
      const timeout = setTimeout(() => navigate("/login", { replace: true }), 5000);
      return () => clearTimeout(timeout);
    }
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
