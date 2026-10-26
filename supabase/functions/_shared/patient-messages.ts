/**
 * Gabarits des messages WhatsApp aux patients : un seul jeu de textes pour l'envoi manuel
 * (lien wa.me depuis l'application) et l'envoi automatique (Edge Function send-reminders).
 * Logique pure (aucune dépendance Deno ni réseau), testée avec vitest.
 *
 * Le cabinet peut personnaliser chaque texte (table message_templates, canal whatsapp) ;
 * sans personnalisation, le texte par défaut ci-dessous (fr ou en) s'applique.
 */

export type Lang = "fr" | "en";

/** Types de messages patients (valeurs de public.message_kind). */
export const PATIENT_MESSAGE_KINDS = [
  "booking_confirmation",
  "reminder_day_before",
  "reminder_same_day",
  "appointment_moved",
  "appointment_cancelled",
  "appointment_missed",
  "dentist_late",
  "invoice_issued",
  "payment_reminder",
  "payment_received",
  "installment_due",
  "checkup_reminder",
] as const;
export type PatientMessageKind = (typeof PATIENT_MESSAGE_KINDS)[number];

/** Messages proposés selon l'endroit d'où l'on envoie. */
export const MESSAGE_CONTEXTS = {
  appointment: [
    "booking_confirmation",
    "reminder_day_before",
    "reminder_same_day",
    "appointment_moved",
    "appointment_cancelled",
    "appointment_missed",
    "dentist_late",
  ],
  invoice: ["invoice_issued", "payment_reminder", "payment_received", "installment_due"],
  patient: ["checkup_reminder"],
} as const satisfies Record<string, readonly PatientMessageKind[]>;

export const PATIENT_MESSAGE_VARIABLES = [
  "patient_first_name",
  "patient_name",
  "cabinet_name",
  "cabinet_address",
  "cabinet_phone",
  "date",
  "time",
  "dentist_name",
  "invoice_number",
  "invoice_total",
  "invoice_balance",
  "amount_paid",
  "installment_amount",
  "installment_date",
] as const;
export type PatientMessageVariable = (typeof PATIENT_MESSAGE_VARIABLES)[number];
export type PatientMessageVars = Partial<Record<PatientMessageVariable, string>>;

const CABINET_VARS: PatientMessageVariable[] = ["patient_first_name", "patient_name", "cabinet_name", "cabinet_address", "cabinet_phone"];
const APPOINTMENT_VARS: PatientMessageVariable[] = [...CABINET_VARS, "date", "time", "dentist_name"];
const INVOICE_VARS: PatientMessageVariable[] = [...CABINET_VARS, "invoice_number", "invoice_total", "invoice_balance"];

/** Variables utilisables dans chaque type de message. */
export const VARIABLES_BY_KIND: Record<PatientMessageKind, PatientMessageVariable[]> = {
  booking_confirmation: APPOINTMENT_VARS,
  reminder_day_before: APPOINTMENT_VARS,
  reminder_same_day: APPOINTMENT_VARS,
  appointment_moved: APPOINTMENT_VARS,
  appointment_cancelled: APPOINTMENT_VARS,
  appointment_missed: APPOINTMENT_VARS,
  dentist_late: APPOINTMENT_VARS,
  invoice_issued: INVOICE_VARS,
  payment_reminder: INVOICE_VARS,
  payment_received: [...INVOICE_VARS, "amount_paid"],
  installment_due: [...INVOICE_VARS, "installment_amount", "installment_date"],
  checkup_reminder: CABINET_VARS,
};

const PAY_FR = "Paiement : espèces au cabinet, Orange Money ou MTN Mobile Money.";
const PAY_EN = "Payment: cash at the practice, Orange Money or MTN Mobile Money.";

/**
 * Textes par défaut. Règle de rendu : une ligne dont une variable est vide est retirée
 * (ex. « Adresse : … » si le cabinet n'a pas d'adresse).
 */
