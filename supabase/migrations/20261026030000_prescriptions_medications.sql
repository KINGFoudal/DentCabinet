-- Nimba Dentaire : médicaments du cabinet et liens ordonnance / facture / rendez-vous.
--
-- 1. medications : médicaments personnalisés d'un cabinet (la liste de base est dans le code,
--    src/features/patients/lib/medications.ts). Lecture : membres ; écriture : praticiens et admin.
--    Synchronisée hors ligne (SYNCED_TABLES, schéma Dexie version 2).
-- 2. prescriptions.appointment_id / prescriptions.invoice_id et invoices.appointment_id :
--    une consultation (rendez-vous) produit une facture (actes) et une ordonnance (les
--    médicaments ne sont pas facturés). Clés composites « même cabinet » comme dans
--    20261026010000_security_fixes.sql, et déclencheur « même patient ».
--
-- Production : migration additive (nouvelles colonnes nulles, nouvelle table) ; aucune ligne
-- existante n'est modifiée.

-- ---------------------------------------------------------------------------
-- 1. Médicaments du cabinet
-- ---------------------------------------------------------------------------

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  form text check (form is null or length(form) <= 100),           -- comprimé, gélule, gel...
  strength text check (strength is null or length(strength) <= 100), -- dosage : 500 mg
  posology text check (posology is null or length(posology) <= 500), -- 1 comprimé 3 fois par jour
  duration text check (duration is null or length(duration) <= 100),
  instructions text check (instructions is null or length(instructions) <= 1000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint medications_id_cabinet_key unique (id, cabinet_id)
);
create index medications_cabinet_idx on public.medications (cabinet_id, updated_at);

create trigger medications_touch before insert or update on public.medications
  for each row execute function app.touch_updated_at();
create trigger medications_freeze_cabinet before update on public.medications
  for each row execute function app.freeze_cabinet_id();
create trigger medications_check_members after insert or update of created_by on public.medications
  for each row execute function app.check_member_refs('created_by');

alter table public.medications enable row level security;

create policy medications_read on public.medications for select using (app.is_member(cabinet_id));
create policy medications_insert on public.medications for insert
  with check (app.can_write(cabinet_id, '{admin,dentist}'));
create policy medications_update on public.medications for update
  using (app.has_role(cabinet_id, '{admin,dentist}'))
  with check (app.can_write(cabinet_id, '{admin,dentist}'));
-- Pas de politique DELETE : suppression logique (deleted_at).

-- ---------------------------------------------------------------------------
-- 2. Liens consultation : rendez-vous, facture, ordonnance
-- ---------------------------------------------------------------------------

alter table public.prescriptions
  add column appointment_id uuid,
  add column invoice_id uuid,
  add constraint prescriptions_appointment_id_fkey foreign key (appointment_id, cabinet_id)
    references public.appointments (id, cabinet_id) on delete set null (appointment_id),
  add constraint prescriptions_invoice_id_fkey foreign key (invoice_id, cabinet_id)
    references public.invoices (id, cabinet_id) on delete set null (invoice_id);
create index prescriptions_invoice_idx on public.prescriptions (invoice_id) where invoice_id is not null;
create index prescriptions_appointment_idx on public.prescriptions (appointment_id) where appointment_id is not null;

alter table public.invoices
  add column appointment_id uuid,
  add constraint invoices_appointment_id_fkey foreign key (appointment_id, cabinet_id)
    references public.appointments (id, cabinet_id) on delete set null (appointment_id);
create index invoices_appointment_idx on public.invoices (appointment_id) where appointment_id is not null;

-- La facture et le rendez-vous liés doivent concerner le même patient que la ligne.
-- AFTER (après RLS), vérifié à l'insertion et quand un lien change. security definer : un
-- dentiste lit les factures, mais la vérification ne doit pas dépendre des droits de lecture.
create or replace function app.check_consultation_links()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid;
begin
  -- Blocs imbriqués : new.invoice_id n'existe que sur prescriptions.
  if tg_table_name = 'prescriptions' then
    if new.invoice_id is not null
       and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id
            or new.patient_id is distinct from old.patient_id) then
      select i.patient_id into v_patient from public.invoices i where i.id = new.invoice_id;
      if v_patient is distinct from new.patient_id then
        raise exception 'prescriptions.invoice_id must belong to the same patient' using errcode = '23514';
      end if;
    end if;
  end if;
  if new.appointment_id is not null
     and (tg_op = 'INSERT' or new.appointment_id is distinct from old.appointment_id
          or new.patient_id is distinct from old.patient_id) then
    select a.patient_id into v_patient from public.appointments a where a.id = new.appointment_id;
    if v_patient is distinct from new.patient_id then
      raise exception '%.appointment_id must belong to the same patient', tg_table_name using errcode = '23514';
    end if;
  end if;
  return null;
end $$;

revoke execute on function app.check_consultation_links() from public, anon, authenticated;

create trigger prescriptions_check_links after insert or update of invoice_id, appointment_id, patient_id
  on public.prescriptions for each row execute function app.check_consultation_links();
create trigger invoices_check_links after insert or update of appointment_id, patient_id
  on public.invoices for each row execute function app.check_consultation_links();
