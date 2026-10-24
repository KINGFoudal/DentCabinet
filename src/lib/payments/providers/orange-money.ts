import {
  PaymentProviderError,
  type Fetch,
  type InitiateInput,
  type PaymentProviderAdapter,
  type ProviderStatus,
  type StatusQuery,
  type WebhookContext,
} from "../types";
import { parseJSON, safeEqual, str, TokenCache } from "./util";

/**
 * Orange Money « Web Payment / M Payment » (API marchand avec redirection).
 *
 * Sources (consultées le 24/10/2026) :
 * - Présentation officielle, pays couverts (dont « Guinea Conakry »), conditions marchand :
 *   https://developer.orange.com/apis/om-webpay et https://developer.orange.com/apis/om-webpay/getting-started
 * - FAQ : https://developer.orange.com/apis/om-webpay/faq
 * - Guide « Orange Money WebPay Dev API – Getting started » (copie PDF du portail Orange,
 *   version du 18/03/2022) : https://www.scribd.com/document/951999955/Documentation-Orange-Money-WebPay-Dev
 *   -> POST {base}/orange-money-webpay/dev/v1/webpayment, champs merchant_key, currency (OUV en
 *      dev, devise du pays en production), order_id (unique, 30 car. max), amount, return_url,
 *      cancel_url, notif_url (120 car. max), lang, reference ; réponse pay_token, payment_url,
 *      notif_token.
 *   -> Notification POST sur notif_url : { status, notif_token, txnid } ; l'authenticité se
 *      vérifie en comparant notif_token à celui reçu à l'initiation.
 *   -> Statut : POST .../transactionstatus { order_id, amount, pay_token } ; valeurs INITIATED,
 *      PENDING, EXPIRED, SUCCESS, FAILED ; jeton de paiement valable 10 min par défaut.
 * - Jeton OAuth2 client_credentials : POST https://api.orange.com/oauth/v3/token (en-tête
 *   Authorization: Basic base64(client_id:client_secret)).
 *
 * NON VÉRIFIABLE sans contrat marchand Orange Guinée (isolé dans la configuration) :
 * - le chemin de production pour la Guinée (ORANGE_MONEY_WEBPAY_PATH, ex. « /orange-money-webpay/gn/v1 »
 *   par analogie avec les autres pays : à confirmer par Orange Guinée) ;
 * - la devise de production (ORANGE_MONEY_CURRENCY, a priori « GNF ») ;
 * - les plafonds, frais et l'éventuelle liste blanche d'IP des notifications.
 * Orange ne documente pas de nouvel envoi des notifications : la route de statut interroge
 * l'API transactionstatus en secours.
 */

export type OrangeMoneyConfig = {
  tokenUrl: string;
  apiBase: string;
  webpayPath: string;
  /** « Basic xxx » fourni par le portail, ou calculé depuis clientId/clientSecret. */
  authHeader: string;
  merchantKey: string;
  currency: string;
  /** Nom du marchand affiché (champ reference, 30 car. max). */
  reference: string;
};

export function orangeMoneyConfigFromEnv(env: Record<string, string | undefined> = process.env): OrangeMoneyConfig {
  const basic =
    env.ORANGE_MONEY_AUTH_HEADER ||
    (env.ORANGE_MONEY_CLIENT_ID && env.ORANGE_MONEY_CLIENT_SECRET
      ? "Basic " + Buffer.from(`${env.ORANGE_MONEY_CLIENT_ID}:${env.ORANGE_MONEY_CLIENT_SECRET}`).toString("base64")
      : "");
  return {
    tokenUrl: env.ORANGE_MONEY_TOKEN_URL || "https://api.orange.com/oauth/v3/token",
    apiBase: (env.ORANGE_MONEY_API_BASE || "https://api.orange.com").replace(/\/$/, ""),
    webpayPath: (env.ORANGE_MONEY_WEBPAY_PATH || "/orange-money-webpay/dev/v1").replace(/\/$/, ""),
    authHeader: basic,
    merchantKey: env.ORANGE_MONEY_MERCHANT_KEY || "",
    currency: env.ORANGE_MONEY_CURRENCY || "OUV",
    reference: (env.ORANGE_MONEY_REFERENCE || "Nimba Dentaire").slice(0, 30),
  };
}

