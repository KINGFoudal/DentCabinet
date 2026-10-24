"use client";

import { supabase } from "@/lib/supabase/client";
import type { ProviderId } from "./types";

/** Appels navigateur vers les routes /api/payments (jeton de session en en-tête). */

export type InitiateRequest = {
  purpose: "invoice" | "subscription";
  invoice_id?: string;
  cabinet_id?: string;
  cycle?: "monthly" | "yearly";
  provider: ProviderId;
  phone: string;
  amount_gnf?: number;
  return_path?: string;
};

export type InitiateResponse = {
  transaction_id: string;
  status: "pending" | "succeeded" | "failed";
  instructions?: string;
  redirect_url?: string;
  sandbox?: boolean;
};

export type TxStatus = "pending" | "succeeded" | "failed" | "expired" | "refunded";

export class PaymentRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function authHeaders(locale: string) {
  const token = (await supabase().auth.getSession()).data.session?.access_token;
  if (!token) throw new PaymentRequestError("unauthorized", 401);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Accept-Language": locale };
}

async function call<T>(path: string, init: RequestInit, locale: string): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders(locale)), ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new PaymentRequestError(typeof body.error === "string" ? body.error : "internal_error", res.status);
  return body as T;
}

export function initiateMobilePayment(req: InitiateRequest, locale = "fr") {
  return call<InitiateResponse>("/api/payments/initiate", { method: "POST", body: JSON.stringify(req) }, locale);
}

export function mobilePaymentStatus(id: string, locale = "fr") {
  return call<{ status: TxStatus }>(`/api/payments/status?id=${encodeURIComponent(id)}`, { method: "GET" }, locale);
}

/** Mode sandbox uniquement : simule la réponse de l'opérateur. */
export function simulateSandboxPayment(id: string, outcome: "succeeded" | "failed", locale = "fr") {
  return call<{ status: TxStatus }>("/api/payments/sandbox", { method: "POST", body: JSON.stringify({ transaction_id: id, outcome }) }, locale);
}
