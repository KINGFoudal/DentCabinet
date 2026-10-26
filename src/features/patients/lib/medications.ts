import type { Row } from "@/lib/local/db";
import type { RxItem } from "./clinical";
import { searchKey } from "./search";

/**
 * Liste de base des médicaments couramment prescrits en cabinet dentaire (adulte).
 *
 * Les textes (nom, forme, dosage, posologie, durée, consignes) sont dans
 * src/features/patients/messages.ts (clés `patients.meds.base.<id>.*`, fr et en).
 *
 * POSOLOGIES INDICATIVES pour un adulte sans terrain particulier : le praticien les adapte
 * (poids, âge, grossesse, insuffisance rénale ou hépatique, allergies, interactions).
 * Sources consultées (octobre 2026) :
 * - HAS, « Prescription des antibiotiques en pratique bucco-dentaire », recommandation du
 *   14 septembre 2026 (mise à jour des recommandations ANSM 2011), résumée par VIDAL :
 *   https://www.vidal.fr/actualites/38301-soins-dentaires-limiter-l-usage-des-antibiotiques.html
 *   et La Revue du Praticien :
 *   https://www.larevuedupraticien.fr/article/antibiotiques-dans-les-urgences-et-soins-dentaires-des-changements
 *   · amoxicilline curative : 1 g × 3/j pendant 3 jours, réévaluation à 48–72 h ;
 *   · antibioprophylaxie : amoxicilline 2 g 1 h avant le geste (jusqu'à 2 h après) ;
 *   · amoxicilline + acide clavulanique 1 g/125 mg × 3/j : 7 jours (sinusite d'origine dentaire) ;
 *   · métronidazole 500 mg × 3/j pendant 3 jours (maladie parodontale nécrosante) ;
 *   · allergie aux pénicillines : clarithromycine 500 mg × 2/j ou azithromycine 500 mg/j ;
 *     la clindamycine n'a plus qu'une place très limitée.
 * - ANSM (Afssaps), « Prescription des antibiotiques en pratique bucco-dentaire », juillet 2011 :
 *   clindamycine 1 200 mg/j en 2 prises ; azithromycine 500 mg/j pendant 3 jours ;
 *   clarithromycine 1 000 mg/j en 2 prises ; durée habituelle 7 jours.
 * - Résumés des caractéristiques du produit (base de données publique des médicaments,
 *   https://base-donnees-publique.medicaments.gouv.fr) : spiramycine + métronidazole (Rodogyl :
 *   4 à 6 comprimés/j en 2 à 3 prises), paracétamol (1 g par prise, 4 h minimum entre deux prises ;
 *   ANSM 2019 : 3 g/j sans avis médical, 4 g/j maximum), ibuprofène (400 mg par prise,
 *   1 200 mg/j), diclofénac (100 à 150 mg/j en 2 à 3 prises), paracétamol 500 mg + codéine 30 mg
 *   (1 à 2 comprimés par prise, 6 h minimum entre deux prises ; ANSM 2013 : contre-indiqué avant
 *   12 ans et pendant l'allaitement), miconazole gel buccal 2 % (Daktarin : 1 cuillère-mesure
 *   4 fois/j, 7 à 15 jours ; contre-indiqué avec les AVK).
 * - Chlorhexidine 0,12 % : 15 mL pendant 30 s, 2 fois par jour (notice des bains de bouche à
 *   0,12 %, ex. Peridex, FDA).
 */

export const MED_GROUPS = ["antibiotics", "analgesics", "mouthwash", "antifungal", "other"] as const;
export type MedGroup = (typeof MED_GROUPS)[number];

export const BASE_MEDICATIONS: readonly { id: string; group: MedGroup }[] = [
  { id: "amoxicillin", group: "antibiotics" },
  { id: "amoxiClav", group: "antibiotics" },
  { id: "spiraMetro", group: "antibiotics" },
  { id: "metronidazole", group: "antibiotics" },
  { id: "clindamycin", group: "antibiotics" },
  { id: "azithromycin", group: "antibiotics" },
  { id: "clarithromycin", group: "antibiotics" },
  { id: "paracetamol", group: "analgesics" },
  { id: "ibuprofen", group: "analgesics" },
  { id: "diclofenac", group: "analgesics" },
  { id: "paracetamolCodeine", group: "analgesics" },
  { id: "chlorhexidine", group: "mouthwash" },
  { id: "miconazole", group: "antifungal" },
  { id: "amoxicillinProphylaxis", group: "other" },
];

export const MED_FIELDS = ["name", "form", "strength", "posology", "duration", "instructions"] as const;

