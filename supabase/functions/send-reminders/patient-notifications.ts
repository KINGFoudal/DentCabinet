/**
 * Envoi des messages patients en file (public.patient_notifications), appelé par
 * send-reminders à chaque passage de pg_cron (toutes les 15 minutes).
 *
 * - Réservation conditionnelle de chaque ligne (statut + tentatives + date de mise à jour)
 *   avant l'envoi : deux exécutions concurrentes n'envoient jamais deux fois.
 * - 3 tentatives au plus ; une ligne restée « sending » plus de 15 min est retentée.
 * - Tout est relu au moment de l'envoi : RDV supprimé ou annulé entre-temps, patient sans
 *   téléphone, opposition WhatsApp, cabinet qui a désactivé l'envoi => ligne « skipped ».
 * - Destinataire : le téléphone de la fiche patient, jamais un numéro du cabinet.
 */

// @ts-expect-error -- Deno exige l'extension .ts dans les imports relatifs.
import { isAbandoned, isDue, planNotification, reservationFilter, type NotifyAppointment, type NotifyCabinet, type NotifyContext, type NotifyInvoice, type NotifyPatient, type NotifyPayment, type QueueRow } from "../_shared/patient-notifications.ts";
// @ts-expect-error -- idem
import { metaTemplateName, PATIENT_MESSAGE_KINDS, type TemplateRow } from "../_shared/patient-messages.ts";
// @ts-expect-error -- idem
import { whatsappParam, whatsappRecipient } from "../_shared/reminders.ts";
// @ts-expect-error -- idem
import { messagingSandbox, SANDBOX_NOTE, sendWhatsApp, whatsappConfig, whatsappLanguage, whatsappTemplatePayload, type SendResult } from "../_shared/messaging.ts";
// @ts-expect-error -- idem
import { chunks, inList, type Rest } from "../_shared/rest.ts";

type Env = (k: string) => string | undefined;

/** Nombre maximal de lignes traitées par exécution (le reste au passage suivant). */
const BATCH = 200;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function loadAll<T>(rest: Rest, table: string, select: string, column: string, ids: (string | null)[], extra = "") {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const out: T[] = [];
  for (const part of chunks(list)) {
    out.push(...(await rest.selectAll<T>(`${table}?select=${select}&${column}=${inList(part)}${extra}&order=id`)));
  }
  return out;
}

type CabinetRow = Omit<NotifyCabinet, "active"> & { subscription_status: string; trial_ends_at: string | null };

function cabinetActive(c: CabinetRow, now: Date) {
  if (c.subscription_status === "active" || c.subscription_status === "past_due") return true;
  return c.subscription_status === "trialing" && (!c.trial_ends_at || new Date(c.trial_ends_at) > now);
}

const QUEUE_SELECT = "id,cabinet_id,patient_id,event,appointment_id,invoice_id,payment_id,ref_starts_at,status,attempts,created_at,updated_at,sent_at";

