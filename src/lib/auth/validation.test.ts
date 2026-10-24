import { describe, expect, it } from "vitest";
import { isStrongPassword, slugify } from "./validation";

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
});
