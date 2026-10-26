import { describe, expect, it } from "vitest";
import { translate } from "@/i18n/messages";
import { buildPrescription, duplicateRxItems, emptyRxItem, latestPrescription, parseRxItems, rxDrugLabel } from "./clinical";
import {
  alreadyInList,
  BASE_MEDICATIONS,
  baseTemplates,
  checkedRefs,
  customTemplates,
  groupTemplates,
  MED_FIELDS,
  medicationFromRxItem,
  searchTemplates,
  templateToRxItem,
  toggleTemplate,
} from "./medications";

const fr = (k: string) => translate("fr", k);
const en = (k: string) => translate("en", k);

describe("liste de médicaments de base", () => {
  it("identifiants uniques et textes présents en fr et en", () => {
    const ids = BASE_MEDICATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { id } of BASE_MEDICATIONS) {
      for (const f of ["name", "posology", "duration"] as const) {
        for (const t of [fr, en]) {
          const key = `patients.meds.base.${id}.${f}`;
          expect(t(key), key).not.toBe(key);
          expect(t(key).trim()).not.toBe("");
        }
      }
      for (const f of MED_FIELDS) expect(fr(`patients.meds.base.${id}.${f}`)).not.toBe(`patients.meds.base.${id}.${f}`);
    }
  });

  it("contient les médicaments demandés", () => {
    const names = baseTemplates(fr).map((m) => `${m.name} ${m.strength}`);
    for (const n of ["Amoxicilline", "acide clavulanique", "Spiramycine", "Métronidazole", "Clindamycine", "Azithromycine", "Paracétamol", "Ibuprofène", "Diclofénac", "codéine", "Chlorhexidine 0,12 %", "Miconazole"]) {
      expect(names.some((x) => x.includes(n)), n).toBe(true);
    }
  });

  it("recherche sans accents, par nom, dosage ou forme", () => {
    const list = baseTemplates(fr);
    expect(searchTemplates(list, "metro").map((m) => m.ref)).toEqual(["base:spiraMetro", "base:metronidazole"]);
    expect(searchTemplates(list, "ibuprofene 400").map((m) => m.ref)).toEqual(["base:ibuprofen"]);
    expect(searchTemplates(list, "gel buccal").map((m) => m.ref)).toEqual(["base:miconazole"]);
    expect(searchTemplates(list, "")).toHaveLength(list.length);
    expect(searchTemplates(list, "zzz")).toEqual([]);
  });

  it("groupes : ma liste d'abord, groupes vides omis", () => {
    const list = [...customTemplates([{ id: "m1", name: "Eugénol", form: null, strength: null, posology: null, duration: null, instructions: null }]), ...baseTemplates(fr)];
    const groups = groupTemplates(list);
    expect(groups.map((g) => g.group)).toEqual(["custom", "antibiotics", "analgesics", "mouthwash", "antifungal", "other"]);
    expect(groupTemplates(searchTemplates(list, "chlorhex")).map((g) => g.group)).toEqual(["mouthwash"]);
  });
});

describe("construction de l'ordonnance", () => {
  const list = baseTemplates(fr);
  const amox = list.find((m) => m.ref === "base:amoxicillin")!;
  const para = list.find((m) => m.ref === "base:paracetamol")!;

  it("cocher ajoute une ligne pré-remplie (en remplaçant la ligne vide), décocher la retire", () => {
    let items = [{ ...emptyRxItem }];
    items = toggleTemplate(items, amox);
    expect(items).toEqual([templateToRxItem(amox)]);
    expect(items[0]).toMatchObject({ drug: "Amoxicilline", strength: "1 g", form: "comprimé", dosage: "1 comprimé 3 fois par jour", duration: "3 jours" });
    items = toggleTemplate(items, para);
    expect(items.map((i) => i.ref)).toEqual(["base:amoxicillin", "base:paracetamol"]);
    expect([...checkedRefs(items)]).toEqual(["base:amoxicillin", "base:paracetamol"]);
    items = toggleTemplate(items, amox);
    expect(items.map((i) => i.ref)).toEqual(["base:paracetamol"]);
  });

  it("libellé imprimé et lecture tolérante des anciennes ordonnances", () => {
    expect(rxDrugLabel({ drug: "Amoxicilline", strength: "1 g", form: "comprimé" })).toBe("Amoxicilline 1 g — comprimé");
    expect(rxDrugLabel({ drug: "Amoxicilline 500 mg" })).toBe("Amoxicilline 500 mg");
    expect(parseRxItems([{ drug: "X", ref: "base:amoxicillin" }])[0].ref).toBe("base:amoxicillin");
  });

  it("buildPrescription : création, modification, liens et ligne vide refusée", () => {
    const base = { cabinetId: "c", patientId: "p", dentistId: "d", notes: "  ", shared: true };
    expect(buildPrescription({ ...base, items: [{ ...emptyRxItem }] })).toEqual({ error: "empty", row: null });
    const created = buildPrescription({ ...base, items: [templateToRxItem(amox)], invoiceId: "i", appointmentId: "a", issuedAt: "2026-10-26T10:00:00Z" });
    expect(created.row).toMatchObject({
      cabinet_id: "c",
      patient_id: "p",
      dentist_id: "d",
      issued_at: "2026-10-26T10:00:00Z",
      notes: null,
      invoice_id: "i",
      appointment_id: "a",
      shared_with_patient: true,
    });
    const updated = buildPrescription({ ...base, id: "rx1", items: [templateToRxItem(para)], notes: "Revoir dans 3 jours" });
    expect(updated.row).toEqual({
      id: "rx1",
      items: [templateToRxItem(para)],
      notes: "Revoir dans 3 jours",
      shared_with_patient: true,
      invoice_id: null,
      appointment_id: null,
    });
    expect(updated.row).not.toHaveProperty("dentist_id");
  });

  it("dupliquer reprend les lignes de la dernière ordonnance", () => {
    const list2 = [
      { issued_at: "2026-10-01T09:00:00Z", items: [{ drug: "Ancien" }], deleted_at: null },
      { issued_at: "2026-10-20T09:00:00Z", items: [{ drug: " Paracétamol ", dosage: "1 g" }, { drug: "" }], deleted_at: null },
      { issued_at: "2026-10-25T09:00:00Z", items: [{ drug: "Supprimée" }], deleted_at: "2026-10-25T10:00:00Z" },
    ];
    const last = latestPrescription(list2)!;
    expect(duplicateRxItems(last.items)).toEqual([{ drug: "Paracétamol", form: "", strength: "", dosage: "1 g", duration: "", instructions: "" }]);
    expect(latestPrescription([])).toBeNull();
  });
});

describe("médicaments du cabinet", () => {
  it("enregistrer dans ma liste depuis une ligne libre", () => {
    const item = { drug: " Eugénol ", strength: "", form: "pâte", dosage: " ", duration: "", instructions: "Usage au fauteuil" };
    expect(medicationFromRxItem(item)).toEqual({ name: "Eugénol", form: "pâte", strength: null, posology: null, duration: null, instructions: "Usage au fauteuil" });
    const custom = customTemplates([
      { id: "m1", name: "Eugenol", form: "pâte", strength: null, posology: null, duration: null, instructions: null },
      { id: "m2", name: "Retiré", form: null, strength: null, posology: null, duration: null, instructions: null, deleted_at: "2026-10-01" },
    ]);
    expect(custom.map((m) => m.ref)).toEqual(["custom:m1"]);
    expect(alreadyInList(custom, item)).toBe(true);
    expect(alreadyInList(custom, { ...item, drug: "Autre" })).toBe(false);
  });
});
