import { describe, expect, it } from "vitest";
import { cyclePrice, planFor, subscriptionQuote, tierChange, type PlanLike } from "./pricing";

const plans: PlanLike[] = [
  { id: "s", code: "solo", name: "Solo", min_dentists: 1, max_dentists: 1, price_monthly_gnf: 150000, price_per_extra_dentist_gnf: 0, yearly_discount_pct: 15, active: true },
  { id: "c", code: "cabinet", name: "Cabinet", min_dentists: 2, max_dentists: 3, price_monthly_gnf: 300000, price_per_extra_dentist_gnf: 0, yearly_discount_pct: 15, active: true },
  { id: "k", code: "clinique", name: "Clinique", min_dentists: 4, max_dentists: null, price_monthly_gnf: 450000, price_per_extra_dentist_gnf: 100000, yearly_discount_pct: 15, active: true },
];

describe("tarification par dentistes actifs", () => {
  it("choisit le palier selon le nombre de dentistes", () => {
    expect(planFor(plans, 0)?.code).toBe("solo");
    expect(planFor(plans, 1)?.code).toBe("solo");
    expect(planFor(plans, 2)?.code).toBe("cabinet");
    expect(planFor(plans, 3)?.code).toBe("cabinet");
    expect(planFor(plans, 4)?.code).toBe("clinique");
    expect(planFor(plans, 12)?.code).toBe("clinique");
  });

  it("ajoute le prix par dentiste au-delà du minimum du palier Clinique", () => {
    expect(cyclePrice(plans[2], 4, "monthly")).toBe(450000);
    expect(cyclePrice(plans[2], 6, "monthly")).toBe(650000);
  });

  it("applique la remise annuelle comme la fonction SQL", () => {
    expect(cyclePrice(plans[0], 1, "yearly")).toBe(1530000); // 150 000 x 12 x 0,85
    const q = subscriptionQuote(plans, 5, "yearly")!;
    expect(q.amount).toBe(Math.trunc((550000 * 12 * 85) / 100));
    expect(q.yearlySaving).toBe(550000 * 12 - q.amount);
  });

  it("ignore les formules désactivées", () => {
    const withInactive = plans.map((p) => (p.code === "cabinet" ? { ...p, active: false } : p));
    expect(planFor(withInactive, 2)).toBeNull();
  });

  it("signale un changement de palier", () => {
    expect(tierChange(plans, 1, 2)).toMatchObject({ changed: true, direction: "up", priceBefore: 150000, priceAfter: 300000 });
    expect(tierChange(plans, 3, 2)).toBeNull();
    expect(tierChange(plans, 5, 6)).toMatchObject({ changed: false, priceAfter: 650000 });
    expect(tierChange(plans, 4, 3)).toMatchObject({ changed: true, direction: "down" });
  });
});
