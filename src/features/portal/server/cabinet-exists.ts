// Vérification rapide de l'existence d'une page publique de cabinet, utilisée par le proxy
// (src/proxy.ts) pour répondre un vrai 404 avant le rendu : la page /c/[slug] est diffusée
// en flux (prérendu partiel), son statut HTTP est donc fixé avant que notFound() puisse jouer.

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const known = new Map<string, { exists: boolean; at: number }>();

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Vrai / faux selon la RPC public_cabinet ; null si la vérification est impossible (la page décidera). */
export async function publicCabinetExists(slug: string, fetchFn: FetchFn = fetch, now = Date.now()): Promise<boolean | null> {
  if (slug.length > 64 || !SLUG_RE.test(slug)) return false;
  const hit = known.get(slug);
  if (hit && now - hit.at < TTL_MS) return hit.exists;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetchFn(`${url}/rest/v1/rpc/public_cabinet`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => undefined)) as { id?: unknown } | null | undefined;
    if (data === undefined) return null;
    const exists = !!data && typeof data.id === "string";
    if (known.size >= MAX_ENTRIES) known.delete(known.keys().next().value!);
    known.set(slug, { exists, at: now });
    return exists;
  } catch {
    return null;
  }
}

/** Slug ciblé par une URL publique (/c/<slug> ou /c/<slug>/rdv), sinon null. */
export function publicSlugFromPath(pathname: string): string | null {
  const m = /^\/c\/([^/]+)(?:\/rdv)?\/?$/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
