import { describe, expect, it } from "vitest";
import { emptyPatientForm, findPhoneDuplicates, formFromPatient, validatePatientForm } from "./validation";
import {
  addAlert,
  cleanRxItems,
  documentPath,
  fitWithin,
  formatBytes,
  groupBySteps,
  isCompressibleImage,
  parseRxItems,
  planTotals,
  safeFileName,
  sortAlerts,
  withExtension,
} from "./clinical";

const today = "2026-10-24";

describe("validation de la fiche administrative", () => {
  it("prénom et nom obligatoires", () => {
    const r = validatePatientForm({ ...emptyPatientForm, first_name: " ", last_name: "" }, today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ first_name: "common.required", last_name: "common.required" });
  });

  it("normalise les téléphones en +224 et vide les champs blancs", () => {
    const r = validatePatientForm(
      {
        ...emptyPatientForm,
        first_name: " Mariama ",
        last_name: "Diallo",
        phone: "620 12 34 56",
        emergency_contact_phone: "00224 655 00 00 00",
        email: " Mariama@Example.GN ",
        city: "  ",
      },
      today,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.first_name).toBe("Mariama");
      expect(r.patch.phone).toBe("+224620123456");
      expect(r.patch.emergency_contact_phone).toBe("+224655000000");
      expect(r.patch.email).toBe("mariama@example.gn");
      expect(r.patch.city).toBeNull();
      expect(r.patch.sex).toBeNull();
      expect(r.patch.whatsapp_opt_in).toBe(true);
    }
  });

  it("refuse un téléphone, un email ou une date invalides", () => {
    const r = validatePatientForm(
      { ...emptyPatientForm, first_name: "A", last_name: "B", phone: "12", email: "x@", birth_date: "2030-01-01" },
      today,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.phone).toBe("patients.form.invalidPhone");
      expect(r.errors.email).toBe("patients.form.invalidEmail");
      expect(r.errors.birth_date).toBe("patients.form.invalidBirthDate");
    }
    const r2 = validatePatientForm({ ...emptyPatientForm, first_name: "A", last_name: "B", birth_date: "2020-02-30" }, today);
    expect(r2.ok).toBe(false);
  });

  it("pré-remplit le formulaire depuis une ligne", () => {
    const f = formFromPatient({ first_name: "A", last_name: "B", phone: "+224620000000", city: null, whatsapp_opt_in: false });
    expect(f.phone).toBe("+224620000000");
    expect(f.city).toBe("");
    expect(f.whatsapp_opt_in).toBe(false);
  });
});

describe("doublons par téléphone", () => {
  const list = [
    { id: "1", phone: "+224620123456", deleted_at: null },
    { id: "2", phone: "+224620123456", deleted_at: "2026-01-01" },
    { id: "3", phone: "+224655000000", deleted_at: null },
  ];
  it("compare après normalisation, ignore les archivés et le patient lui-même", () => {
    expect(findPhoneDuplicates(list, "620 12 34 56").map((p) => p.id)).toEqual(["1"]);
    expect(findPhoneDuplicates(list, "+224 620 12 34 56", "1")).toEqual([]);
    expect(findPhoneDuplicates(list, "")).toEqual([]);
    expect(findPhoneDuplicates(list, "abc")).toEqual([]);
  });
});

describe("alertes médicales", () => {
  it("ajoute une alerte libre sans doublon", () => {
    expect(addAlert(["diabetes"], "  Bisphosphonates ")).toEqual(["diabetes", "Bisphosphonates"]);
    expect(addAlert(["Bisphosphonates"], "bisphosphonates")).toEqual(["Bisphosphonates"]);
    expect(addAlert([], "  ")).toEqual([]);
  });
  it("trie : prédéfinies dans l'ordre de la liste, puis libres", () => {
    expect(sortAlerts(["Autre", "pregnancy", "diabetes"])).toEqual(["diabetes", "pregnancy", "Autre"]);
  });
});

describe("plans de traitement", () => {
  const items = [
    { quantity: 2, unit_price_gnf: 150000, status: "planned", step: 2 },
    { quantity: 1, unit_price_gnf: 50000, status: "done", step: 1 },
    { quantity: 1, unit_price_gnf: 999999, status: "cancelled", step: 1 },
    { quantity: 1, unit_price_gnf: 10000, status: "planned", step: 1, deleted_at: "2026-10-01" },
  ];
  it("total hors actes annulés ou supprimés", () => {
    expect(planTotals(items)).toEqual({ total: 350000, done: 50000, remaining: 300000 });
  });
  it("regroupe par étape", () => {
    const g = groupBySteps(items);
    expect(g.map((s) => [s.step, s.items.length])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });
});

describe("ordonnances", () => {
  it("lit le jsonb de façon tolérante et nettoie les lignes", () => {
    expect(parseRxItems(null)).toEqual([]);
    expect(parseRxItems([{ drug: "Amoxicilline", dosage: 3 }, "x", null])).toEqual([
      { drug: "Amoxicilline", form: "", strength: "", dosage: "", duration: "", instructions: "" },
    ]);
    expect(
      cleanRxItems([
        { drug: " Paracétamol ", dosage: " 1 g ", duration: "", instructions: "" },
        { drug: "  ", dosage: "x", duration: "", instructions: "" },
      ]),
    ).toEqual([{ drug: "Paracétamol", form: "", strength: "", dosage: "1 g", duration: "", instructions: "" }]);
  });
});

describe("documents", () => {
  it("nom de fichier sûr et chemin storage", () => {
    expect(safeFileName("Radio panoramique été 2026.JPG")).toBe("radio-panoramique-ete-2026.jpg");
    expect(safeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFileName("???")).toBe("fichier");
    expect(safeFileName("a".repeat(200) + ".pdf")).toHaveLength(80);
    expect(documentPath("cab", "pat", "id1", "Scan.pdf")).toBe("cab/pat/id1-scan.pdf");
    expect(withExtension("photo.png", ".jpg")).toBe("photo.jpg");
  });
  it("redimensionne dans 1600 px sans agrandir", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1200, 4800)).toEqual({ width: 400, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it("types d'images compressibles", () => {
    expect(isCompressibleImage("image/jpeg")).toBe(true);
    expect(isCompressibleImage("image/png")).toBe(true);
    expect(isCompressibleImage("image/gif")).toBe(false);
    expect(isCompressibleImage("application/pdf")).toBe(false);
  });
  it("tailles lisibles", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3 Mo");
  });
});
