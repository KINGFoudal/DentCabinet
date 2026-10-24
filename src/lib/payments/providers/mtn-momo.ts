import {
  PaymentProviderError,
  type Fetch,
  type InitiateInput,
  type PaymentProviderAdapter,
  type ProviderStatus,
  type StatusQuery,
  type WebhookContext,
} from "../types";
import { parseJSON, str, TokenCache } from "./util";

/**
 * MTN Mobile Money — MoMo Open API, produit « Collection », opération requestToPay.
 *
 * Sources (consultées le 24/10/2026) :
 * - Portail développeur : https://momodeveloper.mtn.com (sandbox) / https://momoapi.mtn.com (production)
 * - Passage en production, URL de base, X-Target-Environment et devise par pays (dont
 *   « MTN GuineaConakry = mtnguineaconakry, GNF ») :
 *   https://momodevelopercommunity.mtn.com/how-to-59/momo-api-production-configuration-101
 * - Codes d'erreur (en-têtes, hôte de rappel) : https://momodevelopercommunity.mtn.com/errors-46/momo-api-common-errors-82
 * - Opérations : POST {base}/collection/token/ (Basic apiUser:apiKey + Ocp-Apim-Subscription-Key),
 *   POST {base}/collection/v1_0/requesttopay (202 Accepted ; en-têtes X-Reference-Id = uuid v4,
 *   X-Target-Environment, X-Callback-Url facultatif), GET {base}/collection/v1_0/requesttopay/{id}
 *   (status PENDING | SUCCESSFUL | FAILED, financialTransactionId, reason).
 * - Le rappel (PUT ou POST sur X-Callback-Url) n'est pas signé et peut n'être envoyé qu'une fois :
 *   on ne le traite que comme un signal et on relit le statut auprès de l'API (source de vérité).
 *
 * ATTENTION — disponibilité en Guinée : MTN Group a cédé sa filiale guinéenne (Areeba Guinée)
 * à l'État guinéen le 30/12/2024 ; l'opérateur est désormais public (décret du 11/12/2025).
 *   https://www.mtn.com/mtn-concludes-the-sale-of-its-guinea-operations-to-the-state-of-guinea/
 *   https://www.rfi.fr/fr/afrique/20251213-la-guin%C3%A9e-prend-officiellement-le-contr%C3%B4le-de-l-op%C3%A9rateur-t%C3%A9l%C3%A9com-areeba-ex-mtn-guin%C3%A9e
 * L'accès à l'environnement « mtnguineaconakry » de la MoMo Open API après cette cession n'est
 * pas vérifiable publiquement : à confirmer auprès d'Areeba / MoMo Guinée avant la mise en
 * production. Toute la connexion est paramétrable (URL, environnement, devise) et un agrégateur
 * local (ex. Lengo Pay, Chap Chap Pay, qui annoncent Orange Money et MoMo Guinée) peut être
 * branché par un adaptateur dédié sans toucher au reste du code.
 */

export type MtnMomoConfig = {
  baseUrl: string;
  targetEnvironment: string;
  currency: string;
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  /** Envoyer X-Callback-Url (l'hôte doit être celui déclaré pour l'API user). */
  sendCallback: boolean;
};

export function mtnMomoConfigFromEnv(env: Record<string, string | undefined> = process.env): MtnMomoConfig {
  const target = env.MTN_MOMO_TARGET_ENV || "sandbox";
  return {
    baseUrl: (env.MTN_MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com").replace(/\/$/, ""),
    targetEnvironment: target,
    currency: env.MTN_MOMO_CURRENCY || (target === "sandbox" ? "EUR" : "GNF"),
    subscriptionKey: env.MTN_MOMO_SUBSCRIPTION_KEY || "",
    apiUser: env.MTN_MOMO_API_USER || "",
    apiKey: env.MTN_MOMO_API_KEY || "",
    sendCallback: env.MTN_MOMO_SEND_CALLBACK !== "0",
  };
}

export function mapMtnStatus(s: string | undefined): ProviderStatus {
  switch ((s ?? "").toUpperCase()) {
    case "SUCCESSFUL":
      return "succeeded";
    case "FAILED":
    case "REJECTED":
      return "failed";
    case "TIMEOUT":
    case "EXPIRED":
      return "expired";
    default:
      return "pending"; // PENDING, CREATED
  }
}

function reasonText(reason: unknown): string | undefined {
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object") {
    const r = reason as Record<string, unknown>;
    return str(r.code) ?? str(r.message);
  }
  return undefined;
}

