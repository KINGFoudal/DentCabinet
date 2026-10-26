import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/database.types";
import { adminClient } from "@/lib/supabase/server";
import { normalizeGuineaPhone } from "@/lib/format";
import { safeNext } from "@/lib/auth/validation";
import { callbackBaseUrl, paymentsMode, sandboxAllowed, sandboxSecret } from "./config";
import { localeFromRequest, paymentInstructions } from "./instructions";
import { providerAdapter } from "./registry";
import { SANDBOX_SIGNATURE_HEADER, signedSandboxNotification } from "./providers/sandbox";
import { PaymentProviderError, PROVIDERS, type ProviderId, type ProviderStatus } from "./types";

type Admin = SupabaseClient<Database>;
type Tx = Tables<"payment_transactions">;
type Role = Database["public"]["Enums"]["app_role"];
type FinalStatus = Database["public"]["Enums"]["payment_status"];

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Échec d'écriture en base pendant l'initiation (distinct d'un refus de l'opérateur). */
class StorageError extends Error {
  constructor(readonly detail: unknown) {
    super("storage_error");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.code }, e.status);
  console.error("[payments]", e);
  return json({ error: "internal_error" }, 500);
}

/**
 * Paiements disponibles seulement en mode live, ou en sandbox explicitement demandé hors
 * production : on refuse plutôt que de simuler.
 */
export function assertPaymentsAvailable() {
  if (paymentsMode() === "live") return;
  if (!sandboxAllowed()) throw new HttpError(503, "payments_not_configured");
}

async function rolesIn(sb: Admin, cabinetId: string, userId: string): Promise<Role[]> {
  const { data, error } = await sb
    .from("memberships")
    .select("roles")
    .eq("cabinet_id", cabinetId)
    .eq("user_id", userId)
    .eq("active", true)
    .is("deleted_at", null)
    .maybeSingle();
  // Une erreur de base n'est pas un refus : 500 plutôt qu'un 403/404 trompeur.
  if (error) throw error;
  return (data?.roles ?? []) as Role[];
}

export async function completeTransaction(
  sb: Admin,
  id: string,
  status: Exclude<ProviderStatus, "pending">,
  extra: { reference?: string; reason?: string; raw?: unknown } = {},
): Promise<FinalStatus> {
  const { data, error } = await sb.rpc("complete_transaction", {
    p_transaction: id,
    p_status: status,
    p_provider_reference: extra.reference,
    p_failure_reason: extra.reason,
    p_raw: (extra.raw ?? null) as Json,
  });
  if (error) throw error;
  return data as FinalStatus;
}

// ---------------------------------------------------------------------------
// Initiation
// ---------------------------------------------------------------------------

export type InitiateBody = {
  purpose?: unknown;
  invoice_id?: unknown;
  cabinet_id?: unknown;
  cycle?: unknown;
  provider?: unknown;
  phone?: unknown;
  amount_gnf?: unknown;
  /** Extension facultative : chemin de retour après la page de paiement de l'opérateur. */
  return_path?: unknown;
};

type Prepared = {
  cabinetId: string;
  purpose: "invoice" | "subscription";
  invoiceId: string | null;
  amount: number;
  cycle: "monthly" | "yearly" | null;
  planId: string | null;
  dentistCount: number | null;
  description: string;
  defaultReturn: string;
};

