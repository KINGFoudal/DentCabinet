"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { wipeLocalDb } from "@/lib/local/db";

type AuthCtx = {
  /** null tant que la session n'a pas été lue. */
  ready: boolean;
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const sb = supabase();
    // getSession lit le stockage local : fonctionne hors ligne.
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut({ scope: "local" });
    try {
      localStorage.removeItem("nimba-cabinet");
      localStorage.removeItem("nimba-memberships");
    } catch {}
    // Les données de santé ne doivent pas rester sur l'appareil après déconnexion.
    await wipeLocalDb();
    setSession(null);
  }, []);

  return <AuthContext value={{ ready, session, user: session?.user ?? null, signOut }}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