export const DEFAULT_TEXTS: Record<PatientMessageKind, Record<Lang, string>> = {
  booking_confirmation: {
    fr: "Bonjour {{patient_first_name}},\nVotre rendez-vous chez {{cabinet_name}} est confirmé le {{date}} à {{time}}.\nPraticien : {{dentist_name}}\nAdresse : {{cabinet_address}}\nPour modifier ou annuler : {{cabinet_phone}}\nÀ bientôt !",
    en: "Hello {{patient_first_name}},\nYour appointment at {{cabinet_name}} is confirmed for {{date}} at {{time}}.\nDentist: {{dentist_name}}\nAddress: {{cabinet_address}}\nTo change or cancel: {{cabinet_phone}}\nSee you soon!",
  },
  reminder_day_before: {
    fr: "Bonjour {{patient_first_name}},\nRappel : vous avez rendez-vous demain, {{date}} à {{time}}, chez {{cabinet_name}}.\nPraticien : {{dentist_name}}\nAdresse : {{cabinet_address}}\nEn cas d'empêchement : {{cabinet_phone}}",
    en: "Hello {{patient_first_name}},\nReminder: you have an appointment tomorrow, {{date}} at {{time}}, at {{cabinet_name}}.\nDentist: {{dentist_name}}\nAddress: {{cabinet_address}}\nIf you cannot come: {{cabinet_phone}}",
  },
  reminder_same_day: {
    fr: "Bonjour {{patient_first_name}},\nNous vous attendons aujourd'hui à {{time}} chez {{cabinet_name}}.\nAdresse : {{cabinet_address}}\nEn cas d'empêchement : {{cabinet_phone}}",
    en: "Hello {{patient_first_name}},\nWe look forward to seeing you today at {{time}} at {{cabinet_name}}.\nAddress: {{cabinet_address}}\nIf you cannot come: {{cabinet_phone}}",
  },
  appointment_moved: {
    fr: "Bonjour {{patient_first_name}},\nVotre rendez-vous chez {{cabinet_name}} a été déplacé au {{date}} à {{time}}.\nPraticien : {{dentist_name}}\nAdresse : {{cabinet_address}}\nSi ce créneau ne vous convient pas : {{cabinet_phone}}",
    en: "Hello {{patient_first_name}},\nYour appointment at {{cabinet_name}} has been moved to {{date}} at {{time}}.\nDentist: {{dentist_name}}\nAddress: {{cabinet_address}}\nIf this time does not suit you: {{cabinet_phone}}",
  },
  appointment_cancelled: {
    fr: "Bonjour {{patient_first_name}},\nVotre rendez-vous chez {{cabinet_name}} du {{date}} à {{time}} est annulé.\nPour reprendre rendez-vous : {{cabinet_phone}}",
    en: "Hello {{patient_first_name}},\nYour appointment at {{cabinet_name}} on {{date}} at {{time}} has been cancelled.\nTo book a new appointment: {{cabinet_phone}}",
  },
  appointment_missed: {
    fr: "Bonjour {{patient_first_name}},\nNous ne vous avons pas vu à votre rendez-vous du {{date}} à {{time}} chez {{cabinet_name}}.\nNous pouvons vous proposer un nouveau rendez-vous : répondez simplement à ce message.\nTéléphone du cabinet : {{cabinet_phone}}",
    en: "Hello {{patient_first_name}},\nWe missed you at your appointment on {{date}} at {{time}} at {{cabinet_name}}.\nWe can offer you a new appointment: simply reply to this message.\nPractice phone: {{cabinet_phone}}",
  },
  dentist_late: {
    fr: "Bonjour {{patient_first_name}},\nVotre praticien a un peu de retard aujourd'hui : votre rendez-vous de {{time}} chez {{cabinet_name}} commencera avec quelques minutes de décalage.\nMerci de votre patience.",
    en: "Hello {{patient_first_name}},\nYour dentist is running a little late today: your {{time}} appointment at {{cabinet_name}} will start a few minutes later.\nThank you for your patience.",
  },
  invoice_issued: {
    fr: `Bonjour {{patient_first_name}},\nVoici votre facture {{invoice_number}} de {{cabinet_name}}.\nMontant total : {{invoice_total}}\nReste à payer : {{invoice_balance}}\n${PAY_FR}\nPour toute question : {{cabinet_phone}}\nMerci de votre confiance.`,
    en: `Hello {{patient_first_name}},\nHere is your invoice {{invoice_number}} from {{cabinet_name}}.\nTotal amount: {{invoice_total}}\nBalance due: {{invoice_balance}}\n${PAY_EN}\nAny question: {{cabinet_phone}}\nThank you for your trust.`,
  },
  payment_reminder: {
    fr: `Bonjour {{patient_first_name}},\nPetit rappel : il reste {{invoice_balance}} à régler sur la facture {{invoice_number}} de {{cabinet_name}}.\n${PAY_FR}\nPour toute question : {{cabinet_phone}}\nMerci.`,
    en: `Hello {{patient_first_name}},\nA gentle reminder: {{invoice_balance}} remains to be paid on invoice {{invoice_number}} from {{cabinet_name}}.\n${PAY_EN}\nAny question: {{cabinet_phone}}\nThank you.`,
  },
  payment_received: {
    fr: "Bonjour {{patient_first_name}},\n{{cabinet_name}} a bien reçu votre paiement de {{amount_paid}} pour la facture {{invoice_number}}.\nReste à payer : {{invoice_balance}}\nMerci de votre confiance.",
    en: "Hello {{patient_first_name}},\n{{cabinet_name}} has received your payment of {{amount_paid}} for invoice {{invoice_number}}.\nBalance due: {{invoice_balance}}\nThank you for your trust.",
  },
  installment_due: {
    fr: `Bonjour {{patient_first_name}},\nVotre prochaine échéance de {{installment_amount}} pour la facture {{invoice_number}} de {{cabinet_name}} est prévue le {{installment_date}}.\nReste à payer au total : {{invoice_balance}}\n${PAY_FR}\nMerci.`,
    en: `Hello {{patient_first_name}},\nYour next instalment of {{installment_amount}} for invoice {{invoice_number}} from {{cabinet_name}} is due on {{installment_date}}.\nTotal balance due: {{invoice_balance}}\n${PAY_EN}\nThank you.`,
  },
  checkup_reminder: {
    fr: "Bonjour {{patient_first_name}},\nIl est temps de faire votre contrôle dentaire (détartrage, visite de suivi) chez {{cabinet_name}}.\nPrenez rendez-vous en répondant à ce message.\nTéléphone : {{cabinet_phone}}\nAdresse : {{cabinet_address}}",
    en: "Hello {{patient_first_name}},\nIt is time for your dental check-up (scaling, follow-up visit) at {{cabinet_name}}.\nBook an appointment by replying to this message.\nPhone: {{cabinet_phone}}\nAddress: {{cabinet_address}}",
  },
};

