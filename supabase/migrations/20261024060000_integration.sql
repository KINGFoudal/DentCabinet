-- Corrections d'intégration.

-- Le moteur de synchronisation envoie des upserts : le trigger BEFORE INSERT s'exécute aussi
-- pour une ligne qui existe déjà (puis l'UPDATE s'applique). Sans ce garde-fou, chaque
-- modification d'un patient consommait un numéro de dossier et laissait des trous.
create or replace function app.assign_file_number()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from now())::int;
begin
  if exists (select 1 from public.patients where id = new.id) then
    return new;
  end if;
  if new.file_number is null then
    new.file_number := 'P' || y || '-' || lpad(app.next_counter(new.cabinet_id, 'patient', y)::text, 5, '0');
  end if;
  return new;
end $$;
