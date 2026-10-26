/**
 * Client PostgREST minimal (clé service) pour les Edge Functions, sans dépendance.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Délai maximal d'une requête PostgREST. */
export const REST_TIMEOUT_MS = 10_000;

export class Rest {
  constructor(
    private url: string,
    private key: string,
    private fetchFn: Fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async call<T>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
    const res = await this.fetchFn(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, {
      method,
      headers: this.headers(prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]}: ${res.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  select<T>(path: string) {
    return this.call<T[]>("GET", path);
  }

  /**
   * Lit toutes les lignes, page par page : PostgREST tronque silencieusement une réponse à
   * `max_rows` (1000 par défaut). `path` doit contenir un ordre stable (ex. `order=starts_at,id`).
   * S'arrête sur une page vide, ce qui reste juste si le serveur plafonne sous `pageSize`.
   */
  async selectAll<T>(path: string, pageSize = 1000) {
    const out: T[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (;;) {
      const page = await this.select<T>(`${path}${sep}limit=${pageSize}&offset=${out.length}`);
      if (page.length === 0) return out;
      out.push(...page);
    }
  }

  insert<T>(table: string, rows: unknown, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    const q = opts.onConflict ? `?on_conflict=${opts.onConflict}` : "";
    const prefer = ["return=representation", opts.ignoreDuplicates ? "resolution=ignore-duplicates" : ""].filter(Boolean).join(",");
    return this.call<T[]>("POST", `${table}${q}`, rows, prefer);
  }

  update<T>(table: string, filter: string, patch: unknown) {
    return this.call<T[]>("PATCH", `${table}?${filter}`, patch, "return=representation");
  }
}

/** Liste d'identifiants pour un filtre PostgREST « in.(...) ». */
export function inList(ids: Iterable<string>) {
  return `in.(${[...new Set(ids)].map((id) => encodeURIComponent(id)).join(",")})`;
}

export function chunks<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
