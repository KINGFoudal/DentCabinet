import { describe, expect, it } from "vitest";
import { callbackBaseUrl, paymentsMode, sandboxAllowed } from "./config";

describe("configuration des paiements", () => {
  it("utilise le mode sandbox par défaut", () => {
    expect(paymentsMode({})).toBe("sandbox");
    expect(paymentsMode({ PAYMENTS_MODE: "live" })).toBe("live");
  });

  it("n'autorise jamais la simulation en production", () => {
    expect(sandboxAllowed({})).toBe(true);
    expect(sandboxAllowed({ NIMBA_ENV: "production" })).toBe(false);
    expect(sandboxAllowed({ VERCEL_ENV: "production", PAYMENTS_MODE: "sandbox" })).toBe(false);
    expect(sandboxAllowed({ PAYMENTS_MODE: "live" })).toBe(false);
  });

  it("choisit la base des URL de rappel", () => {
    expect(callbackBaseUrl("http://localhost:3105", {})).toBe("http://localhost:3105");
    expect(callbackBaseUrl("http://x", { NEXT_PUBLIC_SITE_URL: "https://nimba.gn/" })).toBe("https://nimba.gn");
    expect(callbackBaseUrl("http://x", { PAYMENTS_CALLBACK_BASE_URL: "https://pay.nimba.gn", NEXT_PUBLIC_SITE_URL: "https://nimba.gn" })).toBe(
      "https://pay.nimba.gn",
    );
  });
});
