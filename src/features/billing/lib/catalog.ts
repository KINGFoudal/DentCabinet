/**
 * Liste de base d'actes dentaires courants, proposée à l'import dans le catalogue du cabinet.
 * Les prix sont INDICATIFS (ordre de grandeur en GNF) : chaque cabinet doit les ajuster.
 * Libellés en français : ce sont des données du cabinet, modifiables après import.
 */

export type BaseAct = { code: string; label: string; category: string; price_gnf: number; duration: number };

export const BASE_ACTS: readonly BaseAct[] = [
  { code: "CONS", label: "Consultation", category: "Consultation", price_gnf: 100_000, duration: 20 },
  { code: "CONS-URG", label: "Consultation d'urgence", category: "Consultation", price_gnf: 150_000, duration: 30 },
  { code: "RX-RA", label: "Radiographie rétro-alvéolaire", category: "Radiologie", price_gnf: 75_000, duration: 10 },
  { code: "RX-PANO", label: "Radiographie panoramique", category: "Radiologie", price_gnf: 250_000, duration: 15 },
  { code: "DET", label: "Détartrage et polissage", category: "Prévention", price_gnf: 250_000, duration: 30 },
  { code: "SCEL", label: "Scellement de sillons (par dent)", category: "Prévention", price_gnf: 100_000, duration: 15 },
  { code: "PARO-SURF", label: "Surfaçage radiculaire (par sextant)", category: "Parodontologie", price_gnf: 400_000, duration: 45 },
  { code: "SOIN-COMP", label: "Soin de carie – composite", category: "Soins conservateurs", price_gnf: 300_000, duration: 30 },
  { code: "SOIN-AMAL", label: "Soin de carie – amalgame", category: "Soins conservateurs", price_gnf: 250_000, duration: 30 },
  { code: "SOIN-PROV", label: "Pansement provisoire", category: "Soins conservateurs", price_gnf: 100_000, duration: 15 },
  { code: "ENDO-MONO", label: "Dévitalisation monoradiculée", category: "Endodontie", price_gnf: 500_000, duration: 60 },
  { code: "ENDO-PLURI", label: "Dévitalisation pluriradiculée", category: "Endodontie", price_gnf: 900_000, duration: 90 },
  { code: "PULPO", label: "Pulpotomie (dent de lait)", category: "Pédodontie", price_gnf: 250_000, duration: 30 },
  { code: "EXT-SIMP", label: "Extraction simple", category: "Chirurgie", price_gnf: 200_000, duration: 30 },
  { code: "EXT-CHIR", label: "Extraction chirurgicale / dent de sagesse", category: "Chirurgie", price_gnf: 600_000, duration: 60 },
  { code: "EXT-LAIT", label: "Extraction dent de lait", category: "Pédodontie", price_gnf: 100_000, duration: 15 },
  { code: "COUR-MET", label: "Couronne métallique", category: "Prothèse fixe", price_gnf: 1_200_000, duration: 60 },
  { code: "COUR-CM", label: "Couronne céramo-métallique", category: "Prothèse fixe", price_gnf: 2_500_000, duration: 60 },
  { code: "BRIDGE-3", label: "Bridge 3 éléments", category: "Prothèse fixe", price_gnf: 6_000_000, duration: 90 },
  { code: "PAP-RES", label: "Prothèse amovible partielle (résine)", category: "Prothèse amovible", price_gnf: 2_000_000, duration: 45 },
  { code: "PAC", label: "Prothèse amovible complète (par arcade)", category: "Prothèse amovible", price_gnf: 3_500_000, duration: 60 },
  { code: "BLANCH", label: "Blanchiment", category: "Esthétique", price_gnf: 1_500_000, duration: 60 },
];

/** Actes de la liste de base absents du catalogue (comparaison par code puis par libellé). */
export function actsToImport(existing: readonly { code: string | null; label: string; deleted_at?: string | null }[]) {
  const live = existing.filter((a) => !a.deleted_at);
  const codes = new Set(live.map((a) => a.code?.trim().toUpperCase()).filter(Boolean));
  const labels = new Set(live.map((a) => a.label.trim().toLowerCase()));
  return BASE_ACTS.filter((b) => !codes.has(b.code) && !labels.has(b.label.toLowerCase()));
}
