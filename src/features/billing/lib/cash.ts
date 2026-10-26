/**
 * Paiement en espèces au comptoir : monnaie à rendre et montants remis courants.
 * Le franc guinéen n'a pas de décimales ; le plus gros billet courant est de 20 000 GNF.
 */

/** Monnaie à rendre (0 si le montant remis est absent ou insuffisant). */
export function changeDue(amount: number, tendered: number | null | undefined): number {
  if (tendered == null || !Number.isFinite(tendered) || !Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(tendered) - Math.round(amount));
}

/** Le montant remis couvre-t-il le montant encaissé ? (vide = montant exact, accepté). */
export function tenderCovers(amount: number, tendered: number | null | undefined): boolean {
  return tendered == null || tendered >= amount;
}

const STEPS = [10_000, 20_000, 50_000, 100_000];

/**
 * Montants remis probables, au-dessus du montant à encaisser : arrondis au 10 000, 20 000,
 * 50 000 et 100 000 supérieurs (sans doublon, au plus 3).
 */
export function tenderSuggestions(amount: number): number[] {
  if (!Number.isFinite(amount) || amount <= 0) return [];
  const out: number[] = [];
  for (const step of STEPS) {
    const v = Math.ceil(amount / step) * step;
    const next = v === amount ? v + step : v;
    if (!out.includes(next)) out.push(next);
  }
  return out.sort((a, b) => a - b).slice(0, 3);
}
