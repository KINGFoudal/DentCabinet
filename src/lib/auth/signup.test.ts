import { describe, expect, it } from "vitest";
import { afterSignupPath, confirmationRedirect } from "./signup";

describe("parcours d'inscription", () => {
  it("le lien de confirmation revient sur la connexion", () => {
    expect(confirmationRedirect("https://nimba.app")).toBe("https://nimba.app/connexion?confirme=1");
    expect(confirmationRedirect("http://localhost:3401", "/invitation?token=abc")).toBe(
      "http://localhost:3401/connexion?confirme=1&next=%2Finvitation%3Ftoken%3Dabc",
    );
  });

  it("après inscription : page de connexion avec message", () => {
    expect(afterSignupPath()).toBe("/connexion?inscrit=1");
    expect(afterSignupPath("/invitation?token=abc")).toBe("/connexion?inscrit=1&next=%2Finvitation%3Ftoken%3Dabc");
  });
});
