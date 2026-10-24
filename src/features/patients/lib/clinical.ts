import type { Json } from "@/lib/database.types";

// ---------------------------------------------------------------------------
// Alertes médicales
// ---------------------------------------------------------------------------

/** Alertes prédéfinies (codes stockés dans patient_medical.alerts). */
export const MEDICAL_ALERTS = [
  "diabetes",
  "hypertension",
  "heart_disease",
  "anticoagulants",
  "pregnancy",
  "allergy",
  "asthma",
  "epilepsy",
  "hiv",
  "hepatitis",
] as const;

export type MedicalAlert = (typeof MEDICAL_ALERTS)[number];

export function isKnownAlert(code: string): code is MedicalAlert {
  return (MEDICAL_ALERTS as readonly string[]).includes(code);
}

/** Libellé d'une alerte : traduction pour les codes connus, texte libre sinon. */
export function alertLabel(t: (key: string) => string, code: string) {
  return isKnownAlert(code) ? t(`patients.alerts.${code}`) : code;
}

/** Ajoute une alerte libre (sans doublon, insensible à la casse). */
export function addAlert(list: readonly string[], value: string): string[] {
  const v = value.trim();
  if (!v) return [...list];
  if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return [...list];
  return [...list, v];
}

/** Alertes dans un ordre stable : prédéfinies d'abord (ordre de la liste), puis libres. */
export function sortAlerts(list: readonly string[]): string[] {
  const known = MEDICAL_ALERTS.filter((a) => list.includes(a));
  const free = list.filter((a) => !isKnownAlert(a));
  return [...known, ...free];
}

// ---------------------------------------------------------------------------
// Plans de traitement
// ---------------------------------------------------------------------------

type PlanItemLike = { quantity: number; unit_price_gnf: number; status: string; step: number; deleted_at?: string | null };

export function lineTotal(item: { quantity: number; unit_price_gnf: number }) {
  return Math.max(0, Math.round(item.quantity)) * Math.max(0, Math.round(Number(item.unit_price_gnf)));
}

/** Totaux d'un plan : les actes annulés ou supprimés ne comptent pas. */
export function planTotals(items: readonly PlanItemLike[]) {
  let total = 0;
  let done = 0;
  for (const it of items) {
    if (it.deleted_at || it.status === "cancelled") continue;
    const v = lineTotal(it);
    total += v;
    if (it.status === "done") done += v;
  }
  return { total, done, remaining: total - done };
}

/** Regroupe les actes par étape (ordre croissant). */
export function groupBySteps<T extends PlanItemLike>(items: readonly T[]): { step: number; items: T[] }[] {
  const map = new Map<number, T[]>();
  for (const it of items) {
    if (it.deleted_at) continue;
    const list = map.get(it.step) ?? [];
    list.push(it);
    map.set(it.step, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([step, list]) => ({ step, items: list }));
}

// ---------------------------------------------------------------------------
// Ordonnances
// ---------------------------------------------------------------------------

export type RxItem = { drug: string; dosage: string; duration: string; instructions: string };

export const emptyRxItem: RxItem = { drug: "", dosage: "", duration: "", instructions: "" };

/** Lit le champ jsonb `items` de façon tolérante. */
export function parseRxItems(json: Json | null | undefined): RxItem[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((x): x is { [key: string]: Json | undefined } => !!x && typeof x === "object" && !Array.isArray(x))
    .map((x) => ({
      drug: typeof x.drug === "string" ? x.drug : "",
      dosage: typeof x.dosage === "string" ? x.dosage : "",
      duration: typeof x.duration === "string" ? x.duration : "",
      instructions: typeof x.instructions === "string" ? x.instructions : "",
    }));
}

/** Nettoie les lignes saisies : espaces retirés, lignes sans médicament ignorées. */
export function cleanRxItems(items: readonly RxItem[]): RxItem[] {
  return items
    .map((i) => ({
      drug: i.drug.trim(),
      dosage: i.dosage.trim(),
      duration: i.duration.trim(),
      instructions: i.instructions.trim(),
    }))
    .filter((i) => i.drug);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Nom de fichier sûr pour Storage : sans accents ni caractères spéciaux, 80 caractères max. */
export function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  const base = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 80 - ext.length) || "fichier";
  return base + ext;
}

/** Chemin dans le bucket « documents » (cf. politiques storage de la migration init). */
export function documentPath(cabinetId: string, patientId: string, id: string, fileName: string) {
  return `${cabinetId}/${patientId}/${id}-${safeFileName(fileName)}`;
}

/** Remplace l'extension (ex. après conversion en JPEG). */
export function withExtension(name: string, ext: string) {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name) + ext;
}

/** Dimensions réduites pour tenir dans un carré de `max` px, proportions conservées (jamais agrandies). */
export function fitWithin(width: number, height: number, max = 1600) {
  if (width <= max && height <= max) return { width, height };
  const ratio = Math.min(max / width, max / height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** Images compressibles (pas les GIF animés ni les SVG). */
export function isCompressibleImage(mime: string) {
  return /^image\/(jpeg|png|webp|bmp|heic|heif)$/i.test(mime);
}

export function formatBytes(n: number, locale: "fr" | "en" = "fr") {
  const units = locale === "fr" ? ["o", "Ko", "Mo", "Go"] : ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v);
  return `${s} ${units[i]}`.replace(/[  ]/g, " ");
}
