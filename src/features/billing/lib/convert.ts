/** Conversions entre documents : plan de traitement → devis/facture, devis → facture. */

export type DocLine = {
  act_id: string | null;
  plan_item_id?: string | null;
  label: string;
  tooth: number | null;
  quantity: number;
  unit_price_gnf: number;
  sort_order: number;
};

type QuoteItemLike = {
  act_id: string | null;
  label: string;
  tooth: number | null;
  quantity: number;
  unit_price_gnf: number;
  sort_order: number;
  deleted_at?: string | null;
};

type PlanItemLike = {
  id: string;
  act_id: string | null;
  label: string;
  tooth: number | null;
  step: number;
  quantity: number;
  unit_price_gnf: number;
  status: "planned" | "done" | "cancelled";
  deleted_at?: string | null;
};

/** Lignes d'une facture créée depuis un devis accepté (copie fidèle, ordre conservé). */
export function quoteToInvoiceLines(items: readonly QuoteItemLike[]): DocLine[] {
  return items
    .filter((i) => !i.deleted_at)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i, idx) => ({
      act_id: i.act_id,
      plan_item_id: null,
      label: i.label,
      tooth: i.tooth,
      quantity: i.quantity,
      unit_price_gnf: i.unit_price_gnf,
      sort_order: idx,
    }));
}

/** Seul un devis accepté peut devenir une facture. */
export function canConvertQuote(quote: { status: string; deleted_at?: string | null }) {
  return quote.status === "accepted" && !quote.deleted_at;
}

/** Lignes depuis des éléments d'un plan de traitement (par étape puis ordre de saisie). */
export function planItemsToLines(items: readonly PlanItemLike[], withPlanItemId: boolean): DocLine[] {
  return items
    .filter((i) => !i.deleted_at && i.status !== "cancelled")
    .slice()
    .sort((a, b) => a.step - b.step)
    .map((i, idx) => ({
      act_id: i.act_id,
      plan_item_id: withPlanItemId ? i.id : null,
      label: i.label,
      tooth: i.tooth,
      quantity: i.quantity,
      unit_price_gnf: i.unit_price_gnf,
      sort_order: idx,
    }));
}

/** Éléments prévus d'un plan (pour un devis). */
export function plannedItems<T extends PlanItemLike>(items: readonly T[]): T[] {
  return items.filter((i) => !i.deleted_at && i.status === "planned");
}

/**
 * Actes réalisés d'un plan pas encore facturés : statut « done » et aucune ligne de facture
 * active (facture non supprimée, non annulée) qui y fait référence.
 */
export function uninvoicedDoneItems<T extends PlanItemLike>(
  items: readonly T[],
  invoiceItems: readonly { plan_item_id: string | null; invoice_id: string; deleted_at?: string | null }[],
  invoices: readonly { id: string; status: string; deleted_at?: string | null }[],
): T[] {
  const live = new Set(invoices.filter((i) => !i.deleted_at && i.status !== "cancelled").map((i) => i.id));
  const billed = new Set(
    invoiceItems.filter((ii) => ii.plan_item_id && !ii.deleted_at && live.has(ii.invoice_id)).map((ii) => ii.plan_item_id!),
  );
  return items.filter((i) => !i.deleted_at && i.status === "done" && !billed.has(i.id));
}
