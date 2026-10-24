-- Nimba Dentaire : agenda, salle d'attente et rappels automatiques.
--
-- * notification_log : compteur de tentatives (reprise limitée des envois échoués),
--   index pour le journal, lecture par le praticien pour ses propres rendez-vous.
-- * Un rendez-vous déplacé « libère » ses rappels déjà envoyés (le journal est conservé,
--   détaché du rendez-vous) pour qu'un nouveau rappel parte à la nouvelle date.
-- * Planification de l'Edge Function send-reminders toutes les 15 minutes (pg_cron + pg_net).

-- ---------------------------------------------------------------------------
-- Journal des envois
-- ---------------------------------------------------------------------------

alter table public.notification_log
  add column if not exists attempts int not null default 1 check (attempts >= 0);

create index if not exists notification_log_cabinet_created_idx
  on public.notification_log (cabinet_id, created_at desc);
create index if not exists notification_log_appointment_idx
  on public.notification_log (appointment_id);

-- Le praticien voit l'état des rappels de ses propres rendez-vous.
drop policy if exists notification_log_dentist_read on public.notification_log;
create policy notification_log_dentist_read on public.notification_log for select using (
  app.has_role(cabinet_id, '{dentist}')
  and exists (
    select 1 from public.appointments a
    where a.id = notification_log.appointment_id and a.dentist_id = auth.uid()
  )
);
-- Aucune politique d'écriture : seul le serveur (clé service) écrit dans le journal.

-- Rendez-vous déplacé à un autre jour : les rappels déjà journalisés sont détachés
-- (appointment_id = null, l'historique reste), ce qui autorise un nouvel envoi.
create or replace function app.release_reminders_on_reschedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at then
    update public.notification_log
    set appointment_id = null,
        error = coalesce(error, 'rescheduled')
    where appointment_id = new.id
      and kind in ('reminder_day_before', 'reminder_same_day');
  end if;
  return new;
end $$;

drop trigger if exists appointments_release_reminders on public.appointments;
create trigger appointments_release_reminders after update of starts_at on public.appointments
  for each row execute function app.release_reminders_on_reschedule();

-- ---------------------------------------------------------------------------
-- Planification (pg_cron + pg_net)
-- ---------------------------------------------------------------------------
-- Secrets attendus dans Vault (à créer une fois par environnement) :
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<secret partagé>', 'reminders_cron_secret');
-- Le même secret partagé est donné à la fonction : REMINDERS_CRON_SECRET.
-- Sans ces secrets, la tâche planifiée ne fait rien.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function app.invoke_send_reminders()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1;
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 30000
  );
end $$;

revoke execute on function app.invoke_send_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nimba-send-reminders') then
    perform cron.unschedule('nimba-send-reminders');
  end if;
  perform cron.schedule('nimba-send-reminders', '*/15 * * * *', 'select app.invoke_send_reminders()');
end $$;
