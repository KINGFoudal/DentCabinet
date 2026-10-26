import { normalizeGuineaPhone } from "@/lib/format";

/** Numéro au format attendu par wa.me (chiffres seulement, ex. 224620000000) ; null si invalide. */
export function waPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const e164 = normalizeGuineaPhone(phone);
  return e164 ? e164.slice(1) : null;
}

/** Longueur maximale raisonnable d'un texte pré-rempli (les très longues URL sont tronquées par certains navigateurs). */
export const WA_TEXT_MAX = 3000;

/**
 * Lien « click to chat » gratuit : https://wa.me/224XXXXXXXXX?text=<message encodé>.
 * Renvoie null si le numéro est invalide ou si le texte est vide.
 */
export function waMeLink(phone: string | null | undefined, text: string): string | null {
  const to = waPhone(phone);
  const body = text.replace(/\r\n?/g, "\n").trim();
  if (!to || !body) return null;
  return `https://wa.me/${to}?text=${encodeURIComponent(body.slice(0, WA_TEXT_MAX))}`;
}
