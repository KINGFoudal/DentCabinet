import { userFromRequest } from "@/lib/supabase/server";
import { errorResponse, initiatePayment, json } from "@/lib/payments/service";

/**
 * POST /api/payments/initiate
 * Authorization: Bearer <access_token>
 * { purpose: "invoice" | "subscription", invoice_id?, cabinet_id?, cycle?, provider, phone, amount_gnf? }
 * -> 200 { transaction_id, status, instructions?, redirect_url? } | 4xx { error }
 */
export async function POST(req: Request) {
  try {
    const auth = await userFromRequest(req);
    if (!auth) return json({ error: "unauthorized" }, 401);
    return json(await initiatePayment(req, auth.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
