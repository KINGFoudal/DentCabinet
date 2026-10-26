/**
 * Logique pure des rappels (aucune dépendance Deno ni réseau) : partagée entre les
 * Edge Functions et l'interface (aperçu des modèles), testée avec vitest.
 */

export type ReminderKind = "reminder_day_before" | "reminder_same_day";
export type MessageKind = ReminderKind | "booking_confirmation" | "otp";
export type Channel = "whatsapp" | "email" | "sms";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export const TEMPLATE_VARIABLES = [
  "patient_name",
  "cabinet_name",
  "date",
  "time",
  "dentist_name",
  "cabinet_phone",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string>>;

/** Statuts pour lesquels un rendez-vous est encore « actif » (rappel utile). */
export const REMINDABLE_STATUSES = ["scheduled", "confirmed"];

/** Heure locale (cabinet) d'envoi du rappel de la veille. */
export const DAY_BEFORE_HOUR = 18;
/** Délai du rappel du jour même avant le rendez-vous. */
export const SAME_DAY_LEAD_MS = 2 * 3600 * 1000;
/** Pas d'envoi le jour même avant cette heure locale. */
export const SAME_DAY_EARLIEST_HOUR = 7;
/** Nombre maximum de tentatives pour un même rappel. */
export const MAX_ATTEMPTS = 3;
/**
 * Une ligne restée « queued » plus longtemps que ce délai vient d'une exécution interrompue
 * (délai dépassé, plantage) : elle est traitée comme un échec, donc retentée.
 */
export const QUEUED_STALE_MS = 15 * 60 * 1000;

/** Remplace {{variable}} (espaces tolérés) ; une variable inconnue ou absente devient vide. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body
    .replace(/\\n/g, "\n")
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, name: string) => (vars as Record<string, string | undefined>)[name] ?? "");
}

/** Variables utilisées par un modèle qui ne font pas partie de la liste connue. */
export function unknownVariables(body: string): string[] {
  const found = [...body.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v)))];
}

// ---------------------------------------------------------------------------
// Fuseaux horaires
// ---------------------------------------------------------------------------

