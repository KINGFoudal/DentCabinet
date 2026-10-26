import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicCabinetExists, publicSlugFromPath } from "./cabinet-exists";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("publicCabinetExists", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuse un slug invalide sans requête", async () => {
    const fetchFn = vi.fn();
    expect(await publicCabinetExists("Bad_Slug", fetchFn)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("lit la RPC et met le résultat en cache", async () => {
    const fetchFn = vi.fn(async () => json(200, { id: "c1", name: "Kaloum" }));
    expect(await publicCabinetExists("kaloum-test", fetchFn, 1000)).toBe(true);
    expect(await publicCabinetExists("kaloum-test", fetchFn, 2000)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await publicCabinetExists("inconnu-test", async () => json(200, null), 1000)).toBe(false);
  });

  it("laisse décider la page si la vérification échoue", async () => {
    expect(await publicCabinetExists("panne-test", async () => json(500, {}))).toBeNull();
    expect(
      await publicCabinetExists("reseau-test", async () => {
        throw new TypeError("fetch failed");
      }),
    ).toBeNull();
  });

  it("extrait le slug des URL publiques", () => {
    expect(publicSlugFromPath("/c/kaloum")).toBe("kaloum");
    expect(publicSlugFromPath("/c/kaloum/rdv")).toBe("kaloum");
    expect(publicSlugFromPath("/c/kaloum/autre")).toBeNull();
    expect(publicSlugFromPath("/app")).toBeNull();
  });
});
