/**
 * Calculs purs de l'agenda : plages de dates, positions dans la grille, chevauchements,
 * glisser-déposer (pas de 15 min), disponibilités (horaires, absences).
 * Les « minutes » sont comptées depuis minuit, heure locale du cabinet.
 */
import { addDays, dayBounds } from "@/lib/dates";

export type View = "day" | "week" | "month";
export const SNAP_MINUTES = 15;
export const DAY_MINUTES = 24 * 60;

/** Statuts qui n'occupent plus le créneau (miroir des contraintes d'exclusion). */
export const INACTIVE_STATUSES = ["cancelled", "no_show"] as const;
export const ACTIVE_STATUSES = ["scheduled", "confirmed", "arrived", "in_treatment", "done"] as const;
export const ALL_STATUSES = [...ACTIVE_STATUSES, ...INACTIVE_STATUSES] as const;
export type Status = (typeof ALL_STATUSES)[number];

export function isActiveStatus(status: string) {
  return !(INACTIVE_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** 1 = lundi ... 7 = dimanche. */
export function isoWeekday(dateISO: string) {
  return ((new Date(`${dateISO}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export function startOfWeek(dateISO: string) {
  return addDays(dateISO, 1 - isoWeekday(dateISO));
}

export function startOfMonth(dateISO: string) {
  return dateISO.slice(0, 8) + "01";
}

export function addMonths(dateISO: string, n: number) {
  const d = new Date(`${startOfMonth(dateISO)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Jours affichés par une vue (le mois est complété en semaines entières, lundi en tête). */
export function viewDays(view: View, dateISO: string): string[] {
  if (view === "day") return [dateISO];
  if (view === "week") {
    const s = startOfWeek(dateISO);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const first = startOfMonth(dateISO);
  const start = startOfWeek(first);
  const nextMonth = addMonths(first, 1);
  const days: string[] = [];
  for (let d = start; d < nextMonth || isoWeekday(d) !== 1; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Bornes UTC [début, fin[ couvrant les jours de la vue. */
export function viewRange(view: View, dateISO: string, timeZone: string): [string, string] {
  const days = viewDays(view, dateISO);
  return [dayBounds(days[0], timeZone)[0], dayBounds(days[days.length - 1], timeZone)[1]];
}

export function shiftDate(view: View, dateISO: string, dir: -1 | 1) {
  if (view === "day") return addDays(dateISO, dir);
  if (view === "week") return addDays(dateISO, 7 * dir);
  return addMonths(dateISO, dir);
}

/** Minutes depuis minuit local du jour `dateISO` (peut être < 0 ou > 1440). */
export function isoToMinutes(iso: string, dateISO: string, timeZone: string) {
  const [start] = dayBounds(dateISO, timeZone);
  return Math.round((new Date(iso).getTime() - new Date(start).getTime()) / 60000);
}

export function minutesToISO(dateISO: string, minutes: number, timeZone: string) {
  const [start] = dayBounds(dateISO, timeZone);
  return new Date(new Date(start).getTime() + minutes * 60000).toISOString();
}

/** « 08:30 » -> 510 */
export function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHHMM(min: number) {
  const m = ((Math.round(min) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Jour local (AAAA-MM-JJ) d'un instant. */
export function localDay(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Grille
// ---------------------------------------------------------------------------

export function snap(minutes: number, step = SNAP_MINUTES) {
  return Math.round(minutes / step) * step;
}

/** Plage horaire affichée : 7 h - 20 h par défaut, élargie aux horaires et aux RDV. */
export function displayHours(intervals: [number, number][], defaults: [number, number] = [7 * 60, 20 * 60]): [number, number] {
  let [from, to] = defaults;
  for (const [s, e] of intervals) {
    from = Math.min(from, Math.floor(Math.max(0, s) / 60) * 60);
    to = Math.max(to, Math.ceil(Math.min(DAY_MINUTES, e) / 60) * 60);
  }
  return [from, to];
}

export type LaidOut = { lane: number; lanes: number };

/**
 * Répartit les RDV qui se chevauchent dans des colonnes (« couloirs ») côte à côte.
 * Les RDV d'un même groupe de chevauchement partagent le même nombre de couloirs.
 */
export function layoutLanes(events: { id: string; start: number; end: number }[]): Map<string, LaidOut> {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = new Map<string, LaidOut>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const e of sorted) {
    if (e.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= e.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e.end);
    } else laneEnds[lane] = e.end;
    cluster.push({ id: e.id, lane });
    clusterEnd = Math.max(clusterEnd === -Infinity ? e.end : clusterEnd, e.end);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Glisser-déposer
// ---------------------------------------------------------------------------

export type DragMode = "move" | "resize";

/**
 * Nouvelle position après un déplacement vertical de `deltaMinutes`.
 * move : la durée est conservée, le début est aligné sur le pas ;
 * resize : la fin est alignée sur le pas, durée minimale = un pas.
 */
export function applyDrag(
  ev: { start: number; end: number },
  deltaMinutes: number,
  mode: DragMode,
  bounds: [number, number] = [0, DAY_MINUTES],
  step = SNAP_MINUTES,
): { start: number; end: number } {
  if (mode === "move") {
    const duration = ev.end - ev.start;
    let start = snap(ev.start + deltaMinutes, step);
    start = Math.max(bounds[0], Math.min(start, bounds[1] - duration));
    return { start, end: start + duration };
  }
  let end = snap(ev.end + deltaMinutes, step);
  end = Math.max(ev.start + step, Math.min(end, bounds[1]));
  return { start: ev.start, end };
}

/** Pixels -> minutes pour une grille où une heure fait `hourPx` pixels. */
export function pxToMinutes(px: number, hourPx: number) {
  return (px / hourPx) * 60;
}

// ---------------------------------------------------------------------------
// Chevauchements
// ---------------------------------------------------------------------------

export type Slot = {
  id?: string;
  dentist_id: string;
  chair_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  deleted_at?: string | null;
};

export type Conflict<T extends Slot> = { appointment: T; reason: "dentist" | "chair" };

export function overlaps(a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }) {
  return new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);
}

/**
 * RDV actifs en conflit avec `candidate` (même praticien ou même fauteuil, créneaux qui se recouvrent).
 * Même règle que les contraintes d'exclusion de la base.
 */
export function findConflicts<T extends Slot>(candidate: Slot, others: T[]): Conflict<T>[] {
  if (candidate.deleted_at || !isActiveStatus(candidate.status)) return [];
  const out: Conflict<T>[] = [];
  for (const o of others) {
    if (o.id && o.id === candidate.id) continue;
    if (o.deleted_at || !isActiveStatus(o.status) || !overlaps(candidate, o)) continue;
    if (o.dentist_id === candidate.dentist_id) out.push({ appointment: o, reason: "dentist" });
    else if (candidate.chair_id && o.chair_id === candidate.chair_id) out.push({ appointment: o, reason: "chair" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Disponibilités
// ---------------------------------------------------------------------------

export type OpeningHours = Record<string, [string, string][]>;
export type ScheduleRow = { dentist_id: string; weekday: number; start_time: string; end_time: string; deleted_at: string | null };
export type TimeOffRow = { dentist_id: string | null; starts_at: string; ends_at: string; deleted_at: string | null; reason?: string | null };

export type AvailabilityCtx = {
  timeZone: string;
  openingHours: OpeningHours | null | undefined;
  schedules: ScheduleRow[];
  timeOff: TimeOffRow[];
};

function hasOpeningHours(oh: OpeningHours | null | undefined): oh is OpeningHours {
  return !!oh && typeof oh === "object" && Object.values(oh).some((v) => Array.isArray(v) && v.length > 0);
}

/**
 * Intervalles de travail [début, fin] (minutes) d'un jour : horaires du praticien s'il en a,
 * sinon heures d'ouverture du cabinet ; null = pas d'information (toute la journée ouverte).
 */
export function workingIntervals(dateISO: string, dentistId: string | null, ctx: AvailabilityCtx): [number, number][] | null {
  const wd = isoWeekday(dateISO);
  if (dentistId) {
    const own = ctx.schedules.filter((s) => s.dentist_id === dentistId && !s.deleted_at);
    if (own.length) {
      return own
        .filter((s) => s.weekday === wd)
        .map((s) => [hhmmToMinutes(s.start_time), hhmmToMinutes(s.end_time)] as [number, number])
        .sort((a, b) => a[0] - b[0]);
    }
  }
  if (hasOpeningHours(ctx.openingHours)) {
    return (ctx.openingHours[String(wd)] ?? [])
      .map(([s, e]) => [hhmmToMinutes(s), hhmmToMinutes(e)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
  }
  return null;
}

/** Absences (du praticien ou de tout le cabinet) qui touchent le jour, en minutes bornées à la journée. */
export function timeOffIntervals(dateISO: string, dentistId: string | null, ctx: AvailabilityCtx) {
  const [ds, de] = dayBounds(dateISO, ctx.timeZone);
  return ctx.timeOff
    .filter((t) => !t.deleted_at && (t.dentist_id === null || t.dentist_id === dentistId))
    .filter((t) => overlaps(t, { starts_at: ds, ends_at: de }))
    .map((t) => ({
      start: Math.max(0, isoToMinutes(t.starts_at, dateISO, ctx.timeZone)),
      end: Math.min(DAY_MINUTES, isoToMinutes(t.ends_at, dateISO, ctx.timeZone)),
      reason: t.reason ?? null,
    }));
}

/** Plages grisées : hors horaires + absences. */
export function unavailableIntervals(dateISO: string, dentistId: string | null, ctx: AvailabilityCtx) {
  const out: { start: number; end: number; kind: "closed" | "off"; reason?: string | null }[] = [];
  const work = workingIntervals(dateISO, dentistId, ctx);
  if (work) {
    let cursor = 0;
    for (const [s, e] of work) {
      if (s > cursor) out.push({ start: cursor, end: s, kind: "closed" });
      cursor = Math.max(cursor, e);
    }
    if (cursor < DAY_MINUTES) out.push({ start: cursor, end: DAY_MINUTES, kind: "closed" });
  }
  for (const t of timeOffIntervals(dateISO, dentistId, ctx)) out.push({ ...t, kind: "off" });
  return out;
}

export type AvailabilityWarning = "outside_hours" | "time_off";

/** Avertissements (non bloquants) pour un créneau : hors horaires, pendant une absence. */
export function availabilityWarnings(
  slot: { dentist_id: string; starts_at: string; ends_at: string },
  ctx: AvailabilityCtx,
): AvailabilityWarning[] {
  const warnings: AvailabilityWarning[] = [];
  const day = localDay(slot.starts_at, ctx.timeZone);
  const s = isoToMinutes(slot.starts_at, day, ctx.timeZone);
  const e = isoToMinutes(slot.ends_at, day, ctx.timeZone);
  const work = workingIntervals(day, slot.dentist_id, ctx);
  if (work && !work.some(([ws, we]) => s >= ws && e <= we)) warnings.push("outside_hours");
  if (ctx.timeOff.some((t) => !t.deleted_at && (t.dentist_id === null || t.dentist_id === slot.dentist_id) && overlaps(t, slot))) {
    warnings.push("time_off");
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Statuts : actions rapides
// ---------------------------------------------------------------------------

/** Transitions proposées depuis un statut. */
export function nextStatuses(status: string): Status[] {
  switch (status) {
    case "scheduled":
      return ["confirmed", "arrived", "no_show", "cancelled"];
    case "confirmed":
      return ["arrived", "no_show", "cancelled"];
    case "arrived":
      return ["in_treatment", "done", "no_show"];
    case "in_treatment":
      return ["done"];
    case "done":
      return ["in_treatment"];
    case "cancelled":
    case "no_show":
      return ["scheduled"];
    default:
      return [];
  }
}

/** Champs à écrire pour un changement de statut (heure d'arrivée). */
export function statusPatch(status: Status, current: { arrived_at: string | null }, now = new Date()) {
  const patch: { status: Status; arrived_at?: string | null } = { status };
  if ((status === "arrived" || status === "in_treatment" || status === "done") && !current.arrived_at) {
    patch.arrived_at = now.toISOString();
  }
  if (status === "scheduled" || status === "confirmed") patch.arrived_at = null;
  return patch;
}

/** Minutes d'attente depuis l'arrivée. */
export function waitingMinutes(arrivedAt: string | null, now = new Date()) {
  if (!arrivedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(arrivedAt).getTime()) / 60000));
}

export function statusTone(status: string): "neutral" | "primary" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "confirmed":
      return "success";
    case "arrived":
      return "warning";
    case "in_treatment":
      return "info";
    case "done":
      return "primary";
    case "cancelled":
    case "no_show":
      return "danger";
    default:
      return "neutral";
  }
}
