/**
 * Configuration des paiements mobiles (variables d'environnement serveur).
 *
 * PAYMENTS_MODE
 *   - "live" : appels réels aux API Orange Money / MTN MoMo (voir les adaptateurs).
 *   - "sandbox" : opérateur simulé, aucune somme débitée. Route de test
 *     /api/payments/sandbox disponible pour confirmer ou faire échouer une transaction.
 *     Exige PAYMENTS_SANDBOX_SECRET (clé HMAC des notifications simulées).
 *   - absent ou autre valeur : paiements mobiles désactivés (503).
 *
 * Le mode sandbox est refusé sur un déploiement de production : NIMBA_ENV=production,
 * VERCEL_ENV=production, ou NODE_ENV=production sans NIMBA_ENV=development (c'est le cas de
 * `next start` : un serveur local de test doit définir NIMBA_ENV=development).
 */

export type PaymentsMode = "sandbox" | "live" | "disabled";

type Env = Record<string, string | undefined>;

export function isProductionDeployment(env: Env = process.env) {
  if (env.NIMBA_ENV === "production" || env.VERCEL_ENV === "production") return true;
  return env.NODE_ENV === "production" && env.NIMBA_ENV !== "development";
}

export function paymentsMode(env: Env = process.env): PaymentsMode {
  if (env.PAYMENTS_MODE === "live") return "live";
  if (env.PAYMENTS_MODE === "sandbox") return "sandbox";
  return "disabled";
}

/** Le mode sandbox (et sa route de test) n'est actif que s'il est demandé, hors production, avec son secret. */
export function sandboxAllowed(env: Env = process.env) {
  return paymentsMode(env) === "sandbox" && !isProductionDeployment(env) && !!env.PAYMENTS_SANDBOX_SECRET;
}

/** Durée de validité d'une transaction en attente (Orange : jeton valable 10 min par défaut). */
export const TRANSACTION_TTL_MINUTES = 15;

/** Délai maximal d'un appel réseau à un opérateur. */
export const PROVIDER_TIMEOUT_MS = 15_000;

/** Base des URL de rappel envoyées aux opérateurs (doit être publique et en HTTPS en production). */
export function callbackBaseUrl(requestOrigin: string, env: Env = process.env) {
  return (env.PAYMENTS_CALLBACK_BASE_URL || env.NEXT_PUBLIC_SITE_URL || requestOrigin).replace(/\/$/, "");
}

/** Secret de signature des webhooks simulés (sandbox). Jamais de valeur par défaut. */
export function sandboxSecret(env: Env = process.env) {
  const secret = env.PAYMENTS_SANDBOX_SECRET;
  if (!secret) throw new Error("PAYMENTS_SANDBOX_SECRET is not set");
  return secret;
}
