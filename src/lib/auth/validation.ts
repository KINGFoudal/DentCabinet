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

/** N'accepte qu'un chemin interne (évite les redirections ouvertes). */
export function safeNext(next: string | null | undefined, fallback = "/app") {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
