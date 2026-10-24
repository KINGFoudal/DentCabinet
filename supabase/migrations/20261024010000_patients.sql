-- Dossier patient : règles complémentaires imposées par la base.
--
-- * Archivage (suppression logique) d'un patient réservé à l'administrateur du cabinet.
-- * Une note clinique signée ne peut pas non plus être supprimée (même logiquement).

-- ---------------------------------------------------------------------------
-- Archivage des patients
-- ---------------------------------------------------------------------------

create or replace function app.protect_patient_archive()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.deleted_at is not null and not app.has_role(new.cabinet_id, '{admin}') then
      raise exception 'only an administrator can archive a patient' using errcode = '42501';
    end if;
  elsif new.deleted_at is distinct from old.deleted_at and not app.has_role(new.cabinet_id, '{admin}') then
    raise exception 'only an administrator can archive a patient' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger patients_protect_archive before insert or update on public.patients
  for each row execute function app.protect_patient_archive();

-- ---------------------------------------------------------------------------
-- Notes cliniques signées : ni modification ni suppression
-- ---------------------------------------------------------------------------

create or replace function app.protect_signed_note_delete()
returns trigger language plpgsql as $$
begin
  if old.signed_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'signed note cannot be deleted';
  end if;
  return new;
end $$;

create trigger clinical_notes_protect_delete before update on public.clinical_notes
  for each row execute function app.protect_signed_note_delete();
