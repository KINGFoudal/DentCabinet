/** Codes renvoyés par les RPC du portail (message de l'exception Postgres). */
export const RPC_ERROR_CODES = [
  "cabinet_not_found",
  "booking_disabled",
  "type_not_bookable",
  "phone_not_verified",
  "name_required",
  "slot_unavailable",
  "too_many_bookings",
  "not_authenticated",
  "not_found",
  "not_cancellable",
  "too_late",
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

type ErrLike = { message?: string | null; code?: string | null; status?: number | null } | null | undefined;

/** Code d'erreur connu dans une erreur Supabase (PostgREST ou Auth), sinon null. */
export function rpcErrorCode(err: ErrLike): RpcErrorCode | null {
  const msg = err?.message ?? "";
  return RPC_ERROR_CODES.find((c) => msg === c || new RegExp(`\\b${c}\\b`).test(msg)) ?? null;
}

/** Clé de traduction à afficher pour une erreur. */
export function errorKey(err: ErrLike, online = typeof navigator === "undefined" ? true : navigator.onLine): string {
  if (!online) return "portal.errors.offline";
  const code = rpcErrorCode(err);
  if (code) return `portal.errors.${code}`;
  const msg = (err?.message ?? "").toLowerCase();
  if (err?.status === 429 || err?.code === "over_sms_send_rate_limit" || msg.includes("rate limit")) return "portal.errors.rate_limited";
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed"))
    return "portal.errors.offline";
  return "portal.errors.generic";
}

/**
 * Clé de traduction pour une erreur de connexion par code (Supabase Auth).
 * `step` : « send » (demande du code) ou « verify » (saisie du code).
 * Supabase ne distingue pas un code faux d'un code expiré (otp_expired dans les deux cas).
 */
export function loginErrorKey(err: ErrLike, step: "send" | "verify", online = typeof navigator === "undefined" ? true : navigator.onLine): string {
  if (!online) return "portal.errors.offline";
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  if (err?.status === 429 || code.startsWith("over_") || msg.includes("rate limit") || msg.includes("security purposes"))
    return "portal.errors.rate_limited";
  if (code === "otp_expired" || msg.includes("expired") || msg.includes("invalid")) {
    if (step === "verify") return "portal.login.invalidCode";
  }
  if (code === "email_address_invalid" || code === "validation_failed") return "portal.login.invalidEmail";
  if (code === "email_address_not_authorized") return "portal.errors.email_not_authorized";
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed"))
    return "portal.errors.offline";
  return step === "send" ? "portal.login.sendFailed" : "portal.login.invalidCode";
}
