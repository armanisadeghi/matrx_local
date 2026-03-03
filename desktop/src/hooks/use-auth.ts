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

      // In the Tauri desktop app, the webview origin (tauri://localhost) cannot
      // receive OAuth callbacks from an external browser because it's not a
      // publicly-routable URL.  Instead we redirect to the FastAPI sidecar
      // which is always listening on localhost:22140 and IS reachable by any
      // browser.  The sidecar captures the code and pushes it back to the
      // webview via WebSocket, where we then call exchangeCodeForSession().
      //
      // In the web/dev build (no Tauri), we use the hash-router path on the
      // page origin so the AuthCallback component can pick it up directly.
      const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
      const redirectTo = isTauri
        ? "http://localhost:22140/auth/callback"
        : `${window.location.origin}/#/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: false,
        },
      });

      if (error) {
        update({ loading: false, error: error.message });
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
