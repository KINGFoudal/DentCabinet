import { describe, expect, it } from "vitest";
import { invalidDays, normalizeOpeningHours, parseOpeningHours, rangesValid } from "./opening-hours";

describe("horaires d'ouverture", () => {
  it("lit la valeur stockée en ignorant les données invalides", () => {
    expect(parseOpeningHours({ "1": [["08:00", "12:00"]], "2": "x", "9": [["08:00", "09:00"]] })).toEqual({ "1": [["08:00", "12:00"]] });
    expect(parseOpeningHours(null)).toEqual({});
  });

  it("valide les plages", () => {
    expect(rangesValid([["08:00", "12:00"], ["14:00", "18:00"]])).toBe(true);
    expect(rangesValid([["12:00", "08:00"]])).toBe(false);
    expect(rangesValid([["08:00", "13:00"], ["12:00", "18:00"]])).toBe(false);
    expect(rangesValid([["8:00", "12:00"]])).toBe(false);
  });

  it("normalise avant enregistrement", () => {
    expect(normalizeOpeningHours({ "1": [["14:00", "18:00"], ["08:00", "12:00"]], "2": [] })).toEqual({
      "1": [["08:00", "12:00"], ["14:00", "18:00"]],
    });
    expect(invalidDays({ "3": [["10:00", "09:00"]] })).toEqual(["3"]);
  });
});
