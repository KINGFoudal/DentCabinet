import { describe, expect, it } from "vitest";
import { dictionaries, translate } from "./messages";

type Tree = { readonly [key: string]: string | Tree };

function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

describe("i18n", () => {
  it("fr et en ont exactement les mêmes clés", () => {
    expect(keys(dictionaries.en).sort()).toEqual(keys(dictionaries.fr).sort());
  });

  it("remplace les variables", () => {
    expect(translate("fr", "sync.pending", { count: 3 })).toBe("3 modification(s) en attente");
  });

  it("renvoie la clé si elle est inconnue", () => {
    expect(translate("en", "nope.nothing")).toBe("nope.nothing");
  });
});
