import { describe, expect, it } from "vitest";
import { subscriptionView } from "./state";

const now = Date.parse("2026-10-24T12:00:00Z");
const iso = (days: number) => new Date(now + days * 86_400_000).toISOString();

describe("état d'abonnement", () => {
  it("compte les jours d'essai restants", () => {
    const v = subscriptionView({ subscription_status: "trialing", trial_ends_at: iso(10.2), current_period_end: null }, now);
    expect(v).toMatchObject({ effective: "trialing", trialDaysLeft: 11, writable: true, renewSoon: false });
  });

  it("considère un essai dépassé comme expiré", () => {
    const v = subscriptionView({ subscription_status: "trialing", trial_ends_at: iso(-1), current_period_end: null }, now);
    expect(v).toMatchObject({ effective: "expired", writable: false });
  });

  it("signale une fin de période proche", () => {
    const v = subscriptionView({ subscription_status: "active", trial_ends_at: null, current_period_end: iso(3) }, now);
    expect(v).toMatchObject({ effective: "active", daysLeft: 3, renewSoon: true });
  });

  it("applique le délai de grâce", () => {
    const grace = subscriptionView({ subscription_status: "active", trial_ends_at: null, current_period_end: iso(-2) }, now);
    expect(grace.effective).toBe("past_due");
    expect(grace.graceEnd?.toISOString()).toBe(iso(5));
    const over = subscriptionView({ subscription_status: "past_due", trial_ends_at: null, current_period_end: iso(-9) }, now);
    expect(over.writable).toBe(true); // le serveur tranche (tâche planifiée) ; l'affichage reste cohérent avec cabinet_writable
  });
});
