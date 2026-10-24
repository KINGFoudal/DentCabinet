/**
 * Webhook WhatsApp Cloud API : statuts de distribution (sent, delivered, read, failed).
 * Signature : en-tête X-Hub-Signature-256 = « sha256=<hex HMAC-SHA256(corps brut, app secret)> ».
 * Logique pure (WebCrypto), sans dépendance Deno.
 */

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";
export type StatusUpdate = { id: string; status: DeliveryStatus; error: string | null };

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/** Un statut ne recule jamais (lu > distribué > envoyé) ; un échec n'écrase pas un message distribué ou lu. */
export function shouldApplyStatus(current: string, next: DeliveryStatus): boolean {
  if (next === "failed") return current === "queued" || current === "sent";
  if (current === "failed") return true;
  return (RANK[next] ?? 0) > (RANK[current] ?? 0);
}

type MetaPayload = {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string; message?: string }[] }[];
      };
    }[];
  }[];
};

export function extractStatuses(payload: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  for (const entry of (payload as MetaPayload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        if (!s.id || !s.status || !["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        const e = s.errors?.[0];
        out.push({
          id: s.id,
          status: s.status as DeliveryStatus,
          error: e ? [e.code, e.title ?? e.message].filter(Boolean).join(" ") : null,
        });
      }
    }
  }
  return out;
}

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function metaSignature(secret: string, body: string) {
  return `sha256=${await hmacHex(secret, body)}`;
}

export async function verifyMetaSignature(body: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header) return false;
  const expected = await metaSignature(appSecret, body);
  if (expected.length !== header.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return r === 0;
}
