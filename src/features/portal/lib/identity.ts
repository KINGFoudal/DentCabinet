import { authPhoneToE164 } from "./schedule";

type AuthUserLike = { email?: string | null; phone?: string | null } | null | undefined;

/**
 * Identifiant de connexion de l'espace patient : email (connexion par code email, par défaut)
 * ou téléphone (connexion par code SMS/WhatsApp). Null si le compte n'a ni l'un ni l'autre.
 */
export function portalIdentity(user: AuthUserLike): { kind: "email"; value: string } | { kind: "phone"; value: string } | null {
  const email = user?.email?.trim();
  if (email) return { kind: "email", value: email.toLowerCase() };
  const phone = authPhoneToE164(user?.phone);
  return phone ? { kind: "phone", value: phone } : null;
}

/** Adresse email plausible (la vraie vérification est le code reçu). */
export function isPlausibleEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/** Connexion par téléphone proposée ? Désactivée par défaut (pas de fournisseur SMS en production). */
export const PHONE_LOGIN_ENABLED = process.env.NEXT_PUBLIC_PORTAL_PHONE_LOGIN === "1";
