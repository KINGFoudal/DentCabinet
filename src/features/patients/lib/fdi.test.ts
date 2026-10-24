import { describe, expect, it } from "vitest";
import {
  ADULT_TEETH,
  CHILD_TEETH,
  coloredSurfaces,
  defaultDentition,
  dentitionOf,
  isUpper,
  isValidTooth,
  quadrants,
  surfaceLayout,
  toggleSurface,
  toothRecordId,
} from "./fdi";

describe("numérotation FDI", () => {
  it("32 dents adultes et 20 dents temporaires, sans doublon", () => {
    expect(ADULT_TEETH).toHaveLength(32);
    expect(new Set(ADULT_TEETH).size).toBe(32);
    expect(CHILD_TEETH).toHaveLength(20);
    expect(new Set(CHILD_TEETH).size).toBe(20);
  });

  it("ordre d'affichage classique (vu par le praticien)", () => {
    const [q1, q2, q4, q3] = quadrants("adult");
    expect(q1.teeth).toEqual([18, 17, 16, 15, 14, 13, 12, 11]);
    expect(q2.teeth).toEqual([21, 22, 23, 24, 25, 26, 27, 28]);
    expect(q4.teeth).toEqual([48, 47, 46, 45, 44, 43, 42, 41]);
    expect(q3.teeth).toEqual([31, 32, 33, 34, 35, 36, 37, 38]);
    const child = quadrants("child");
    expect(child.map((q) => q.teeth)).toEqual([
      [55, 54, 53, 52, 51],
      [61, 62, 63, 64, 65],
      [85, 84, 83, 82, 81],
      [71, 72, 73, 74, 75],
    ]);
  });

  it("valide les numéros comme la contrainte de la base", () => {
    for (const t of [...ADULT_TEETH, ...CHILD_TEETH]) expect(isValidTooth(t)).toBe(true);
    for (const t of [0, 10, 19, 20, 29, 39, 49, 50, 56, 66, 76, 86, 91, 11.5, -11]) expect(isValidTooth(t)).toBe(false);
  });

  it("denture et arcade", () => {
    expect(dentitionOf(36)).toBe("adult");
    expect(dentitionOf(75)).toBe("child");
    expect(isUpper(11)).toBe(true);
    expect(isUpper(26)).toBe(true);
    expect(isUpper(55)).toBe(true);
    expect(isUpper(36)).toBe(false);
    expect(isUpper(84)).toBe(false);
  });
});

describe("faces", () => {
  it("vestibulaire à l'extérieur, mésiale vers la ligne médiane", () => {
    expect(surfaceLayout(16)).toEqual({ top: "V", bottom: "L", left: "D", right: "M", center: "O" });
    expect(surfaceLayout(21)).toEqual({ top: "V", bottom: "L", left: "M", right: "D", center: "O" });
    expect(surfaceLayout(46)).toEqual({ top: "L", bottom: "V", left: "D", right: "M", center: "O" });
    expect(surfaceLayout(36)).toEqual({ top: "L", bottom: "V", left: "M", right: "D", center: "O" });
    expect(surfaceLayout(54).right).toBe("M");
    expect(surfaceLayout(74).left).toBe("M");
  });

  it("bascule une face en gardant l'ordre M O D V L", () => {
    expect(toggleSurface([], "D")).toEqual(["D"]);
    expect(toggleSurface(["D"], "M")).toEqual(["M", "D"]);
    expect(toggleSurface(["M", "D"], "M")).toEqual(["D"]);
    expect(toggleSurface(["L", "X", "O"], "V")).toEqual(["O", "V", "L"]);
  });

  it("colore les faces indiquées, ou toute la dent", () => {
    expect(coloredSurfaces("healthy", ["O"])).toEqual([]);
    expect(coloredSurfaces("caries", ["O", "D"])).toEqual(["O", "D"]);
    expect(coloredSurfaces("crown", [])).toEqual(["M", "O", "D", "V", "L"]);
  });
});

describe("denture par défaut", () => {
  it("dépend des dents renseignées puis de l'âge", () => {
    expect(defaultDentition(30, [])).toBe("adult");
    expect(defaultDentition(4, [])).toBe("child");
    expect(defaultDentition(null, [])).toBe("adult");
    expect(defaultDentition(30, [55, 64])).toBe("child");
    expect(defaultDentition(4, [16])).toBe("adult");
  });
});

describe("toothRecordId", () => {
  it("UUID v5 déterministe par patient et par dent", async () => {
    const p = "0b9e3f6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    const a = await toothRecordId(p, 16);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await toothRecordId(p, 16)).toBe(a);
    expect(await toothRecordId(p, 17)).not.toBe(a);
    expect(await toothRecordId("11111111-1111-4111-8111-111111111111", 16)).not.toBe(a);
  });
});
