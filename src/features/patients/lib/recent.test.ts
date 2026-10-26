import { describe, expect, it } from "vitest";
import { pushRecent, RECENT_MAX } from "./recent";

describe("patients récents", () => {
  it("met le dernier ouvert en tête, sans doublon", () => {
    expect(pushRecent([], "a")).toEqual(["a"]);
    expect(pushRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(pushRecent(["a", "b"], "z")).toEqual(["z", "a", "b"]);
  });

  it("garde au plus quelques patients", () => {
    let list: string[] = [];
    for (let i = 0; i < 20; i++) list = pushRecent(list, `p${i}`);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toBe("p19");
  });
});
