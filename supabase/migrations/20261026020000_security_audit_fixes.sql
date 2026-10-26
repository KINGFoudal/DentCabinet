-- Nimba Dentaire : corrections issues de l'audit de sécurité du 26/10/2026.
--
-- 1. Espace patient : un « téléphone vérifié » doit venir d'une connexion par code (OTP).
--    Si les confirmations SMS sont désactivées dans Supabase Auth (c'est le cas de la
--    configuration locale, et c'est un réglage du tableau de bord en production), une
--    inscription { phone, password } reçoit phone_confirmed_at sans aucun code : n'importe qui
--    pouvait alors s'inscrire avec le numéro d'un patient, appeler link_portal_patients() et
--    lire ses rendez-vous, factures, ordonnances et documents dans tous les cabinets.
--    Même chose pour un compte email (ou anonyme) qui change son téléphone sans confirmation.
--    Désormais seuls comptent les comptes « téléphone seul » : sans email, sans mot de passe,
--    non anonymes (ceux créés par signInWithOtp + verifyOtp, le seul parcours de l'application).
-- 2. Fonctions internes du schéma app (compteurs, recalcul des totaux, déclencheurs) :
--    plus exécutables par anon / authenticated (elles ne servent qu'à des fonctions
--    security definer et à des déclencheurs, qui ne vérifient pas ce droit à l'exécution).
--    Le schéma app n'est pas exposé par l'API ; c'est une défense en profondeur.
-- 3. Documents : un même fichier ne peut être référencé que par une seule ligne (sinon le
--    secrétariat pouvait déclarer « administratif » un second enregistrement pointant vers
--    une radio dont il connaît le chemin, et la lire).
-- 4. Bucket public « branding » : images uniquement (pas de HTML servi depuis le stockage).
-- 5. Journal d'audit : changements de membres (rôles, désactivation) et d'invitations.
-- 6. Espace patient : lignes de devis / facture supprimées, paiements d'une facture brouillon
--    ou supprimée et rendez-vous supprimés ne sont plus visibles du patient.

-- ---------------------------------------------------------------------------
-- 1. Téléphone vérifié par code
-- ---------------------------------------------------------------------------

create or replace function app.verified_phone()
returns text language sql stable security definer set search_path = '' as $$
  select app.phone_digits(u.phone)
  from auth.users u
  where u.id = auth.uid()
    and u.phone is not null and u.phone <> '' and u.phone_confirmed_at is not null
    and coalesce(u.email, '') = ''
    and coalesce(u.encrypted_password, '') = ''
    and not coalesce(u.is_anonymous, false)
$$;

revoke execute on function app.verified_phone() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fonctions internes
-- ---------------------------------------------------------------------------

revoke execute on function app.next_counter(uuid, text, int) from public, anon, authenticated;
revoke execute on function app.recompute_invoice(uuid) from public, anon, authenticated;
revoke execute on function app.recompute_quote(uuid) from public, anon, authenticated;
revoke execute on function app.booking_cabinet(text) from public, anon, authenticated;
revoke execute on function app.assign_number() from public, anon, authenticated;
revoke execute on function app.assign_file_number() from public, anon, authenticated;
revoke execute on function app.audit_row() from public, anon, authenticated;
revoke execute on function app.on_invoice_child_change() from public, anon, authenticated;
revoke execute on function app.on_invoice_status_change() from public, anon, authenticated;
revoke execute on function app.on_quote_item_change() from public, anon, authenticated;
revoke execute on function app.release_reminders_on_reschedule() from public, anon, authenticated;
revoke execute on function app.check_transaction_invoice() from public, anon, authenticated;
revoke execute on function app.protect_last_admin() from public, anon, authenticated;
revoke execute on function app.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Un fichier, une ligne documents
-- ---------------------------------------------------------------------------

create unique index if not exists documents_storage_path_key on public.documents (storage_path);

-- ---------------------------------------------------------------------------
-- 4. Logos : images uniquement
-- ---------------------------------------------------------------------------

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
where id = 'branding';

-- ---------------------------------------------------------------------------
-- 5. Audit des membres et invitations
-- ---------------------------------------------------------------------------

drop trigger if exists memberships_audit on public.memberships;
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit_row();
drop trigger if exists invitations_audit on public.invitations;
create trigger invitations_audit after insert or update or delete on public.invitations
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- 6. Lecture portail : lignes supprimées et brouillons
-- ---------------------------------------------------------------------------

drop policy if exists quote_items_portal_read on public.quote_items;
create policy quote_items_portal_read on public.quote_items for select using (
  deleted_at is null and exists (
    select 1 from public.quotes q join public.patients p on p.id = q.patient_id
    where q.id = quote_items.quote_id and q.status <> 'draft' and q.deleted_at is null
      and p.portal_user_id = auth.uid())
);

drop policy if exists invoice_items_portal_read on public.invoice_items;
create policy invoice_items_portal_read on public.invoice_items for select using (
  deleted_at is null and exists (
    select 1 from public.invoices i join public.patients p on p.id = i.patient_id
    where i.id = invoice_items.invoice_id and i.status <> 'draft' and i.deleted_at is null
      and p.portal_user_id = auth.uid())
);

drop policy if exists payments_portal_read on public.payments;
create policy payments_portal_read on public.payments for select using (
  deleted_at is null and exists (
    select 1 from public.invoices i join public.patients p on p.id = i.patient_id
    where i.id = payments.invoice_id and i.status <> 'draft' and i.deleted_at is null
      and p.portal_user_id = auth.uid())
);

drop policy if exists appointments_portal_read on public.appointments;
create policy appointments_portal_read on public.appointments for select using (
  deleted_at is null and exists (
    select 1 from public.patients p where p.id = appointments.patient_id and p.portal_user_id = auth.uid())
);
