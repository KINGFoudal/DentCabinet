/**
 * Vérification de signature « Standard Webhooks » (utilisée par les hooks Supabase Auth).
 * Contenu signé : `${webhook-id}.${webhook-timestamp}.${corps}` ; HMAC-SHA256 ;
 * secret « v1,whsec_<base64> » ; en-tête webhook-signature : « v1,<base64> » (plusieurs séparés par des espaces).
 * Implémentation WebCrypto, sans dépendance (Deno, navigateurs, Node 20+).
 */

const TOLERANCE_S = 5 * 60;

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** « v1,whsec_abc » ou « whsec_abc » -> clé brute. */
export function secretKey(secret: string): Uint8Array<ArrayBuffer> {
  return b64decode(secret.replace(/^v1,/, "").replace(/^whsec_/, ""));
}

async function hmac(secret: string, content: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretKey(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64encode(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content)));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function signWebhook(secret: string, id: string, timestamp: number, payload: string): Promise<string> {
  return `v1,${await hmac(secret, `${id}.${timestamp}.${payload}`)}`;
}

export class WebhookVerificationError extends Error {}

type HeaderSource = Headers | Record<string, string | undefined>;

function header(h: HeaderSource, name: string) {
  return h instanceof Headers ? h.get(name) : (h[name] ?? h[name.toLowerCase()]);
}

/**
 * Vérifie la signature et renvoie le corps JSON. `secrets` : un ou plusieurs secrets
 * séparés par « | » ou des virgules hors préfixe (rotation).
 */
export async function verifyWebhook<T = unknown>(
  payload: string,
  headers: HeaderSource,
  secrets: string | string[],
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<T> {
  const id = header(headers, "webhook-id");
  const ts = header(headers, "webhook-timestamp");
  const sig = header(headers, "webhook-signature");
  if (!id || !ts || !sig) throw new WebhookVerificationError("missing headers");
  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > TOLERANCE_S) {
    throw new WebhookVerificationError("timestamp out of tolerance");
  }
  const list = (Array.isArray(secrets) ? secrets : secrets.split("|")).map((s) => s.trim()).filter(Boolean);
  const provided = sig.split(" ").map((s) => s.split(",")).filter((p) => p[0] === "v1").map((p) => p[1]);
  for (const secret of list) {
    const expected = (await signWebhook(secret, id, timestamp, payload)).slice(3);
    if (provided.some((p) => timingSafeEqual(p, expected))) return JSON.parse(payload) as T;
  }
  throw new WebhookVerificationError("invalid signature");
}
