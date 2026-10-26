/**
 * Edge Function « send-reminders » : rappels de rendez-vous par WhatsApp et email.
 *
 * Appelée toutes les 15 minutes par pg_cron (voir la migration 20261024020000_agenda.sql),
 * avec l'en-tête x-cron-secret = REMINDERS_CRON_SECRET (ou Authorization: Bearer <clé service>).
 * Corps optionnel : { "now": "<ISO>", "dry_run": true } (tests).
 *
 * Idempotence : une ligne notification_log est réservée (contrainte d'unicité
 * appointment_id + kind + channel) AVANT l'envoi ; une exécution concurrente ne renvoie rien.
 * Une ligne restée « queued » plus de 15 min (exécution interrompue) est retentée.
 * Chaque envoi est isolé : une erreur est journalisée (ligne « failed ») et la boucle continue.
 *
 * La même exécution envoie ensuite les messages patients de la file patient_notifications
 * (confirmation / déplacement / annulation de RDV, facture émise, paiement reçu) : voir
 * ./patient-notifications.ts.
 *
 * Sans clés WhatsApp / email :
 *   - MESSAGING_MODE=sandbox (local) : rien n'est envoyé ; la ligne est écrite avec
 *     status « sent », provider_message_id « sandbox-… » et error « sandbox: non envoyé … » ;
 *   - sinon : la ligne passe en « failed » avec « whatsapp/email not configured ».
 */

// @ts-expect-error -- Deno exige l'extension .ts dans les imports relatifs.
import { abandonedLogs, candidateRange, retryReservationFilter, selectReminders, whatsappParam, whatsappRecipient, type ExistingLog, type ReminderAppointment, type ReminderCabinet, type ReminderJob, type ReminderPatient, type ReminderTemplate } from "../_shared/reminders.ts";
// @ts-expect-error -- idem
import { emailConfig, messagingSandbox, SANDBOX_NOTE, SEND_TIMEOUT_MS, sendEmail, sendWhatsApp, whatsappConfig, whatsappLanguage, whatsappTemplatePayload, type SendResult } from "../_shared/messaging.ts";
// @ts-expect-error -- idem
import { chunks, inList, Rest } from "../_shared/rest.ts";
// @ts-expect-error -- idem
import { secretsEqual } from "../_shared/secrets.ts";
// @ts-expect-error -- idem
import { runPatientNotifications } from "./patient-notifications.ts";

