-- Nimba Dentaire : corrections de sécurité.
--
-- 1. Références entre cabinets. Les clés étrangères ne vérifiaient que l'existence de la ligne
--    parente, pas son cabinet. Un utilisateur pouvait créer son propre cabinet (create_cabinet)
--    puis y insérer, par exemple, un paiement { cabinet_id: le sien, invoice_id: facture d'un
--    autre cabinet } : la facture de l'autre cabinet était recalculée « payée ».
--    Correctif : unique (id, cabinet_id) sur les tables parentes et clés étrangères composites
--    (x_id, cabinet_id) -> parent (id, cabinet_id) sur les tables enfants (MATCH SIMPLE : une
--    colonne x_id nulle n'est pas vérifiée). Les anciennes clés simples sont supprimées (elles
--    rendraient ambiguës les jointures PostgREST). Pour les clés « on delete set null », la
--    forme « on delete set null (x_id) » (PostgreSQL 15+) ne remet à null que x_id, jamais
--    cabinet_id.
--    Les praticiens (dentist_id, author_id -> auth.users) sont vérifiés par déclencheur : membre
--    actif du cabinet de la ligne.
-- 2. Documents : storage_path doit commencer par {cabinet_id}/{patient_id}/ ; la lecture d'un
--    fichier du bucket exige aussi que son dossier racine soit le cabinet de la ligne documents.
-- 3. accept_invitation : refusée si l'email du compte est absent ou non confirmé.
-- 4. plans : plus de politique « for all » (qui permettait DELETE) ; insert et update seulement.
-- 5. active_dentist_count : réservé aux membres du cabinet, aux admins plateforme et à la clé service.
--
-- Production : l'ajout des clés étrangères et de la contrainte de chemin valide les lignes
-- existantes ; la migration échoue (sans rien appliquer) si une ligne incohérente existe déjà.

-- ---------------------------------------------------------------------------
-- 1. Clés étrangères « même cabinet »
-- ---------------------------------------------------------------------------

alter table public.patients add constraint patients_id_cabinet_key unique (id, cabinet_id);
alter table public.chairs add constraint chairs_id_cabinet_key unique (id, cabinet_id);
alter table public.appointment_types add constraint appointment_types_id_cabinet_key unique (id, cabinet_id);
alter table public.acts add constraint acts_id_cabinet_key unique (id, cabinet_id);
alter table public.appointments add constraint appointments_id_cabinet_key unique (id, cabinet_id);
alter table public.treatment_plans add constraint treatment_plans_id_cabinet_key unique (id, cabinet_id);
alter table public.treatment_plan_items add constraint treatment_plan_items_id_cabinet_key unique (id, cabinet_id);
alter table public.quotes add constraint quotes_id_cabinet_key unique (id, cabinet_id);
alter table public.invoices add constraint invoices_id_cabinet_key unique (id, cabinet_id);
alter table public.payment_transactions add constraint payment_transactions_id_cabinet_key unique (id, cabinet_id);

-- Dossier patient
alter table public.patient_medical
  drop constraint patient_medical_patient_id_fkey,
  add constraint patient_medical_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id) on delete cascade;

alter table public.clinical_notes
  drop constraint clinical_notes_patient_id_fkey,
  add constraint clinical_notes_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id) on delete cascade,
  drop constraint clinical_notes_appointment_id_fkey,
  add constraint clinical_notes_appointment_id_fkey foreign key (appointment_id, cabinet_id)
    references public.appointments (id, cabinet_id) on delete set null (appointment_id);

alter table public.tooth_records
  drop constraint tooth_records_patient_id_fkey,
  add constraint tooth_records_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id) on delete cascade;

alter table public.treatment_plans
  drop constraint treatment_plans_patient_id_fkey,
  add constraint treatment_plans_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id) on delete cascade;

alter table public.treatment_plan_items
  drop constraint treatment_plan_items_plan_id_fkey,
  add constraint treatment_plan_items_plan_id_fkey foreign key (plan_id, cabinet_id)
    references public.treatment_plans (id, cabinet_id) on delete cascade,
  drop constraint treatment_plan_items_act_id_fkey,
  add constraint treatment_plan_items_act_id_fkey foreign key (act_id, cabinet_id)
    references public.acts (id, cabinet_id);

alter table public.prescriptions
  drop constraint prescriptions_patient_id_fkey,
  add constraint prescriptions_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id) on delete cascade;

