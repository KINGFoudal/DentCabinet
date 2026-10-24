import { addDays, todayISO } from "@/lib/dates";
import { countsAsRevenue, type InvoiceStatus } from "./totals";

/** Agrégations des rapports financiers (calculées sur la base locale). */

export type ReportInvoice = { id: string; issue_date: string; status: InvoiceStatus; total: number; dentist_id: string | null };
export type ReportPayment = { paid_at: string; amount_gnf: number; method: string; status: string; deleted_at?: string | null };
export type ReportItem = {
  invoice_id: string;
  act_id: string | null;
  label: string;
  quantity: number;
  unit_price_gnf: number;
  deleted_at?: string | null;
};

/** Date locale (AAAA-MM-JJ) d'un horodatage, dans le fuseau du cabinet. */
export function localDate(iso: string, timeZone: string) {
  return todayISO(timeZone, new Date(iso));
}

export function inPeriod(dateISO: string, from: string, to: string) {
  return dateISO >= from && dateISO <= to;
}

/** Liste des jours de la période (bornes incluses), plafonnée à 400 jours. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function revenueByDay(
  invoices: readonly ReportInvoice[],
  payments: readonly ReportPayment[],
  from: string,
  to: string,
  timeZone: string,
) {
  const rows = new Map(daysOf(from, to).map((d) => [d, { date: d, invoiced: 0, collected: 0 }]));
  for (const inv of invoices) {
    if (!countsAsRevenue(inv.status)) continue;
    const r = rows.get(inv.issue_date);
    if (r) r.invoiced += inv.total;
  }
  for (const p of payments) {
    if (p.deleted_at || p.status !== "succeeded") continue;
    const r = rows.get(localDate(p.paid_at, timeZone));
    if (r) r.collected += Number(p.amount_gnf);
  }
  return [...rows.values()];
}

export function byPaymentMethod(payments: readonly ReportPayment[]) {
  const m = new Map<string, { method: string; count: number; amount: number }>();
  for (const p of payments) {
    if (p.deleted_at || p.status !== "succeeded") continue;
    const r = m.get(p.method) ?? { method: p.method, count: 0, amount: 0 };
    r.count += 1;
    r.amount += Number(p.amount_gnf);
    m.set(p.method, r);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

export function byDentist(invoices: readonly ReportInvoice[]) {
  const m = new Map<string | null, { dentist_id: string | null; count: number; amount: number }>();
  for (const inv of invoices) {
    if (!countsAsRevenue(inv.status)) continue;
    const r = m.get(inv.dentist_id) ?? { dentist_id: inv.dentist_id, count: 0, amount: 0 };
    r.count += 1;
    r.amount += inv.total;
    m.set(inv.dentist_id, r);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

/** Actes les plus fréquents sur les factures émises (regroupés par acte du catalogue, sinon par libellé). */
export function topActs(items: readonly ReportItem[], countedInvoiceIds: ReadonlySet<string>, limit = 10) {
  const m = new Map<string, { key: string; label: string; quantity: number; amount: number }>();
  for (const it of items) {
    if (it.deleted_at || !countedInvoiceIds.has(it.invoice_id)) continue;
    const key = it.act_id ?? `label:${it.label.trim().toLowerCase()}`;
    const r = m.get(key) ?? { key, label: it.label, quantity: 0, amount: 0 };
    r.quantity += Number(it.quantity);
    r.amount += Number(it.quantity) * Number(it.unit_price_gnf);
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount).slice(0, limit);
}

export type PeriodPreset = "today" | "thisMonth" | "lastMonth" | "thisYear" | "last30";

export function presetRange(preset: PeriodPreset, today: string): [string, string] {
  const y = today.slice(0, 4);
  const m = today.slice(0, 7);
  switch (preset) {
    case "today":
      return [today, today];
    case "thisMonth":
      return [`${m}-01`, today];
    case "lastMonth": {
      const firstThis = `${m}-01`;
      const lastPrev = addDays(firstThis, -1);
      return [`${lastPrev.slice(0, 7)}-01`, lastPrev];
    }
    case "thisYear":
      return [`${y}-01-01`, today];
    case "last30":
      return [addDays(today, -29), today];
  }
}
