import type { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/supabase/server";
import { errorResponse, json, transactionStatus } from "@/lib/payments/service";

/** GET /api/payments/status?id=<transaction_id> -> { status } (initiateur ou personnel du cabinet). */
export async function GET(req: NextRequest) {
  // Lu hors du try : l'accès aux en-têtes rend la route dynamique (Cache Components).
  const auth = await userFromRequest(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  try {
    return json(await transactionStatus(req.nextUrl.searchParams.get("id") ?? "", auth.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
