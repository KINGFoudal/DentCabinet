"use client";

import { mutate, newId, softDelete } from "@/lib/sync/mutate";
import type { Enums } from "@/lib/database.types";
import type { DocLine } from "./lib/convert";
import type { InstallmentDraft } from "./lib/installments";
import type { Installment, InvoiceItem, QuoteItem } from "./data";

/**
 * Écritures de la facturation. Toujours via mutate()/softDelete() (base locale + file d'envoi).
 * Les numéros, totaux et l'état « payé » sont calculés par le serveur.
 */

export type EditableLine = {
  id?: string;
  act_id: string | null;
  plan_item_id?: string | null;
  label: string;
  tooth: number | null;
  quantity: number;
  unit_price_gnf: number;
};

export async function createInvoice(args: {
  cabinetId: string;
  patientId: string;
  userId: string | null;
  today: string;
  dentistId?: string | null;
  quoteId?: string | null;
  /** Rendez-vous de la consultation facturée (« Terminer la consultation »). */
  appointmentId?: string | null;
  lines?: DocLine[];
}) {
  const id = newId();
  await mutate("invoices", {
    id,
    cabinet_id: args.cabinetId,
    patient_id: args.patientId,
    quote_id: args.quoteId ?? null,
    appointment_id: args.appointmentId ?? null,
    dentist_id: args.dentistId ?? null,
    status: "draft",
    number: null,
    issue_date: args.today,
    due_date: null,
    total_gnf: 0,
    paid_gnf: 0,
    notes: null,
    created_by: args.userId,
    deleted_at: null,
  });
  for (const [i, l] of (args.lines ?? []).entries()) {
    await mutate("invoice_items", {
      cabinet_id: args.cabinetId,
      invoice_id: id,
      act_id: l.act_id,
      plan_item_id: l.plan_item_id ?? null,
      label: l.label,
      tooth: l.tooth,
      quantity: l.quantity,
      unit_price_gnf: l.unit_price_gnf,
      sort_order: i,
      deleted_at: null,
    });
  }
  return id;
}

export async function createQuote(args: {
  cabinetId: string;
  patientId: string;
  userId: string | null;
  today: string;
  validUntil: string;
  dentistId?: string | null;
  planId?: string | null;
  lines?: DocLine[];
}) {
  const id = newId();
  await mutate("quotes", {
    id,
    cabinet_id: args.cabinetId,
    patient_id: args.patientId,
    plan_id: args.planId ?? null,
    dentist_id: args.dentistId ?? null,
    status: "draft",
    number: null,
    issue_date: args.today,
    valid_until: args.validUntil,
    total_gnf: 0,
    notes: null,
    accepted_at: null,
    created_by: args.userId,
    deleted_at: null,
  });
  for (const [i, l] of (args.lines ?? []).entries()) {
    await mutate("quote_items", {
      cabinet_id: args.cabinetId,
      quote_id: id,
      act_id: l.act_id,
      label: l.label,
      tooth: l.tooth,
      quantity: l.quantity,
      unit_price_gnf: l.unit_price_gnf,
      sort_order: i,
      deleted_at: null,
    });
  }
  return id;
}

function sameLine(a: EditableLine, b: EditableLine) {
  return (
    a.act_id === b.act_id &&
    a.label === b.label &&
    a.tooth === b.tooth &&
    a.quantity === b.quantity &&
    a.unit_price_gnf === b.unit_price_gnf
  );
}

/** Enregistre les lignes modifiées d'un devis ou d'une facture (ajouts, modifications, suppressions). */
export async function saveLines(
  kind: "invoice" | "quote",
  cabinetId: string,
  parentId: string,
  previous: readonly (InvoiceItem | QuoteItem)[],
  next: readonly EditableLine[],
) {
  const table = kind === "invoice" ? "invoice_items" : "quote_items";
  const prevById = new Map(previous.filter((p) => !p.deleted_at).map((p) => [p.id, p]));
  const keep = new Set<string>();
  for (const [i, line] of next.entries()) {
    const prev = line.id ? prevById.get(line.id) : undefined;
    if (prev) keep.add(prev.id);
    const unchanged = prev && sameLine(prev as EditableLine, line) && prev.sort_order === i;
    if (unchanged) continue;
    const row = {
      ...(prev ? { id: prev.id } : {}),
      cabinet_id: cabinetId,
      act_id: line.act_id,
      label: line.label.trim(),
      tooth: line.tooth,
      quantity: line.quantity,
      unit_price_gnf: line.unit_price_gnf,
      sort_order: i,
      deleted_at: null,
    };
    if (table === "invoice_items") {
      await mutate("invoice_items", { ...row, invoice_id: parentId, plan_item_id: line.plan_item_id ?? (prev as InvoiceItem | undefined)?.plan_item_id ?? null });
    } else {
      await mutate("quote_items", { ...row, quote_id: parentId });
    }
  }
  for (const p of prevById.values()) if (!keep.has(p.id)) await softDelete(table, p.id);
}

export function updateInvoice(id: string, patch: Partial<{ due_date: string | null; notes: string | null; dentist_id: string | null }>) {
  return mutate("invoices", { id, ...patch });
}

/** Brouillon -> émise : le serveur attribue le numéro à la synchronisation. */
export function issueInvoice(id: string, today: string) {
  return mutate("invoices", { id, status: "issued", issue_date: today });
}

export function cancelInvoice(id: string) {
  return mutate("invoices", { id, status: "cancelled" });
}

export function deleteDraft(kind: "invoice" | "quote", id: string) {
  return softDelete(kind === "invoice" ? "invoices" : "quotes", id);
}

export function updateQuote(id: string, patch: Partial<{ valid_until: string | null; notes: string | null }>) {
  return mutate("quotes", { id, ...patch });
}

export function setQuoteStatus(id: string, status: Enums<"quote_status">, today: string) {
  return mutate("quotes", {
    id,
    status,
    ...(status === "sent" ? { issue_date: today } : {}),
    accepted_at: status === "accepted" ? new Date().toISOString() : null,
  });
}

export function recordPayment(args: {
  cabinetId: string;
  invoiceId: string;
  amount: number;
  method: Enums<"payment_method">;
  reference: string | null;
  paidAt: string;
  userId: string | null;
  notes: string | null;
}) {
  return mutate("payments", {
    cabinet_id: args.cabinetId,
    invoice_id: args.invoiceId,
    amount_gnf: args.amount,
    method: args.method,
    status: "succeeded",
    reference: args.reference,
    transaction_id: null,
    paid_at: args.paidAt,
    received_by: args.userId,
    notes: args.notes,
    deleted_at: null,
  });
}

/** Annule un paiement saisi au comptoir (suppression logique ; le serveur recalcule la facture). */
export function cancelPayment(id: string) {
  return softDelete("payments", id);
}

/** Remplace l'échéancier d'une facture. */
export async function replaceInstallments(cabinetId: string, invoiceId: string, previous: readonly Installment[], next: readonly InstallmentDraft[]) {
  for (const p of previous) if (!p.deleted_at) await softDelete("payment_installments", p.id);
  for (const n of next) {
    await mutate("payment_installments", {
      cabinet_id: cabinetId,
      invoice_id: invoiceId,
      due_date: n.due_date,
      amount_gnf: n.amount_gnf,
      deleted_at: null,
    });
  }
}

export function addInstallment(cabinetId: string, invoiceId: string, d: InstallmentDraft) {
  return mutate("payment_installments", { cabinet_id: cabinetId, invoice_id: invoiceId, ...d, deleted_at: null });
}

export function removeInstallment(id: string) {
  return softDelete("payment_installments", id);
}