async function prepareInvoice(sb: Admin, userId: string, body: InitiateBody): Promise<Prepared> {
  if (typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)) throw new HttpError(400, "invalid_invoice_id");
  const { data: inv, error } = await sb
    .from("invoices")
    .select("id, cabinet_id, status, number, total_gnf, paid_gnf, deleted_at, patient:patients(portal_user_id)")
    .eq("id", body.invoice_id)
    .maybeSingle();
  if (error) throw error;
  if (!inv) throw new HttpError(404, "invoice_not_found");

  const roles = await rolesIn(sb, inv.cabinet_id, userId);
  const staff = roles.some((r) => r === "admin" || r === "dentist" || r === "assistant");
  const patient = (inv.patient as { portal_user_id: string | null } | null)?.portal_user_id === userId;
  if (!staff && !patient) throw new HttpError(403, "forbidden");

  if (inv.deleted_at || inv.status === "draft" || inv.status === "cancelled") throw new HttpError(409, "invoice_not_payable");
  const remaining = Number(inv.total_gnf) - Number(inv.paid_gnf);
  if (remaining <= 0) throw new HttpError(409, "invoice_already_paid");

  let amount = remaining;
  if (body.amount_gnf != null) {
    const a = Number(body.amount_gnf);
    if (!Number.isInteger(a) || a <= 0) throw new HttpError(400, "invalid_amount");
    if (a > remaining) throw new HttpError(409, "amount_exceeds_balance");
    amount = a;
  }
  return {
    cabinetId: inv.cabinet_id,
    purpose: "invoice",
    invoiceId: inv.id,
    amount,
    cycle: null,
    planId: null,
    dentistCount: null,
    description: `Facture ${inv.number ?? ""}`.trim(),
    defaultReturn: patient && !staff ? "/patient" : `/app/facturation/facture?id=${inv.id}`,
  };
}

async function prepareSubscription(sb: Admin, userId: string, body: InitiateBody): Promise<Prepared> {
  if (typeof body.cabinet_id !== "string" || !UUID.test(body.cabinet_id)) throw new HttpError(400, "invalid_cabinet_id");
  const cycle = body.cycle == null ? "monthly" : body.cycle;
  if (cycle !== "monthly" && cycle !== "yearly") throw new HttpError(400, "invalid_cycle");
  const roles = await rolesIn(sb, body.cabinet_id, userId);
  if (!roles.includes("admin")) throw new HttpError(403, "forbidden");

  const { data: count, error: countError } = await sb.rpc("active_dentist_count", { p_cabinet: body.cabinet_id });
  if (countError) throw countError;
  const dentists = Math.max(Number(count ?? 0), 1);
  const { data: price, error: priceError } = await sb.rpc("subscription_price", { p_dentists: dentists, p_cycle: cycle });
  if (priceError) throw priceError;
  const row = price?.[0];
  if (!row || !(Number(row.amount_gnf) > 0)) throw new HttpError(409, "no_plan_available");
  const amount = Number(row.amount_gnf);
  if (body.amount_gnf != null && Number(body.amount_gnf) !== amount) throw new HttpError(409, "amount_mismatch");

  return {
    cabinetId: body.cabinet_id,
    purpose: "subscription",
    invoiceId: null,
    amount,
    cycle,
    planId: row.plan_id,
    dentistCount: dentists,
    description: `Abonnement Nimba Dentaire ${row.plan_code} ${cycle === "yearly" ? "annuel" : "mensuel"}`,
    defaultReturn: "/app/abonnement",
  };
}

