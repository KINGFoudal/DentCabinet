import { describe, expect, it } from "vitest";
import { ageFrom, formatGNF, formatPhone, normalizeGuineaPhone, parseGNF } from "./format";

describe("format", () => {
  it("formate les montants en GNF sans décimales", () => {
    expect(formatGNF(150000)).toBe("150 000 GNF");
    expect(formatGNF(1234567.6)).toBe("1 234 568 GNF");
    expect(formatGNF(null)).toBe("0 GNF");
  });

  it("analyse un montant saisi", () => {
    expect(parseGNF("150 000")).toBe(150000);
    expect(parseGNF("150000 GNF")).toBe(150000);
    expect(parseGNF("abc")).toBeNull();
  });

  it("normalise les numéros guinéens", () => {
    expect(normalizeGuineaPhone("620000001")).toBe("+224620000001");
    expect(normalizeGuineaPhone("00224620000001")).toBe("+224620000001");
    expect(normalizeGuineaPhone("+224 620 00 00 01")).toBe("+224620000001");
    expect(normalizeGuineaPhone("12")).toBeNull();
    expect(formatPhone("+224620000001")).toBe("+224 620 00 00 01");
  });

  it("calcule l'âge", () => {
    expect(ageFrom("2000-06-15", new Date("2026-06-14T00:00:00Z"))).toBe(25);
    expect(ageFrom("2000-06-15", new Date("2026-06-15T00:00:00Z"))).toBe(26);
  });
});
