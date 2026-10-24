import type { NextRequest } from "next/server";
import { errorResponse, handleWebhook, json } from "@/lib/payments/service";

/**
 * Notifications des opérateurs (Orange Money : POST ; MTN MoMo : PUT ou POST).
 * L'authenticité est vérifiée par l'adaptateur ; la finalisation est idempotente.
 */
async function handle(req: NextRequest, ctx: RouteContext<"/api/payments/webhook/[provider]">) {
  try {
    const { provider } = await ctx.params;
    const body = await req.text();
    return json(await handleWebhook(provider, body, req.nextUrl, req.headers));
  } catch (e) {
    return errorResponse(e);
  }
}

export const POST = handle;
export const PUT = handle;
