import type { InitiateInput, PaymentProviderAdapter, ProviderId, ProviderStatus, WebhookContext } from "../types";
import { hmacSha256, parseJSON, safeEqual, str } from "./util";

/**
 * Opérateur simulé (PAYMENTS_MODE=sandbox).
 *
 * - L'initiation renvoie toujours « en attente », sans redirection.
 * - Le résultat est décidé par la route de test POST /api/payments/sandbox, qui envoie au
 *   gestionnaire de webhook une notification signée (HMAC-SHA256, en-tête
 *   `x-nimba-sandbox-signature`) : c'est le même chemin que pour un vrai opérateur.
 * - Interroger le statut renvoie « en attente » : l'état fait foi dans la base.
 */
export const SANDBOX_SIGNATURE_HEADER = "x-nimba-sandbox-signature";

export function sandboxAdapter(provider: ProviderId, secret: string): PaymentProviderAdapter {
  return {
    name: `sandbox:${provider}`,

    async initiate(input: InitiateInput) {
      return { status: "pending", providerReference: `SBX-${input.transactionId}`, raw: { sandbox: true } };
    },

    async status() {
      return { status: "pending" as const };
    },

    parseWebhook(body: string) {
      const json = parseJSON(body);
      const status = str(json.status);
      const claimed: ProviderStatus | undefined =
        status === "succeeded" || status === "failed" || status === "expired" || status === "pending" ? status : undefined;
      return {
        transactionId: str(json.transaction_id),
        providerReference: str(json.reference),
        claimedStatus: claimed,
        providerTransactionId: str(json.reference),
        failureReason: str(json.reason),
        raw: json,
      };
    },

    async verifyWebhook(ctx: WebhookContext) {
      const signature = ctx.headers.get(SANDBOX_SIGNATURE_HEADER);
      if (!safeEqual(signature, hmacSha256(secret, ctx.body))) return null;
      if (!ctx.parsed.claimedStatus) return null;
      return {
        status: ctx.parsed.claimedStatus,
        providerTransactionId: ctx.parsed.providerTransactionId,
        failureReason: ctx.parsed.failureReason,
        raw: ctx.parsed.raw,
      };
    },
  };
}

/** Construit une notification simulée signée (utilisée par la route de test et les tests). */
export function signedSandboxNotification(
  secret: string,
  payload: { transaction_id: string; reference: string; status: "succeeded" | "failed"; reason?: string },
) {
  const body = JSON.stringify(payload);
  return { body, signature: hmacSha256(secret, body) };
}
