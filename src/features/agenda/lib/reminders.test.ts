import { describe, expect, it, vi } from "vitest";
import {
  isReminderDue,
  reminderWindow,
  renderTemplate,
  selectReminders,
  unknownVariables,
  whatsappParam,
  zonedTime,
  type ReminderTemplate,
} from "../../../../supabase/functions/_shared/reminders";
import { sendEmail, sendWhatsApp, whatsappConfig, whatsappTemplatePayload } from "../../../../supabase/functions/_shared/messaging";
import { signWebhook, verifyWebhook } from "../../../../supabase/functions/_shared/standard-webhooks";

const TZ = "Africa/Conakry";

describe("rendu des modèles", () => {
  it("remplace les variables, tolère les espaces, vide les inconnues", () => {
    expect(renderTemplate("Bonjour {{patient_name}}, {{ time }} {{nope}}!", { patient_name: "Awa", time: "09:30" })).toBe("Bonjour Awa, 09:30 !");
  });

  it("convertit les \\n littéraux des modèles par défaut", () => {
    expect(renderTemplate("A\\n\\nB", {})).toBe("A\n\nB");
  });

  it("détecte les variables inconnues", () => {
    expect(unknownVariables("{{patient_name}} {{prenom}} {{prenom}}")).toEqual(["prenom"]);
  });

  it("aplatit un paramètre WhatsApp", () => {
    expect(whatsappParam("Bonjour\n\nAwa,\t  rappel     demain")).toBe("Bonjour Awa, rappel demain");
    expect(whatsappParam("x".repeat(1000)).length).toBe(900);
  });
});

describe("fenêtres de rappel", () => {
  const appt = new Date("2026-10-27T10:00:00Z"); // mardi 10 h à Conakry (UTC+0)

  it("veille à partir de 18 h, jusqu'à minuit", () => {
    expect(reminderWindow(appt, "reminder_day_before", TZ)).toEqual([new Date("2026-10-26T18:00:00Z"), new Date("2026-10-27T00:00:00Z")]);
    expect(isReminderDue(appt, "reminder_day_before", new Date("2026-10-26T17:59:00Z"), TZ)).toBe(false);
    expect(isReminderDue(appt, "reminder_day_before", new Date("2026-10-26T18:00:00Z"), TZ)).toBe(true);
    expect(isReminderDue(appt, "reminder_day_before", new Date("2026-10-27T00:10:00Z"), TZ)).toBe(false);
  });

  it("jour même 2 h avant, jamais avant 7 h", () => {
    expect(reminderWindow(appt, "reminder_same_day", TZ)).toEqual([new Date("2026-10-27T08:00:00Z"), appt]);
    const early = new Date("2026-10-27T08:00:00Z");
    expect(reminderWindow(early, "reminder_same_day", TZ)?.[0]).toEqual(new Date("2026-10-27T07:00:00Z"));
    expect(reminderWindow(new Date("2026-10-27T06:30:00Z"), "reminder_same_day", TZ)).toBeNull();
  });

  it("respecte le fuseau du cabinet (Paris, UTC+1 en hiver)", () => {
    expect(zonedTime("2026-11-02", "18:00", "Europe/Paris").toISOString()).toBe("2026-11-02T17:00:00.000Z");
    const parisAppt = new Date("2026-11-03T09:00:00Z");
    expect(reminderWindow(parisAppt, "reminder_day_before", "Europe/Paris")?.[0].toISOString()).toBe("2026-11-02T17:00:00.000Z");
  });
});

