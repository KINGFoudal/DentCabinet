/**
 * Client des routes de paiement mobile (implémentées côté serveur par le module paiements) :
 *   POST /api/payments/initiate  { purpose: "invoice", invoice_id, provider, phone, amount_gnf? }
 *   GET  /api/payments/status?id=<transaction_id>
 * Le paiement réussi est enregistré par le serveur (webhook) et arrive par la synchronisation.
 */

export type MobileProvider = "orange_money" | "mtn_momo";
export type MobileStatus = "pending" | "succeeded" | "failed" | "expired";

export type InitiateResponse = {
  transaction_id: string;
  status: "pending" | "succeeded" | "failed";
  instructions?: string;
  redirect_url?: string;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "not_found" | "network" | "error"; status?: number; message?: string };

export const POLL_INTERVAL_MS = 5_000;
export const POLL_TIMEOUT_MS = 120_000;

type Fetch = typeof fetch;

async function call<T>(fetchImpl: Fetch, url: string, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    return { ok: false, kind: "network", message: e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 404) {
    // Route absente (pas encore déployée) ou transaction inconnue.
    let message: string | undefined;
    try {
      message = ((await res.json()) as { error?: string }).error;
    } catch {}
    return { ok: false, kind: "not_found", status: 404, message };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    return { ok: false, kind: "error", status: res.status, message: (body as { error?: string } | null)?.error };
  }
  return { ok: true, data: body as T };
}

export function initiateMobilePayment(
  token: string,
  body: { invoice_id: string; provider: MobileProvider; phone: string; amount_gnf?: number },
  fetchImpl: Fetch = fetch,
) {
  return call<InitiateResponse>(fetchImpl, "/api/payments/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ purpose: "invoice", ...body }),
  });
}

export function mobilePaymentStatus(token: string, transactionId: string, fetchImpl: Fetch = fetch) {
  return call<{ status: MobileStatus }>(fetchImpl, `/api/payments/status?id=${encodeURIComponent(transactionId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
}

export function isFinal(status: MobileStatus) {
  return status !== "pending";
}
