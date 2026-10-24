/**
 * Calcul du prix d'abonnement côté interface : miroir exact de la fonction SQL
 * public.subscription_price (la base reste la référence au moment du paiement).
 */

export type PlanLike = {
  id: string;
  code: string;
  name: string;
  min_dentists: number;
  max_dentists: number | null;
  price_monthly_gnf: number;
  price_per_extra_dentist_gnf: number;
  yearly_discount_pct: number;
  active: boolean;
  sort_order?: number;
};

export type Cycle = "monthly" | "yearly";

/** Palier applicable : le plus haut palier actif dont la plage contient le nombre de dentistes. */
export function planFor<P extends PlanLike>(plans: readonly P[], dentists: number): P | null {
  const n = Math.max(dentists, 1);
  const candidates = plans
    .filter((p) => p.active && n >= p.min_dentists && (p.max_dentists == null || n <= p.max_dentists))
    .sort((a, b) => b.min_dentists - a.min_dentists);
  return candidates[0] ?? null;
}

export function monthlyPrice(plan: PlanLike, dentists: number) {
  return plan.price_monthly_gnf + Math.max(dentists - plan.min_dentists, 0) * plan.price_per_extra_dentist_gnf;
}

/** Même arrondi que SQL : division entière (bigint) après application de la remise. */
export function cyclePrice(plan: PlanLike, dentists: number, cycle: Cycle) {
  const monthly = monthlyPrice(plan, dentists);
  if (cycle === "monthly") return monthly;
  return Math.trunc((monthly * 12 * (100 - plan.yearly_discount_pct)) / 100);
}

export function subscriptionQuote<P extends PlanLike>(plans: readonly P[], dentists: number, cycle: Cycle) {
  const plan = planFor(plans, dentists);
  if (!plan) return null;
  const amount = cyclePrice(plan, dentists, cycle);
  const fullYear = monthlyPrice(plan, dentists) * 12;
  return { plan, amount, monthly: monthlyPrice(plan, dentists), yearlySaving: cycle === "yearly" ? fullYear - amount : 0 };
}

/** Changement de palier provoqué par une variation du nombre de dentistes (équipe). */
export function tierChange<P extends PlanLike>(plans: readonly P[], before: number, after: number) {
  if (before === after) return null;
  const from = planFor(plans, before);
  const to = planFor(plans, after);
  if (!to) return null;
  const changed = from?.id !== to.id;
  const priceBefore = from ? monthlyPrice(from, before) : 0;
  const priceAfter = monthlyPrice(to, after);
  if (!changed && priceBefore === priceAfter) return null;
  return { from, to, changed, priceBefore, priceAfter, direction: after > before ? ("up" as const) : ("down" as const) };
}
