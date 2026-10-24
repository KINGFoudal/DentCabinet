/** Horaires d'ouverture : {"1": [["08:00","12:00"],["14:00","18:00"]], ...} ; 1 = lundi ... 7 = dimanche. */

export type Range = [string, string];
export type OpeningHours = Record<string, Range[]>;
export const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lit la valeur JSON stockée en tolérant les données mal formées. */
export function parseOpeningHours(value: unknown): OpeningHours {
  const out: OpeningHours = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const day of WEEKDAYS) {
    const ranges = (value as Record<string, unknown>)[day];
    if (!Array.isArray(ranges)) continue;
    const valid = ranges.filter(
      (r): r is Range => Array.isArray(r) && r.length === 2 && typeof r[0] === "string" && typeof r[1] === "string",
    );
    if (valid.length) out[day] = valid.map((r) => [r[0], r[1]]);
  }
  return out;
}

/** Plages valides : format HH:MM, fin après début, sans chevauchement. */
export function rangesValid(ranges: Range[]) {
  const sorted = [...ranges].sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 0; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (!TIME.test(s) || !TIME.test(e) || e <= s) return false;
    if (i > 0 && s < sorted[i - 1][1]) return false;
  }
  return true;
}

/** Nettoie avant enregistrement : jours sans plage retirés, plages triées. */
export function normalizeOpeningHours(h: OpeningHours): OpeningHours {
  const out: OpeningHours = {};
  for (const day of WEEKDAYS) {
    const ranges = h[day];
    if (ranges?.length) out[day] = [...ranges].sort((a, b) => a[0].localeCompare(b[0]));
  }
  return out;
}

export function invalidDays(h: OpeningHours) {
  return WEEKDAYS.filter((d) => h[d]?.length && !rangesValid(h[d]));
}
