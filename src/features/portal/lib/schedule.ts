import { addDays } from "@/lib/dates";
import type { OpeningHours } from "./types";

/** Jour ISO (1 = lundi ... 7 = dimanche) d'une date AAAA-MM-JJ. */
export function isoWeekday(dateISO: string): number {
  const d = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Lignes d'horaires du lundi au dimanche ; intervals vide = fermé. */
export function weekRows(hours: OpeningHours): { day: number; intervals: [string, string][] }[] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, intervals: hours[String(day)] ?? [] }));
}

export function hasOpeningHours(hours: OpeningHours): boolean {
  return Object.values(hours).some((l) => l.length > 0);
}

/** Vrai si le cabinet est ouvert ce jour-là (ou si aucun horaire n'est connu : le serveur tranchera). */
export function isOpenOn(hours: OpeningHours, dateISO: string): boolean {
  if (!hasOpeningHours(hours)) return true;
  return (hours[String(isoWeekday(dateISO))] ?? []).length > 0;
}

/** Les n jours à partir de `from` (inclus). */
export function nextDays(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

/** Heure locale (0-23) d'un instant dans le fuseau donné. */
export function localHour(iso: string, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
  return Number(h);
}

export type Slot = { starts_at: string; ends_at: string };

/** Sépare les créneaux du matin (avant 12 h) et de l'après-midi. */
export function splitSlots(slots: Slot[], timeZone: string): { morning: Slot[]; afternoon: Slot[] } {
  const morning: Slot[] = [];
  const afternoon: Slot[] = [];
  for (const s of slots) (localHour(s.starts_at, timeZone) < 12 ? morning : afternoon).push(s);
  return { morning, afternoon };
}

/** Le patient peut-il annuler lui-même ce rendez-vous ? (même règle que cancel_online) */
export function canCancelOnline(
  appt: { status: string; starts_at: string },
  minHours: number,
  now: Date = new Date(),
): boolean {
  if (appt.status !== "scheduled" && appt.status !== "confirmed") return false;
  return new Date(appt.starts_at).getTime() - now.getTime() >= minHours * 3600 * 1000;
}

const ACTIVE = new Set(["scheduled", "confirmed", "arrived", "in_treatment"]);

/** Sépare les rendez-vous à venir (triés du plus proche) de l'historique (du plus récent). */
export function splitAppointments<T extends { status: string; starts_at: string; ends_at: string }>(
  list: T[],
  now: Date = new Date(),
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const a of list) {
    (ACTIVE.has(a.status) && new Date(a.ends_at).getTime() > now.getTime() ? upcoming : past).push(a);
  }
  upcoming.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  past.sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { upcoming, past };
}

const intl = (locale: string) => (locale === "fr" ? "fr-FR" : "en-GB");

/** « lun. » / « 27 oct. » pour une date AAAA-MM-JJ (déjà locale : pas de fuseau). */
export function shortDayLabel(dateISO: string, locale: string): { weekday: string; day: string } {
  const d = new Date(`${dateISO}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat(intl(locale), { weekday: "short", timeZone: "UTC" }).format(d),
    day: new Intl.DateTimeFormat(intl(locale), { day: "numeric", month: "short", timeZone: "UTC" }).format(d),
  };
}

/** « lundi 27 octobre 2026 » pour un instant, dans le fuseau du cabinet. */
export function longDate(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(intl(locale), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(
    new Date(iso),
  );
}

/** « Dr {name} », sans doubler le titre si le nom affiché le contient déjà. */
export function doctorLabel(name: string, t: (key: string, vars?: Record<string, string>) => string): string {
  return /^(dr|docteur|doctor)\b\.?/i.test(name.trim()) ? name.trim() : t("portal.prescriptions.by", { name });
}

/** « 224620000000 » (format Supabase Auth) -> « +224620000000 ». */
export function authPhoneToE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}
