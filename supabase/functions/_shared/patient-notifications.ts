/**
 * Envoi automatique des messages patients (file public.patient_notifications) :
 * décision pure « envoyer / abandonner / attendre » pour chaque ligne, relue au moment
 * de l'envoi (le RDV ou la facture a pu changer depuis la mise en file).
 * Aucune dépendance Deno ni réseau ; testé avec vitest.
 */

import {
  appointmentVars,
  EVENT_KIND,
  EVENT_SETTING,
  effectiveText,
  invoiceVars,
  langOf,
  NOTIFY_DEFAULTS,
  renderPatientMessage,
  templateDisabled,
  type AutoEvent,
  type TemplateRow,
  type VarsCabinet,
  // @ts-expect-error -- Deno exige l'extension .ts dans les imports relatifs.
} from "./patient-messages.ts";
// @ts-expect-error -- idem
import { MAX_ATTEMPTS, QUEUED_STALE_MS } from "./reminders.ts";

/** Au-delà, un message non parti n'a plus de sens (ex. clés WhatsApp ajoutées un mois plus tard). */
export const NOTIFICATION_EXPIRY_MS = 24 * 3600 * 1000;
/** Facture dont les lignes ne sont pas encore arrivées (total nul) : on attend jusqu'à ce délai. */
export const INVOICE_WAIT_MS = 60 * 60 * 1000;

export type QueueRow = {
  id: string;
  cabinet_id: string;
  patient_id: string;
  event: string;
  appointment_id: string | null;
  invoice_id: string | null;
  payment_id: string | null;
  ref_starts_at: string | null;
  status: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  sent_at?: string | null;
};

export type NotifyCabinet = VarsCabinet & {
  id: string;
  active: boolean;
  notify_appointment_created?: boolean | null;
  notify_appointment_changed?: boolean | null;
  notify_invoice_issued?: boolean | null;
  notify_payment_received?: boolean | null;
};
export type NotifyPatient = {
  id: string;
  cabinet_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  whatsapp_opt_in: boolean;
  deleted_at: string | null;
};
export type NotifyAppointment = {
  id: string;
  cabinet_id: string;
  patient_id: string | null;
  dentist_id: string;
  starts_at: string;
  status: string;
  deleted_at: string | null;
};
export type NotifyInvoice = {
  id: string;
  cabinet_id: string;
  patient_id: string;
  number: string | null;
  status: string;
  total_gnf: number;
  paid_gnf: number;
  deleted_at: string | null;
};
export type NotifyPayment = {
  id: string;
  cabinet_id: string;
  invoice_id: string;
  amount_gnf: number;
  status: string;
  created_at: string;
  deleted_at: string | null;
};

export type NotifyContext = {
  now: Date;
  cabinets: Map<string, NotifyCabinet>;
  patients: Map<string, NotifyPatient>;
  appointments: Map<string, NotifyAppointment>;
  invoices: Map<string, NotifyInvoice>;
  payments: Map<string, NotifyPayment>;
  templates: TemplateRow[];
  dentistNames: Record<string, string>;
  /** Numéros (chiffres) du personnel par cabinet : jamais destinataires. */
  staffPhones: Map<string, Set<string>>;
  /** Autres lignes de la file (règle « paiement déjà annoncé par la facture »). */
  queue: QueueRow[];
};

export type Plan =
  | { action: "send"; event: AutoEvent; recipient: string; locale: "fr" | "en"; text: string }
  | { action: "skip"; reason: string }
  | { action: "defer"; reason: string };

const WHATSAPP_RE = /^\+\d{8,15}$/;

/** Chiffres d'un numéro, comme app.phone_digits (00 initial retiré, 9 chiffres -> 224…). */
export function phoneDigits(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) return d.slice(2);
  if (d.length === 9) return "224" + d;
  return d;
}

/** Ligne à traiter maintenant ? (en attente, échec retentable, ou envoi interrompu) */
export function isDue(row: Pick<QueueRow, "status" | "attempts" | "updated_at">, now: Date): boolean {
  if (row.attempts >= MAX_ATTEMPTS) return false;
  if (row.status === "pending" || row.status === "failed") return true;
  return row.status === "sending" && now.getTime() - new Date(row.updated_at).getTime() > QUEUED_STALE_MS;
}

/** Envoi interrompu après la dernière tentative : à passer en échec. */
export function isAbandoned(row: Pick<QueueRow, "status" | "attempts" | "updated_at">, now: Date): boolean {
  return row.status === "sending" && row.attempts >= MAX_ATTEMPTS && now.getTime() - new Date(row.updated_at).getTime() > QUEUED_STALE_MS;
}

/** Filtre PostgREST de réservation conditionnelle (aucun double envoi entre deux exécutions). */
export function reservationFilter(row: Pick<QueueRow, "id" | "status" | "attempts" | "updated_at">): string {
  return `id=eq.${row.id}&status=eq.${row.status}&attempts=eq.${row.attempts}&updated_at=eq.${encodeURIComponent(row.updated_at)}`;
}

