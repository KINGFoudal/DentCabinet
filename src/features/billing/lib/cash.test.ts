import { describe, expect, it } from "vitest";
import { changeDue, tenderCovers, tenderSuggestions } from "./cash";

describe("espèces au comptoir", () => {
  it("calcule la monnaie à rendre", () => {
    expect(changeDue(150_000, 200_000)).toBe(50_000);
    expect(changeDue(150_000, 150_000)).toBe(0);
    expect(changeDue(150_000, 100_000)).toBe(0);
    expect(changeDue(150_000, null)).toBe(0);
  });

  it("vérifie que le montant remis suffit", () => {
    expect(tenderCovers(150_000, null)).toBe(true);
    expect(tenderCovers(150_000, 150_000)).toBe(true);
    expect(tenderCovers(150_000, 140_000)).toBe(false);
  });

  it("propose des montants remis arrondis au-dessus", () => {
    expect(tenderSuggestions(135_000)).toEqual([140_000, 150_000, 200_000]);
    expect(tenderSuggestions(150_000)).toEqual([160_000, 200_000]);
    expect(tenderSuggestions(0)).toEqual([]);
  });
});