export async function initiatePayment(req: Request, userId: string) {
  assertPaymentsAvailable();
  const body = (await req.json().catch(() => null)) as InitiateBody | null;
  if (!body || typeof body !== "object") throw new HttpError(400, "invalid_body");
  if (!PROVIDERS.includes(body.provider as ProviderId)) throw new HttpError(400, "invalid_provider");
  const provider = body.provider as ProviderId;
  const phone = typeof body.phone === "string" ? normalizeGuineaPhone(body.phone) : null;
  if (!phone || !/^\+224\d{9}$/.test(phone)) throw new HttpError(400, "invalid_phone");

  const sb = adminClient();
  let prepared: Prepared;
  if (body.purpose === "invoice") prepared = await prepareInvoice(sb, userId, body);
  else if (body.purpose === "subscription") prepared = await prepareSubscription(sb, userId, body);
  else throw new HttpError(400, "invalid_purpose");

  const id = crypto.randomUUID();
  const { error: insertError } = await sb.from("payment_transactions").insert({
    id,
    cabinet_id: prepared.cabinetId,
    purpose: prepared.purpose,
    invoice_id: prepared.invoiceId,
    provider,
    amount_gnf: prepared.amount,
    payer_phone: phone,
    status: "pending",
    initiated_by: userId,
    subscription_cycle: prepared.cycle,
    plan_id: prepared.planId,
    dentist_count: prepared.dentistCount,
  });
  if (insertError) throw insertError;

  const origin = new URL(req.url).origin;
  const base = callbackBaseUrl(origin);
  const returnPath = safeNext(typeof body.return_path === "string" ? body.return_path : null, prepared.defaultReturn);
  const sep = returnPath.includes("?") ? "&" : "?";
  const locale = localeFromRequest(req);
  const sandbox = paymentsMode() === "sandbox";

  try {
    const result = await providerAdapter(provider).initiate({
      transactionId: id,
      amountGnf: prepared.amount,
      phone,
      description: prepared.description,
      notifyUrl: `${base}/api/payments/webhook/${provider}?tx=${id}`,
      returnUrl: `${base}${returnPath}${sep}payment=${id}`,
      cancelUrl: `${base}${returnPath}${sep}payment=${id}&cancelled=1`,
      locale,
    });
    // Sans référence ni jeton enregistrés, le webhook ne pourrait pas être vérifié : la
    // transaction échoue (catch ci-dessous : statut failed, réponse 502).
    const { error: refError } = await sb
      .from("payment_transactions")
      .update({ provider_reference: result.providerReference, raw: (result.raw ?? null) as Json })
      .eq("id", id);
    if (refError) throw new StorageError(refError);
    if (result.webhookSecret) {
      const { error: secretError } = await sb.from("payment_transaction_secrets").insert({ transaction_id: id, secret: result.webhookSecret });
      if (secretError) throw new StorageError(secretError);
    }
    let status: FinalStatus = "pending";
    if (result.status !== "pending") {
      status = await completeTransaction(sb, id, result.status, { reference: result.providerReference, reason: result.failureReason });
    }
    return {
      transaction_id: id,
      status: status === "succeeded" ? "succeeded" : status === "pending" ? "pending" : "failed",
      instructions: paymentInstructions(provider, locale, sandbox),
      ...(result.redirectUrl ? { redirect_url: result.redirectUrl } : {}),
      ...(sandbox ? { sandbox: true } : {}),
    };
  } catch (e) {
    const reason = e instanceof PaymentProviderError ? e.message : e instanceof StorageError ? "storage_error" : "provider_error";
    console.error("[payments] initiate", provider, e instanceof PaymentProviderError ? { status: e.httpStatus, details: e.details } : e);
    await completeTransaction(sb, id, "failed", { reason }).catch(() => undefined);
    throw new HttpError(502, "provider_unavailable");
  }
}

// ---------------------------------------------------------------------------
// Statut
// ---------------------------------------------------------------------------

