/**
 * Client PostgREST minimal (clé service) pour les Edge Functions, sans dépendance.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

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
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]}: ${res.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  select<T>(path: string) {
    return this.call<T[]>("GET", path);
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