/**
 * Anciens textes par défaut créés avec chaque cabinet (migration initiale) : traités comme
 * « non personnalisés », donc remplacés par le texte par défaut actuel.
 */
export const LEGACY_DEFAULTS: Partial<Record<PatientMessageKind, string[]>> = {
  booking_confirmation: [
    "Bonjour {{patient_name}}, votre rendez-vous du {{date}} à {{time}} au {{cabinet_name}} est enregistré.",
  ],
};

export function isPatientMessageKind(kind: string): kind is PatientMessageKind {
  return (PATIENT_MESSAGE_KINDS as readonly string[]).includes(kind);
}

export const langOf = (locale: string | null | undefined): Lang => (locale === "en" ? "en" : "fr");

export function defaultText(kind: PatientMessageKind, locale: string): string {
  return DEFAULT_TEXTS[kind][langOf(locale)];
}

export type TemplateRow = {
  cabinet_id: string;
  kind: string;
  channel: string;
  locale: string;
  body: string;
  enabled: boolean;
  deleted_at?: string | null;
};

/** Modèle WhatsApp personnalisé du cabinet (langue exacte), s'il existe et n'est pas un ancien défaut. */
export function customTemplate(templates: readonly TemplateRow[], cabinetId: string, kind: PatientMessageKind, locale: string) {
  const lang = langOf(locale);
  const row = templates.find(
    (t) => t.cabinet_id === cabinetId && t.kind === kind && t.channel === "whatsapp" && t.locale === lang && !t.deleted_at,
  );
  if (!row || !row.body.trim()) return null;
  if (LEGACY_DEFAULTS[kind]?.includes(row.body.trim())) return null;
  return row;
}