const tokenCache = new TokenCache();

export function mtnMomoAdapter(config: MtnMomoConfig, fetchImpl: Fetch = fetch, cache = tokenCache): PaymentProviderAdapter {
  const assertConfigured = () => {
    if (!config.subscriptionKey || !config.apiUser || !config.apiKey) {
      throw new PaymentProviderError("MTN MoMo is not configured (MTN_MOMO_SUBSCRIPTION_KEY, MTN_MOMO_API_USER, MTN_MOMO_API_KEY)");
    }
  };

  const token = () =>
    cache.get(async () => {
      const res = await fetchImpl(`${config.baseUrl}/collection/token/`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${config.apiUser}:${config.apiKey}`).toString("base64"),
          "Ocp-Apim-Subscription-Key": config.subscriptionKey,
        },
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !str(json.access_token)) throw new PaymentProviderError("MTN MoMo token request failed", res.status, json);
      return { token: String(json.access_token), expiresIn: Number(json.expires_in ?? 3600) };
    });

  const headers = async (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${await token()}`,
    "X-Target-Environment": config.targetEnvironment,
    "Ocp-Apim-Subscription-Key": config.subscriptionKey,
    ...extra,
  });

  const status = async (q: StatusQuery) => {
    assertConfigured();
    const reference = q.providerReference ?? q.transactionId;
    const res = await fetchImpl(`${config.baseUrl}/collection/v1_0/requesttopay/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: await headers(),
    });
    if (res.status === 401) cache.clear();
    if (res.status === 404) return { status: "pending" as const, raw: { notFound: true } };
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new PaymentProviderError("MTN MoMo status request failed", res.status, json);
    return {
      status: mapMtnStatus(str(json.status)),
      providerTransactionId: str(json.financialTransactionId),
      failureReason: reasonText(json.reason),
      raw: json,
    };
  };

  return {
    name: "mtn_momo",

    async initiate(input: InitiateInput) {
      assertConfigured();
      const extra: Record<string, string> = {
        "X-Reference-Id": input.transactionId,
        "Content-Type": "application/json",
      };
      if (config.sendCallback) extra["X-Callback-Url"] = input.notifyUrl;
      const res = await fetchImpl(`${config.baseUrl}/collection/v1_0/requesttopay`, {
        method: "POST",
        headers: await headers(extra),
        body: JSON.stringify({
          amount: String(input.amountGnf),
          currency: config.currency,
          externalId: input.transactionId,
          payer: { partyIdType: "MSISDN", partyId: input.phone.replace(/^\+/, "") },
          // 160 caractères maximum, sans caractères spéciaux (apostrophes refusées).
          payerMessage: input.description.replace(/['’]/g, " ").slice(0, 160),
          payeeNote: input.description.replace(/['’]/g, " ").slice(0, 160),
        }),
      });
      if (res.status === 401) cache.clear();
      if (res.status !== 202) {
        const json = await res.json().catch(() => ({}));
        throw new PaymentProviderError("MTN MoMo requesttopay failed", res.status, json);
      }
      return { status: "pending" as const, providerReference: input.transactionId, raw: { accepted: true } };
    },

    status,

    parseWebhook(body: string) {
      const json = parseJSON(body);
      return {
        transactionId: str(json.externalId),
        providerReference: str(json.referenceId) ?? str(json.externalId),
        claimedStatus: mapMtnStatus(str(json.status)),
        providerTransactionId: str(json.financialTransactionId),
        failureReason: reasonText(json.reason),
        raw: json,
      };
    },

    // Le rappel MTN n'est pas signé : on relit le statut auprès de l'API.
    async verifyWebhook(ctx: WebhookContext) {
      return status(ctx.transaction);
    },
  };
}
