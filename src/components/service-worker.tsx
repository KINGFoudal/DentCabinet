"use client";

import { useEffect } from "react";

/** Pages de l'espace cabinet préchargées pour être disponibles hors ligne. */
export const OFFLINE_ROUTES = [
  "/app",
  "/app/agenda",
  "/app/salle-attente",
  "/app/patients",
  "/app/patients/fiche",
  "/app/facturation",
  "/app/facturation/facture",
  "/app/facturation/devis",
];

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW_DEV !== "1") return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        await navigator.serviceWorker.ready;
        (reg.active ?? reg.waiting ?? reg.installing)?.postMessage({ type: "warm", urls: OFFLINE_ROUTES });
      })
      .catch(() => undefined);
  }, []);
  return null;
}
