import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  isAnonymous: boolean;
  displayName: string;
  avatarUrl: string | null;
}

interface AuthContextType extends AuthState {
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInAsGuest: () => Promise<void>;
  signOut: (setMode?: (mode: string) => void) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
    isAnonymous: false,
    displayName: "",
    avatarUrl: null,
  });

  const deriveUserInfo = useCallback((user: User | null) => {
    if (!user) return { isAnonymous: false, displayName: "", avatarUrl: null };
    const isAnonymous = user.is_anonymous ?? false;
    const meta = user.user_metadata ?? {};
    const displayName = meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "Guest");
    const avatarUrl = meta.avatar_url || meta.picture || null;
    return { isAnonymous, displayName, avatarUrl };
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      const info = deriveUserInfo(user);
      setState({ user, session, loading: false, error: null, ...info });
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      const info = deriveUserInfo(user);
      setState({ user, session, loading: false, error: null, ...info });
    });

    return () => subscription.unsubscribe();
  }, [deriveUserInfo]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, error: null }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setState((s) => ({ ...s, error: error.message }));
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, error: null }));
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setState((s) => ({ ...s, error: error.message }));
  }, []);

  const signInAsGuest = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    const { error } = await supabase.auth.signInAnonymously();
    if (error) setState((s) => ({ ...s, error: error.message }));
  }, []);

  const signOut = useCallback(async (setMode?: (mode: string) => void) => {
    await supabase.auth.signOut();
    setState({ user: null, session: null, loading: false, error: null, isAnonymous: false, displayName: "", avatarUrl: null });
    // Stay on studio page (don't redirect to landing)
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, signInWithEmail, signUpWithEmail, signInAsGuest, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
