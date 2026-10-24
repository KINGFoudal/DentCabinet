import { paymentsMode, sandboxSecret } from "./config";
import { mtnMomoAdapter, mtnMomoConfigFromEnv } from "./providers/mtn-momo";
import { orangeMoneyAdapter, orangeMoneyConfigFromEnv } from "./providers/orange-money";
import { sandboxAdapter } from "./providers/sandbox";
import type { PaymentProviderAdapter, ProviderId } from "./types";

/**
 * Choisit l'adaptateur d'un opérateur selon le mode.
 * Pour ajouter un agrégateur : écrire un adaptateur (voir types.ts) et le renvoyer ici, par
 * exemple selon une variable PAYMENTS_GATEWAY.
 */
export function providerAdapter(provider: ProviderId, env: Record<string, string | undefined> = process.env): PaymentProviderAdapter {
  if (paymentsMode(env) === "sandbox") return sandboxAdapter(provider, sandboxSecret(env));
  switch (provider) {
    case "orange_money":
      return orangeMoneyAdapter(orangeMoneyConfigFromEnv(env));
    case "mtn_momo":
      return mtnMomoAdapter(mtnMomoConfigFromEnv(env));
  }
}
