export function isStrongPassword(p: string) {
  return p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);
}

/** « Cabinet Dentaire du Port » -> « cabinet-dentaire-du-port » */
export function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const INTERNAL_ORIGIN = "http://nimba.invalid";
// Barre oblique inverse et caractères de contrôle (les navigateurs les ignorent ou les
// convertissent en « / », ce qui transforme « /\evil.com » en « //evil.com »).
const UNSAFE = /[\\\u0000-\u001f\u007f]/;

function decoded(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * N'accepte qu'un chemin interne (évite les redirections ouvertes) : le chemin est analysé
 * avec `new URL`, doit rester sur la même origine, et est renvoyé normalisé
 * (pathname + search + hash).
 */
export function safeNext(next: string | null | undefined, fallback = "/app") {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  const plain = decoded(next);
  if (plain === null || UNSAFE.test(next) || UNSAFE.test(plain) || plain.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(next, INTERNAL_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== INTERNAL_ORIGIN) return fallback;
  const path = url.pathname + url.search + url.hash;
  // « /.//evil.com » devient « //evil.com » une fois normalisé.
  return path.startsWith("//") ? fallback : path;
}
