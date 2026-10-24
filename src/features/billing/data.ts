"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { localDb, type Local, type Row } from "@/lib/local/db";
import { fullName } from "@/lib/format";
import { invoiceFigures, quoteFigures, type InvoiceFigures } from "./lib/totals";

export type Invoice = Local<Row<"invoices">>;
export type InvoiceItem = Local<Row<"invoice_items">>;
export type Quote = Local<Row<"quotes">>;
export type QuoteItem = Local<Row<"quote_items">>;
export type Payment = Local<Row<"payments">>;
export type Installment = Local<Row<"payment_installments">>;
export type Patient = Local<Row<"patients">>;
export type Act = Local<Row<"acts">>;

export type InvoiceView = {
  invoice: Invoice;
  patient: Patient | undefined;
  items: InvoiceItem[];
  payments: Payment[];
  installments: Installment[];
  figures: InvoiceFigures;
};

export type QuoteView = {
  quote: Quote;
  patient: Patient | undefined;
  items: QuoteItem[];
  figures: ReturnType<typeof quoteFigures>;
};

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export function buildInvoiceView(
  invoice: Invoice,
  patient: Patient | undefined,
  items: InvoiceItem[],
  payments: Payment[],
  installments: Installment[],
): InvoiceView {
  return {
    invoice,
    patient,
    items: items.slice().sort((a, b) => a.sort_order - b.sort_order),
    payments: payments.slice().sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
    installments,
    figures: invoiceFigures(invoice, items, payments),
  };
}

/**
 * Toutes les données de facturation du cabinet (base locale), regroupées par document.
 * patientId : restreint aux documents d'un patient.
 */
