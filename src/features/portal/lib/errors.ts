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
