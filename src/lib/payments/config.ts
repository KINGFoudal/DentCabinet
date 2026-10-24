/**
 * Configuration des paiements mobiles (variables d'environnement serveur).
 *
 * PAYMENTS_MODE
 *   - "sandbox" (défaut) : opérateur simulé, aucune somme débitée. Route de test
 *     /api/payments/sandbox disponible pour confirmer ou faire échouer une transaction.
 *   - "live" : appels réels aux API Orange Money / MTN MoMo (voir les adaptateurs).
 *
 * Le mode sandbox est refusé sur un déploiement de production (NIMBA_ENV=production ou
 * VERCEL_ENV=production) : les routes de paiement répondent alors 503 tant que
 * PAYMENTS_MODE=live n'est pas configuré.
 */

export type PaymentsMode = "sandbox" | "live";

type Env = Record<string, string | undefined>;

export function isProductionDeployment(env: Env = process.env) {
  return env.NIMBA_ENV === "production" || env.VERCEL_ENV === "production";
}

export function paymentsMode(env: Env = process.env): PaymentsMode {
  return env.PAYMENTS_MODE === "live" ? "live" : "sandbox";
}

/** Le mode sandbox (et sa route de test) n'est jamais actif en production. */
export function sandboxAllowed(env: Env = process.env) {
  return paymentsMode(env) === "sandbox" && !isProductionDeployment(env);
}

/** Durée de validité d'une transaction en attente (Orange : jeton valable 10 min par défaut). */
export const TRANSACTION_TTL_MINUTES = 15;

/** Base des URL de rappel envoyées aux opérateurs (doit être publique et en HTTPS en production). */
export function callbackBaseUrl(requestOrigin: string, env: Env = process.env) {
  return (env.PAYMENTS_CALLBACK_BASE_URL || env.NEXT_PUBLIC_SITE_URL || requestOrigin).replace(/\/$/, "");
}

/** Secret de signature des webhooks simulés (sandbox). */
export function sandboxSecret(env: Env = process.env) {
  return env.PAYMENTS_SANDBOX_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "nimba-sandbox";
}
