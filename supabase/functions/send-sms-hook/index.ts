/**
 * Edge Function « send-sms-hook » : « Send SMS Hook » de Supabase Auth.
 * Envoie le code de connexion de l'espace patient par WhatsApp (modèle d'authentification
 * Meta avec bouton « copier le code »).
 *
 * Requête : corps { user: { phone, ... }, sms: { otp } } signé selon Standard Webhooks
 * (en-têtes webhook-id / webhook-timestamp / webhook-signature), secret SEND_SMS_HOOK_SECRETS
 * (« v1,whsec_<base64> », plusieurs secrets séparés par « | »).
 * Réponse : 200 {} si envoyé ; sinon { error: { http_code, message } } (Content-Type JSON).
 * Sans clés WhatsApp : erreur (le code n'est pas envoyé), sauf si MESSAGING_MODE=sandbox
 * (développement local) : réponse 200 sans envoi. Le code n'est jamais journalisé ; en local,
 * utiliser le numéro de démonstration et son code fixe ([auth.sms.test_otp] de config.toml).
 */

// @ts-expect-error -- Deno exige l'extension .ts dans les imports relatifs.
import { verifyWebhook } from "../_shared/standard-webhooks.ts";
// @ts-expect-error -- idem
import { messagingSandbox, sendWhatsApp, whatsappConfig, whatsappLanguage, whatsappTemplatePayload } from "../_shared/messaging.ts";
// @ts-expect-error -- idem
import { whatsappRecipient } from "../_shared/reminders.ts";

type DenoLike = {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
const Deno = (globalThis as unknown as { Deno: DenoLike }).Deno;
const env = (k: string) => Deno.env.get(k);

type HookPayload = {
  user: { id?: string; phone?: string; user_metadata?: { locale?: string } };
  sms: { otp: string };
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (http_code: number, message: string) => reply({ error: { http_code, message } }, http_code);

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail(405, "method not allowed");
  const secrets = env("SEND_SMS_HOOK_SECRETS") ?? env("SEND_SMS_HOOK_SECRET");
  if (!secrets) return fail(500, "hook secret not configured");

  const payload = await req.text();
  let data: HookPayload;
  try {
    data = await verifyWebhook<HookPayload>(payload, req.headers, secrets);
  } catch {
    return fail(401, "invalid signature");
  }

  const phone = data.user?.phone?.replace(/^\+?/, "+");
  const otp = data.sms?.otp;
  if (!phone || !/^\+\d{8,15}$/.test(phone) || !otp || otp.length > 15) return fail(400, "invalid payload");

  const cfg = whatsappConfig(env);
  const locale = data.user.user_metadata?.locale === "en" ? "en" : "fr";
  const result = await sendWhatsApp(
    cfg,
    whatsappTemplatePayload(whatsappRecipient(phone), cfg?.otpTemplate ?? "nimba_code_connexion", whatsappLanguage(locale, env), [otp], otp),
    undefined,
    { sandbox: messagingSandbox(env) },
  );
  if (!result.ok) {
    // Le message d'erreur de l'API pourrait citer les paramètres : le code est masqué.
    console.error("send-sms-hook", result.error.split(otp).join("******"));
    return fail(500, "message could not be sent");
  }
  // Jamais le code lui-même dans les journaux.
  if (result.sandbox) console.log(`[sandbox] login code not sent (MESSAGING_MODE=sandbox) -> ${phone.slice(0, 5)}…${phone.slice(-2)}`);
  return reply({});
});