export async function runPatientNotifications(rest: Rest, now: Date, env: Env, dryRun = false) {
  // Lignes en attente, échecs retentables et envois interrompus (les plus anciens d'abord).
  const candidates = await rest.select<QueueRow>(
    `patient_notifications?select=${QUEUE_SELECT}&status=in.(pending,failed,sending)&attempts=lt.3&deleted_at=is.null&order=created_at,id&limit=${BATCH}`,
  );
  const abandoned = await rest.select<QueueRow>(
    `patient_notifications?select=${QUEUE_SELECT}&status=eq.sending&attempts=gte.3&order=created_at,id&limit=${BATCH}`,
  );
  for (const row of abandoned.filter((r) => isAbandoned(r, now))) {
    await rest
      .update("patient_notifications", reservationFilter(row), { status: "failed", error: "interrupted: still sending after 15 min" })
      .catch((e: unknown) => console.error("patient-notifications: abandoned", row.id, errorMessage(e)));
  }
  const due = candidates.filter((r) => isDue(r, now));
  if (!due.length) return { checked: 0, sent: 0, simulated: 0, failed: 0, skipped: 0, deferred: 0 };

  const cabinetIds = due.map((r) => r.cabinet_id);
  const [cabinetRows, patients, appointments, invoices, payments, templates, memberships, invoiceRows] = await Promise.all([
    loadAll<CabinetRow>(
      rest,
      "cabinets",
      "id,name,phone,address,city,timezone,locale,subscription_status,trial_ends_at,notify_appointment_created,notify_appointment_changed,notify_invoice_issued,notify_payment_received",
      "id",
      cabinetIds,
    ),
    loadAll<NotifyPatient>(rest, "patients", "id,cabinet_id,first_name,last_name,phone,whatsapp_opt_in,deleted_at", "id", due.map((r) => r.patient_id)),
    loadAll<NotifyAppointment>(rest, "appointments", "id,cabinet_id,patient_id,dentist_id,starts_at,status,deleted_at", "id", due.map((r) => r.appointment_id)),
    loadAll<NotifyInvoice>(rest, "invoices", "id,cabinet_id,patient_id,number,status,total_gnf,paid_gnf,deleted_at", "id", due.map((r) => r.invoice_id)),
    loadAll<NotifyPayment>(rest, "payments", "id,cabinet_id,invoice_id,amount_gnf,status,created_at,deleted_at", "id", due.map((r) => r.payment_id)),
    loadAll<TemplateRow>(
      rest,
      "message_templates",
      "cabinet_id,kind,channel,locale,body,enabled,deleted_at",
      "cabinet_id",
      cabinetIds,
      `&channel=eq.whatsapp&kind=in.(${PATIENT_MESSAGE_KINDS.join(",")})`,
    ),
    loadAll<{ cabinet_id: string; user_id: string; display_name: string | null; deleted_at: string | null }>(
      rest,
      "memberships",
      "cabinet_id,user_id,display_name,deleted_at",
      "cabinet_id",
      cabinetIds,
    ),
    // Messages de facture des mêmes factures (règle « paiement déjà annoncé »).
    loadAll<QueueRow>(rest, "patient_notifications", QUEUE_SELECT, "invoice_id", due.map((r) => r.invoice_id), "&event=eq.invoice_issued"),
  ]);
  const profiles = await loadAll<{ id: string; full_name: string | null; phone: string | null }>(
    rest,
    "profiles",
    "id,full_name,phone",
    "id",
    memberships.map((m) => m.user_id),
  );
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const dentistNames: Record<string, string> = {};
  const staffPhones = new Map<string, Set<string>>();
  for (const m of memberships) {
    const p = profileById.get(m.user_id);
    const name = m.display_name || p?.full_name;
    if (name) dentistNames[m.user_id] = name;
    const digits = (p?.phone ?? "").replace(/\D/g, "");
    if (digits && !m.deleted_at) {
      const set = staffPhones.get(m.cabinet_id) ?? new Set<string>();
      set.add(digits.startsWith("00") ? digits.slice(2) : digits.length === 9 ? "224" + digits : digits);
      staffPhones.set(m.cabinet_id, set);
    }
  }

  const queue = [...invoiceRows];
  const ctx: NotifyContext = {
    now,
    cabinets: new Map(cabinetRows.map((c) => [c.id, { ...c, active: cabinetActive(c, now) }])),
    patients: new Map(patients.map((p) => [p.id, p])),
    appointments: new Map(appointments.map((a) => [a.id, a])),
    invoices: new Map(invoices.map((i) => [i.id, i])),
    payments: new Map(payments.map((p) => [p.id, p])),
    templates,
    dentistNames,
    staffPhones,
    queue,
  };

  // Factures avant paiements, puis ordre d'arrivée.
  const ordered = [...due].sort((a, b) => Number(a.event === "payment_received") - Number(b.event === "payment_received"));
  if (dryRun) return { checked: ordered.length, plans: ordered.map((r) => ({ id: r.id, event: r.event, plan: planNotification(r, ctx) })) };

  const sandbox = messagingSandbox(env);
  const wa = whatsappConfig(env);
  let sent = 0;
  let simulated = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  // État des messages de facture tenu à jour pendant la boucle.
  const track = (id: string, patch: Partial<QueueRow>) => {
    const q = queue.find((x) => x.id === id);
    if (q) Object.assign(q, patch);
  };

  for (const row of ordered) {
    const plan = planNotification(row, ctx);
    try {
      if (plan.action === "defer") {
        deferred++;
        continue;
      }
      if (plan.action === "skip") {
        await rest.update("patient_notifications", reservationFilter(row), { status: "skipped", error: plan.reason.slice(0, 500) });
        track(row.id, { status: "skipped" });
        skipped++;
        continue;
      }
      // 1. Réservation (empêche le double envoi).
      const reserved = await rest.update<{ id: string; updated_at: string }>("patient_notifications", reservationFilter(row), {
        status: "sending",
        attempts: row.attempts + 1,
        recipient: plan.recipient,
        body: plan.text.slice(0, 4000),
        error: null,
      });
      if (!reserved[0]) {
        skipped++;
        continue;
      }
      // 2. Envoi : modèle Meta « Utilitaire » à une variable {{1}} = texte rendu du cabinet.
      let result: SendResult;
      try {
        result = await sendWhatsApp(
          wa,
          whatsappTemplatePayload(whatsappRecipient(plan.recipient), metaTemplateName(plan.event, env), whatsappLanguage(plan.locale, env), [whatsappParam(plan.text)]),
          undefined,
          { sandbox },
        );
      } catch (e) {
        result = { ok: false, error: `error: ${errorMessage(e)}`, sandbox: false };
      }
      // 3. Résultat.
      const sentAt = new Date().toISOString();
      await rest.update(
        "patient_notifications",
        `id=eq.${row.id}`,
        result.ok
          ? { status: "sent", provider_message_id: result.providerId, sent_at: sentAt, error: result.sandbox ? SANDBOX_NOTE : null }
          : { status: "failed", provider_message_id: null, error: result.error.slice(0, 500) },
      );
      track(row.id, result.ok ? { status: "sent", sent_at: sentAt } : { status: "failed" });
      if (result.ok) {
        if (result.sandbox) {
          simulated++;
          console.log(`patient-notifications [sandbox] ${row.event} -> ${plan.recipient}: ${whatsappParam(plan.text)}`);
        } else sent++;
      } else failed++;
    } catch (e) {
      failed++;
      console.error("patient-notifications: row", row.id, row.event, errorMessage(e));
    }
  }
  return { checked: ordered.length, sent, simulated, failed, skipped, deferred, sandbox, configured: { whatsapp: !!wa } };
}
