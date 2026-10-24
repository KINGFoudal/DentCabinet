-- Nimba Dentaire : schéma initial.
--
-- Principes :
-- * Chaque table métier porte cabinet_id ; l'isolation est imposée par RLS.
-- * Les identifiants (uuid) peuvent être générés côté client pour le mode hors ligne.
-- * updated_at est toujours fixé par le serveur et sert de curseur de synchronisation.
-- * Pas de suppression physique depuis l'application : deleted_at (suppression logique).

create extension if not exists btree_gist;

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'dentist', 'assistant', 'accountant');
create type public.sex as enum ('female', 'male', 'other');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'expired', 'cancelled');
create type public.billing_cycle as enum ('monthly', 'yearly');
create type public.appointment_status as enum (
  'scheduled', 'confirmed', 'arrived', 'in_treatment', 'done', 'cancelled', 'no_show'
);
create type public.appointment_source as enum ('staff', 'online');
create type public.tooth_status as enum (
  'healthy', 'caries', 'filled', 'crown', 'missing', 'extracted', 'implant',
  'root_canal', 'bridge', 'fractured', 'to_extract', 'other'
);
create type public.plan_status as enum ('draft', 'proposed', 'accepted', 'in_progress', 'completed', 'cancelled');
create type public.plan_item_status as enum ('planned', 'done', 'cancelled');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'refused', 'expired');
create type public.invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'cancelled');
create type public.payment_method as enum ('cash', 'orange_money', 'mtn_momo', 'transfer', 'other');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'expired', 'refunded');
create type public.payment_provider as enum ('orange_money', 'mtn_momo');
create type public.payment_purpose as enum ('invoice', 'subscription');
create type public.document_kind as enum ('xray', 'photo', 'prescription', 'scan', 'consent', 'administrative', 'other');
create type public.message_channel as enum ('whatsapp', 'email', 'sms');
create type public.message_kind as enum ('reminder_day_before', 'reminder_same_day', 'booking_confirmation', 'otp');
create type public.message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');

-- ---------------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, clock_timestamp());
  else
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- Empêche un client de déplacer une ligne vers un autre cabinet.
create or replace function app.freeze_cabinet_id()
returns trigger language plpgsql as $$
begin
  if new.cabinet_id is distinct from old.cabinet_id then
    raise exception 'cabinet_id is immutable';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Plateforme : formules et cabinets
-- ---------------------------------------------------------------------------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  min_dentists int not null,
  max_dentists int,                        -- null = illimité
  price_monthly_gnf bigint not null,       -- prix du palier pour min_dentists
  price_per_extra_dentist_gnf bigint not null default 0,
  yearly_discount_pct int not null default 0 check (yearly_discount_pct between 0 and 100),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_dentists is null or max_dentists >= min_dentists)
);

