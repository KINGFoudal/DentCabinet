import { connection } from "next/server";
import { json } from "@/lib/payments/service";
import { mobilePaymentsAvailable } from "@/lib/payments/config";

/**
 * GET /api/payments/config -> { mobile: boolean }
 * Indique si le paiement mobile (Orange Money / MTN MoMo) est configuré, pour ne pas proposer
 * un bouton qui échouerait (503 payments_not_configured). Aucune donnée sensible.
 */
export async function GET() {
  // Variables lues à l'exécution, pas au moment du build.
  await connection();
  return json({ mobile: mobilePaymentsAvailable() });
}