/** Texte à utiliser : personnalisation du cabinet, sinon texte par défaut. */
export function effectiveText(templates: readonly TemplateRow[], cabinetId: string, kind: PatientMessageKind, locale: string): string {
  return customTemplate(templates, cabinetId, kind, locale)?.body.replace(/\\n/g, "\n") ?? defaultText(kind, locale);
}

/** Le cabinet a-t-il désactivé ce modèle WhatsApp (ligne existante, enabled = false) ? */
export function templateDisabled(templates: readonly TemplateRow[], cabinetId: string, kind: PatientMessageKind, locale: string) {
  const lang = langOf(locale);
  return templates.some(
    (t) => t.cabinet_id === cabinetId && t.kind === kind && t.channel === "whatsapp" && t.locale === lang && !t.deleted_at && !t.enabled,
  );
}

const VAR_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/** Variables d'un texte qui n'existent pas pour ce type de message. */
export function unknownPatientVariables(body: string, kind: PatientMessageKind): string[] {
  const allowed = VARIABLES_BY_KIND[kind] as string[];
  const found = [...body.matchAll(VAR_RE)].map((m) => m[1]);
  return [...new Set(found.filter((v) => !allowed.includes(v)))];
}

/**
 * Rend un texte : remplace les variables ; une ligne dont une variable est vide ou absente
 * est retirée ; espaces superflus et lignes vides multiples supprimés.
 */
