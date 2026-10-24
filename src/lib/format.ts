import type { Locale } from "@/i18n/messages";

export const CABINET_TIMEZONE = "Africa/Conakry";

const intlLocale = (locale: Locale) => (locale === "fr" ? "fr-FR" : "en-GB");

/** 150000 -> « 150 000 GNF ». Le franc guinéen n'a pas de décimales. */
export function formatGNF(amount: number | bigint | null | undefined, locale: Locale = "fr"): string {
  const n = Number(amount ?? 0);
  const formatted = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 })
    .format(Math.round(n))
    .replace(/[  ]/g, " ");
  return `${formatted} GNF`;
}

/** Analyse un montant saisi (« 150 000 », « 150000 ») ; null si invalide. */
export function parseGNF(input: string): number | null {
  const digits = input.replace(/[\s  .,]/g, "").replace(/GNF$/i, "");
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

export function formatDate(value: string | Date | null | undefined, locale: Locale = "fr", timeZone = CABINET_TIMEZONE) {
  if (!value) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone }).format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined, locale: Locale = "fr", timeZone = CABINET_TIMEZONE) {
  if (!value) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined, locale: Locale = "fr", timeZone = CABINET_TIMEZONE) {
  if (!value) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(value),
  );
}

/**
 * Normalise un numéro guinéen au format E.164 (+224XXXXXXXXX).
 * Accepte « 620 00 00 00 », « 00224620000000 », « +224 620000000 ».
 * Renvoie null si le numéro n'est pas reconnu.
 */
export function normalizeGuineaPhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  }
  // Numéro local guinéen : 9 chiffres.
  if (/^\d{9}$/.test(digits)) return "+224" + digits;
  if (/^224\d{9}$/.test(digits)) return "+" + digits;
  return null;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+224(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+224 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

export function fullName(p: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!p) return "";
  return [p.first_name, p.last_name?.toUpperCase()].filter(Boolean).join(" ");
}

/** Âge en années révolues à la date donnée. */
export function ageFrom(birthDate: string | null | undefined, now = new Date()): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate + "T00:00:00Z");
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
