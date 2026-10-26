import { paymentsMode, sandboxAllowed, sandboxSecret } from "./config";
import { mtnMomoAdapter, mtnMomoConfigFromEnv } from "./providers/mtn-momo";
import { orangeMoneyAdapter, orangeMoneyConfigFromEnv } from "./providers/orange-money";
import { sandboxAdapter } from "./providers/sandbox";
import { PaymentProviderError, type PaymentProviderAdapter, type ProviderId } from "./types";

/**
 * Choisit l'adaptateur d'un opérateur selon le mode.
 * Pour ajouter un agrégateur : écrire un adaptateur (voir types.ts) et le renvoyer ici, par
 * exemple selon une variable PAYMENTS_GATEWAY.
 */
export function providerAdapter(provider: ProviderId, env: Record<string, string | undefined> = process.env): PaymentProviderAdapter {
  const mode = paymentsMode(env);
  if (mode === "sandbox") {
    // Jamais d'opérateur simulé en production ni sans secret dédié.
    if (!sandboxAllowed(env)) throw new PaymentProviderError("payments_not_configured");
    return sandboxAdapter(provider, sandboxSecret(env));
  }
  if (mode !== "live") throw new PaymentProviderError("payments_not_configured");
  switch (provider) {
    case "orange_money":
      return orangeMoneyAdapter(orangeMoneyConfigFromEnv(env));
    case "mtn_momo":
      return mtnMomoAdapter(mtnMomoConfigFromEnv(env));
  }
}
