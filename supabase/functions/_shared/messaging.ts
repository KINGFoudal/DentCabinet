/**
 * Envoi des messages : WhatsApp Business Cloud API (modèles pré-approuvés) et email (Resend).
 * Sans clés configurées, mode « sandbox » : rien n'est envoyé, le résultat est simulé.
 * Aucune dépendance Deno : `fetch` est injectable pour les tests.
 */

export type Env = (key: string) => string | undefined;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type SendResult = { ok: true; providerId: string | null; sandbox: boolean } | { ok: false; error: string; sandbox: boolean };

export const DEFAULT_GRAPH_VERSION = "v23.0";

export type WhatsAppConfig = {
  token: string;
  phoneNumberId: string;
  version: string;
  reminderTemplate: string;
  otpTemplate: string;
};

export function whatsappConfig(env: Env): WhatsAppConfig | null {
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    version: env("WHATSAPP_GRAPH_VERSION") || DEFAULT_GRAPH_VERSION,
    reminderTemplate: env("WHATSAPP_REMINDER_TEMPLATE") || "nimba_rappel_rdv",
    otpTemplate: env("WHATSAPP_OTP_TEMPLATE") || "nimba_code_connexion",
  };
}

/** Code de langue des modèles WhatsApp (ex. « fr », « en » ; configurable). */
export function whatsappLanguage(locale: string, env: Env): string {
  return (locale === "en" ? env("WHATSAPP_LANG_EN") || "en" : env("WHATSAPP_LANG_FR") || "fr");
}

/**
 * Message initié par l'entreprise : hors de la fenêtre de 24 h, seul un modèle approuvé
 * par Meta peut être envoyé. Le modèle « rappel » a un seul paramètre de corps {{1}}
 * qui reçoit le texte rendu du modèle du cabinet.
 */
export function whatsappTemplatePayload(
  to: string,
  template: string,
  languageCode: string,
  bodyParams: string[],
  buttonParam?: string,
) {
  const components: Record<string, unknown>[] = [
    { type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) },
  ];
  if (buttonParam !== undefined) {
    // Modèle d'authentification avec bouton « copier le code » : le code apparaît deux fois.
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: buttonParam }] });
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: { name: template, language: { code: languageCode }, components },
  };
}

export async function sendWhatsApp(
  cfg: WhatsAppConfig | null,
  payload: ReturnType<typeof whatsappTemplatePayload>,
  fetchFn: Fetch = fetch,
): Promise<SendResult> {
  if (!cfg) return { ok: true, providerId: `sandbox-wa-${crypto.randomUUID()}`, sandbox: true };
  try {
    const res = await fetchFn(`https://graph.facebook.com/${cfg.version}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok || !json.messages?.[0]?.id) {
      return { ok: false, error: `whatsapp ${res.status}: ${json.error?.message ?? "unknown error"}`, sandbox: false };
    }
    return { ok: true, providerId: json.messages[0].id, sandbox: false };
  } catch (e) {
    return { ok: false, error: `whatsapp: ${e instanceof Error ? e.message : String(e)}`, sandbox: false };
  }
}

export type EmailConfig = { apiKey: string; from: string };

export function emailConfig(env: Env): EmailConfig | null {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  return apiKey && from ? { apiKey, from } : null;
}

/** Email via l'API HTTP de Resend (POST /emails). */
export async function sendEmail(
  cfg: EmailConfig | null,
  msg: { to: string; subject: string; text: string; idempotencyKey?: string; fromName?: string },
  fetchFn: Fetch = fetch,
): Promise<SendResult> {
  if (!cfg) return { ok: true, providerId: `sandbox-email-${crypto.randomUUID()}`, sandbox: true };
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" };
    if (msg.idempotencyKey) headers["Idempotency-Key"] = msg.idempotencyKey.slice(0, 256);
    const from = msg.fromName && !cfg.from.includes("<") ? `${msg.fromName.replace(/[<>"]/g, "")} <${cfg.from}>` : cfg.from;
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !json.id) return { ok: false, error: `email ${res.status}: ${json.message ?? "unknown error"}`, sandbox: false };
    return { ok: true, providerId: json.id, sandbox: false };
  } catch (e) {
    return { ok: false, error: `email: ${e instanceof Error ? e.message : String(e)}`, sandbox: false };
  }
}
