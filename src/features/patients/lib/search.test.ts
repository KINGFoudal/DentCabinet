import { describe, expect, it } from "vitest";
import { filterPatient, matchesPatient, searchKey, sortPatients } from "./search";

const p = (over: Partial<Parameters<typeof sortPatients>[0][number]> & { id?: string; sex?: string; deleted_at?: string | null } = {}) => ({
  id: "x",
  first_name: "Mariama",
  last_name: "Diallo",
  file_number: "P2026-00012" as string | null,
  phone: "+224620123456" as string | null,
  created_at: "2026-10-01T10:00:00Z",
  birth_date: null as string | null,
  ...over,
});

describe("recherche de patients", () => {
  it("ignore les accents et la casse", () => {
    expect(searchKey("  Élise   KÉÏTA ")).toBe("elise keita");
    expect(matchesPatient(p({ first_name: "Fatoumata", last_name: "Kéïta" }), "keita")).toBe(true);
    expect(matchesPatient(p({ first_name: "Fatoumata", last_name: "Keita" }), "KÉÏTA")).toBe(true);
  });

  it("cherche chaque mot dans le prénom, le nom ou le numéro de dossier", () => {
    expect(matchesPatient(p(), "diallo mariama")).toBe(true);
    expect(matchesPatient(p(), "mar dia")).toBe(true);
    expect(matchesPatient(p(), "mariama camara")).toBe(false);
    expect(matchesPatient(p(), "p2026-00012")).toBe(true);
    expect(matchesPatient(p(), "00012")).toBe(true);
  });

  it("retrouve un téléphone saisi au format local ou international", () => {
    expect(matchesPatient(p(), "620 12 34")).toBe(true);
    expect(matchesPatient(p(), "+224 620 123 456")).toBe(true);
    expect(matchesPatient(p(), "0620123456")).toBe(true);
    expect(matchesPatient(p(), "62")).toBe(false);
    expect(matchesPatient(p({ phone: null }), "620")).toBe(false);
  });

  it("recherche vide : tout le monde", () => {
    expect(matchesPatient(p(), "   ")).toBe(true);
  });
});

describe("tri", () => {
  const list = [
    p({ id: "a", last_name: "Sylla", first_name: "Aïssatou", file_number: "P2026-00010", created_at: "2026-10-03T00:00:00Z", birth_date: "1990-01-01" }),
    p({ id: "b", last_name: "Bah", first_name: "Ousmane", file_number: null, created_at: "2026-10-05T00:00:00Z", birth_date: null }),
    p({ id: "c", last_name: "Barry", first_name: "Élise", file_number: "P2026-00002", created_at: "2026-10-01T00:00:00Z", birth_date: "2015-06-01" }),
  ];
  const now = new Date("2026-10-24T00:00:00Z");
  const ids = (l: { id: string }[]) => l.map((x) => x.id);

  it("par nom, sans accents", () => expect(ids(sortPatients(list, "name", now))).toEqual(["b", "c", "a"]));
  it("par n° de dossier (provisoires à la fin)", () => expect(ids(sortPatients(list, "fileNumber", now))).toEqual(["c", "a", "b"]));
  it("plus récents d'abord", () => expect(ids(sortPatients(list, "recent", now))).toEqual(["b", "a", "c"]));
  it("par âge (inconnu à la fin)", () => expect(ids(sortPatients(list, "age", now))).toEqual(["c", "a", "b"]));
  it("ne modifie pas la liste d'origine", () => {
    sortPatients(list, "name", now);
    expect(ids(list)).toEqual(["a", "b", "c"]);
  });
});

describe("filtres", () => {
  const alerts = new Set(["a"]);
  it("archivés à part", () => {
    expect(filterPatient({ id: "a", deleted_at: "2026-10-01" }, "all", alerts)).toBe(false);
    expect(filterPatient({ id: "a", deleted_at: "2026-10-01" }, "archived", alerts)).toBe(true);
    expect(filterPatient({ id: "a" }, "archived", alerts)).toBe(false);
  });
  it("sexe, alertes, provisoires", () => {
    expect(filterPatient({ id: "a", sex: "female" }, "female", alerts)).toBe(true);
    expect(filterPatient({ id: "a", sex: "female" }, "male", alerts)).toBe(false);
    expect(filterPatient({ id: "a" }, "withAlerts", alerts)).toBe(true);
    expect(filterPatient({ id: "b" }, "withAlerts", alerts)).toBe(false);
    expect(filterPatient({ id: "b", file_number: null }, "provisional", alerts)).toBe(true);
    expect(filterPatient({ id: "b", file_number: "P1" }, "provisional", alerts)).toBe(false);
  });
});
