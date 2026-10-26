import { describe, expect, it, vi } from "vitest";
import { mapMtnStatus, mtnMomoAdapter, mtnMomoConfigFromEnv } from "./mtn-momo";
import { mapOrangeStatus, orangeMoneyAdapter, orangeMoneyConfigFromEnv, orangeOrderId } from "./orange-money";
import { sandboxAdapter, SANDBOX_SIGNATURE_HEADER, signedSandboxNotification } from "./sandbox";
import { TokenCache, withTimeout } from "./util";
import type { Fetch, InitiateInput } from "../types";

const TX = "3f2b9c1e-7a4d-4b8e-9f00-1234567890ab";

const input: InitiateInput = {
  transactionId: TX,
  amountGnf: 150000,
  phone: "+224620000001",
  description: "Facture F-2026-00001",
  notifyUrl: `https://nimba.example/api/payments/webhook/orange_money?tx=${TX}`,
  returnUrl: "https://nimba.example/patient?payment=1",
  cancelUrl: "https://nimba.example/patient?cancelled=1",
  locale: "fr",
};

type Call = { url: string; init?: RequestInit };

function mockFetch(responses: Array<(c: Call) => Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    const next = responses.shift();
    if (!next) throw new Error("unexpected call " + url);
    return next(c);
  });
  return { fetch: fn as unknown as Fetch, calls };
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Orange Money Web Payment", () => {
  const config = orangeMoneyConfigFromEnv({
    ORANGE_MONEY_CLIENT_ID: "id",
    ORANGE_MONEY_CLIENT_SECRET: "secret",
    ORANGE_MONEY_MERCHANT_KEY: "a86b2087",
  });

  it("obtient un jeton puis crée le paiement web", async () => {
    const { fetch, calls } = mockFetch([
      () => jsonRes({ token_type: "Bearer", access_token: "tok", expires_in: 3600 }),
      () =>
        jsonRes(
          { status: 201, message: "OK", pay_token: "pt123", payment_url: "https://webpayment.example/pay/pt123", notif_token: "nt456" },
          201,
        ),
    ]);
    const om = orangeMoneyAdapter(config, fetch, new TokenCache());
    const r = await om.initiate(input);

    expect(calls[0].url).toBe("https://api.orange.com/oauth/v3/token");
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe("Basic " + Buffer.from("id:secret").toString("base64"));
    expect(calls[0].init!.body).toBe("grant_type=client_credentials");

    expect(calls[1].url).toBe("https://api.orange.com/orange-money-webpay/dev/v1/webpayment");
    const sent = JSON.parse(String(calls[1].init!.body));
    expect(sent).toMatchObject({ merchant_key: "a86b2087", currency: "OUV", amount: 150000, lang: "fr", notif_url: input.notifyUrl });
    expect(sent.order_id).toHaveLength(30);
    expect(sent.order_id).toBe(orangeOrderId(TX));

    expect(r).toMatchObject({ status: "pending", providerReference: "pt123", redirectUrl: "https://webpayment.example/pay/pt123", webhookSecret: "nt456" });
  });

  it("borne chaque appel réseau par un délai", async () => {
    const { fetch, calls } = mockFetch([
      () => jsonRes({ access_token: "tok", expires_in: 3600 }),
      () => jsonRes({ pay_token: "pt", payment_url: "https://x", notif_token: "n" }, 201),
    ]);
    await orangeMoneyAdapter(config, fetch, new TokenCache()).initiate(input);
    for (const c of calls) expect(c.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("échoue proprement si l'opérateur ne répond pas", async () => {
    const hanging: Fetch = (_url, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    await expect(withTimeout(hanging, 20)("https://api.example")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("interroge transactionstatus et convertit le statut", async () => {
    const { fetch, calls } = mockFetch([
      () => jsonRes({ access_token: "tok", expires_in: 3600 }),
      () => jsonRes({ status: "SUCCESS", order_id: orangeOrderId(TX), txnid: "MP150709.1341.A00073" }, 201),
    ]);
    const om = orangeMoneyAdapter(config, fetch, new TokenCache());
    const r = await om.status({ transactionId: TX, providerReference: "pt123", amountGnf: 150000 });
    expect(calls[1].url).toBe("https://api.orange.com/orange-money-webpay/dev/v1/transactionstatus");
    expect(JSON.parse(String(calls[1].init!.body))).toEqual({ order_id: orangeOrderId(TX), amount: 150000, pay_token: "pt123" });
    expect(r).toMatchObject({ status: "succeeded", providerTransactionId: "MP150709.1341.A00073" });
  });

  it("n'accepte une notification que si notif_token correspond", async () => {
    const om = orangeMoneyAdapter(config, mockFetch([]).fetch, new TokenCache());
    const body = JSON.stringify({ status: "SUCCESS", notif_token: "nt456", txnid: "MP1" });
    const url = new URL(input.notifyUrl);
    const parsed = om.parseWebhook(body, url, new Headers());
    expect(parsed.transactionId).toBe(TX);
    const tx = { transactionId: TX, providerReference: "pt123", amountGnf: 150000 };
    expect(await om.verifyWebhook({ parsed, body, headers: new Headers(), transaction: tx, secret: "nt456" })).toMatchObject({
      status: "succeeded",
      providerTransactionId: "MP1",
    });
    expect(await om.verifyWebhook({ parsed, body, headers: new Headers(), transaction: tx, secret: "other" })).toBeNull();
    expect(await om.verifyWebhook({ parsed, body, headers: new Headers(), transaction: tx, secret: null })).toBeNull();
  });

  it("convertit les statuts Orange", () => {
    expect(mapOrangeStatus("INITIATED")).toBe("pending");
    expect(mapOrangeStatus("PENDING")).toBe("pending");
    expect(mapOrangeStatus("EXPIRED")).toBe("expired");
    expect(mapOrangeStatus("FAILED")).toBe("failed");
  });

  it("refuse de fonctionner sans configuration", async () => {
    const om = orangeMoneyAdapter(orangeMoneyConfigFromEnv({}), mockFetch([]).fetch, new TokenCache());
    await expect(om.initiate(input)).rejects.toThrow(/not configured/);
  });
});

describe("MTN MoMo Collection requestToPay", () => {
  const config = mtnMomoConfigFromEnv({ MTN_MOMO_SUBSCRIPTION_KEY: "sub", MTN_MOMO_API_USER: "user", MTN_MOMO_API_KEY: "key" });

  it("envoie requesttopay avec les en-têtes MoMo", async () => {
    const { fetch, calls } = mockFetch([() => jsonRes({ access_token: "tok", token_type: "access_token", expires_in: 3600 }), () => new Response(null, { status: 202 })]);
    const momo = mtnMomoAdapter(config, fetch, new TokenCache());
    const r = await momo.initiate({ ...input, description: "Facture d'acte" });

    expect(calls[0].url).toBe("https://sandbox.momodeveloper.mtn.com/collection/token/");
    const tokenHeaders = calls[0].init!.headers as Record<string, string>;
    expect(tokenHeaders.Authorization).toBe("Basic " + Buffer.from("user:key").toString("base64"));
    expect(tokenHeaders["Ocp-Apim-Subscription-Key"]).toBe("sub");

    expect(calls[1].url).toBe("https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay");
    const h = calls[1].init!.headers as Record<string, string>;
    expect(h).toMatchObject({ Authorization: "Bearer tok", "X-Reference-Id": TX, "X-Target-Environment": "sandbox", "X-Callback-Url": input.notifyUrl });
    const body = JSON.parse(String(calls[1].init!.body));
    expect(body).toMatchObject({ amount: "150000", currency: "EUR", externalId: TX, payer: { partyIdType: "MSISDN", partyId: "224620000001" } });
    expect(body.payerMessage).not.toContain("'");
    expect(r).toMatchObject({ status: "pending", providerReference: TX });
  });

  it("utilise GNF et l'environnement guinéen en production", () => {
    const c = mtnMomoConfigFromEnv({ MTN_MOMO_TARGET_ENV: "mtnguineaconakry", MTN_MOMO_BASE_URL: "https://proxy.momoapi.mtn.com" });
    expect(c.currency).toBe("GNF");
    expect(c.baseUrl).toBe("https://proxy.momoapi.mtn.com");
  });

  it("signale un refus de l'opérateur", async () => {
    const { fetch } = mockFetch([() => jsonRes({ access_token: "tok", expires_in: 3600 }), () => jsonRes({ code: "INVALID_CURRENCY" }, 500)]);
    await expect(mtnMomoAdapter(config, fetch, new TokenCache()).initiate(input)).rejects.toThrow(/requesttopay failed/);
  });

  it("vérifie un rappel en relisant le statut (le rappel n'est pas signé)", async () => {
    const { fetch, calls } = mockFetch([
      () => jsonRes({ access_token: "tok", expires_in: 3600 }),
      () => jsonRes({ amount: "150000", currency: "GNF", externalId: TX, status: "FAILED", reason: "LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED" }),
    ]);
    const momo = mtnMomoAdapter(config, fetch, new TokenCache());
    // Le rappel prétend une réussite ; l'API dit « échec » : c'est l'API qui fait foi.
    const body = JSON.stringify({ externalId: TX, status: "SUCCESSFUL", financialTransactionId: "123" });
    const parsed = momo.parseWebhook(body, new URL("https://x/y"), new Headers());
    expect(parsed).toMatchObject({ transactionId: TX, claimedStatus: "succeeded" });
    const v = await momo.verifyWebhook({ parsed, body, headers: new Headers(), secret: null, transaction: { transactionId: TX, providerReference: TX, amountGnf: 150000 } });
    expect(calls[1].url).toBe(`https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${TX}`);
    expect(v).toMatchObject({ status: "failed", failureReason: "LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED" });
  });

  it("garde le jeton en cache", async () => {
    const { fetch, calls } = mockFetch([
      () => jsonRes({ access_token: "tok", expires_in: 3600 }),
      () => jsonRes({ status: "PENDING" }),
      () => jsonRes({ status: "SUCCESSFUL", financialTransactionId: "42" }),
    ]);
    const momo = mtnMomoAdapter(config, fetch, new TokenCache());
    const q = { transactionId: TX, providerReference: TX, amountGnf: 1 };
    expect((await momo.status(q)).status).toBe("pending");
    expect(await momo.status(q)).toMatchObject({ status: "succeeded", providerTransactionId: "42" });
    expect(calls.filter((c) => c.url.endsWith("/token/"))).toHaveLength(1);
  });

  it("convertit les statuts MTN", () => {
    expect(mapMtnStatus("SUCCESSFUL")).toBe("succeeded");
    expect(mapMtnStatus("PENDING")).toBe("pending");
    expect(mapMtnStatus("FAILED")).toBe("failed");
  });
});

describe("opérateur simulé (sandbox)", () => {
  const sbx = sandboxAdapter("orange_money", "s3cret");

  it("vérifie la signature HMAC des notifications simulées", async () => {
    const n = signedSandboxNotification("s3cret", { transaction_id: TX, reference: `SBX-${TX}`, status: "succeeded" });
    const parsed = sbx.parseWebhook(n.body, new URL("https://x"), new Headers());
    const tx = { transactionId: TX, providerReference: `SBX-${TX}`, amountGnf: 1 };
    const good = new Headers({ [SANDBOX_SIGNATURE_HEADER]: n.signature });
    expect(await sbx.verifyWebhook({ parsed, body: n.body, headers: good, secret: null, transaction: tx })).toMatchObject({ status: "succeeded" });

    const bad = new Headers({ [SANDBOX_SIGNATURE_HEADER]: "0".repeat(64) });
    expect(await sbx.verifyWebhook({ parsed, body: n.body, headers: bad, secret: null, transaction: tx })).toBeNull();

    const tampered = n.body.replace("succeeded", "failed");
    expect(await sbx.verifyWebhook({ parsed: sbx.parseWebhook(tampered, new URL("https://x"), new Headers()), body: tampered, headers: good, secret: null, transaction: tx })).toBeNull();
  });

  it("met la transaction en attente sans redirection", async () => {
    expect(await sbx.initiate(input)).toMatchObject({ status: "pending", providerReference: `SBX-${TX}` });
  });
});
