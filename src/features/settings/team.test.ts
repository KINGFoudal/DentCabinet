import { describe, expect, it } from "vitest";
import { activeDentists, dentistsAfter, removesLastAdmin } from "./team";

const m = (id: string, roles: string[], active = true) => ({ id, roles, active, deleted_at: null });

describe("équipe", () => {
  const team = [m("a", ["admin", "dentist"]), m("b", ["dentist"]), m("c", ["assistant"]), m("d", ["dentist"], false)];

  it("compte les dentistes actifs", () => {
    expect(activeDentists(team)).toBe(2);
    expect(dentistsAfter(team, m("d", ["dentist"]))).toBe(3);
    expect(dentistsAfter(team, m("b", ["dentist"], false))).toBe(1);
    expect(dentistsAfter(team, m("new", ["dentist"]))).toBe(3);
  });

  it("empêche de retirer le dernier administrateur", () => {
    expect(removesLastAdmin(team, m("a", ["dentist"]))).toBe(true);
    expect(removesLastAdmin(team, m("a", ["admin", "dentist"], false))).toBe(true);
    expect(removesLastAdmin(team, m("b", []))).toBe(false);
    expect(removesLastAdmin([...team, m("e", ["admin"])], m("a", ["dentist"]))).toBe(false);
  });
});
