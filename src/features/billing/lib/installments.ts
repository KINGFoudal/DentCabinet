/** Échéancier d'une facture (table payment_installments). */

export type InstallmentDraft = { due_date: string; amount_gnf: number };

export type InstallmentState = "paid" | "partial" | "overdue" | "upcoming";

/** Ajoute n mois à une date AAAA-MM-JJ, en restant sur le dernier jour du mois si besoin (31/01 + 1 = 28/02). */
export function addMonthsISO(dateISO: string, months: number): string {
  const y = +dateISO.slice(0, 4);
  const m = +dateISO.slice(5, 7) - 1 + months;
  const d = +dateISO.slice(8, 10);
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Répartit un montant en `count` échéances mensuelles (ou tous les `stepMonths` mois).
 * Montants entiers en GNF ; l'arrondi est reporté sur la dernière échéance.
 */
export function splitSchedule(total: number, count: number, firstDate: string, stepMonths = 1): InstallmentDraft[] {
  const n = Math.floor(count);
  if (!Number.isFinite(total) || total <= 0 || n < 1) return [];
  if (total < n) throw new Error("amount too small for the number of installments");
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => ({
    due_date: addMonthsISO(firstDate, i * stepMonths),
    amount_gnf: i === n - 1 ? total - base * (n - 1) : base,
  }));
}

export type AllocatedInstallment<T> = T & { covered: number; remaining: number; state: InstallmentState };

/**
 * Affecte le montant déjà payé aux échéances, de la plus ancienne à la plus récente,
 * et en déduit l'état de chacune (payée, partielle, en retard, à venir).
 *
 * Si `total` (total de la facture) est donné et que l'échéancier n'en couvre qu'une partie
 * (cas d'un acompte versé avant d'échelonner le reste), la partie non échelonnée est
 * considérée comme payée en premier.
 */
export function allocateInstallments<T extends { due_date: string; amount_gnf: number; deleted_at?: string | null }>(
  installments: readonly T[],
  paid: number,
  todayISO: string,
  total?: number,
): AllocatedInstallment<T>[] {
  const live = installments.filter((i) => !i.deleted_at);
  const scheduled = live.reduce((s, i) => s + Number(i.amount_gnf), 0);
  const unscheduled = total == null ? 0 : Math.max(0, total - scheduled);
  let left = Math.max(0, paid - unscheduled);
  return live
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map((inst) => {
      const amount = Number(inst.amount_gnf);
      const covered = Math.min(amount, left);
      left -= covered;
      const remaining = amount - covered;
      const state: InstallmentState =
        remaining === 0 ? "paid" : inst.due_date < todayISO ? "overdue" : covered > 0 ? "partial" : "upcoming";
      return { ...inst, covered, remaining, state };
    });
}

/** Montant en retard (somme restante des échéances dépassées). */
export function overdueAmount(allocated: readonly { state: InstallmentState; remaining: number }[]) {
  return allocated.filter((i) => i.state === "overdue").reduce((s, i) => s + i.remaining, 0);
}
