import { describe, expect, it } from "vitest";
import { isStrongPassword, safeNext, slugify } from "./validation";

describe("validation", () => {
  it("slugify", () => {
    expect(slugify("Cabinet Dentaire de Kaloum")).toBe("cabinet-dentaire-de-kaloum");
    expect(slugify("  Clinique Élite — Ratoma ")).toBe("clinique-elite-ratoma");
  });
  it("mot de passe", () => {
    expect(isStrongPassword("abc12345")).toBe(true);
    expect(isStrongPassword("abcdefgh")).toBe(false);
    expect(isStrongPassword("a1")).toBe(false);
  });

  describe("safeNext", () => {
    it("garde les chemins internes", () => {
      expect(safeNext("/app")).toBe("/app");
      expect(safeNext("/app/patients/fiche?id=abc#notes")).toBe("/app/patients/fiche?id=abc#notes");
      expect(safeNext("/patient")).toBe("/patient");
      expect(safeNext("/app/../patient")).toBe("/patient");
    });

    it("utilise la valeur par défaut si absent", () => {
      expect(safeNext(null)).toBe("/app");
      expect(safeNext(undefined)).toBe("/app");
      expect(safeNext("", "/x")).toBe("/x");
    });

    it.each([
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "/\\/evil.com",
      "/%09/evil.com",
      "/%5Cevil.com",
      "/%2F/evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/.//evil.com",
      "/%",
      "https://evil.com",
      "http:/evil.com",
      "javascript:alert(1)",
      "evil.com",
    ])("refuse %j", (next) => {
      expect(safeNext(next)).toBe("/app");
    });
  });
});
