"use client";

import { useEffect, useState } from "react";

let cached: Promise<boolean | null> | null = null;

/** Interroge /api/payments/config une fois par chargement de page ; null si la réponse est inconnue (hors ligne). */
function fetchAvailability(): Promise<boolean | null> {
  cached ??= fetch("/api/payments/config", { cache: "no-store" })
    .then(async (r) => {
      if (r.status === 404) return false;
      if (!r.ok) return null;
      const data = (await r.json().catch(() => null)) as { mobile?: unknown } | null;
      return typeof data?.mobile === "boolean" ? data.mobile : null;
    })
    .catch(() => null)
    .then((v) => {
      // Réponse inconnue (réseau) : réessayer au prochain appel.
      if (v === null) cached = null;
      return v;
    });
  return cached;
}

/**
 * Paiement mobile (Orange Money / MTN MoMo à distance) configuré sur le serveur ?
 * undefined : en cours ; null : inconnu (hors ligne) ; true / false sinon.
 */
export function useMobilePaymentsAvailable(): boolean | null | undefined {
  const [value, setValue] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fetchAvailability().then((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return value;
}
