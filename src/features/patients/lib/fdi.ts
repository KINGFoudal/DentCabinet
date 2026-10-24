import type { Enums } from "@/lib/database.types";

/**
 * Numérotation dentaire FDI (ISO 3950).
 * Adulte : quadrants 1 à 4 (11-18, 21-28, 31-38, 41-48).
 * Enfant (dents temporaires) : quadrants 5 à 8 (51-55, 61-65, 71-75, 81-85).
 *
 * Affichage classique, vu par le praticien face au patient :
 *   haut : 18 … 11 | 21 … 28
 *   bas  : 48 … 41 | 31 … 38
 */

export type ToothStatus = Enums<"tooth_status">;
export type Dentition = "adult" | "child";
export type Surface = "M" | "O" | "D" | "V" | "L";

export const SURFACES: readonly Surface[] = ["M", "O", "D", "V", "L"];

const range = (quadrant: number, count: number, reverse: boolean) => {
  const r = Array.from({ length: count }, (_, i) => quadrant * 10 + i + 1);
  return reverse ? r.reverse() : r;
};

export type Quadrant = { quadrant: number; labelKey: string; teeth: number[] };

/** Quadrants dans l'ordre d'affichage : haut droite, haut gauche, bas droite, bas gauche. */
export function quadrants(dentition: Dentition): Quadrant[] {
  const [q1, q2, q3, q4] = dentition === "adult" ? [1, 2, 3, 4] : [5, 6, 7, 8];
  const n = dentition === "adult" ? 8 : 5;
  return [
    { quadrant: q1, labelKey: "patients.chart.upperRight", teeth: range(q1, n, true) },
    { quadrant: q2, labelKey: "patients.chart.upperLeft", teeth: range(q2, n, false) },
    { quadrant: q4, labelKey: "patients.chart.lowerRight", teeth: range(q4, n, true) },
    { quadrant: q3, labelKey: "patients.chart.lowerLeft", teeth: range(q3, n, false) },
  ];
}

export const ADULT_TEETH: readonly number[] = quadrants("adult").flatMap((q) => q.teeth);
export const CHILD_TEETH: readonly number[] = quadrants("child").flatMap((q) => q.teeth);

/** Vrai si le numéro est une dent FDI valide (même règle que la contrainte de la base). */
export function isValidTooth(n: number) {
  if (!Number.isInteger(n)) return false;
  const q = Math.floor(n / 10);
  const i = n % 10;
  if (q >= 1 && q <= 4) return i >= 1 && i <= 8;
  if (q >= 5 && q <= 8) return i >= 1 && i <= 5;
  return false;
}

export function dentitionOf(tooth: number): Dentition {
  return Math.floor(tooth / 10) >= 5 ? "child" : "adult";
}

export function isUpper(tooth: number) {
  const q = Math.floor(tooth / 10);
  return q === 1 || q === 2 || q === 5 || q === 6;
}

/** Quadrants affichés à gauche du schéma (côté droit du patient) : la ligne médiane est à leur droite. */
function midlineOnRight(tooth: number) {
  const q = Math.floor(tooth / 10);
  return q === 1 || q === 4 || q === 5 || q === 8;
}

/**
 * Position des faces sur le schéma d'une dent (carré à 5 zones) :
 * vestibulaire vers l'extérieur de l'arcade (haut pour le maxillaire, bas pour la mandibule),
 * mésiale du côté de la ligne médiane, occlusale au centre.
 */
export function surfaceLayout(tooth: number): { top: Surface; bottom: Surface; left: Surface; right: Surface; center: Surface } {
  const upper = isUpper(tooth);
  const mRight = midlineOnRight(tooth);
  return {
    top: upper ? "V" : "L",
    bottom: upper ? "L" : "V",
    left: mRight ? "D" : "M",
    right: mRight ? "M" : "D",
    center: "O",
  };
}

/** Ajoute ou retire une face, en gardant l'ordre canonique M O D V L et sans doublon. */
export function toggleSurface(list: readonly string[], s: Surface): Surface[] {
  const set = new Set(list.filter((x): x is Surface => (SURFACES as readonly string[]).includes(x)));
  if (set.has(s)) set.delete(s);
  else set.add(s);
  return SURFACES.filter((x) => set.has(x));
}

/** Denture affichée par défaut : enfant avant 6 ans ou si seules des dents temporaires sont renseignées. */
export function defaultDentition(age: number | null, recordedTeeth: readonly number[]): Dentition {
  const hasAdult = recordedTeeth.some((t) => dentitionOf(t) === "adult");
  const hasChild = recordedTeeth.some((t) => dentitionOf(t) === "child");
  if (hasChild && !hasAdult) return "child";
  if (hasAdult) return "adult";
  return age != null && age < 6 ? "child" : "adult";
}

/** Faces à colorer pour un état donné : les faces indiquées, ou la dent entière si aucune. */
export function coloredSurfaces(status: ToothStatus, surfaces: readonly string[]): Surface[] {
  if (status === "healthy") return [];
  const valid = SURFACES.filter((s) => surfaces.includes(s));
  return valid.length ? valid : [...SURFACES];
}

export const TOOTH_STATUSES: readonly ToothStatus[] = [
  "healthy",
  "caries",
  "filled",
  "crown",
  "root_canal",
  "fractured",
  "to_extract",
  "extracted",
  "missing",
  "implant",
  "bridge",
  "other",
];

/** Style de chaque état (jetons du thème uniquement). `cross` : dent barrée. */
export const STATUS_STYLE: Record<ToothStatus, { fill: string; swatch: string; cross?: "muted" | "danger" }> = {
  healthy: { fill: "fill-surface", swatch: "bg-surface" },
  caries: { fill: "fill-danger", swatch: "bg-danger" },
  filled: { fill: "fill-info", swatch: "bg-info" },
  crown: { fill: "fill-accent", swatch: "bg-accent" },
  root_canal: { fill: "fill-warning", swatch: "bg-warning" },
  fractured: { fill: "fill-danger-soft", swatch: "bg-danger-soft", cross: "danger" },
  to_extract: { fill: "fill-surface", swatch: "bg-surface", cross: "danger" },
  extracted: { fill: "fill-background", swatch: "bg-background", cross: "muted" },
  missing: { fill: "fill-background", swatch: "bg-background", cross: "muted" },
  implant: { fill: "fill-primary", swatch: "bg-primary" },
  bridge: { fill: "fill-primary-light", swatch: "bg-primary-light" },
  other: { fill: "fill-muted", swatch: "bg-muted" },
};

/**
 * Identifiant déterministe (UUID v5, SHA-1) de la ligne tooth_records d'une dent :
 * deux appareils hors ligne qui renseignent la même dent écrivent la même ligne
 * (pas de conflit sur la contrainte unique patient_id + tooth).
 */
export async function toothRecordId(patientId: string, tooth: number): Promise<string> {
  const data = new TextEncoder().encode(`nimba:tooth:${patientId}:${tooth}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
