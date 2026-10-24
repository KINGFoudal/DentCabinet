/**
 * Edge Function « whatsapp-webhook » : reçoit les statuts de distribution de Meta
 * (sent / delivered / read / failed) et met à jour notification_log.
 *
 * GET  : vérification de l'abonnement (hub.mode=subscribe, hub.verify_token = WHATSAPP_WEBHOOK_VERIFY_TOKEN).
 * POST : signature X-Hub-Signature-256 vérifiée avec WHATSAPP_APP_SECRET.
 * À servir sans vérification JWT (Meta n'envoie pas de jeton Supabase).
 */

// @ts-expect-error -- Deno exige l'extension .ts dans les imports relatifs.
import { extractStatuses, shouldApplyStatus, verifyMetaSignature } from "../_shared/whatsapp-status.ts";
// @ts-expect-error -- idem
import { Rest } from "../_shared/rest.ts";

type DenoLike = {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
const Deno = (globalThis as unknown as { Deno: DenoLike }).Deno;
const env = (k: string) => Deno.env.get(k);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const token = env("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
    if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = env("WHATSAPP_APP_SECRET");
  if (!secret) return new Response("not configured", { status: 503 });
  const body = await req.text();
  if (!(await verifyMetaSignature(body, req.headers.get("x-hub-signature-256"), secret))) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const rest = new Rest(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
  let updated = 0;
  for (const s of extractStatuses(payload)) {
    const rows = await rest.select<{ id: string; status: string }>(
      `notification_log?select=id,status&channel=eq.whatsapp&provider_message_id=eq.${encodeURIComponent(s.id)}`,
    );
    for (const row of rows) {
      if (!shouldApplyStatus(row.status, s.status)) continue;
      // Mise à jour conditionnelle : ignore une modification concurrente.
      await rest.update("notification_log", `id=eq.${row.id}&status=eq.${row.status}`, {
        status: s.status,
        ...(s.status === "failed" ? { error: (s.error ?? "failed").slice(0, 500) } : {}),
      });
      updated++;
    }
  }
  return new Response(JSON.stringify({ updated }), { status: 200, headers: { "Content-Type": "application/json" } });
});
