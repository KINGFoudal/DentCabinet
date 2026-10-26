// Client du paiement mobile d'une facture (routes /api/payments/* implémentées côté serveur).
// Une transaction n'est jamais considérée payée par le navigateur : on ne fait qu'afficher
// le statut renvoyé par le serveur, lui-même mis à jour par les webhooks des opérateurs.
// Suivi du statut : pollPaymentStatus (@/lib/payments/poll), partagé avec l'abonnement.

import type { FetchFn } from "@/lib/payments/poll";

export type Provider = "orange_money" | "mtn_momo";

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

/** Montant saisi valide : entier entre 1 et le reste à payer. */
export function validAmount(amount: number | null, balance: number): amount is number {
  return amount !== null && Number.isInteger(amount) && amount >= 1 && amount <= balance;
}
