"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** Vrai sous 640 px de large (téléphone). */
export function useIsMobile() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(max-width: 639px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 639px)").matches,
    () => false,
  );
}

/** Heure courante rafraîchie périodiquement (ligne « maintenant », temps d'attente). */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Préférence locale (localStorage), sans effet si le stockage est indisponible. */
export function usePersistentState<T extends string>(key: string, initial: T, allowed?: readonly T[]) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique de la préférence au montage
      if (v !== null && (!allowed || allowed.includes(v))) setValue(v);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lecture au montage seulement
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {}
  };
  return [value, set] as const;
}
