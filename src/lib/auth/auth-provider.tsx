"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { claimLocalData, wipeDeviceData } from "@/lib/local/device-data";

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
    let alive = true;
    // Utilisateur auquel les données locales sont rattachées dans cet onglet.
    let claimed: string | null = null;
    // Les événements sont traités dans l'ordre : l'effacement ou la vérification du
    // propriétaire des données locales se termine avant d'exposer la session.
    let queue: Promise<void> = Promise.resolve();

    const apply = (s: Session | null, event?: AuthChangeEvent) => {
      queue = queue
        .then(async () => {
          if (event === "SIGNED_OUT") {
            // Déconnexion réelle (volontaire, ou jeton refusé par le serveur). supabase-js
            // n'émet pas SIGNED_OUT sur une erreur réseau (AuthRetryableFetchError) : une
            // coupure ou un rafraîchissement impossible hors ligne n'efface rien.
            claimed = null;
            if (alive) setSession(null);
            await wipeDeviceData();
          } else if (s && s.user.id !== claimed) {
            try {
              await claimLocalData(s.user.id);
            } catch (e) {
              console.error("[auth] local data owner check", e);
              await wipeDeviceData().catch(() => undefined);
            }
            claimed = s.user.id;
          }
          if (alive) {
            setSession(s);
            setReady(true);
          }
        })
        .catch((e) => console.error("[auth]", e));
    };

    // getSession lit le stockage local : fonctionne hors ligne.
    void sb.auth.getSession().then(({ data }) => apply(data.session));
    // Ne pas appeler supabase-js dans ce rappel (verrou interne) : le travail est différé dans `queue`.
    const { data } = sb.auth.onAuthStateChange((event, s) => apply(s, event));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut({ scope: "local" });
    // Les données de santé ne doivent pas rester sur l'appareil après déconnexion.
    await wipeDeviceData();
    setSession(null);
  }, []);

  return <AuthContext value={{ ready, session, user: session?.user ?? null, signOut }}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