/** order_id Orange : unique, 30 caractères maximum (un uuid en compte 36). */
export function orangeOrderId(transactionId: string) {
  return ("NB" + transactionId.replace(/-/g, "")).slice(0, 30);
}

export function mapOrangeStatus(s: string | undefined): ProviderStatus {
  switch ((s ?? "").toUpperCase()) {
    case "SUCCESS":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    default:
      return "pending"; // INITIATED, PENDING
  }
}

const tokenCache = new TokenCache();

export function orangeMoneyAdapter(config: OrangeMoneyConfig, fetchImpl: Fetch = fetch, cache = tokenCache): PaymentProviderAdapter {
  const assertConfigured = () => {
    if (!config.authHeader || !config.merchantKey) {
      throw new PaymentProviderError("Orange Money is not configured (ORANGE_MONEY_CLIENT_ID/SECRET, ORANGE_MONEY_MERCHANT_KEY)");
    }
  };

  const token = () =>
    cache.get(async () => {
      const res = await fetchImpl(config.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: config.authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !str(json.access_token)) throw new PaymentProviderError("Orange Money token request failed", res.status, json);
      return { token: String(json.access_token), expiresIn: Number(json.expires_in ?? 3600) };
    });

  const call = async (path: string, body: unknown) => {
    const res = await fetchImpl(`${config.apiBase}${config.webpayPath}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401) cache.clear();
    if (!res.ok) throw new PaymentProviderError(`Orange Money ${path} failed`, res.status, json);
    return json;
  };

  return {
    name: "orange_money",

    async initiate(input: InitiateInput) {
      assertConfigured();
      const json = await call("/webpayment", {
        merchant_key: config.merchantKey,
        currency: config.currency,
        order_id: orangeOrderId(input.transactionId),
        amount: input.amountGnf,
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        notif_url: input.notifyUrl,
        lang: input.locale,
        reference: config.reference,
      });
      const payToken = str(json.pay_token);
      const paymentUrl = str(json.payment_url);
      if (!payToken || !paymentUrl) throw new PaymentProviderError("Orange Money: unexpected webpayment response", 502, json);
      return {
        status: "pending" as const,
        providerReference: payToken,
        redirectUrl: paymentUrl,
        webhookSecret: str(json.notif_token),
        raw: { pay_token: payToken, payment_url: paymentUrl, status: json.status, message: json.message },
      };
    },

    async status(q: StatusQuery) {
      assertConfigured();
      if (!q.providerReference) return { status: "pending" as const };
      const json = await call("/transactionstatus", {
        order_id: orangeOrderId(q.transactionId),
        amount: q.amountGnf,
        pay_token: q.providerReference,
      });
      return { status: mapOrangeStatus(str(json.status)), providerTransactionId: str(json.txnid), raw: json };
    },

    parseWebhook(body: string, url: URL) {
      const json = parseJSON(body);
      return {
        // Notre identifiant est placé dans notif_url (?tx=...) : la notification officielle ne
        // contient que status, notif_token et txnid.
        transactionId: url.searchParams.get("tx") ?? undefined,
        providerReference: str(json.pay_token),
        claimedStatus: mapOrangeStatus(str(json.status)),
        providerTransactionId: str(json.txnid),
        raw: json,
      };
    },

    async verifyWebhook(ctx: WebhookContext) {
      const token = str((ctx.parsed.raw as Record<string, unknown>).notif_token);
      if (!ctx.secret || !safeEqual(token, ctx.secret)) return null;
      return {
        status: ctx.parsed.claimedStatus ?? "pending",
        providerTransactionId: ctx.parsed.providerTransactionId,
        raw: ctx.parsed.raw,
      };
    },
  };
}