async function loadTransaction(sb: Admin, id: string) {
  if (!UUID.test(id)) throw new HttpError(400, "invalid_id");
  const { data, error } = await sb.from("payment_transactions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "not_found");
  return data;
}

async function assertCanSee(sb: Admin, tx: Tx, userId: string) {
  if (tx.initiated_by === userId) return;
  const roles = await rolesIn(sb, tx.cabinet_id, userId);
  if (roles.length === 0) throw new HttpError(404, "not_found");
}

/** Interroge l'opérateur pour une transaction en attente, et la clôt si possible. */
export async function refreshTransaction(sb: Admin, tx: Tx): Promise<FinalStatus> {
  if (tx.status !== "pending") return tx.status;
  let result: Awaited<ReturnType<ReturnType<typeof providerAdapter>["status"]>> | null = null;
  try {
    result = await providerAdapter(tx.provider).status({
      transactionId: tx.id,
      providerReference: tx.provider_reference,
      amountGnf: Number(tx.amount_gnf),
    });
  } catch (e) {
    console.error("[payments] status", tx.provider, e instanceof PaymentProviderError ? { status: e.httpStatus, details: e.details } : e);
  }
  if (result && result.status !== "pending") {
    return completeTransaction(sb, tx.id, result.status, {
      reference: result.providerTransactionId,
      reason: result.failureReason,
      raw: result.raw,
    });
  }
  if (Date.now() > new Date(tx.expires_at).getTime()) {
    return completeTransaction(sb, tx.id, "expired", { reason: "expired" });
  }
  return "pending";
}

export async function transactionStatus(id: string, userId: string) {
  const sb = adminClient();
  const tx = await loadTransaction(sb, id);
  await assertCanSee(sb, tx, userId);
  const status = await refreshTransaction(sb, tx);
  return { status };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export async function handleWebhook(providerParam: string, body: string, url: URL, headers: Headers) {
  if (!PROVIDERS.includes(providerParam as ProviderId)) throw new HttpError(404, "unknown_provider");
  assertPaymentsAvailable();
  const provider = providerParam as ProviderId;
  const adapter = providerAdapter(provider);
  let parsed;
  try {
    parsed = adapter.parseWebhook(body, url, headers);
  } catch {
    throw new HttpError(400, "invalid_payload");
  }

  const sb = adminClient();
  let tx: Tx | null = null;
  if (parsed.transactionId && UUID.test(parsed.transactionId)) {
    const { data, error } = await sb.from("payment_transactions").select("*").eq("id", parsed.transactionId).eq("provider", provider).maybeSingle();
    if (error) throw error;
    tx = data;
  }
  if (!tx && parsed.providerReference) {
    const { data, error } = await sb
      .from("payment_transactions")
      .select("*")
      .eq("provider", provider)
      .eq("provider_reference", parsed.providerReference)
      .maybeSingle();
    if (error) throw error;
    tx = data;
  }
  if (!tx) throw new HttpError(404, "unknown_transaction");

  const { data: secretRow, error: secretError } = await sb
    .from("payment_transaction_secrets")
    .select("secret")
    .eq("transaction_id", tx.id)
    .maybeSingle();
  if (secretError) throw secretError;
  const verified = await adapter
    .verifyWebhook({
      parsed,
      body,
      headers,
      secret: secretRow?.secret ?? null,
      transaction: { transactionId: tx.id, providerReference: tx.provider_reference, amountGnf: Number(tx.amount_gnf) },
    })
    .catch((e) => {
      console.error("[payments] webhook verification", provider, e);
      throw new HttpError(502, "verification_unavailable");
    });
  if (!verified) throw new HttpError(401, "invalid_signature");

  if (verified.status === "pending") return { status: tx.status };
  const status = await completeTransaction(sb, tx.id, verified.status, {
    reference: verified.providerTransactionId,
    reason: verified.failureReason,
    raw: verified.raw,
  });
  return { status };
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export async function sandboxSettle(req: Request, userId: string) {
  if (!sandboxAllowed()) throw new HttpError(404, "not_found");
  const body = (await req.json().catch(() => null)) as { transaction_id?: unknown; outcome?: unknown } | null;
  const id = typeof body?.transaction_id === "string" ? body.transaction_id : "";
  const outcome = body?.outcome === "failed" ? "failed" : body?.outcome === "succeeded" ? "succeeded" : null;
  if (!outcome) throw new HttpError(400, "invalid_outcome");
  const sb = adminClient();
  const tx = await loadTransaction(sb, id);
  await assertCanSee(sb, tx, userId);

  const n = signedSandboxNotification(sandboxSecret(), {
    transaction_id: tx.id,
    reference: tx.provider_reference ?? `SBX-${tx.id}`,
    status: outcome,
    ...(outcome === "failed" ? { reason: "declined_by_payer" } : {}),
  });
  const url = new URL(`/api/payments/webhook/${tx.provider}?tx=${tx.id}`, req.url);
  return handleWebhook(tx.provider, n.body, url, new Headers({ [SANDBOX_SIGNATURE_HEADER]: n.signature }));
}