/** Médicament proposé dans la liste (de base ou du cabinet). `ref` identifie la source. */
export type MedTemplate = {
  ref: string;
  group: MedGroup | "custom";
  name: string;
  form: string;
  strength: string;
  posology: string;
  duration: string;
  instructions: string;
};

type T = (key: string) => string;

export const baseRef = (id: string) => `base:${id}`;
export const customRef = (id: string) => `custom:${id}`;

/** Liste de base traduite. */
export function baseTemplates(t: T): MedTemplate[] {
  return BASE_MEDICATIONS.map(({ id, group }) => {
    const f = (k: (typeof MED_FIELDS)[number]) => t(`patients.meds.base.${id}.${k}`);
    return {
      ref: baseRef(id),
      group,
      name: f("name"),
      form: f("form"),
      strength: f("strength"),
      posology: f("posology"),
      duration: f("duration"),
      instructions: f("instructions"),
    };
  });
}

type MedicationRow = Pick<Row<"medications">, "id" | "name" | "form" | "strength" | "posology" | "duration" | "instructions"> & {
  deleted_at?: string | null;
};

/** Médicaments du cabinet (non supprimés), triés par nom. */
export function customTemplates(rows: readonly MedicationRow[]): MedTemplate[] {
  return rows
    .filter((r) => !r.deleted_at)
    .map((r) => ({
      ref: customRef(r.id),
      group: "custom" as const,
      name: r.name,
      form: r.form ?? "",
      strength: r.strength ?? "",
      posology: r.posology ?? "",
      duration: r.duration ?? "",
      instructions: r.instructions ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** Recherche sans accents : chaque mot doit apparaître dans le nom, le dosage ou la forme. */
export function searchTemplates(list: readonly MedTemplate[], query: string): MedTemplate[] {
  const q = searchKey(query);
  if (!q) return [...list];
  const tokens = q.split(" ");
  return list.filter((m) => {
    const hay = searchKey(`${m.name} ${m.strength} ${m.form}`);
    return tokens.every((tok) => hay.includes(tok));
  });
}

/** Groupes non vides, dans l'ordre : médicaments du cabinet d'abord, puis la liste de base. */
export function groupTemplates(list: readonly MedTemplate[]): { group: MedGroup | "custom"; items: MedTemplate[] }[] {
  const order: (MedGroup | "custom")[] = ["custom", ...MED_GROUPS];
  return order.map((group) => ({ group, items: list.filter((m) => m.group === group) })).filter((g) => g.items.length > 0);
}

/** Ligne d'ordonnance pré-remplie depuis un médicament de la liste. */
export function templateToRxItem(m: MedTemplate): RxItem {
  return {
    drug: m.name,
    form: m.form,
    strength: m.strength,
    dosage: m.posology,
    duration: m.duration,
    instructions: m.instructions,
    ref: m.ref,
  };
}

/** Coche / décoche un médicament : ajoute sa ligne ou retire la ligne issue de ce médicament. */
export function toggleTemplate(items: readonly RxItem[], m: MedTemplate): RxItem[] {
  if (items.some((i) => i.ref === m.ref)) return items.filter((i) => i.ref !== m.ref);
  // Remplace la première ligne vide (ordonnance vierge) plutôt que d'en ajouter une.
  const blank = items.findIndex((i) => !i.drug.trim() && !i.dosage.trim() && !i.ref);
  if (blank >= 0) return items.map((i, j) => (j === blank ? templateToRxItem(m) : i));
  return [...items, templateToRxItem(m)];
}

/** Références cochées. */
export function checkedRefs(items: readonly RxItem[]): Set<string> {
  return new Set(items.map((i) => i.ref).filter((r): r is string => !!r));
}

/** Champs d'un médicament du cabinet créé depuis une ligne libre (« enregistrer dans ma liste »). */
export function medicationFromRxItem(item: RxItem) {
  const v = (s: string | undefined) => (s ?? "").trim() || null;
  return {
    name: item.drug.trim(),
    form: v(item.form),
    strength: v(item.strength),
    posology: v(item.dosage),
    duration: v(item.duration),
    instructions: v(item.instructions),
  };
}

/** Vrai si un médicament du même nom et du même dosage existe déjà dans la liste du cabinet. */
export function alreadyInList(list: readonly MedTemplate[], item: RxItem) {
  const k = searchKey(`${item.drug} ${item.strength ?? ""}`);
  return list.some((m) => m.group === "custom" && searchKey(`${m.name} ${m.strength}`) === k);
}