alter table public.documents
  drop constraint documents_patient_id_fkey,
  add constraint documents_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id) on delete cascade;

-- Agenda
alter table public.appointments
  drop constraint appointments_patient_id_fkey,
  add constraint appointments_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id) on delete set null (patient_id),
  drop constraint appointments_chair_id_fkey,
  add constraint appointments_chair_id_fkey foreign key (chair_id, cabinet_id)
    references public.chairs (id, cabinet_id),
  drop constraint appointments_type_id_fkey,
  add constraint appointments_type_id_fkey foreign key (type_id, cabinet_id)
    references public.appointment_types (id, cabinet_id);

alter table public.notification_log
  drop constraint notification_log_appointment_id_fkey,
  add constraint notification_log_appointment_id_fkey foreign key (appointment_id, cabinet_id)
    references public.appointments (id, cabinet_id) on delete set null (appointment_id),
  drop constraint notification_log_patient_id_fkey,
  add constraint notification_log_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id) on delete set null (patient_id);

-- Facturation
alter table public.quotes
  drop constraint quotes_patient_id_fkey,
  add constraint quotes_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id),
  drop constraint quotes_plan_id_fkey,
  add constraint quotes_plan_id_fkey foreign key (plan_id, cabinet_id)
    references public.treatment_plans (id, cabinet_id) on delete set null (plan_id);

alter table public.quote_items
  drop constraint quote_items_quote_id_fkey,
  add constraint quote_items_quote_id_fkey foreign key (quote_id, cabinet_id)
    references public.quotes (id, cabinet_id) on delete cascade,
  drop constraint quote_items_act_id_fkey,
  add constraint quote_items_act_id_fkey foreign key (act_id, cabinet_id)
    references public.acts (id, cabinet_id);

alter table public.invoices
  drop constraint invoices_patient_id_fkey,
  add constraint invoices_patient_id_fkey foreign key (patient_id, cabinet_id)
    references public.patients (id, cabinet_id),
  drop constraint invoices_quote_id_fkey,
  add constraint invoices_quote_id_fkey foreign key (quote_id, cabinet_id)
    references public.quotes (id, cabinet_id) on delete set null (quote_id);

alter table public.invoice_items
  drop constraint invoice_items_invoice_id_fkey,
  add constraint invoice_items_invoice_id_fkey foreign key (invoice_id, cabinet_id)
    references public.invoices (id, cabinet_id) on delete cascade,
  drop constraint invoice_items_act_id_fkey,
  add constraint invoice_items_act_id_fkey foreign key (act_id, cabinet_id)
    references public.acts (id, cabinet_id),
  drop constraint invoice_items_plan_item_id_fkey,
  add constraint invoice_items_plan_item_id_fkey foreign key (plan_item_id, cabinet_id)
    references public.treatment_plan_items (id, cabinet_id) on delete set null (plan_item_id);

alter table public.payment_installments
  drop constraint payment_installments_invoice_id_fkey,
  add constraint payment_installments_invoice_id_fkey foreign key (invoice_id, cabinet_id)
    references public.invoices (id, cabinet_id) on delete cascade;

alter table public.payment_transactions
  drop constraint payment_transactions_invoice_id_fkey,
  add constraint payment_transactions_invoice_id_fkey foreign key (invoice_id, cabinet_id)
    references public.invoices (id, cabinet_id);

alter table public.payments
  drop constraint payments_invoice_id_fkey,
  add constraint payments_invoice_id_fkey foreign key (invoice_id, cabinet_id)
    references public.invoices (id, cabinet_id),
  drop constraint payments_transaction_id_fkey,
  add constraint payments_transaction_id_fkey foreign key (transaction_id, cabinet_id)
    references public.payment_transactions (id, cabinet_id);

alter table public.subscription_payments
  drop constraint subscription_payments_transaction_id_fkey,
  add constraint subscription_payments_transaction_id_fkey foreign key (transaction_id, cabinet_id)
    references public.payment_transactions (id, cabinet_id);

-- Praticiens et auteurs : membre actif du cabinet de la ligne.
-- Arguments du déclencheur : les colonnes (uuid -> auth.users) à vérifier.
-- * Déclencheur AFTER : il s'exécute après les politiques RLS (un refus RLS reste un refus RLS)
--   et seulement pour la branche réellement appliquée d'un upsert (INSERT ... ON CONFLICT).
-- * Vérifié à l'insertion et quand la colonne change : une ligne existante dont le praticien a
--   quitté le cabinet reste modifiable (statut, suppression logique...).
create or replace function app.check_member_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  col text;
  v_new uuid;
