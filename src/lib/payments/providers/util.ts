import { createHmac, timingSafeEqual } from "node:crypto";

/** Comparaison à temps constant de deux chaînes (secrets de webhook). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmacSha256(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function parseJSON(body: string): Record<string, unknown> {
  try {
    const v = JSON.parse(body);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  throw new Error("invalid JSON body");
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : undefined;
}

/** Cache mémoire d'un jeton OAuth (un par processus serveur). */
export class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;

  async get(fetchToken: () => Promise<{ token: string; expiresIn: number }>, now = Date.now()) {
    if (this.token && now < this.expiresAt) return this.token;
    const { token, expiresIn } = await fetchToken();
    this.token = token;
    // Marge de 60 s avant l'expiration annoncée.
    this.expiresAt = now + Math.max(expiresIn - 60, 30) * 1000;
    return token;
  }

  clear() {
    this.token = null;
    this.expiresAt = 0;
  }
}
