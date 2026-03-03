import { useState, useEffect, useCallback, useRef } from "react";
import type { User, Session, Provider } from "@supabase/supabase-js";
import supabase from "@/lib/supabase";


export interface AuthState {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    isAuthenticated: false,
    loading: true,
    error: null,
  });

  const mountedRef = useRef(true);

  const update = useCallback((partial: Partial<AuthState>) => {
    if (mountedRef.current) {
      setState((prev) => ({ ...prev, ...partial }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      update({
        session,
        user: session?.user ?? null,
        isAuthenticated: !!session,
        loading: false,
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      update({
        session,
        user: session?.user ?? null,
        isAuthenticated: !!session,
        loading: false,
        error: null,
      });
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [update]);

  const signInWithOAuth = useCallback(
    async (provider: Provider) => {
      update({ loading: true, error: null });

      const isInTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

      if (isInTauri) {
        // ── Tauri desktop path ────────────────────────────────────────────
        // CRITICAL: skipBrowserRedirect MUST be true in Tauri.
        //
        // With skipBrowserRedirect:false, Supabase JS calls:
        //   window.location.href = authUrl
        // This navigates the TAURI WEBVIEW itself away from the React app,
        // destroying OAuthPending, the WebSocket connection, and any ability
        // to receive the callback — that's why auth appeared to succeed but
        // the app never resumed.
        //
        // Correct flow:
        // 1. skipBrowserRedirect:true  → Supabase returns the URL without navigating
        // 2. shell.open(url)           → opens URL in the SYSTEM BROWSER (not webview)
        // 3. Webview stays on OAuthPending with WS connection alive
        // 4. User completes OAuth in system browser
        // 5. System browser → http://localhost:22140/auth/callback?code=X
        // 6. FastAPI sidecar broadcasts { type:"oauth-callback", code:"X" } via WS
        // 7. OAuthPending receives it → exchangeCodeForSession() → navigate("/")
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: "http://localhost:22140/auth/callback",
            skipBrowserRedirect: true,
          },
        });

        if (error) {
          update({ loading: false, error: error.message });
          return;
        }

        if (data?.url) {
          try {
            // Open in the system browser — this does NOT navigate the webview.
            const { open } = await import("@tauri-apps/plugin-shell");
            await open(data.url);
          } catch (shellErr) {
            console.error("[auth] shell.open failed:", shellErr);
            // Last-resort fallback: window.open targets a new window, not the webview.
            window.open(data.url, "_blank");
          }
        }
      } else {
        // ── Web / dev browser path ────────────────────────────────────────
        // Standard browser flow: Supabase navigates the tab to the auth URL.
        // After OAuth completes, Supabase redirects to /#/auth/callback where
        // AuthCallback.tsx extracts and sets the session.
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: `${window.location.origin}/#/auth/callback`,
            skipBrowserRedirect: false,
          },
        });

        if (error) {
          update({ loading: false, error: error.message });
        }
      }
    },
    [update]
  );

  const signInWithGoogle = useCallback(
    () => signInWithOAuth("google"),
    [signInWithOAuth]
  );

  const signInWithGitHub = useCallback(
    () => signInWithOAuth("github"),
    [signInWithOAuth]
  );

  const signInWithApple = useCallback(
    () => signInWithOAuth("apple"),
    [signInWithOAuth]
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      update({ loading: true, error: null });

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        update({ loading: false, error: error.message });
      }
    },
    [update]
  );

  const signOut = useCallback(async () => {
    update({ loading: true, error: null });
    try {
      // 5-second timeout — if Supabase is unreachable, clear the local session
      // anyway so the user is never permanently stuck on a spinner.
      const result = await Promise.race([
        supabase.auth.signOut(),
        new Promise<{ error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({ error: { message: "Sign-out timed out" } }), 5000)
        ),
      ]);
      if (result.error) {
        console.warn("[signOut]", result.error.message);
      }
    } catch (err) {
      console.warn("[signOut] unexpected error:", err);
    } finally {
      // Always clear local state so the UI unlocks regardless of network outcome.
      update({ loading: false, session: null, user: null, isAuthenticated: false, error: null });
    }
  }, [update]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  return {
    ...state,
    signInWithGoogle,
    signInWithGitHub,
    signInWithApple,
    signInWithEmail,
    signOut,
    getAccessToken,
  };
}