type DenoLike = {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
const Deno = (globalThis as unknown as { Deno: DenoLike }).Deno;
const env = (k: string) => Deno.env.get(k);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function authorized(req: Request) {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const given = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (service && bearer && (await secretsEqual(bearer, service))) return true;
  if (!given) return false;
  // Secret fourni par l'environnement, sinon celui conservé dans Vault (public.reminders_cron_secret).
  let cron = env("REMINDERS_CRON_SECRET");
  if (!cron && service) {
    const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/reminders_cron_secret`, {
      method: "POST",
      headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    cron = res.ok ? ((await res.json()) as string | null) ?? undefined : undefined;
  }
  return secretsEqual(given, cron);
}

type CabinetRow = ReminderCabinet & { subscription_status: string; trial_ends_at: string | null };

function cabinetActive(c: CabinetRow, now: Date) {
  if (c.subscription_status === "active" || c.subscription_status === "past_due") return true;
  return c.subscription_status === "trialing" && (!c.trial_ends_at || new Date(c.trial_ends_at) > now);
}

/** Lignes dont `column` est dans `ids`, par lots d'identifiants et paginées (pas de troncature). */
async function loadAll<T>(rest: Rest, table: string, select: string, column: string, ids: string[], extra = "") {
  const out: T[] = [];
  for (const part of chunks(ids)) {
    out.push(...(await rest.selectAll<T>(`${table}?select=${select}&${column}=${inList(part)}${extra}&order=id`)));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);
    return await run(req);
  } catch (e) {
    console.error("send-reminders", errorMessage(e));
    return json({ error: "internal error" }, 500);
  }
});

async function run(req: Request) {
  const input = (await req.json().catch(() => ({}))) as { now?: string; dry_run?: boolean };
  const now = input.now ? new Date(input.now) : new Date();
  if (Number.isNaN(now.getTime())) return json({ error: "invalid now" }, 400);

  const rest = new Rest(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
  // Rappels avant RDV, puis messages patients (confirmation, déplacement, facture...) :
  // une erreur dans l'un n'empêche pas l'autre.
  const reminders = await runReminders(rest, now, !!input.dry_run).catch((e: unknown) => {
    console.error("send-reminders: reminders", errorMessage(e));
    return { error: "reminders failed" };
  });
  const patient_notifications = await runPatientNotifications(rest, now, env, !!input.dry_run).catch((e: unknown) => {
    console.error("send-reminders: patient notifications", errorMessage(e));
    return { error: "patient notifications failed" };
  });
  return json({ ...reminders, patient_notifications });
}

async function runReminders(rest: Rest, now: Date, dryRun: boolean): Promise<Record<string, unknown>> {
  const [from, to] = candidateRange(now);

  const appointments = await rest.selectAll<ReminderAppointment>(
    `appointments?select=id,cabinet_id,patient_id,dentist_id,starts_at,status,deleted_at` +
      `&starts_at=gte.${encodeURIComponent(from.toISOString())}&starts_at=lt.${encodeURIComponent(to.toISOString())}` +
      `&status=in.(scheduled,confirmed)&deleted_at=is.null&patient_id=not.is.null&order=starts_at,id`,
  );
  if (!appointments.length) return { checked: 0, sent: 0, failed: 0, skipped: 0 };

  const cabinetIds = [...new Set(appointments.map((a) => a.cabinet_id))];
  const [cabinetRows, patients, templates, logs, memberships] = await Promise.all([
    loadAll<CabinetRow>(rest, "cabinets", "id,name,phone,address,city,timezone,locale,subscription_status,trial_ends_at", "id", cabinetIds),
    loadAll<ReminderPatient>(
      rest,
      "patients",
      "id,first_name,last_name,phone,email,whatsapp_opt_in,deleted_at",
      "id",
      appointments.map((a) => a.patient_id!),
    ),
    loadAll<ReminderTemplate>(
      rest,
      "message_templates",
      "cabinet_id,kind,channel,locale,subject,body,enabled,deleted_at",
      "cabinet_id",
      cabinetIds,
      "&kind=in.(reminder_day_before,reminder_same_day)",
    ),
    loadAll<ExistingLog>(
      rest,
      "notification_log",
      "id,appointment_id,kind,channel,status,attempts,updated_at",
      "appointment_id",
      appointments.map((a) => a.id),
    ),
    loadAll<{ user_id: string; display_name: string | null }>(
      rest,
      "memberships",
      "user_id,display_name",
      "cabinet_id",
      cabinetIds,
    ),
  ]);
  const profiles = await loadAll<{ id: string; full_name: string | null }>(
    rest,
    "profiles",
    "id,full_name",
    "id",
    appointments.map((a) => a.dentist_id),
  );
  const dentistNames: Record<string, string> = {};
  for (const p of profiles) if (p.full_name) dentistNames[p.id] = p.full_name;
  for (const m of memberships) if (m.display_name) dentistNames[m.user_id] = m.display_name;

  const jobs: ReminderJob[] = selectReminders({
    now,
    appointments,
    patients,
    cabinets: cabinetRows.filter((c) => cabinetActive(c, now)),
    templates,
    logs,
    dentistNames,
  });
  if (dryRun) return { checked: appointments.length, jobs };

  const sandbox = messagingSandbox(env);
  const wa = whatsappConfig(env);
  const mail = emailConfig(env);
  const cabinetNames = new Map(cabinetRows.map((c) => [c.id, c.name]));
  let sent = 0;
  let simulated = 0;
  let failed = 0;
  let skipped = 0;

  // Lignes « queued » abandonnées après la dernière tentative : marquées en échec (plus de faux « en cours »).
  for (const l of abandonedLogs(logs, now)) {
    try {
      await rest.update("notification_log", retryReservationFilter({ id: l.id, attempts: l.attempts, status: "queued", updated_at: l.updated_at ?? null }), {
        status: "failed",
        error: "interrupted: still queued after 15 min",
      });
    } catch (e) {
      console.error("send-reminders: abandoned log", l.id, errorMessage(e));
    }
  }

  for (const job of jobs) {
    let logId: string | null = null;
    try {
      // 1. Réservation de la ligne du journal (empêche le double envoi).
      if (job.retry) {
        const rows = await rest.update<{ id: string }>("notification_log", retryReservationFilter(job.retry), {
          status: "queued",
          attempts: job.retry.attempts + 1,
          error: null,
          recipient: job.recipient,
        });
        logId = rows[0]?.id ?? null;
      } else {
        const rows = await rest.insert<{ id: string }>(
          "notification_log",
          {
            cabinet_id: job.cabinet_id,
            appointment_id: job.appointment_id,
            patient_id: job.patient_id,
            kind: job.kind,
            channel: job.channel,
            recipient: job.recipient,
            status: "queued",
            attempts: 1,
          },
          { onConflict: "appointment_id,kind,channel", ignoreDuplicates: true },
        );
        logId = rows[0]?.id ?? null;
      }
      if (!logId) {
        skipped++;
        continue;
      }

      // 2. Envoi.
      let result: SendResult;
      if (job.channel === "whatsapp") {
        result = await sendWhatsApp(
          wa,
          whatsappTemplatePayload(
            whatsappRecipient(job.recipient),
            wa?.reminderTemplate ?? "nimba_rappel_rdv",
            whatsappLanguage(job.locale, env),
            [whatsappParam(job.body)],
          ),
          undefined,
          { sandbox },
        );
      } else {
        result = await sendEmail(
          mail,
          {
            to: job.recipient,
            subject: job.subject || (job.locale === "en" ? "Appointment reminder" : "Rappel de rendez-vous"),
            text: job.body,
            idempotencyKey: `${job.appointment_id}-${job.kind}-${job.retry ? job.retry.attempts + 1 : 1}`,
            fromName: cabinetNames.get(job.cabinet_id),
          },
          undefined,
          { sandbox },
        );
      }

      // 3. Résultat. Un envoi simulé est signalé dans `error` (le schéma n'a pas de statut dédié).
      await rest.update(
        "notification_log",
        `id=eq.${logId}`,
        result.ok
          ? { status: "sent", provider_message_id: result.providerId, sent_at: new Date().toISOString(), error: result.sandbox ? SANDBOX_NOTE : null }
          : { status: "failed", provider_message_id: null, error: result.error.slice(0, 500) },
      );
      if (!result.ok) failed++;
      else if (result.sandbox) simulated++;
      else sent++;
    } catch (e) {
      failed++;
      const message = errorMessage(e);
      console.error("send-reminders: job", job.appointment_id, job.kind, job.channel, message);
      if (logId) {
        // Échec après réservation : la ligne devient retentable au lieu de rester « queued ».
        await rest
          .update("notification_log", `id=eq.${logId}`, { status: "failed", error: `error: ${message}`.slice(0, 500) })
          .catch((e2: unknown) => console.error("send-reminders: log update", logId, errorMessage(e2)));
      }
    }
  }

  return {
    checked: appointments.length,
    sent,
    simulated,
    failed,
    skipped,
    sandbox,
    configured: { whatsapp: !!wa, email: !!mail },
  };
}
