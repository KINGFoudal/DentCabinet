import type { Enums } from "@/lib/database.types";

/**
 * Calculs de facturation côté interface.
 *
 * Le serveur reste la référence (triggers app.recompute_invoice / app.recompute_quote) :
 * ces fonctions reproduisent la même formule pour afficher un total « provisoire »
 * tant que la ligne n'est pas synchronisée.
 */

export type InvoiceStatus = Enums<"invoice_status">;
export type QuoteStatus = Enums<"quote_status">;

type DirtyFlag = { _dirty?: 0 | 1 };
export type LineLike = { quantity: number; unit_price_gnf: number; deleted_at?: string | null } & DirtyFlag;
export type PaymentLike = { amount_gnf: number; status: string; deleted_at?: string | null } & DirtyFlag;

export function lineTotal(line: { quantity: number; unit_price_gnf: number }): number {
  return Number(line.quantity) * Number(line.unit_price_gnf);
}

/** Somme quantité × prix des lignes non supprimées (= sum(quantity * unit_price_gnf) côté serveur). */
export function sumLines(lines: readonly LineLike[]): number {
  return lines.filter((l) => !l.deleted_at).reduce((s, l) => s + lineTotal(l), 0);
}

/** Somme des paiements réussis non supprimés. */
export function sumPayments(payments: readonly PaymentLike[]): number {
  return payments.filter((p) => !p.deleted_at && p.status === "succeeded").reduce((s, p) => s + Number(p.amount_gnf), 0);
}

/** Même règle que app.recompute_invoice(). */
export function deriveInvoiceStatus(status: InvoiceStatus, total: number, paid: number): InvoiceStatus {
  if (status === "draft" || status === "cancelled") return status;
  if (total > 0 && paid >= total) return "paid";
  if (paid > 0) return "partially_paid";
  return "issued";
}

export type InvoiceFigures = {
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  /** true : chiffres calculés localement, pas encore confirmés par le serveur. */
  provisional: boolean;
  /** true : facture émise mais numéro pas encore attribué par le serveur. */
  numberPending: boolean;
};

type InvoiceLike = {
  status: InvoiceStatus;
  total_gnf: number;
  paid_gnf: number;
  number: string | null;
} & DirtyFlag;

/**
 * Chiffres d'une facture : ceux du serveur si la facture, ses lignes et ses paiements sont
 * synchronisés ; sinon un calcul local (même formule), marqué provisoire.
 * `items` et `payments` : toutes les lignes de la facture, y compris supprimées (une suppression
 * pas encore envoyée rend les chiffres provisoires).
 */
export function invoiceFigures(invoice: InvoiceLike, items: readonly LineLike[], payments: readonly PaymentLike[]): InvoiceFigures {
  const provisional = invoice._dirty === 1 || items.some((i) => i._dirty === 1) || payments.some((p) => p._dirty === 1);
  const total = provisional ? sumLines(items) : Number(invoice.total_gnf);
  const paid = provisional ? sumPayments(payments) : Number(invoice.paid_gnf);
  const status = provisional ? deriveInvoiceStatus(invoice.status, total, paid) : invoice.status;
  return {
    total,
    paid,
    balance: status === "cancelled" || status === "draft" ? 0 : Math.max(0, total - paid),
    status,
    provisional,
    numberPending: !invoice.number && invoice.status !== "draft",
  };
}

type QuoteLike = { total_gnf: number; number: string | null; status: QuoteStatus } & DirtyFlag;

export function quoteFigures(quote: QuoteLike, items: readonly LineLike[]) {
  const provisional = quote._dirty === 1 || items.some((i) => i._dirty === 1);
  return {
    total: provisional ? sumLines(items) : Number(quote.total_gnf),
    provisional,
    numberPending: !quote.number && quote.status !== "draft",
  };
}

/** Statut affiché d'un devis : un devis envoyé dont la validité est dépassée est « expiré ». */
export function displayQuoteStatus(quote: { status: QuoteStatus; valid_until: string | null }, todayISO: string): QuoteStatus {
  if (quote.status === "sent" && quote.valid_until && quote.valid_until < todayISO) return "expired";
  return quote.status;
}

/** Nombre de jours entiers entre deux dates AAAA-MM-JJ (to - from). */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Facture qui compte dans le chiffre d'affaires (émise, non annulée). */
export function countsAsRevenue(status: InvoiceStatus) {
  return status !== "draft" && status !== "cancelled";
}