export function renderPatientMessage(body: string, vars: PatientMessageVars): string {
  const values = vars as Record<string, string | undefined>;
  const lines = body.replace(/\\n/g, "\n").replace(/\r\n?/g, "\n").split("\n");
  const kept = lines.filter((line) => [...line.matchAll(VAR_RE)].every((m) => (values[m[1]] ?? "").trim() !== ""));
  return kept
    .join("\n")
    .replace(VAR_RE, (_m, name: string) => values[name] ?? "")
    .split("\n")
    .map((l: string) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Variables (formatage identique à l'application : formatGNF, formatPhone)
// ---------------------------------------------------------------------------

const intl = (lang: Lang) => (lang === "en" ? "en-GB" : "fr-FR");

/** 150000 -> « 150 000 GNF » (même rendu que formatGNF de l'application). */
export function formatAmountGNF(amount: number | bigint | null | undefined, locale: string): string {
  const n = Number(amount ?? 0);
  const formatted = new Intl.NumberFormat(intl(langOf(locale)), { maximumFractionDigits: 0 })
    .format(Math.round(n))
    .replace(/[  ]/g, " ");
  return `${formatted} GNF`;
}

/** +224620000000 -> « +224 620 00 00 00 » (même rendu que formatPhone). */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+224(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+224 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

export function formatLongDate(at: Date | string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(intl(langOf(locale)), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(new Date(at));
}

export function formatClock(at: Date | string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(intl(langOf(locale)), { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(at));
}

/** Date AAAA-MM-JJ (échéance) -> « 12 novembre 2026 ». */
export function formatDay(dateISO: string, locale: string) {
  return new Intl.DateTimeFormat(intl(langOf(locale)), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateISO}T00:00:00Z`),
  );
}

export type VarsCabinet = { name: string; phone: string | null; address?: string | null; city?: string | null; timezone?: string | null; locale?: string | null };
export type VarsPatient = { first_name: string; last_name: string };

export function cabinetAddress(c: Pick<VarsCabinet, "address" | "city">) {
  const parts = [c.address?.trim(), c.city?.trim()].filter((x): x is string => !!x);
  // Ville déjà comprise dans l'adresse : pas de doublon.
  if (parts.length === 2 && parts[0].toLowerCase().includes(parts[1].toLowerCase())) return parts[0];
  return parts.join(", ");
}

export function baseVars(cabinet: VarsCabinet, patient: VarsPatient): PatientMessageVars {
  return {
    patient_first_name: patient.first_name.trim() || `${patient.first_name} ${patient.last_name}`.trim(),
    patient_name: `${patient.first_name} ${patient.last_name}`.trim(),
    cabinet_name: cabinet.name,
    cabinet_address: cabinetAddress(cabinet),
    cabinet_phone: formatPhoneDisplay(cabinet.phone),
  };
}

export function appointmentVars(
  cabinet: VarsCabinet,
  patient: VarsPatient,
  appointment: { starts_at: string },
  dentistName: string | null | undefined,
): PatientMessageVars {
  const tz = cabinet.timezone || "Africa/Conakry";
  const locale = langOf(cabinet.locale);
  return {
    ...baseVars(cabinet, patient),
    date: formatLongDate(appointment.starts_at, locale, tz),
    time: formatClock(appointment.starts_at, locale, tz),
    dentist_name: dentistName?.trim() ?? "",
  };
}

export function invoiceVars(
  cabinet: VarsCabinet,
  patient: VarsPatient,
  invoice: { number: string | null; total: number; paid: number },
  extra: { amountPaid?: number | null; installment?: { amount: number; due_date: string } | null; provisionalNumber?: string } = {},
): PatientMessageVars {
  const locale = langOf(cabinet.locale);
  const balance = Math.max(0, invoice.total - invoice.paid);
  return {
    ...baseVars(cabinet, patient),
    invoice_number: invoice.number ?? extra.provisionalNumber ?? "",
    invoice_total: formatAmountGNF(invoice.total, locale),
    invoice_balance: formatAmountGNF(balance, locale),
    amount_paid: extra.amountPaid != null ? formatAmountGNF(extra.amountPaid, locale) : "",
    installment_amount: extra.installment ? formatAmountGNF(extra.installment.amount, locale) : "",
    installment_date: extra.installment ? formatDay(extra.installment.due_date, locale) : "",
  };
}

// ---------------------------------------------------------------------------
// Envoi automatique : événements de la file patient_notifications
// ---------------------------------------------------------------------------

export const AUTO_EVENTS = ["appointment_created", "appointment_moved", "appointment_cancelled", "invoice_issued", "payment_received"] as const;
export type AutoEvent = (typeof AUTO_EVENTS)[number];

/** Gabarit (texte) utilisé pour chaque événement automatique. */
export const EVENT_KIND: Record<AutoEvent, PatientMessageKind> = {
  appointment_created: "booking_confirmation",
  appointment_moved: "appointment_moved",
  appointment_cancelled: "appointment_cancelled",
  invoice_issued: "invoice_issued",
  payment_received: "payment_received",
};

/** Réglage du cabinet (colonne de cabinets) qui active chaque événement. */
export const EVENT_SETTING = {
  appointment_created: "notify_appointment_created",
  appointment_moved: "notify_appointment_changed",
  appointment_cancelled: "notify_appointment_changed",
  invoice_issued: "notify_invoice_issued",
  payment_received: "notify_payment_received",
} as const satisfies Record<AutoEvent, string>;
export type NotifySetting = (typeof EVENT_SETTING)[AutoEvent];

/** Valeurs par défaut des réglages (identiques à la migration). */
export const NOTIFY_DEFAULTS: Record<NotifySetting, boolean> = {
  notify_appointment_created: true,
  notify_appointment_changed: true,
  notify_invoice_issued: false,
  notify_payment_received: false,
};

/** Modèle Meta (catégorie Utilitaire, une variable {{1}}) et variable d'environnement de chaque événement. */
export const EVENT_META_TEMPLATE: Record<AutoEvent, { env: string; fallback: string }> = {
  appointment_created: { env: "WHATSAPP_APPOINTMENT_TEMPLATE", fallback: "nimba_rdv_confirme" },
  appointment_moved: { env: "WHATSAPP_APPOINTMENT_CHANGE_TEMPLATE", fallback: "nimba_rdv_modifie" },
  appointment_cancelled: { env: "WHATSAPP_APPOINTMENT_CHANGE_TEMPLATE", fallback: "nimba_rdv_modifie" },
  invoice_issued: { env: "WHATSAPP_INVOICE_TEMPLATE", fallback: "nimba_facture_emise" },
  payment_received: { env: "WHATSAPP_PAYMENT_TEMPLATE", fallback: "nimba_paiement_recu" },
};

export function metaTemplateName(event: AutoEvent, env: (k: string) => string | undefined): string {
  const t = EVENT_META_TEMPLATE[event];
  return env(t.env) || t.fallback;
}
