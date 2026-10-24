// Client du paiement mobile d'une facture (routes /api/payments/* implémentées côté serveur).
// Une transaction n'est jamais considérée payée par le navigateur : on ne fait qu'afficher
// le statut renvoyé par le serveur, lui-même mis à jour par les webhooks des opérateurs.

export type Provider = "orange_money" | "mtn_momo";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "expired";

export type InitiateRequest = {
  purpose: "invoice";
  invoice_id: string;
  provider: Provider;
  phone: string;
  amount_gnf?: number;
};

export type InitiateResult =
  | {
      ok: true;
      transaction_id: string;
      status: "pending" | "succeeded" | "failed";
      instructions?: string;
      redirect_url?: string;
    }
  | { ok: false; reason: "unavailable" | "offline" | "error"; message?: string };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** N'accepte qu'une redirection https (évite javascript: et autres schémas). */
export function safeRedirect(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export async function initiatePayment(fetchFn: FetchFn, token: string, body: InitiateRequest): Promise<InitiateResult> {
  let res: Response;
  try {
    res = await fetchFn("/api/payments/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: "offline" };
  }
  // Route absente (module de paiement non déployé) ou méthode non prise en charge.
  if (res.status === 404 || res.status === 405 || res.status === 501) return { ok: false, reason: "unavailable" };
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data || typeof data.transaction_id !== "string") {
    return { ok: false, reason: "error", message: typeof data?.error === "string" ? data.error : undefined };
  }
  const status = data.status === "succeeded" || data.status === "failed" ? data.status : "pending";
  return {
    ok: true,
    transaction_id: data.transaction_id,
    status,
    instructions: typeof data.instructions === "string" ? data.instructions : undefined,
    redirect_url: safeRedirect(data.redirect_url),
  };
}

export async function fetchPaymentStatus(fetchFn: FetchFn, token: string, id: string): Promise<PaymentStatus | null> {
  try {
    const res = await fetchFn(`/api/payments/status?id=${encodeURIComponent(id)}`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { status?: unknown } | null;
    const s = data?.status;
    return s === "pending" || s === "succeeded" || s === "failed" || s === "expired" ? s : null;
  } catch {
    return null; // coupure réseau passagère : on réessaie au prochain tour
  }
}

/**
 * Interroge le statut toutes les `intervalMs` jusqu'à un état final ou `timeoutMs`.
 * Renvoie l'état final, ou "timeout". Les erreurs passagères sont ignorées.
 */
export async function pollPaymentStatus(opts: {
  fetchFn: FetchFn;
  token: string | (() => Promise<string | null>);
  id: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<Exclude<PaymentStatus, "pending"> | "timeout" | "aborted"> {
  const interval = opts.intervalMs ?? 5000;
  const timeout = opts.timeoutMs ?? 120_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  while (now() - start < timeout) {
    await sleep(interval);
    if (opts.signal?.aborted) return "aborted";
    const token = typeof opts.token === "function" ? await opts.token() : opts.token;
    if (!token) continue;
    const status = await fetchPaymentStatus(opts.fetchFn, token, opts.id);
    if (opts.signal?.aborted) return "aborted";
    if (status && status !== "pending") return status;
  }
  return "timeout";
}

/** Montant saisi valide : entier entre 1 et le reste à payer. */
export function validAmount(amount: number | null, balance: number): amount is number {
  return amount !== null && Number.isInteger(amount) && amount >= 1 && amount <= balance;
}
