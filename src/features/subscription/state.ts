/** État d'abonnement affiché, dérivé des champs du cabinet (miroir de app.cabinet_writable). */

export const GRACE_DAYS = 7;
const DAY = 86_400_000;

export type SubscriptionView = {
  status: "trialing" | "active" | "past_due" | "expired" | "cancelled";
  /** Statut effectif : un essai dépassé est considéré comme expiré même avant le passage de la tâche planifiée. */
  effective: "trialing" | "active" | "past_due" | "expired" | "cancelled";
  trialDaysLeft: number | null;
  periodEnd: Date | null;
  graceEnd: Date | null;
  daysLeft: number | null;
  writable: boolean;
  renewSoon: boolean;
};

export function subscriptionView(
  c: { subscription_status: SubscriptionView["status"]; trial_ends_at: string | null; current_period_end: string | null },
  now = Date.now(),
): SubscriptionView {
  const trialEnd = c.trial_ends_at ? new Date(c.trial_ends_at) : null;
  const periodEnd = c.current_period_end ? new Date(c.current_period_end) : null;
  let effective = c.subscription_status;
  if (effective === "trialing" && trialEnd && trialEnd.getTime() <= now) effective = "expired";
  if (effective === "active" && periodEnd && periodEnd.getTime() <= now) {
    effective = periodEnd.getTime() + GRACE_DAYS * DAY > now ? "past_due" : "expired";
  }
  const graceEnd = periodEnd && effective === "past_due" ? new Date(periodEnd.getTime() + GRACE_DAYS * DAY) : null;
  const trialDaysLeft = effective === "trialing" && trialEnd ? Math.max(Math.ceil((trialEnd.getTime() - now) / DAY), 0) : null;
  const daysLeft =
    effective === "active" && periodEnd ? Math.max(Math.ceil((periodEnd.getTime() - now) / DAY), 0) : trialDaysLeft;
  const writable =
    c.subscription_status === "active" ||
    c.subscription_status === "past_due" ||
    (c.subscription_status === "trialing" && (!trialEnd || trialEnd.getTime() > now));
  return {
    status: c.subscription_status,
    effective,
    trialDaysLeft,
    periodEnd,
    graceEnd,
    daysLeft,
    writable,
    renewSoon: daysLeft != null && daysLeft <= 7,
  };
}
