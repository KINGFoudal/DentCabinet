import { describe, expect, it } from "vitest";
import { callbackBaseUrl, isProductionDeployment, paymentsMode, sandboxAllowed, sandboxSecret } from "./config";

const SECRET = { PAYMENTS_SANDBOX_SECRET: "s3cret" };

describe("configuration des paiements", () => {
  it("n'active la simulation que sur demande explicite", () => {
    expect(paymentsMode({})).toBe("disabled");
    expect(paymentsMode({ PAYMENTS_MODE: "Sandbox" })).toBe("disabled");
    expect(paymentsMode({ PAYMENTS_MODE: "sandbox" })).toBe("sandbox");
    expect(paymentsMode({ PAYMENTS_MODE: "live" })).toBe("live");
  });

  it("n'autorise jamais la simulation en production", () => {
    expect(sandboxAllowed({})).toBe(false);
    expect(sandboxAllowed({ PAYMENTS_MODE: "sandbox", ...SECRET })).toBe(true);
    expect(sandboxAllowed({ PAYMENTS_MODE: "sandbox", NIMBA_ENV: "production", ...SECRET })).toBe(false);
    expect(sandboxAllowed({ VERCEL_ENV: "production", PAYMENTS_MODE: "sandbox", ...SECRET })).toBe(false);
    expect(sandboxAllowed({ NODE_ENV: "production", PAYMENTS_MODE: "sandbox", ...SECRET })).toBe(false);
    expect(sandboxAllowed({ NODE_ENV: "production", NIMBA_ENV: "development", PAYMENTS_MODE: "sandbox", ...SECRET })).toBe(true);
    expect(sandboxAllowed({ PAYMENTS_MODE: "live", ...SECRET })).toBe(false);
  });

  it("exige un secret dédié pour la simulation", () => {
    expect(sandboxAllowed({ PAYMENTS_MODE: "sandbox" })).toBe(false);
    expect(sandboxAllowed({ PAYMENTS_MODE: "sandbox", SUPABASE_SERVICE_ROLE_KEY: "service" })).toBe(false);
    expect(() => sandboxSecret({ SUPABASE_SERVICE_ROLE_KEY: "service" })).toThrow();
    expect(sandboxSecret(SECRET)).toBe("s3cret");
  });

  it("détecte la production", () => {
    expect(isProductionDeployment({})).toBe(false);
    expect(isProductionDeployment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ NODE_ENV: "production", NIMBA_ENV: "development" })).toBe(false);
    expect(isProductionDeployment({ NODE_ENV: "development", NIMBA_ENV: "production" })).toBe(true);
  });

  it("choisit la base des URL de rappel", () => {
    expect(callbackBaseUrl("http://localhost:3105", {})).toBe("http://localhost:3105");
    expect(callbackBaseUrl("http://x", { NEXT_PUBLIC_SITE_URL: "https://nimba.gn/" })).toBe("https://nimba.gn");
    expect(callbackBaseUrl("http://x", { PAYMENTS_CALLBACK_BASE_URL: "https://pay.nimba.gn", NEXT_PUBLIC_SITE_URL: "https://nimba.gn" })).toBe(
      "https://pay.nimba.gn",
    );
  });
});