create table public.cabinets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  phone text,
  email text,
  address text,
  city text,
  country text not null default 'GN',
  currency text not null default 'GNF',
  timezone text not null default 'Africa/Conakry',
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  logo_path text,
  public_description text,
  public_page_enabled boolean not null default true,
  online_booking_enabled boolean not null default false,
  -- Délai minimum (heures) avant un RDV pour qu'un patient puisse l'annuler en ligne.
  online_cancel_min_hours int not null default 24,
  -- {"1": [["08:00","12:00"],["14:00","18:00"]], ...} ; 1 = lundi ... 7 = dimanche
  opening_hours jsonb not null default '{}'::jsonb,
  plan_id uuid references public.plans(id),
  billing_cycle public.billing_cycle not null default 'monthly',
  subscription_status public.subscription_status not null default 'trialing',
  trial_ends_at timestamptz default (now() + interval '30 days'),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  roles public.app_role[] not null check (cardinality(roles) > 0),
  display_name text,
  color text,                              -- couleur du praticien dans l'agenda
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (cabinet_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  email text not null,
  roles public.app_role[] not null check (cardinality(roles) > 0),
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Fonctions d'autorisation (utilisées par RLS)
-- ---------------------------------------------------------------------------

create or replace function app.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function app.has_role(p_cabinet uuid, p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.cabinet_id = p_cabinet
      and m.user_id = auth.uid()
      and m.active
      and m.deleted_at is null
      and m.roles && p_roles
  )
$$;

create or replace function app.is_member(p_cabinet uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_cabinet, array['admin','dentist','assistant','accountant']::public.app_role[])
$$;

-- Un cabinet dont l'abonnement est expiré passe en lecture seule.
create or replace function app.cabinet_writable(p_cabinet uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cabinets c
    where c.id = p_cabinet
      and (
        c.subscription_status in ('active', 'past_due')
        or (c.subscription_status = 'trialing' and (c.trial_ends_at is null or c.trial_ends_at > now()))
      )
  )
$$;

create or replace function app.can_write(p_cabinet uuid, p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_cabinet, p_roles) and app.cabinet_writable(p_cabinet)
$$;

-- ---------------------------------------------------------------------------
-- Paramétrage du cabinet
-- ---------------------------------------------------------------------------

create table public.chairs (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  name text not null,
  duration_minutes int not null default 30 check (duration_minutes between 5 and 480),
  color text not null default '#0F766E',
  bookable_online boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Horaires de travail récurrents d'un praticien.
create table public.practitioner_schedules (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  dentist_id uuid not null references auth.users(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7), -- 1 = lundi
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  dentist_id uuid references auth.users(id) on delete cascade, -- null = tout le cabinet
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Catalogue des actes et tarifs du cabinet.
create table public.acts (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  code text,
  label text not null,
  category text,
  price_gnf bigint not null check (price_gnf >= 0),
  default_duration_minutes int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  file_number text,                         -- numéro de dossier attribué par le serveur
  first_name text not null,
  last_name text not null,
  sex public.sex,
  birth_date date,
  phone text,                               -- format E.164, ex. +224620000000
  whatsapp_opt_in boolean not null default true,
  email text,
  address text,
  city text,
  profession text,
  emergency_contact_name text,
  emergency_contact_phone text,
  insurance_name text,
  insurance_number text,
  admin_notes text,
  portal_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (cabinet_id, file_number)
);
create index patients_cabinet_name_idx on public.patients (cabinet_id, last_name, first_name);
create index patients_cabinet_phone_idx on public.patients (cabinet_id, phone);
create index patients_portal_user_idx on public.patients (portal_user_id);

-- Informations médicales (pas visibles par le comptable).
create table public.patient_medical (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  alerts text[] not null default '{}',      -- ex. {diabetes, anticoagulants, pregnancy}
  allergies text,
  medical_history text,
  current_treatments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------------

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  dentist_id uuid not null references auth.users(id),
  chair_id uuid references public.chairs(id),
  type_id uuid references public.appointment_types(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'scheduled',
  source public.appointment_source not null default 'staff',
  title text,                               -- libellé libre (ex. patient non encore créé)
  notes text,
  arrived_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at),
  -- Deux rendez-vous actifs ne peuvent pas se chevaucher pour un même praticien ou fauteuil.
  constraint appointments_no_dentist_overlap exclude using gist (
    dentist_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (deleted_at is null and status not in ('cancelled', 'no_show')),
  constraint appointments_no_chair_overlap exclude using gist (
    chair_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (chair_id is not null and deleted_at is null and status not in ('cancelled', 'no_show'))
);
create index appointments_cabinet_start_idx on public.appointments (cabinet_id, starts_at);
create index appointments_patient_idx on public.appointments (patient_id);

-- ---------------------------------------------------------------------------
-- Dossier clinique (praticiens uniquement)
-- ---------------------------------------------------------------------------

create table public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  author_id uuid not null references auth.users(id),
  body text not null,
  signed_at timestamptz,                    -- une note signée n'est plus modifiable
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index clinical_notes_patient_idx on public.clinical_notes (patient_id);

-- État courant de chaque dent (numérotation FDI : 11-48 adulte, 51-85 enfant).
create table public.tooth_records (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  tooth int not null check (
    (tooth between 11 and 18) or (tooth between 21 and 28) or (tooth between 31 and 38) or (tooth between 41 and 48)
    or (tooth between 51 and 55) or (tooth between 61 and 65) or (tooth between 71 and 75) or (tooth between 81 and 85)
  ),
  status public.tooth_status not null default 'healthy',
  surfaces text[] not null default '{}',    -- M, O, D, V, L
  notes text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (patient_id, tooth)
);

create table public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  dentist_id uuid not null references auth.users(id),
  title text not null,
  status public.plan_status not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.treatment_plan_items (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  plan_id uuid not null references public.treatment_plans(id) on delete cascade,
  act_id uuid references public.acts(id),
  label text not null,
  tooth int,
  step int not null default 1,
  quantity int not null default 1 check (quantity > 0),
  unit_price_gnf bigint not null check (unit_price_gnf >= 0),
  status public.plan_item_status not null default 'planned',
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  dentist_id uuid not null references auth.users(id),
  -- [{"drug": "...", "dosage": "...", "duration": "...", "instructions": "..."}]
  items jsonb not null default '[]'::jsonb,
  notes text,
  shared_with_patient boolean not null default true,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  kind public.document_kind not null default 'other',
  title text not null,
  storage_path text not null,               -- bucket "documents" : {cabinet_id}/{patient_id}/{id}-{nom}
  mime_type text,
  size_bytes bigint,
  shared_with_patient boolean not null default false,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Facturation
-- ---------------------------------------------------------------------------

create table public.cabinet_counters (
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  kind text not null,                       -- 'invoice' | 'quote' | 'patient'
  year int not null,
  value int not null default 0,
  primary key (cabinet_id, kind, year)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid not null references public.patients(id),
  plan_id uuid references public.treatment_plans(id) on delete set null,
  dentist_id uuid references auth.users(id),
  number text,                              -- attribué par le serveur : D-2026-00001
  status public.quote_status not null default 'draft',
  issue_date date not null default current_date,
  valid_until date,
  total_gnf bigint not null default 0,      -- recalculé par le serveur
  notes text,
  accepted_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (cabinet_id, number)
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  act_id uuid references public.acts(id),
  label text not null,
  tooth int,
  quantity int not null default 1 check (quantity > 0),
  unit_price_gnf bigint not null check (unit_price_gnf >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_id uuid not null references public.patients(id),
  quote_id uuid references public.quotes(id) on delete set null,
  number text,                              -- attribué par le serveur : F-2026-00001
  status public.invoice_status not null default 'draft',
  issue_date date not null default current_date,
  due_date date,
  total_gnf bigint not null default 0,      -- recalculé par le serveur
  paid_gnf bigint not null default 0,       -- recalculé par le serveur
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (cabinet_id, number)
);
create index invoices_cabinet_status_idx on public.invoices (cabinet_id, status);
create index invoices_patient_idx on public.invoices (patient_id);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  act_id uuid references public.acts(id),
  plan_item_id uuid references public.treatment_plan_items(id) on delete set null,
  label text not null,
  tooth int,
  quantity int not null default 1 check (quantity > 0),
  unit_price_gnf bigint not null check (unit_price_gnf >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Échéancier d'une facture.
create table public.payment_installments (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  due_date date not null,
  amount_gnf bigint not null check (amount_gnf > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Transactions initiées auprès d'un opérateur de paiement mobile.
-- Écrites uniquement côté serveur (service role) : jamais marquées payées depuis le navigateur.
create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  purpose public.payment_purpose not null,
  invoice_id uuid references public.invoices(id),
  provider public.payment_provider not null,
  amount_gnf bigint not null check (amount_gnf > 0),
  payer_phone text not null,
  status public.payment_status not null default 'pending',
  provider_reference text,
  failure_reason text,
  raw jsonb,
  initiated_by uuid references auth.users(id),
  -- Pour un abonnement : la période payée.
  subscription_cycle public.billing_cycle,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference),
  check (purpose <> 'invoice' or invoice_id is not null)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id),
  amount_gnf bigint not null check (amount_gnf > 0),
  method public.payment_method not null,
  status public.payment_status not null default 'succeeded',
  reference text,                           -- n° de transaction saisi au comptoir
  transaction_id uuid unique references public.payment_transactions(id),
  paid_at timestamptz not null default now(),
  received_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_cabinet_paid_idx on public.payments (cabinet_id, paid_at);

-- Paiements d'abonnement des cabinets.
create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  plan_id uuid references public.plans(id),
  transaction_id uuid unique references public.payment_transactions(id),
  amount_gnf bigint not null,
  dentist_count int not null,
  cycle public.billing_cycle not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Messages et rappels
-- ---------------------------------------------------------------------------

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  kind public.message_kind not null,
  channel public.message_channel not null,
  locale text not null default 'fr',
  subject text,
  -- Variables : {{patient_name}} {{cabinet_name}} {{date}} {{time}} {{dentist_name}} {{cabinet_phone}}
  body text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (cabinet_id, kind, channel, locale)
);

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  kind public.message_kind not null,
  channel public.message_channel not null,
  recipient text not null,
  status public.message_status not null default 'queued',
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un même rappel n'est envoyé qu'une fois par canal.
  unique (appointment_id, kind, channel)
);

-- ---------------------------------------------------------------------------
-- Journal d'audit
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  cabinet_id uuid references public.cabinets(id) on delete cascade,
  user_id uuid,
  action text not null,                     -- insert | update | delete | view
  table_name text not null,
  record_id uuid,
  patient_id uuid,
  at timestamptz not null default now()
);
create index audit_log_cabinet_at_idx on public.audit_log (cabinet_id, at desc);
create index audit_log_patient_idx on public.audit_log (patient_id, at desc);

create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
  pid uuid;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  pid := case
    when tg_table_name = 'patients' then (to_jsonb(r) ->> 'id')::uuid
    else (to_jsonb(r) ->> 'patient_id')::uuid
  end;
  insert into public.audit_log (cabinet_id, user_id, action, table_name, record_id, patient_id)
  values ((to_jsonb(r) ->> 'cabinet_id')::uuid, auth.uid(), lower(tg_op), tg_table_name,
          coalesce((to_jsonb(r) ->> 'id')::uuid, (to_jsonb(r) ->> 'patient_id')::uuid), pid);
  return null;
end $$;

-- Appelé par l'application à l'ouverture d'un dossier patient (traçabilité des consultations).
create or replace function public.log_patient_view(p_patient uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_cabinet uuid;
begin
  select cabinet_id into v_cabinet from public.patients where id = p_patient;
  if v_cabinet is null or not app.is_member(v_cabinet) then
    raise exception 'not allowed';
  end if;
  insert into public.audit_log (cabinet_id, user_id, action, table_name, record_id, patient_id)
  values (v_cabinet, auth.uid(), 'view', 'patients', p_patient, p_patient);
end $$;

-- ---------------------------------------------------------------------------
-- Numérotation séquentielle par cabinet
-- ---------------------------------------------------------------------------

create or replace function app.next_counter(p_cabinet uuid, p_kind text, p_year int)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v int;
begin
  insert into public.cabinet_counters (cabinet_id, kind, year, value)
  values (p_cabinet, p_kind, p_year, 1)
  on conflict (cabinet_id, kind, year) do update set value = public.cabinet_counters.value + 1
  returning value into v;
  return v;
end $$;

create or replace function app.assign_number()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from coalesce(new.issue_date, current_date))::int;
begin
  -- Un brouillon n'a pas de numéro ; le numéro est attribué une seule fois.
  if new.number is null and new.status <> 'draft' then
    if tg_table_name = 'invoices' then
      new.number := 'F-' || y || '-' || lpad(app.next_counter(new.cabinet_id, 'invoice', y)::text, 5, '0');
    else
      new.number := 'D-' || y || '-' || lpad(app.next_counter(new.cabinet_id, 'quote', y)::text, 5, '0');
    end if;
  elsif tg_op = 'UPDATE' and old.number is not null and new.number is distinct from old.number then
    raise exception 'number is immutable';
  end if;
  return new;
end $$;

create or replace function app.assign_file_number()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from now())::int;
begin
  if new.file_number is null then
    new.file_number := 'P' || y || '-' || lpad(app.next_counter(new.cabinet_id, 'patient', y)::text, 5, '0');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Totaux calculés par le serveur
-- ---------------------------------------------------------------------------

create or replace function app.recompute_quote(p_quote uuid)
returns void language sql security definer set search_path = '' as $$
  update public.quotes q
  set total_gnf = coalesce((
    select sum(i.quantity * i.unit_price_gnf) from public.quote_items i
    where i.quote_id = q.id and i.deleted_at is null), 0)
  where q.id = p_quote
$$;

create or replace function app.recompute_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_total bigint;
  v_paid bigint;
  v_status public.invoice_status;
begin
  select coalesce(sum(i.quantity * i.unit_price_gnf), 0) into v_total
  from public.invoice_items i where i.invoice_id = p_invoice and i.deleted_at is null;

  select coalesce(sum(p.amount_gnf), 0) into v_paid
  from public.payments p
  where p.invoice_id = p_invoice and p.deleted_at is null and p.status = 'succeeded';

  select status into v_status from public.invoices where id = p_invoice;

  update public.invoices
  set total_gnf = v_total,
      paid_gnf = v_paid,
      status = case
        when v_status in ('draft', 'cancelled') then v_status
        when v_total > 0 and v_paid >= v_total then 'paid'
        when v_paid > 0 then 'partially_paid'
        else 'issued'
      end
  where id = p_invoice;
end $$;

create or replace function app.on_quote_item_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.recompute_quote(coalesce(new.quote_id, old.quote_id));
  return null;
end $$;

create or replace function app.on_invoice_child_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.recompute_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

create or replace function app.on_invoice_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status not in ('draft', 'cancelled') then
    perform app.recompute_invoice(new.id);
  end if;
  return null;
end $$;

-- Les totaux ne peuvent pas être fixés par le client.
create or replace function app.protect_totals()
returns trigger language plpgsql as $$
begin
  if current_setting('app.recomputing', true) = 'on' then
    return new;
  end if;
  if tg_table_name = 'invoices' then
    if tg_op = 'INSERT' then
      new.total_gnf := 0; new.paid_gnf := 0;
    elsif pg_trigger_depth() = 1 then
      new.total_gnf := old.total_gnf; new.paid_gnf := old.paid_gnf;
      if new.status in ('partially_paid', 'paid') and old.status not in ('partially_paid', 'paid') then
        new.status := old.status;  -- l'état « payé » découle des paiements
      end if;
    end if;
  else
    if tg_op = 'INSERT' then
      new.total_gnf := 0;
    elsif pg_trigger_depth() = 1 then
      new.total_gnf := old.total_gnf;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profils créés à l'inscription
-- ---------------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Les champs sensibles du profil ne sont modifiables que par un admin plateforme.
create or replace function app.protect_profile()
returns trigger language plpgsql as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin and not app.is_platform_admin()
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function app.protect_profile();

-- Champs d'abonnement : modifiables uniquement côté serveur.
create or replace function app.protect_cabinet_billing()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or app.is_platform_admin() then
    return new;
  end if;
  if new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.current_period_end is distinct from old.current_period_end
     or new.plan_id is distinct from old.plan_id then
    raise exception 'subscription fields are managed by the platform';
  end if;
  return new;
end $$;

create trigger cabinets_protect_billing before update on public.cabinets
  for each row execute function app.protect_cabinet_billing();

-- Une note clinique signée n'est plus modifiable.
create or replace function app.protect_signed_note()
returns trigger language plpgsql as $$
begin
  if old.signed_at is not null and (
      new.body is distinct from old.body
      or new.signed_at is distinct from old.signed_at
      or new.patient_id is distinct from old.patient_id) then
    raise exception 'signed note cannot be modified';
  end if;
  return new;
end $$;

create trigger clinical_notes_protect before update on public.clinical_notes
  for each row execute function app.protect_signed_note();

-- Le statut d'un paiement mobile initié en ligne ne vient que du serveur.
create or replace function app.protect_payment()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if new.transaction_id is not null then
    raise exception 'online payments are recorded by the server';
  end if;
  if tg_op = 'UPDATE' and (new.amount_gnf is distinct from old.amount_gnf
      or new.invoice_id is distinct from old.invoice_id) then
    raise exception 'payments are immutable; cancel and record a new one';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers communs
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'plans', 'cabinets', 'profiles', 'memberships', 'invitations', 'chairs', 'appointment_types',
    'practitioner_schedules', 'time_off', 'acts', 'patients', 'patient_medical', 'appointments',
    'clinical_notes', 'tooth_records', 'treatment_plans', 'treatment_plan_items', 'prescriptions',
    'documents', 'quotes', 'quote_items', 'invoices', 'invoice_items', 'payment_installments',
    'payment_transactions', 'payments', 'subscription_payments', 'message_templates', 'notification_log'
  ] loop
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;

  foreach t in array array[
    'memberships', 'invitations', 'chairs', 'appointment_types', 'practitioner_schedules', 'time_off',
    'acts', 'patients', 'patient_medical', 'appointments', 'clinical_notes', 'tooth_records',
    'treatment_plans', 'treatment_plan_items', 'prescriptions', 'documents', 'quotes', 'quote_items',
    'invoices', 'invoice_items', 'payment_installments', 'payment_transactions', 'payments',
    'subscription_payments', 'message_templates', 'notification_log'
  ] loop
    execute format('create trigger %I before update on public.%I
                    for each row execute function app.freeze_cabinet_id()', t || '_freeze_cabinet', t);
  end loop;

  foreach t in array array[
    'patients', 'patient_medical', 'clinical_notes', 'tooth_records', 'treatment_plans',
    'treatment_plan_items', 'prescriptions', 'documents'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

create trigger invoices_number before insert or update on public.invoices
  for each row execute function app.assign_number();
create trigger quotes_number before insert or update on public.quotes
  for each row execute function app.assign_number();
create trigger patients_file_number before insert on public.patients
  for each row execute function app.assign_file_number();

create trigger invoices_protect_totals before insert or update on public.invoices
  for each row execute function app.protect_totals();
create trigger quotes_protect_totals before insert or update on public.quotes
  for each row execute function app.protect_totals();

create trigger quote_items_recompute after insert or update or delete on public.quote_items
  for each row execute function app.on_quote_item_change();
create trigger invoice_items_recompute after insert or update or delete on public.invoice_items
  for each row execute function app.on_invoice_child_change();
create trigger payments_recompute after insert or update or delete on public.payments
  for each row execute function app.on_invoice_child_change();
create trigger invoices_status_recompute after update of status on public.invoices
  for each row execute function app.on_invoice_status_change();

create trigger payments_protect before insert or update on public.payments
  for each row execute function app.protect_payment();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.cabinets enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.chairs enable row level security;
alter table public.appointment_types enable row level security;
alter table public.practitioner_schedules enable row level security;
alter table public.time_off enable row level security;
alter table public.acts enable row level security;
alter table public.patients enable row level security;
alter table public.patient_medical enable row level security;
alter table public.appointments enable row level security;
alter table public.clinical_notes enable row level security;
alter table public.tooth_records enable row level security;
alter table public.treatment_plans enable row level security;
alter table public.treatment_plan_items enable row level security;
alter table public.prescriptions enable row level security;
alter table public.documents enable row level security;
alter table public.cabinet_counters enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payment_installments enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payments enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.message_templates enable row level security;
alter table public.notification_log enable row level security;
alter table public.audit_log enable row level security;

-- Aucune politique DELETE : l'application fait des suppressions logiques (deleted_at).

-- Formules : lisibles par tous, modifiables par l'admin plateforme.
create policy plans_read on public.plans for select using (true);
create policy plans_admin on public.plans for all
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- Cabinets
create policy cabinets_read on public.cabinets for select
  using (app.is_member(id) or app.is_platform_admin());
create policy cabinets_update on public.cabinets for update
  using (app.has_role(id, '{admin}') or app.is_platform_admin())
  with check (app.has_role(id, '{admin}') or app.is_platform_admin());
-- La création passe par public.create_cabinet().

-- Profils
create policy profiles_read on public.profiles for select using (
  id = auth.uid()
  or app.is_platform_admin()
  or exists (
    select 1 from public.memberships mine
    join public.memberships theirs on theirs.cabinet_id = mine.cabinet_id
    where mine.user_id = auth.uid() and mine.active and mine.deleted_at is null
      and theirs.user_id = profiles.id
  )
);
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Membres
create policy memberships_read on public.memberships for select
  using (user_id = auth.uid() or app.is_member(cabinet_id) or app.is_platform_admin());
create policy memberships_write on public.memberships for insert
  with check (app.can_write(cabinet_id, '{admin}'));
create policy memberships_update on public.memberships for update
  using (app.has_role(cabinet_id, '{admin}'))
  with check (app.can_write(cabinet_id, '{admin}'));

create policy invitations_admin on public.invitations for select
  using (app.has_role(cabinet_id, '{admin}'));
create policy invitations_insert on public.invitations for insert
  with check (app.can_write(cabinet_id, '{admin}'));
create policy invitations_update on public.invitations for update
  using (app.has_role(cabinet_id, '{admin}')) with check (app.can_write(cabinet_id, '{admin}'));

-- Paramétrage : lecture par tous les membres, écriture par l'admin.
do $$
declare
  t text;
begin
  foreach t in array array['chairs', 'appointment_types', 'acts', 'message_templates'] loop
    execute format('create policy %I on public.%I for select using (app.is_member(cabinet_id))', t || '_read', t);
    execute format('create policy %I on public.%I for insert with check (app.can_write(cabinet_id, ''{admin}''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (app.has_role(cabinet_id, ''{admin}'')) with check (app.can_write(cabinet_id, ''{admin}''))', t || '_update', t);
  end loop;
end $$;

-- Horaires et absences : l'admin, le secrétariat, et chaque praticien pour lui-même.
do $$
declare
  t text;
begin
  foreach t in array array['practitioner_schedules', 'time_off'] loop
    execute format('create policy %I on public.%I for select using (app.is_member(cabinet_id))', t || '_read', t);
    execute format($f$create policy %I on public.%I for insert with check (
      app.can_write(cabinet_id, '{admin,assistant}')
      or (dentist_id = auth.uid() and app.can_write(cabinet_id, '{dentist}')))$f$, t || '_insert', t);
    execute format($f$create policy %I on public.%I for update
      using (app.has_role(cabinet_id, '{admin,assistant}') or (dentist_id = auth.uid() and app.has_role(cabinet_id, '{dentist}')))
      with check (app.can_write(cabinet_id, '{admin,assistant}')
        or (dentist_id = auth.uid() and app.can_write(cabinet_id, '{dentist}')))$f$, t || '_update', t);
  end loop;
end $$;

-- Patients : fiche administrative visible par tous les membres (le comptable en a besoin pour les factures).
create policy patients_staff_read on public.patients for select using (app.is_member(cabinet_id));
create policy patients_portal_read on public.patients for select using (portal_user_id = auth.uid());
create policy patients_insert on public.patients for insert
  with check (app.can_write(cabinet_id, '{admin,dentist,assistant}'));
create policy patients_update on public.patients for update
  using (app.has_role(cabinet_id, '{admin,dentist,assistant}'))
  with check (app.can_write(cabinet_id, '{admin,dentist,assistant}'));

-- Informations médicales : praticiens et secrétariat (alertes utiles à l'accueil), pas le comptable.
create policy patient_medical_read on public.patient_medical for select
  using (app.has_role(cabinet_id, '{dentist,assistant}'));
create policy patient_medical_insert on public.patient_medical for insert
  with check (app.can_write(cabinet_id, '{dentist,assistant}'));
create policy patient_medical_update on public.patient_medical for update
  using (app.has_role(cabinet_id, '{dentist,assistant}'))
  with check (app.can_write(cabinet_id, '{dentist,assistant}'));

-- Rendez-vous
create policy appointments_staff_read on public.appointments for select using (app.is_member(cabinet_id));
create policy appointments_portal_read on public.appointments for select using (
  exists (select 1 from public.patients p where p.id = appointments.patient_id and p.portal_user_id = auth.uid())
);
create policy appointments_insert on public.appointments for insert
  with check (app.can_write(cabinet_id, '{admin,dentist,assistant}'));
create policy appointments_update on public.appointments for update
  using (app.has_role(cabinet_id, '{admin,dentist,assistant}'))
  with check (app.can_write(cabinet_id, '{admin,dentist,assistant}'));

-- Dossier clinique : praticiens uniquement.
do $$
declare
  t text;
begin
  foreach t in array array['clinical_notes', 'tooth_records', 'treatment_plans', 'treatment_plan_items'] loop
    execute format('create policy %I on public.%I for select using (app.has_role(cabinet_id, ''{dentist}''))', t || '_read', t);
    execute format('create policy %I on public.%I for insert with check (app.can_write(cabinet_id, ''{dentist}''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (app.has_role(cabinet_id, ''{dentist}'')) with check (app.can_write(cabinet_id, ''{dentist}''))', t || '_update', t);
  end loop;
end $$;

-- Seul l'auteur modifie sa note.
drop policy clinical_notes_update on public.clinical_notes;
create policy clinical_notes_update on public.clinical_notes for update
  using (author_id = auth.uid() and app.has_role(cabinet_id, '{dentist}'))
  with check (author_id = auth.uid() and app.can_write(cabinet_id, '{dentist}'));
drop policy clinical_notes_insert on public.clinical_notes;
create policy clinical_notes_insert on public.clinical_notes for insert
  with check (author_id = auth.uid() and app.can_write(cabinet_id, '{dentist}'));

-- Ordonnances : praticiens ; le patient voit les siennes si partagées.
create policy prescriptions_read on public.prescriptions for select using (app.has_role(cabinet_id, '{dentist}'));
create policy prescriptions_portal_read on public.prescriptions for select using (
  shared_with_patient and deleted_at is null
  and exists (select 1 from public.patients p where p.id = prescriptions.patient_id and p.portal_user_id = auth.uid())
);
create policy prescriptions_insert on public.prescriptions for insert
  with check (app.can_write(cabinet_id, '{dentist}'));
create policy prescriptions_update on public.prescriptions for update
  using (app.has_role(cabinet_id, '{dentist}')) with check (app.can_write(cabinet_id, '{dentist}'));

-- Documents : les praticiens voient tout ; le secrétariat ne voit que l'administratif.
create policy documents_read on public.documents for select using (
  app.has_role(cabinet_id, '{dentist}')
  or (kind = 'administrative' and app.has_role(cabinet_id, '{admin,assistant}'))
);
create policy documents_portal_read on public.documents for select using (
  shared_with_patient and deleted_at is null
  and exists (select 1 from public.patients p where p.id = documents.patient_id and p.portal_user_id = auth.uid())
);
create policy documents_insert on public.documents for insert with check (
  app.can_write(cabinet_id, '{dentist}')
  or (kind = 'administrative' and app.can_write(cabinet_id, '{admin,assistant}'))
);
create policy documents_update on public.documents for update
  using (app.has_role(cabinet_id, '{dentist}') or (kind = 'administrative' and app.has_role(cabinet_id, '{admin,assistant}')))
  with check (app.can_write(cabinet_id, '{dentist}') or (kind = 'administrative' and app.can_write(cabinet_id, '{admin,assistant}')));

-- Facturation : lecture par tous les membres (comptable inclus), écriture hors comptable.
do $$
declare
  t text;
begin
  foreach t in array array['quotes', 'quote_items', 'invoices', 'invoice_items', 'payment_installments', 'payments'] loop
    execute format('create policy %I on public.%I for select using (app.is_member(cabinet_id))', t || '_read', t);
    execute format('create policy %I on public.%I for insert with check (app.can_write(cabinet_id, ''{admin,dentist,assistant}''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (app.has_role(cabinet_id, ''{admin,dentist,assistant}'')) with check (app.can_write(cabinet_id, ''{admin,dentist,assistant}''))', t || '_update', t);
  end loop;
end $$;

create policy quotes_portal_read on public.quotes for select using (
  status <> 'draft' and deleted_at is null
  and exists (select 1 from public.patients p where p.id = quotes.patient_id and p.portal_user_id = auth.uid())
);
create policy quote_items_portal_read on public.quote_items for select using (
  exists (select 1 from public.quotes q join public.patients p on p.id = q.patient_id
          where q.id = quote_items.quote_id and q.status <> 'draft' and p.portal_user_id = auth.uid())
);
create policy invoices_portal_read on public.invoices for select using (
  status <> 'draft' and deleted_at is null
  and exists (select 1 from public.patients p where p.id = invoices.patient_id and p.portal_user_id = auth.uid())
);
create policy invoice_items_portal_read on public.invoice_items for select using (
  exists (select 1 from public.invoices i join public.patients p on p.id = i.patient_id
          where i.id = invoice_items.invoice_id and i.status <> 'draft' and p.portal_user_id = auth.uid())
);
create policy payments_portal_read on public.payments for select using (
  exists (select 1 from public.invoices i join public.patients p on p.id = i.patient_id
          where i.id = payments.invoice_id and p.portal_user_id = auth.uid())
);

-- Transactions mobiles : lecture seule pour le cabinet et le patient concerné ; écriture serveur.
create policy payment_transactions_read on public.payment_transactions for select
  using (app.has_role(cabinet_id, '{admin,assistant,accountant}') or initiated_by = auth.uid());

create policy subscription_payments_read on public.subscription_payments for select
  using (app.has_role(cabinet_id, '{admin,accountant}') or app.is_platform_admin());

create policy notification_log_read on public.notification_log for select
  using (app.has_role(cabinet_id, '{admin,assistant}'));

create policy audit_log_read on public.audit_log for select
  using (app.has_role(cabinet_id, '{admin}') or app.is_platform_admin());

-- cabinet_counters : aucune politique, accès uniquement via les fonctions security definer.

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Création d'un cabinet par un nouvel utilisateur : il en devient administrateur et praticien.
create or replace function public.create_cabinet(
  p_name text, p_slug text, p_phone text default null, p_city text default null,
  p_is_dentist boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_roles public.app_role[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.cabinets (name, slug, phone, city, plan_id)
  values (p_name, p_slug, p_phone, p_city,
          (select id from public.plans where active order by min_dentists, sort_order limit 1))
  returning id into v_id;

  v_roles := case when p_is_dentist then '{admin,dentist}'::public.app_role[] else '{admin}'::public.app_role[] end;
  insert into public.memberships (cabinet_id, user_id, roles) values (v_id, auth.uid(), v_roles);

  insert into public.chairs (cabinet_id, name) values (v_id, 'Fauteuil 1');
  insert into public.appointment_types (cabinet_id, name, duration_minutes, color, bookable_online) values
    (v_id, 'Consultation', 30, '#0F766E', true),
    (v_id, 'Détartrage', 30, '#14B8A6', true),
    (v_id, 'Soin de carie', 45, '#2563EB', false),
    (v_id, 'Extraction', 45, '#DC2626', false),
    (v_id, 'Urgence', 30, '#D97706', false);
  insert into public.message_templates (cabinet_id, kind, channel, locale, subject, body) values
    (v_id, 'reminder_day_before', 'whatsapp', 'fr', null,
     'Bonjour {{patient_name}}, rappel de votre rendez-vous demain {{date}} à {{time}} au {{cabinet_name}}. Pour toute modification : {{cabinet_phone}}.'),
    (v_id, 'reminder_same_day', 'whatsapp', 'fr', null,
     'Bonjour {{patient_name}}, nous vous attendons aujourd''hui à {{time}} au {{cabinet_name}}.'),
    (v_id, 'reminder_day_before', 'email', 'fr', 'Rappel de votre rendez-vous',
     'Bonjour {{patient_name}},\n\nNous vous rappelons votre rendez-vous le {{date}} à {{time}} avec {{dentist_name}} au {{cabinet_name}}.\n\nPour toute modification : {{cabinet_phone}}.'),
    (v_id, 'booking_confirmation', 'whatsapp', 'fr', null,
     'Bonjour {{patient_name}}, votre rendez-vous du {{date}} à {{time}} au {{cabinet_name}} est enregistré.');
  return v_id;
end $$;

-- Acceptation d'une invitation par l'utilisateur connecté (même adresse email).
create or replace function public.accept_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  inv public.invitations;
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  select * into inv from public.invitations
  where token = p_token and accepted_at is null and expires_at > now();
  if inv.id is null or lower(inv.email) <> lower(v_email) then
    raise exception 'invalid invitation';
  end if;
  insert into public.memberships (cabinet_id, user_id, roles)
  values (inv.cabinet_id, auth.uid(), inv.roles)
  on conflict (cabinet_id, user_id) do update set roles = excluded.roles, active = true, deleted_at = null;
  update public.invitations set accepted_at = now() where id = inv.id;
  return inv.cabinet_id;
end $$;

create or replace function public.active_dentist_count(p_cabinet uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.memberships
  where cabinet_id = p_cabinet and active and deleted_at is null and 'dentist' = any(roles)
$$;

-- Prix d'abonnement pour un nombre de dentistes donné (en GNF).
create or replace function public.subscription_price(p_dentists int, p_cycle public.billing_cycle)
returns table (plan_id uuid, plan_code text, amount_gnf bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.code,
    (case when p_cycle = 'yearly'
      then (p.price_monthly_gnf + greatest(p_dentists - p.min_dentists, 0) * p.price_per_extra_dentist_gnf) * 12
           * (100 - p.yearly_discount_pct) / 100
      else p.price_monthly_gnf + greatest(p_dentists - p.min_dentists, 0) * p.price_per_extra_dentist_gnf
    end)::bigint
  from public.plans p
  where p.active and greatest(p_dentists, 1) >= p.min_dentists
    and (p.max_dentists is null or greatest(p_dentists, 1) <= p.max_dentists)
  order by p.min_dentists desc
  limit 1
$$;

-- Page publique d'un cabinet (accessible sans compte).
create or replace function public.public_cabinet(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'slug', c.slug, 'phone', c.phone, 'email', c.email,
    'address', c.address, 'city', c.city, 'logo_path', c.logo_path,
    'description', c.public_description, 'opening_hours', c.opening_hours,
    'online_booking_enabled', c.online_booking_enabled and app.cabinet_writable(c.id),
    'timezone', c.timezone,
    'dentists', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', coalesce(m.display_name, pr.full_name)))
      from public.memberships m left join public.profiles pr on pr.id = m.user_id
      where m.cabinet_id = c.id and m.active and m.deleted_at is null and 'dentist' = any(m.roles)), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'duration_minutes', t.duration_minutes) order by t.sort_order)
      from public.appointment_types t
      where t.cabinet_id = c.id and t.bookable_online and t.deleted_at is null), '[]'::jsonb)
  )
  from public.cabinets c
  where c.slug = p_slug and c.public_page_enabled
$$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------

grant usage on schema app to authenticated, anon, service_role;
grant execute on all functions in schema app to authenticated, anon, service_role;
revoke execute on function public.create_cabinet(text, text, text, text, boolean) from anon;
revoke execute on function public.accept_invitation(uuid) from anon;
revoke execute on function public.log_patient_view(uuid) from anon;
revoke execute on function public.active_dentist_count(uuid) from anon;
grant execute on function public.public_cabinet(text) to anon, authenticated;
grant execute on function public.subscription_price(int, public.billing_cycle) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Stockage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 20971520),
       ('branding', 'branding', true, 2097152)
on conflict (id) do nothing;

-- documents : chemin {cabinet_id}/{patient_id}/... ; accès via la table documents.
create policy documents_bucket_read on storage.objects for select using (
  bucket_id = 'documents' and exists (
    select 1 from public.documents d
    where d.storage_path = storage.objects.name and d.deleted_at is null
      and (
        app.has_role(d.cabinet_id, '{dentist}')
        or (d.kind = 'administrative' and app.has_role(d.cabinet_id, '{admin,assistant}'))
        or (d.shared_with_patient and exists (
          select 1 from public.patients p where p.id = d.patient_id and p.portal_user_id = auth.uid()))
      )
  )
);
create policy documents_bucket_insert on storage.objects for insert with check (
  bucket_id = 'documents'
  and app.can_write(((storage.foldername(name))[1])::uuid, '{admin,dentist,assistant}')
);

create policy branding_bucket_insert on storage.objects for insert with check (
  bucket_id = 'branding' and app.can_write(((storage.foldername(name))[1])::uuid, '{admin}')
);
create policy branding_bucket_update on storage.objects for update using (
  bucket_id = 'branding' and app.has_role(((storage.foldername(name))[1])::uuid, '{admin}')
);
