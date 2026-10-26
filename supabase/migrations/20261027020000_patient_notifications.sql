-- Nimba Dentaire : messages WhatsApp aux PATIENTS (jamais au personnel).
--
-- Migration additive :
-- * message_kind : nouveaux types de messages (gabarits WhatsApp personnalisables par le
--   cabinet dans message_templates, déjà synchronisée) ;
-- * cabinets : réglages des envois automatiques (un booléen par type d'événement) ;
-- * patient_notifications : file d'attente des envois automatiques, alimentée par des
--   déclencheurs à l'arrivée des lignes synchronisées (RDV créé / déplacé / annulé,
--   facture émise, paiement reçu) et vidée par l'Edge Function send-reminders (pg_cron,
--   toutes les 15 minutes). Une ligne par événement (contrainte d'unicité), 3 tentatives max.
--
-- Le destinataire est toujours le téléphone de la fiche patient, relu au moment de l'envoi.
-- Rien n'est mis en file pour un patient sans téléphone valide, opposé à WhatsApp
-- (whatsapp_opt_in = false), ni si ce numéro est celui du cabinet ou d'un membre du personnel.

-- ---------------------------------------------------------------------------
-- Types de messages (gabarits)
-- ---------------------------------------------------------------------------
-- Ajout de valeurs d'énumération : autorisé dans une transaction, non utilisées ici.
alter type public.message_kind add value if not exists 'appointment_moved';
alter type public.message_kind add value if not exists 'appointment_cancelled';
alter type public.message_kind add value if not exists 'appointment_missed';
alter type public.message_kind add value if not exists 'dentist_late';
alter type public.message_kind add value if not exists 'invoice_issued';
alter type public.message_kind add value if not exists 'payment_reminder';
alter type public.message_kind add value if not exists 'payment_received';
alter type public.message_kind add value if not exists 'installment_due';
alter type public.message_kind add value if not exists 'checkup_reminder';

-- ---------------------------------------------------------------------------
-- Réglages par cabinet
-- ---------------------------------------------------------------------------
-- Confirmations et changements de RDV : activés par défaut (information attendue par le
-- patient, sans donnée financière). Facture et paiement : désactivés par défaut (montants
-- envoyés sur le téléphone de la fiche, à activer en connaissance de cause).
alter table public.cabinets
  add column if not exists notify_appointment_created boolean not null default true,
  add column if not exists notify_appointment_changed boolean not null default true,
  add column if not exists notify_invoice_issued boolean not null default false,
  add column if not exists notify_payment_received boolean not null default false;

-- ---------------------------------------------------------------------------
-- File d'attente
-- ---------------------------------------------------------------------------
create table if not exists public.patient_notifications (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid not null,
  event text not null check (event in (
    'appointment_created', 'appointment_moved', 'appointment_cancelled', 'invoice_issued', 'payment_received'
  )),
  -- Clé d'idempotence : un seul message par événement.
  event_key text not null,
  appointment_id uuid,
  invoice_id uuid,
  payment_id uuid references public.payments(id) on delete set null,
  -- Début du RDV concerné au moment de l'événement (déplacement : nouvelle heure).
  ref_starts_at timestamptz,
  channel public.message_channel not null default 'whatsapp',
  recipient text,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0 check (attempts between 0 and 3),
  body text,
  error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (cabinet_id, event_key),
  foreign key (patient_id, cabinet_id) references public.patients(id, cabinet_id) on delete cascade,
  foreign key (appointment_id, cabinet_id) references public.appointments(id, cabinet_id) on delete set null (appointment_id),
  foreign key (invoice_id, cabinet_id) references public.invoices(id, cabinet_id) on delete set null (invoice_id)
);

create index if not exists patient_notifications_due_idx
  on public.patient_notifications (created_at) where status in ('pending', 'sending', 'failed');
create index if not exists patient_notifications_cabinet_created_idx
  on public.patient_notifications (cabinet_id, created_at desc);
create index if not exists patient_notifications_appointment_idx
  on public.patient_notifications (appointment_id) where appointment_id is not null;
create index if not exists patient_notifications_invoice_idx
  on public.patient_notifications (invoice_id) where invoice_id is not null;

drop trigger if exists patient_notifications_touch on public.patient_notifications;
create trigger patient_notifications_touch before insert or update on public.patient_notifications
  for each row execute function app.touch_updated_at();
drop trigger if exists patient_notifications_freeze_cabinet on public.patient_notifications;
create trigger patient_notifications_freeze_cabinet before update on public.patient_notifications
  for each row execute function app.freeze_cabinet_id();

alter table public.patient_notifications enable row level security;
-- Lecture du journal par l'administration et l'accueil ; aucune écriture côté client
-- (seuls les déclencheurs et la clé service écrivent).
drop policy if exists patient_notifications_read on public.patient_notifications;
create policy patient_notifications_read on public.patient_notifications for select
  using (app.has_role(cabinet_id, '{admin,assistant}'));
revoke insert, update, delete, truncate on public.patient_notifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mise en file
-- ---------------------------------------------------------------------------

-- Le patient peut-il recevoir un message WhatsApp ? (téléphone valide, pas d'opposition,
-- et numéro différent de celui du cabinet et de chaque membre du personnel)
create or replace function app.patient_whatsapp_ok(p_cabinet uuid, p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.patients p
    join public.cabinets c on c.id = p.cabinet_id
    where p.id = p_patient and p.cabinet_id = p_cabinet
      and p.deleted_at is null
      and p.whatsapp_opt_in
      and p.phone ~ '^\+\d{8,15}$'
      and app.phone_digits(p.phone) is distinct from app.phone_digits(c.phone)
      and not exists (
        select 1 from public.memberships m
        join public.profiles pr on pr.id = m.user_id
        where m.cabinet_id = p_cabinet and m.deleted_at is null
          and app.phone_digits(pr.phone) = app.phone_digits(p.phone)
      )
  )
$$;

-- Ajoute un message dans la file (idempotent). Ne fait jamais échouer l'écriture d'origine :
-- une erreur est seulement signalée dans le journal de la base.
create or replace function app.enqueue_patient_notification(
  p_cabinet uuid, p_patient uuid, p_event text, p_key text,
  p_appointment uuid default null, p_invoice uuid default null, p_payment uuid default null,
  p_starts_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_enabled boolean;
begin
  if p_patient is null then
    return;
  end if;
  select case
           when p_event = 'appointment_created' then c.notify_appointment_created
           when p_event in ('appointment_moved', 'appointment_cancelled') then c.notify_appointment_changed
           when p_event = 'invoice_issued' then c.notify_invoice_issued
           when p_event = 'payment_received' then c.notify_payment_received
           else false
         end
  into v_enabled
  from public.cabinets c where c.id = p_cabinet;
  if not coalesce(v_enabled, false) or not app.patient_whatsapp_ok(p_cabinet, p_patient) then
    return;
  end if;
  insert into public.patient_notifications
    (cabinet_id, patient_id, event, event_key, appointment_id, invoice_id, payment_id, ref_starts_at)
  values (p_cabinet, p_patient, p_event, p_key, p_appointment, p_invoice, p_payment, p_starts_at)
  on conflict (cabinet_id, event_key) do nothing;
exception when others then
  raise warning 'enqueue_patient_notification %: %', p_key, sqlerrm;
end $$;

-- Messages encore en attente d'un RDV / d'une facture / d'un paiement : abandonnés.
create or replace function app.skip_pending_notifications(
  p_cabinet uuid, p_reason text, p_appointment uuid default null, p_invoice uuid default null,
  p_payment uuid default null, p_events text[] default null
) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  update public.patient_notifications n
  set status = 'skipped', error = p_reason
  where n.cabinet_id = p_cabinet
    and n.status in ('pending', 'failed')
    and (p_appointment is null or n.appointment_id = p_appointment)
    and (p_invoice is null or n.invoice_id = p_invoice)
    and (p_payment is null or n.payment_id = p_payment)
    and (p_events is null or n.event = any (p_events));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Rendez-vous : création, déplacement, annulation, suppression.
create or replace function app.queue_appointment_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_active boolean := new.status in ('scheduled', 'confirmed') and new.deleted_at is null;
  v_skipped int;
begin
  if tg_op = 'INSERT' then
    if v_active and new.patient_id is not null and new.starts_at > now() then
      perform app.enqueue_patient_notification(new.cabinet_id, new.patient_id, 'appointment_created',
        'appointment_created:' || new.id || ':' || new.patient_id, new.id, null, null, new.starts_at);
    end if;
    return null;
  end if;

  -- Supprimé : plus rien ne part pour ce RDV.
  if new.deleted_at is not null then
    if old.deleted_at is null then
      perform app.skip_pending_notifications(new.cabinet_id, 'appointment deleted', new.id);
    end if;
    return null;
  end if;

  -- Patient changé : les messages prévus pour l'ancien patient sont abandonnés.
  if new.patient_id is distinct from old.patient_id then
    perform app.skip_pending_notifications(new.cabinet_id, 'patient changed', new.id);
    if v_active and new.patient_id is not null and new.starts_at > now() then
      perform app.enqueue_patient_notification(new.cabinet_id, new.patient_id, 'appointment_created',
        'appointment_created:' || new.id || ':' || new.patient_id, new.id, null, null, new.starts_at);
    end if;
    return null;
  end if;
  if new.patient_id is null then
    return null;
  end if;

  -- Annulation.
  if new.status = 'cancelled' and old.status in ('scheduled', 'confirmed') then
    -- Confirmation jamais partie : le patient n'a rien reçu, pas de message d'annulation.
    v_skipped := app.skip_pending_notifications(new.cabinet_id, 'appointment cancelled', new.id, null, null,
      array['appointment_created']);
    perform app.skip_pending_notifications(new.cabinet_id, 'appointment cancelled', new.id, null, null,
      array['appointment_moved']);
    if v_skipped = 0 and new.starts_at > now() then
      perform app.enqueue_patient_notification(new.cabinet_id, new.patient_id, 'appointment_cancelled',
        'appointment_cancelled:' || new.id || ':' || extract(epoch from new.starts_at)::bigint,
        new.id, null, null, new.starts_at);
    end if;
    return null;
  end if;

  -- Déplacement d'un RDV actif à venir.
  if new.starts_at is distinct from old.starts_at and v_active and new.starts_at > now() then
    if exists (
      select 1 from public.patient_notifications n
      where n.cabinet_id = new.cabinet_id and n.appointment_id = new.id
        and n.event = 'appointment_created' and n.status in ('pending', 'failed')
    ) then
      -- La confirmation pas encore envoyée donnera directement la nouvelle heure.
      return null;
    end if;
    perform app.skip_pending_notifications(new.cabinet_id, 'superseded', new.id, null, null, array['appointment_moved']);
    perform app.enqueue_patient_notification(new.cabinet_id, new.patient_id, 'appointment_moved',
      'appointment_moved:' || new.id || ':' || extract(epoch from old.starts_at)::bigint || ':' || extract(epoch from new.starts_at)::bigint,
      new.id, null, null, new.starts_at);
  end if;
  return null;
end $$;

drop trigger if exists appointments_patient_notifications on public.appointments;
create trigger appointments_patient_notifications
  after insert or update of starts_at, status, deleted_at, patient_id on public.appointments
  for each row execute function app.queue_appointment_notifications();

-- Factures : émission (brouillon -> émise), annulation, suppression.
create or replace function app.queue_invoice_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null or new.status = 'cancelled' then
    if tg_op = 'UPDATE' and (old.deleted_at is null and old.status <> 'cancelled') then
      perform app.skip_pending_notifications(new.cabinet_id, 'invoice cancelled', null, new.id);
    end if;
    return null;
  end if;
  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    perform app.enqueue_patient_notification(new.cabinet_id, new.patient_id, 'invoice_issued',
      'invoice_issued:' || new.id, null, new.id, null, null);
  end if;
  return null;
end $$;

drop trigger if exists invoices_patient_notifications on public.invoices;
create trigger invoices_patient_notifications
  after insert or update of status, deleted_at on public.invoices
  for each row execute function app.queue_invoice_notifications();

-- Paiements : encaissement réussi (comptoir ou paiement mobile confirmé).
create or replace function app.queue_payment_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid;
begin
  if new.deleted_at is not null or new.status <> 'succeeded' then
    if tg_op = 'UPDATE' then
      perform app.skip_pending_notifications(new.cabinet_id, 'payment cancelled', null, null, new.id);
    end if;
    return null;
  end if;
  if tg_op = 'INSERT' or old.status <> 'succeeded' or old.deleted_at is not null then
    select i.patient_id into v_patient from public.invoices i
    where i.id = new.invoice_id and i.cabinet_id = new.cabinet_id and i.deleted_at is null and i.status <> 'draft';
    if v_patient is not null then
      perform app.enqueue_patient_notification(new.cabinet_id, v_patient, 'payment_received',
        'payment_received:' || new.id, null, new.invoice_id, new.id, null);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists payments_patient_notifications on public.payments;
create trigger payments_patient_notifications
  after insert or update of status, deleted_at on public.payments
  for each row execute function app.queue_payment_notifications();

-- Fonctions internes : jamais appelables par les clients.
revoke execute on function app.patient_whatsapp_ok(uuid, uuid) from public, anon, authenticated;
revoke execute on function app.enqueue_patient_notification(uuid, uuid, text, text, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function app.skip_pending_notifications(uuid, text, uuid, uuid, uuid, text[]) from public, anon, authenticated;
revoke execute on function app.queue_appointment_notifications() from public, anon, authenticated;
revoke execute on function app.queue_invoice_notifications() from public, anon, authenticated;
revoke execute on function app.queue_payment_notifications() from public, anon, authenticated;
