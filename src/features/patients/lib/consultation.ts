import { parseGNF } from "@/lib/format";
import type { DocLine } from "@/features/billing/lib/convert";
import { cleanRxItems, type RxItem } from "./clinical";

/**
 * « Terminer la consultation » : actes réalisés -> facture, ordonnance, impression.
 * Les médicaments ne sont jamais facturés : la facture ne contient que les actes.
 */

export type ActDraft = {
  key: string;
  act_id: string | null;
  plan_item_id?: string | null;
  label: string;
  tooth: string;
  quantity: string;
  price: string;
};

/** Ligne de facture depuis une ligne saisie ; null si invalide (libellé, quantité, prix, dent FDI). */
export function parseActDraft(d: ActDraft, index = 0): DocLine | null {
  const quantity = Number(d.quantity);
  const price = parseGNF(d.price);
  const tooth = d.tooth.trim() === "" ? null : Number(d.tooth);
  if (!d.label.trim() || !Number.isInteger(quantity) || quantity < 1 || price == null) return null;
  if (tooth != null && (!Number.isInteger(tooth) || tooth < 11 || tooth > 85)) return null;
  return { act_id: d.act_id, plan_item_id: d.plan_item_id ?? null, label: d.label.trim(), tooth, quantity, unit_price_gnf: price, sort_order: index };
}

/** Lignes non vides (libellé ou prix saisi). */
export function meaningfulActs(drafts: readonly ActDraft[]) {
  return drafts.filter((d) => d.label.trim() || d.price.trim());
}

export type ConsultationCheck =
  | { ok: true; lines: DocLine[]; rxItems: RxItem[] }
  | { ok: false; error: "nothing" | "invalidLine" };

/** Vérifie la saisie : au moins un acte ou un médicament, et des actes valides. */
export function checkConsultation(drafts: readonly ActDraft[], rxItems: readonly RxItem[], withRx: boolean): ConsultationCheck {
  const acts = meaningfulActs(drafts);
  const lines = acts.map((d, i) => parseActDraft(d, i));
  if (lines.some((l) => !l)) return { ok: false, error: "invalidLine" };
  const rx = withRx ? cleanRxItems(rxItems) : [];
  if (!lines.length && !rx.length) return { ok: false, error: "nothing" };
  return { ok: true, lines: lines as DocLine[], rxItems: rx };
}

type ApptLike = {
  id: string;
  patient_id: string | null;
  starts_at: string;
  status: string;
  deleted_at?: string | null;
};

const STATUS_RANK: Record<string, number> = { in_treatment: 0, arrived: 1, confirmed: 2, scheduled: 2, done: 3 };

/**
 * Rendez-vous du jour à rattacher à la consultation : celui du patient en cours de soin, sinon
 * arrivé, sinon prévu (le plus proche de maintenant), sinon terminé. Jamais annulé ni absent.
 */
export function pickConsultationAppointment<A extends ApptLike>(appts: readonly A[], patientId: string, dayStart: string, dayEnd: string, now = new Date()): A | null {
  const nowMs = now.getTime();
  const candidates = appts.filter(
    (a) => a.patient_id === patientId && !a.deleted_at && a.starts_at >= dayStart && a.starts_at < dayEnd && a.status in STATUS_RANK,
  );
  candidates.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      Math.abs(new Date(a.starts_at).getTime() - nowMs) - Math.abs(new Date(b.starts_at).getTime() - nowMs),
  );
  return candidates[0] ?? null;
}

/** Ordonnances liées à une facture (directement, ou par le même rendez-vous). */
export function prescriptionsForInvoice<P extends { invoice_id: string | null; appointment_id: string | null; deleted_at?: string | null }>(
  list: readonly P[],
  invoice: { id: string; appointment_id: string | null },
): P[] {
  return list.filter((p) => !p.deleted_at && (p.invoice_id === invoice.id || (!p.invoice_id && !!invoice.appointment_id && p.appointment_id === invoice.appointment_id)));
}

/** Adresse de la page d'impression des documents de la consultation. */
export function consultationPrintHref(ids: { invoiceId?: string | null; rxId?: string | null; patientId: string }) {
  const q = new URLSearchParams({ patient: ids.patientId });
  if (ids.invoiceId) q.set("invoice", ids.invoiceId);
  if (ids.rxId) q.set("rx", ids.rxId);
  return `/app/patients/impression?${q.toString()}`;
}

/** Adresse de l'écran « Terminer la consultation ». */
export function consultationHref(patientId: string, appointmentId?: string | null) {
  const q = new URLSearchParams({ patient: patientId });
  if (appointmentId) q.set("appointment", appointmentId);
  return `/app/patients/consultation?${q.toString()}`;
}