export function useBillingData(cabinetId: string, patientId?: string) {
  return useLiveQuery(async () => {
    const db = localDb();
    const [invoicesAll, quotesAll] = await Promise.all([
      patientId
        ? db.invoices.where("patient_id").equals(patientId).toArray()
        : db.invoices.where("cabinet_id").equals(cabinetId).toArray(),
      patientId ? db.quotes.where("patient_id").equals(patientId).toArray() : db.quotes.where("cabinet_id").equals(cabinetId).toArray(),
    ]);
    const invoices = invoicesAll.filter((i) => i.cabinet_id === cabinetId && !i.deleted_at);
    const quotes = quotesAll.filter((q) => q.cabinet_id === cabinetId && !q.deleted_at);

    const [invoiceItems, payments, installments, quoteItems] = patientId
      ? await Promise.all([
          db.invoice_items.where("invoice_id").anyOf(invoices.map((i) => i.id)).toArray(),
          db.payments.where("invoice_id").anyOf(invoices.map((i) => i.id)).toArray(),
          db.payment_installments.where("invoice_id").anyOf(invoices.map((i) => i.id)).toArray(),
          db.quote_items.where("quote_id").anyOf(quotes.map((q) => q.id)).toArray(),
        ])
      : await Promise.all([
          db.invoice_items.where("cabinet_id").equals(cabinetId).toArray(),
          db.payments.where("cabinet_id").equals(cabinetId).toArray(),
          db.payment_installments.where("cabinet_id").equals(cabinetId).toArray(),
          db.quote_items.where("cabinet_id").equals(cabinetId).toArray(),
        ]);

    const patientIds = [...new Set([...invoices.map((i) => i.patient_id), ...quotes.map((q) => q.patient_id)])];
    const patients = new Map(
      (await db.patients.bulkGet(patientIds)).filter((p): p is Patient => !!p).map((p) => [p.id, p] as const),
    );

    const itemsBy = groupBy(invoiceItems, (i) => i.invoice_id);
    const paysBy = groupBy(payments, (p) => p.invoice_id);
    const instBy = groupBy(installments, (p) => p.invoice_id);
    const qItemsBy = groupBy(quoteItems, (i) => i.quote_id);

    const invoiceViews = invoices
      .map((inv) =>
        buildInvoiceView(
          inv,
          patients.get(inv.patient_id),
          itemsBy.get(inv.id) ?? [],
          paysBy.get(inv.id) ?? [],
          (instBy.get(inv.id) ?? []).filter((i) => !i.deleted_at),
        ),
      )
      .sort((a, b) => b.invoice.issue_date.localeCompare(a.invoice.issue_date) || b.invoice.created_at.localeCompare(a.invoice.created_at));

    const quoteViews: QuoteView[] = quotes
      .map((q) => {
        const items = (qItemsBy.get(q.id) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
        return { quote: q, patient: patients.get(q.patient_id), items, figures: quoteFigures(q, items) };
      })
      .sort((a, b) => b.quote.issue_date.localeCompare(a.quote.issue_date) || b.quote.created_at.localeCompare(a.quote.created_at));

    return { invoices: invoiceViews, quotes: quoteViews, payments: payments.filter((p) => !p.deleted_at), invoiceItems };
  }, [cabinetId, patientId]);
}

/** Une facture et tout ce qui s'y rattache. `undefined` : chargement ; `null` : introuvable. */
export function useInvoice(cabinetId: string, id: string | null) {
  return useLiveQuery(async () => {
    if (!id) return null;
    const db = localDb();
    const inv = await db.invoices.get(id);
    if (!inv || inv.cabinet_id !== cabinetId || inv.deleted_at) return null;
    const [items, payments, installments, patient] = await Promise.all([
      db.invoice_items.where("invoice_id").equals(id).toArray(),
      db.payments.where("invoice_id").equals(id).toArray(),
      db.payment_installments.where("invoice_id").equals(id).toArray(),
      db.patients.get(inv.patient_id),
    ]);
    return buildInvoiceView(inv, patient, items, payments, installments.filter((i) => !i.deleted_at));
  }, [cabinetId, id]);
}

export function useQuote(cabinetId: string, id: string | null) {
  return useLiveQuery(async () => {
    if (!id) return null;
    const db = localDb();
    const q = await db.quotes.get(id);
    if (!q || q.cabinet_id !== cabinetId || q.deleted_at) return null;
    const [items, patient, invoices] = await Promise.all([
      db.quote_items.where("quote_id").equals(id).toArray(),
      db.patients.get(q.patient_id),
      db.invoices.where("patient_id").equals(q.patient_id).toArray(),
    ]);
    const sorted = items.slice().sort((a, b) => a.sort_order - b.sort_order);
    const invoice = invoices.find((i) => i.quote_id === id && !i.deleted_at && i.status !== "cancelled") ?? null;
    return { quote: q, patient, items: sorted, figures: quoteFigures(q, sorted), invoice } as QuoteView & { invoice: Invoice | null };
  }, [cabinetId, id]);
}

export function useActs(cabinetId: string) {
  return useLiveQuery(
    async () =>
      (await localDb().acts.where("cabinet_id").equals(cabinetId).toArray())
        .filter((a) => !a.deleted_at)
        .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.label.localeCompare(b.label)),
    [cabinetId],
  );
}

export type Dentist = { id: string; name: string };

/** Praticiens du cabinet (rôle dentiste), avec leur nom affiché. */
export function useDentists(cabinetId: string) {
  return useLiveQuery(async () => {
    const db = localDb();
    const ms = (await db.memberships.where("cabinet_id").equals(cabinetId).toArray()).filter(
      (m) => !m.deleted_at && m.roles.includes("dentist"),
    );
    const profiles = await db.profiles.bulkGet(ms.map((m) => m.user_id));
    return ms
      .map((m, i) => ({ id: m.user_id, name: m.display_name || profiles[i]?.full_name || "—", active: m.active }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cabinetId]);
}

/** Nom d'affichage d'un membre du cabinet (praticien, personne ayant encaissé). */
export function useMemberNames(cabinetId: string) {
  return useLiveQuery(async () => {
    const db = localDb();
    const ms = (await db.memberships.where("cabinet_id").equals(cabinetId).toArray()).filter((m) => !m.deleted_at);
    const profiles = await db.profiles.bulkGet(ms.map((m) => m.user_id));
    return new Map(ms.map((m, i) => [m.user_id, m.display_name || profiles[i]?.full_name || ""] as const));
  }, [cabinetId]);
}

export function patientLabel(p: Patient | undefined) {
  return p ? fullName(p) : "—";
}