describe("sélection des rappels", () => {
  const cabinet = { id: "cab", name: "Cabinet Nimba", phone: "+224620000000", timezone: TZ, locale: "fr" };
  const patient = { id: "p1", first_name: "Awa", last_name: "Bah", phone: "+224621000000", email: "awa@example.com", whatsapp_opt_in: true };
  const tpl = (kind: string, channel: string, extra: Partial<ReminderTemplate> = {}): ReminderTemplate => ({
    cabinet_id: "cab",
    kind,
    channel,
    locale: "fr",
    subject: channel === "email" ? "Rappel {{date}}" : null,
    body: "Bonjour {{patient_name}}, RDV le {{date}} à {{time}} avec {{dentist_name}} — {{cabinet_phone}}",
    enabled: true,
    ...extra,
  });
  const templates = [tpl("reminder_day_before", "whatsapp"), tpl("reminder_day_before", "email"), tpl("reminder_same_day", "whatsapp")];
  const appt = { id: "a1", cabinet_id: "cab", patient_id: "p1", dentist_id: "d1", starts_at: "2026-10-27T10:00:00Z", status: "scheduled", deleted_at: null };
  const base = { patients: [patient], cabinets: [cabinet], templates, logs: [], dentistNames: { d1: "Dr Camara" } };

  it("la veille : WhatsApp et email, modèle rendu", () => {
    const jobs = selectReminders({ ...base, now: new Date("2026-10-26T18:15:00Z"), appointments: [appt] });
    expect(jobs.map((j) => [j.kind, j.channel, j.recipient])).toEqual([
      ["reminder_day_before", "whatsapp", "+224621000000"],
      ["reminder_day_before", "email", "awa@example.com"],
    ]);
    expect(jobs[0].body).toBe("Bonjour Awa Bah, RDV le mardi 27 octobre 2026 à 10:00 avec Dr Camara — +224620000000");
    expect(jobs[1].subject).toBe("Rappel mardi 27 octobre 2026");
  });

  it("le jour même : seulement les canaux qui ont un modèle", () => {
    const jobs = selectReminders({ ...base, now: new Date("2026-10-27T08:30:00Z"), appointments: [appt] });
    expect(jobs.map((j) => [j.kind, j.channel])).toEqual([["reminder_same_day", "whatsapp"]]);
  });

  it("rien hors fenêtre, ni pour un RDV annulé, supprimé ou sans patient", () => {
    expect(selectReminders({ ...base, now: new Date("2026-10-26T12:00:00Z"), appointments: [appt] })).toEqual([]);
    const now = new Date("2026-10-26T19:00:00Z");
    expect(selectReminders({ ...base, now, appointments: [{ ...appt, status: "cancelled" }] })).toEqual([]);
    expect(selectReminders({ ...base, now, appointments: [{ ...appt, status: "arrived" }] })).toEqual([]);
    expect(selectReminders({ ...base, now, appointments: [{ ...appt, deleted_at: "2026-10-26T00:00:00Z" }] })).toEqual([]);
    expect(selectReminders({ ...base, now, appointments: [{ ...appt, patient_id: null }] })).toEqual([]);
  });

  it("respecte whatsapp_opt_in et les coordonnées valides", () => {
    const now = new Date("2026-10-26T19:00:00Z");
    const jobs = selectReminders({ ...base, now, appointments: [appt], patients: [{ ...patient, whatsapp_opt_in: false, email: "pas-un-email" }] });
    expect(jobs).toEqual([]);
  });

  it("modèle désactivé : pas d'envoi ; repli sur le français", () => {
    const now = new Date("2026-10-26T19:00:00Z");
    const off = selectReminders({ ...base, now, appointments: [appt], templates: [tpl("reminder_day_before", "whatsapp", { enabled: false })] });
    expect(off).toEqual([]);
    const en = selectReminders({ ...base, now, appointments: [appt], cabinets: [{ ...cabinet, locale: "en" }], templates: [tpl("reminder_day_before", "whatsapp")] });
    expect(en).toHaveLength(1);
    expect(en[0].locale).toBe("fr");
  });

  it("pas de double envoi ; échec réessayé au plus 3 fois", () => {
    const now = new Date("2026-10-26T19:00:00Z");
    const log = (status: string, attempts: number) => ({ id: "l1", appointment_id: "a1", kind: "reminder_day_before", channel: "whatsapp", status, attempts });
    const only = (logs: ReturnType<typeof log>[]) =>
      selectReminders({ ...base, now, appointments: [appt], templates: [tpl("reminder_day_before", "whatsapp")], logs });
    expect(only([log("sent", 1)])).toEqual([]);
    expect(only([log("queued", 1)])).toEqual([]);
    expect(only([log("failed", 1)])[0].retry).toEqual({ id: "l1", attempts: 1 });
    expect(only([log("failed", 3)])).toEqual([]);
  });
});