const ACTIVE = ["scheduled", "confirmed"];
const ISSUED = ["issued", "partially_paid", "paid"];

export function planNotification(row: QueueRow, ctx: NotifyContext): Plan {
  const event = row.event as AutoEvent;
  if (!(event in EVENT_KIND)) return { action: "skip", reason: `unknown event ${row.event}` };
  const now = ctx.now.getTime();
  if (now - new Date(row.created_at).getTime() > NOTIFICATION_EXPIRY_MS) return { action: "skip", reason: "expired" };

  const cabinet = ctx.cabinets.get(row.cabinet_id);
  if (!cabinet) return { action: "skip", reason: "cabinet not found" };
  if (!cabinet.active) return { action: "skip", reason: "subscription inactive" };
  const setting = EVENT_SETTING[event];
  if (!(cabinet[setting] ?? NOTIFY_DEFAULTS[setting])) return { action: "skip", reason: "disabled by cabinet" };

  // Destinataire : toujours le téléphone actuel de la fiche patient.
  const patient = ctx.patients.get(row.patient_id);
  if (!patient || patient.cabinet_id !== row.cabinet_id || patient.deleted_at) return { action: "skip", reason: "patient not found" };
  if (!patient.whatsapp_opt_in) return { action: "skip", reason: "patient opted out" };
  if (!patient.phone || !WHATSAPP_RE.test(patient.phone)) return { action: "skip", reason: "no valid phone" };
  const digits = phoneDigits(patient.phone);
  if (digits === phoneDigits(cabinet.phone) || ctx.staffPhones.get(row.cabinet_id)?.has(digits!)) {
    return { action: "skip", reason: "phone belongs to the practice" };
  }

  const locale = langOf(cabinet.locale);
  const kind = EVENT_KIND[event];
  if (templateDisabled(ctx.templates, row.cabinet_id, kind, locale)) return { action: "skip", reason: "template disabled" };
  const body = effectiveText(ctx.templates, row.cabinet_id, kind, locale);
  let vars;

  if (event === "appointment_created" || event === "appointment_moved" || event === "appointment_cancelled") {
    const a = row.appointment_id ? ctx.appointments.get(row.appointment_id) : undefined;
    if (!a || a.deleted_at) return { action: "skip", reason: "appointment deleted" };
    if (a.patient_id !== row.patient_id) return { action: "skip", reason: "patient changed" };
    if (event === "appointment_cancelled") {
      if (a.status !== "cancelled") return { action: "skip", reason: "appointment no longer cancelled" };
    } else {
      if (!ACTIVE.includes(a.status)) return { action: "skip", reason: `appointment ${a.status}` };
      if (new Date(a.starts_at).getTime() <= now) return { action: "skip", reason: "appointment in the past" };
      if (event === "appointment_moved" && row.ref_starts_at && new Date(row.ref_starts_at).getTime() !== new Date(a.starts_at).getTime()) {
        return { action: "skip", reason: "superseded" };
      }
    }
    vars = appointmentVars(cabinet, patient, a, ctx.dentistNames[a.dentist_id]);
  } else {
    const inv = row.invoice_id ? ctx.invoices.get(row.invoice_id) : undefined;
    if (!inv || inv.deleted_at || !ISSUED.includes(inv.status)) return { action: "skip", reason: "invoice not issued" };
    if (inv.patient_id !== row.patient_id) return { action: "skip", reason: "patient changed" };
    const young = now - new Date(row.created_at).getTime() < INVOICE_WAIT_MS;
    if (!inv.number || Number(inv.total_gnf) <= 0) {
      return young ? { action: "defer", reason: "invoice not complete yet" } : { action: "skip", reason: "invoice empty" };
    }
    let amountPaid: number | null = null;
    if (event === "payment_received") {
      const p = row.payment_id ? ctx.payments.get(row.payment_id) : undefined;
      if (!p || p.deleted_at || p.status !== "succeeded") return { action: "skip", reason: "payment cancelled" };
      // Facture annoncée après ce paiement (ou en attente) : le message de facture donne déjà le reste à payer.
      const issued = ctx.queue.find((q) => q.event === "invoice_issued" && q.invoice_id === inv.id);
      if (issued && (["pending", "sending"].includes(issued.status) || (issued.status === "sent" && issued.sent_at && issued.sent_at >= p.created_at))) {
        return { action: "skip", reason: "covered by invoice message" };
      }
      amountPaid = Number(p.amount_gnf);
    }
    vars = invoiceVars(cabinet, patient, { number: inv.number, total: Number(inv.total_gnf), paid: Number(inv.paid_gnf) }, { amountPaid });
  }

  const text = renderPatientMessage(body, vars);
  if (!text) return { action: "skip", reason: "empty message" };
  return { action: "send", event, recipient: patient.phone, locale, text };
}
