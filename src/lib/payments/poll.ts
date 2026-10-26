// Suivi du statut d'un paiement mobile (/api/payments/status), partagé par le portail patient
// et l'abonnement. Le navigateur n'affiche que le statut renvoyé par le serveur.

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type PaymentStatus = "pending" | "succeeded" | "failed" | "expired";

const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

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
  /** Première interrogation sans attendre (reprise d'une transaction). */
  immediate?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<Exclude<PaymentStatus, "pending"> | "timeout" | "aborted"> {
  const interval = opts.intervalMs ?? 5000;
  const timeout = opts.timeoutMs ?? 120_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  let first = true;
  while (now() - start < timeout) {
    if (!(first && opts.immediate)) await sleep(interval);
    first = false;
    if (opts.signal?.aborted) return "aborted";
    const token = typeof opts.token === "function" ? await opts.token() : opts.token;
    if (!token) continue;
    const status = await fetchPaymentStatus(opts.fetchFn, token, opts.id);
    if (opts.signal?.aborted) return "aborted";
    if (status && status !== "pending") return status;
  }
  return "timeout";
}
