"use client";

import { useSyncExternalStore } from "react";

/**
 * Patients récemment ouverts (par cabinet), mémorisés sur l'appareil (localStorage) :
 * uniquement des identifiants, jamais de données de santé. Effacé avec les données locales
 * à la déconnexion (clé préfixée « nimba- »).
 */
export const RECENT_MAX = 8;
const key = (cabinetId: string) => `nimba-recent-patients:${cabinetId}`;
const EVENT = "nimba-recent-patients";

/** Ajoute `id` en tête de liste, sans doublon, limitée à `max` éléments. */
export function pushRecent(list: readonly string[], id: string, max = RECENT_MAX) {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

function read(cabinetId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(cabinetId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberPatient(cabinetId: string, patientId: string) {
  try {
    localStorage.setItem(key(cabinetId), JSON.stringify(pushRecent(read(cabinetId), patientId)));
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

// Instantané stable pour useSyncExternalStore (la même chaîne donne le même tableau).
const cache = new Map<string, { raw: string; list: string[] }>();
function snapshot(cabinetId: string) {
  let raw = "[]";
  try {
    raw = localStorage.getItem(key(cabinetId)) ?? "[]";
  } catch {}
  const hit = cache.get(cabinetId);
  if (hit && hit.raw === raw) return hit.list;
  const list = read(cabinetId);
  cache.set(cabinetId, { raw, list });
  return list;
}

const EMPTY: string[] = [];

/** Identifiants des patients récemment ouverts, du plus récent au plus ancien. */
export function useRecentPatientIds(cabinetId: string): string[] {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => snapshot(cabinetId),
    () => EMPTY,
  );
}
