import { CABINET_TIMEZONE } from "@/lib/format";

/** Date du jour (AAAA-MM-JJ) dans le fuseau du cabinet. */
export function todayISO(timeZone = CABINET_TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Bornes UTC [début, fin[ d'une journée locale.
 * Africa/Conakry est en UTC+0 toute l'année, mais le calcul reste correct pour un autre fuseau.
 */
export function dayBounds(dateISO: string, timeZone = CABINET_TIMEZONE): [string, string] {
  const offsetMs = tzOffsetMs(new Date(`${dateISO}T12:00:00Z`), timeZone);
  const start = new Date(new Date(`${dateISO}T00:00:00Z`).getTime() - offsetMs);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return [start.toISOString(), end.toISOString()];
}

/** Décalage (ms) entre le fuseau donné et UTC à l'instant donné. */
export function tzOffsetMs(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUTC - Math.floor(at.getTime() / 1000) * 1000;
}

export function addDays(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