describe("fournisseurs", () => {
  it("charge utile d'un modèle WhatsApp d'authentification (code répété dans le bouton)", () => {
    expect(whatsappTemplatePayload("224621000000", "nimba_code_connexion", "fr", ["123456"], "123456")).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "224621000000",
      type: "template",
      template: {
        name: "nimba_code_connexion",
        language: { code: "fr" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "123456" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
        ],
      },
    });
  });

  it("mode sandbox sans clés", async () => {
    const fetchFn = vi.fn();
    expect(whatsappConfig(() => undefined)).toBeNull();
    const r = await sendWhatsApp(null, whatsappTemplatePayload("224", "t", "fr", ["x"]), fetchFn);
    expect(r.ok && r.sandbox).toBe(true);
    const e = await sendEmail(null, { to: "a@b.c", subject: "s", text: "t" }, fetchFn);
    expect(e.ok && e.sandbox).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("appel WhatsApp Cloud API et lecture de l'identifiant", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    const cfg = whatsappConfig((k) => ({ WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "123" })[k]);
    const r = await sendWhatsApp(cfg, whatsappTemplatePayload("224", "t", "fr", ["x"]), fetchFn);
    expect(r).toEqual({ ok: true, providerId: "wamid.1", sandbox: false });
    expect(fetchFn).toHaveBeenCalledWith("https://graph.facebook.com/v23.0/123/messages", expect.objectContaining({ method: "POST" }));
  });

  it("erreur du fournisseur email", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ message: "invalid from" }), { status: 422 }));
    const r = await sendEmail({ apiKey: "re_x", from: "rappels@example.com" }, { to: "a@b.c", subject: "s", text: "t" }, fetchFn);
    expect(r).toEqual({ ok: false, error: "email 422: invalid from", sandbox: false });
  });
});

describe("Standard Webhooks", () => {
  const secret = "v1,whsec_" + Buffer.from("un-secret-de-test-assez-long").toString("base64");
  const body = JSON.stringify({ user: { phone: "224621000000" }, sms: { otp: "123456" } });

  it("accepte une signature valide", async () => {
    const ts = 1_800_000_000;
    const sig = await signWebhook(secret, "msg_1", ts, body);
    const data = await verifyWebhook<{ sms: { otp: string } }>(body, { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,AAAA ${sig}` }, secret, ts + 10);
    expect(data.sms.otp).toBe("123456");
  });

  it("refuse une signature fausse, un corps modifié ou un horodatage trop ancien", async () => {
    const ts = 1_800_000_000;
    const sig = await signWebhook(secret, "msg_1", ts, body);
    const h = { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": sig };
    await expect(verifyWebhook(body.replace("123456", "000000"), h, secret, ts)).rejects.toThrow("invalid signature");
    await expect(verifyWebhook(body, h, "v1,whsec_" + Buffer.from("autre").toString("base64"), ts)).rejects.toThrow("invalid signature");
    await expect(verifyWebhook(body, h, secret, ts + 3600)).rejects.toThrow("timestamp");
    await expect(verifyWebhook(body, { "webhook-id": "x" }, secret, ts)).rejects.toThrow("missing headers");
  });

  it("rotation : plusieurs secrets séparés par |", async () => {
    const ts = 1_800_000_000;
    const sig = await signWebhook(secret, "m", ts, body);
    await expect(verifyWebhook(body, { "webhook-id": "m", "webhook-timestamp": String(ts), "webhook-signature": sig }, `v1,whsec_b2xk|${secret}`, ts)).resolves.toBeTruthy();
  });
});
