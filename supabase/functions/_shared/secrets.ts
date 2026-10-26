/**
 * Comparaison de secrets à temps constant (en-têtes d'authentification des Edge Functions).
 * Les deux valeurs sont d'abord hachées (SHA-256) : la durée ne dépend ni du contenu ni de la
 * longueur du secret attendu. Une valeur vide ou absente n'est jamais acceptée.
 */
export async function secretsEqual(given: string | null | undefined, expected: string | null | undefined): Promise<boolean> {
  if (typeof given !== "string" || typeof expected !== "string" || !given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}