begin
  foreach col in array tg_argv loop
    v_new := (to_jsonb(new) ->> col)::uuid;
    continue when v_new is null;
    continue when tg_op = 'UPDATE' and v_new is not distinct from (to_jsonb(old) ->> col)::uuid;
    if not exists (
      select 1 from public.memberships m
      where m.cabinet_id = new.cabinet_id and m.user_id = v_new and m.active and m.deleted_at is null
    ) then
      raise exception '%.% must be an active member of the cabinet', tg_table_name, col
        using errcode = '23503';
    end if;
  end loop;
  return null;
end $$;

create trigger appointments_check_members after insert or update of dentist_id on public.appointments
  for each row execute function app.check_member_refs('dentist_id');
create trigger treatment_plans_check_members after insert or update of dentist_id on public.treatment_plans
  for each row execute function app.check_member_refs('dentist_id');
create trigger prescriptions_check_members after insert or update of dentist_id on public.prescriptions
  for each row execute function app.check_member_refs('dentist_id');
create trigger quotes_check_members after insert or update of dentist_id on public.quotes
  for each row execute function app.check_member_refs('dentist_id');
create trigger invoices_check_members after insert or update of dentist_id on public.invoices
  for each row execute function app.check_member_refs('dentist_id');
create trigger clinical_notes_check_members after insert or update of author_id on public.clinical_notes
  for each row execute function app.check_member_refs('author_id');
create trigger practitioner_schedules_check_members after insert or update of dentist_id on public.practitioner_schedules
  for each row execute function app.check_member_refs('dentist_id');
create trigger time_off_check_members after insert or update of dentist_id on public.time_off
  for each row execute function app.check_member_refs('dentist_id');

revoke execute on function app.check_member_refs() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Chemin des documents
-- ---------------------------------------------------------------------------

alter table public.documents add constraint documents_storage_path_check
  check (starts_with(storage_path, cabinet_id::text || '/' || patient_id::text || '/'));

drop policy if exists documents_bucket_read on storage.objects;
create policy documents_bucket_read on storage.objects for select using (
  bucket_id = 'documents' and exists (
    select 1 from public.documents d
    where d.storage_path = storage.objects.name and d.deleted_at is null
      and (storage.foldername(storage.objects.name))[1] = d.cabinet_id::text
      and (storage.foldername(storage.objects.name))[2] = d.patient_id::text
      and (
        app.has_role(d.cabinet_id, '{dentist}')
        or (d.kind = 'administrative' and app.has_role(d.cabinet_id, '{admin,assistant}'))
        or (d.shared_with_patient and exists (
          select 1 from public.patients p where p.id = d.patient_id and p.portal_user_id = auth.uid()))
      )
  )
);

-- ---------------------------------------------------------------------------
-- 3. Invitations : email du compte présent et confirmé
-- ---------------------------------------------------------------------------

create or replace function public.accept_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  inv public.invitations;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
  if v_email is null or v_email = '' or v_confirmed is null then
    raise exception 'email not confirmed';
  end if;
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

revoke execute on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Formules : pas de suppression
-- ---------------------------------------------------------------------------

drop policy if exists plans_admin on public.plans;
drop policy if exists plans_insert on public.plans;
drop policy if exists plans_update on public.plans;
create policy plans_insert on public.plans for insert with check (app.is_platform_admin());
create policy plans_update on public.plans for update
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 5. Nombre de dentistes actifs
-- ---------------------------------------------------------------------------

-- Appelants autorisés : membres du cabinet, admins plateforme (admin_cabinets, admin_metrics),
-- clé service (route de paiement d'abonnement) et connexions directes à la base sans jeton
-- (migrations, tâches planifiées).
create or replace function public.active_dentist_count(p_cabinet uuid)
returns int language plpgsql stable security definer set search_path = '' as $$
begin
  if not (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or (auth.uid() is null and session_user <> 'authenticator')
    or app.is_member(p_cabinet)
    or app.is_platform_admin()
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (
    select count(*)::int from public.memberships
    where cabinet_id = p_cabinet and active and deleted_at is null and 'dentist' = any(roles)
  );
end $$;

revoke execute on function public.active_dentist_count(uuid) from public, anon;
grant execute on function public.active_dentist_count(uuid) to authenticated, service_role;