/** Décalage (ms) entre le fuseau et UTC à l'instant donné. */
export function tzOffsetMs(at: Date, timeZone: string): number {
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

/** Date locale AAAA-MM-JJ d'un instant dans le fuseau. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Instant UTC correspondant à « dateISO hh:mm » heure locale du fuseau. */
export function zonedTime(dateISO: string, hhmm: string, timeZone: string): Date {
  const naive = new Date(`${dateISO}T${hhmm.length === 5 ? hhmm + ":00" : hhmm}Z`);
  const offset = tzOffsetMs(naive, timeZone);
  const guess = new Date(naive.getTime() - offset);
  // Second passage pour les changements d'heure.
  const offset2 = tzOffsetMs(guess, timeZone);
  return offset2 === offset ? guess : new Date(naive.getTime() - offset2);
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Fenêtre [début, fin[ pendant laquelle un rappel doit partir.
 * - veille : de 18 h (heure du cabinet) la veille jusqu'à minuit ;
 * - jour même : 2 h avant le RDV (pas avant 7 h), jusqu'au début du RDV.
 * Renvoie null si la fenêtre est vide.
 */
export function reminderWindow(startsAt: Date, kind: ReminderKind, timeZone: string): [Date, Date] | null {
  const day = localDate(startsAt, timeZone);
  if (kind === "reminder_day_before") {
    const from = zonedTime(addDaysISO(day, -1), `${pad(DAY_BEFORE_HOUR)}:00`, timeZone);
    const midnight = zonedTime(day, "00:00", timeZone);
    const to = midnight < startsAt ? midnight : startsAt;
    return from < to ? [from, to] : null;
  }
  const earliest = zonedTime(day, `${pad(SAME_DAY_EARLIEST_HOUR)}:00`, timeZone);
  const lead = new Date(startsAt.getTime() - SAME_DAY_LEAD_MS);
  const from = lead > earliest ? lead : earliest;
  return from < startsAt ? [from, startsAt] : null;
}

export function isReminderDue(startsAt: Date, kind: ReminderKind, now: Date, timeZone: string): boolean {
  const w = reminderWindow(startsAt, kind, timeZone);
  return !!w && now >= w[0] && now < w[1];
}

/** Plage de rendez-vous à examiner à un instant donné (couvre les deux types de rappel). */
export function candidateRange(now: Date): [Date, Date] {
  return [now, new Date(now.getTime() + 32 * 3600 * 1000)];
}

// ---------------------------------------------------------------------------
// Sélection des envois
// ---------------------------------------------------------------------------

export type ReminderAppointment = {
  id: string;
  cabinet_id: string;
  patient_id: string | null;
  dentist_id: string;
  starts_at: string;
  status: string;
  deleted_at: string | null;
};
export type ReminderPatient = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  whatsapp_opt_in: boolean;
  deleted_at?: string | null;
};
export type ReminderCabinet = {
  id: string;
  name: string;
  phone: string | null;
  timezone: string;
  locale: string;
};
export type ReminderTemplate = {
  cabinet_id: string;
  kind: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  enabled: boolean;
  deleted_at?: string | null;
};
export type ExistingLog = {
  id: string;
  appointment_id: string | null;
  kind: string;
  channel: string;
  status: string;
  attempts: number;
  updated_at?: string | null;
};

/** Ligne « queued » abandonnée par une exécution interrompue. */
export function isStaleQueued(log: Pick<ExistingLog, "status" | "updated_at">, now: Date): boolean {
  if (log.status !== "queued" || !log.updated_at) return false;
  const at = new Date(log.updated_at).getTime();
  return Number.isFinite(at) && now.getTime() - at > QUEUED_STALE_MS;
}

/** Un rappel déjà journalisé peut-il être retenté ? (échec, ou « queued » abandonné) */
export function isRetryable(log: ExistingLog, now: Date): boolean {
  if (log.attempts >= MAX_ATTEMPTS) return false;
  return log.status === "failed" || isStaleQueued(log, now);
}

/** Lignes « queued » abandonnées qui ne seront plus retentées : à passer en « failed ». */
export function abandonedLogs(logs: ExistingLog[], now: Date): ExistingLog[] {
  return logs.filter((l) => isStaleQueued(l, now) && l.attempts >= MAX_ATTEMPTS);
}

export type ReminderJob = {
  appointment_id: string;
  cabinet_id: string;
  patient_id: string;
  kind: ReminderKind;
  channel: "whatsapp" | "email";
  recipient: string;
  locale: string;
  subject: string | null;
  body: string;
  vars: TemplateVars;
  /**
   * Ligne existante à réessayer (sinon nouvelle ligne) : la réservation est conditionnée à
   * son état lu (statut, tentatives, date de mise à jour) pour éviter un double envoi.
   */
  retry?: { id: string; attempts: number; status: string; updated_at: string | null };
};

export function formatDateLong(at: Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", { dateStyle: "full", timeZone }).format(at);
}

export function formatHour(at: Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
}

export function patientDisplayName(p: { first_name: string; last_name: string }) {
  return `${p.first_name} ${p.last_name}`.trim();
}

/** Choisit le modèle (langue du cabinet, sinon français). */
export function pickTemplate(
  templates: ReminderTemplate[],
  cabinetId: string,
  kind: string,
  channel: string,
  locale: string,
): ReminderTemplate | null {
  const usable = templates.filter((t) => t.cabinet_id === cabinetId && t.kind === kind && t.channel === channel && !t.deleted_at);
  const t = usable.find((x) => x.locale === locale) ?? usable.find((x) => x.locale === "fr") ?? null;
  return t && t.enabled ? t : null;
}

const WHATSAPP_RE = /^\+\d{8,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function selectReminders(input: {
  now: Date;
  appointments: ReminderAppointment[];
  patients: ReminderPatient[];
  cabinets: ReminderCabinet[];
  templates: ReminderTemplate[];
  logs: ExistingLog[];
  dentistNames: Record<string, string>;
}): ReminderJob[] {
  const patients = new Map(input.patients.map((p) => [p.id, p]));
  const cabinets = new Map(input.cabinets.map((c) => [c.id, c]));
  const logs = new Map(input.logs.filter((l) => l.appointment_id).map((l) => [`${l.appointment_id}|${l.kind}|${l.channel}`, l]));
  const jobs: ReminderJob[] = [];

  for (const a of input.appointments) {
    if (a.deleted_at || !REMINDABLE_STATUSES.includes(a.status) || !a.patient_id) continue;
    const patient = patients.get(a.patient_id);
    const cabinet = cabinets.get(a.cabinet_id);
    if (!patient || patient.deleted_at || !cabinet) continue;
    const startsAt = new Date(a.starts_at);
    const tz = cabinet.timezone || "Africa/Conakry";
    const locale = cabinet.locale === "en" ? "en" : "fr";

    // Rappel de la veille prioritaire si les deux fenêtres se recouvrent (RDV très matinal).
    const kinds: ReminderKind[] = ["reminder_day_before", "reminder_same_day"];
    const kind = kinds.find((k) => isReminderDue(startsAt, k, input.now, tz));
    if (!kind) continue;

    const vars: TemplateVars = {
      patient_name: patientDisplayName(patient),
      cabinet_name: cabinet.name,
      date: formatDateLong(startsAt, locale, tz),
      time: formatHour(startsAt, locale, tz),
      dentist_name: input.dentistNames[a.dentist_id] ?? "",
      cabinet_phone: cabinet.phone ?? "",
    };

    const channels: { channel: "whatsapp" | "email"; recipient: string | null }[] = [
      { channel: "whatsapp", recipient: patient.whatsapp_opt_in && patient.phone && WHATSAPP_RE.test(patient.phone) ? patient.phone : null },
      { channel: "email", recipient: patient.email && EMAIL_RE.test(patient.email.trim()) ? patient.email.trim() : null },
    ];
    for (const { channel, recipient } of channels) {
      if (!recipient) continue;
      const tpl = pickTemplate(input.templates, a.cabinet_id, kind, channel, locale);
      if (!tpl) continue;
      const existing = logs.get(`${a.id}|${kind}|${channel}`);
      if (existing && !isRetryable(existing, input.now)) continue;
      jobs.push({
        appointment_id: a.id,
        cabinet_id: a.cabinet_id,
        patient_id: patient.id,
        kind,
        channel,
        recipient,
        locale: tpl.locale,
        subject: tpl.subject ? renderTemplate(tpl.subject, vars) : null,
        body: renderTemplate(tpl.body, vars),
        vars,
        retry: existing
          ? { id: existing.id, attempts: existing.attempts, status: existing.status, updated_at: existing.updated_at ?? null }
          : undefined,
      });
    }
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// WhatsApp : contraintes des paramètres de modèle
// ---------------------------------------------------------------------------

/**
 * Un paramètre texte de modèle WhatsApp ne peut contenir ni retour à la ligne, ni tabulation,
 * ni plus de 4 espaces consécutifs. On aplatit le texte et on le tronque.
 */
export function whatsappParam(text: string, max = 900): string {
  const flat = text.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/** Numéro E.164 -> format attendu par l'API WhatsApp (chiffres seulement). */
export function whatsappRecipient(e164: string): string {
  return e164.replace(/\D/g, "");
}

/** Filtre PostgREST de réservation d'une ligne à réessayer (mise à jour conditionnelle). */
export function retryReservationFilter(retry: NonNullable<ReminderJob["retry"]>): string {
  const base = `id=eq.${retry.id}&status=eq.${retry.status}&attempts=eq.${retry.attempts}`;
  return retry.status === "queued" && retry.updated_at ? `${base}&updated_at=eq.${encodeURIComponent(retry.updated_at)}` : base;
}
