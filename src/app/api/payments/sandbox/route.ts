import { userFromRequest } from "@/lib/supabase/server";
import { errorResponse, json, sandboxSettle } from "@/lib/payments/service";

/**
 * Route de test (PAYMENTS_MODE=sandbox uniquement, jamais en production) :
 * POST { transaction_id, outcome: "succeeded" | "failed" } simule la notification de l'opérateur.
 */
export async function POST(req: Request) {
  try {
    const auth = await userFromRequest(req);
    if (!auth) return json({ error: "unauthorized" }, 401);
    return json(await sandboxSettle(req, auth.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
