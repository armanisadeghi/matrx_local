import { useState, useEffect, useCallback, useRef } from "react";
import type { User, Session, Provider } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

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
    const supabase = getSupabase();

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
      const supabase = getSupabase();

      const redirectTo = `${window.location.origin}/auth/callback`;

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
      const supabase = getSupabase();

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
    const supabase = getSupabase();
    const { error } = await supabase.auth.signOut();
    if (error) {
      update({ loading: false, error: error.message });
    }
  }, [update]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const supabase = getSupabase();
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
