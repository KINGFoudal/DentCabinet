import { describe, expect, it } from "vitest";
import { addDays, dayBounds, todayISO } from "./dates";

describe("dates", () => {
  it("Conakry est en UTC+0", () => {
    expect(dayBounds("2026-10-24")).toEqual(["2026-10-24T00:00:00.000Z", "2026-10-25T00:00:00.000Z"]);
  });
  it("gère un autre fuseau", () => {
    expect(dayBounds("2026-01-15", "Europe/Paris")[0]).toBe("2026-01-14T23:00:00.000Z");
  });
  it("todayISO et addDays", () => {
    expect(todayISO("Africa/Conakry", new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-24");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
