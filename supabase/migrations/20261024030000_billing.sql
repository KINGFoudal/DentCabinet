-- Facturation : corrections et compléments du schéma initial.

-- 1. Numérotation sans trous.
--
-- Le client synchronise par upsert (INSERT ... ON CONFLICT DO UPDATE). PostgreSQL exécute
-- les triggers BEFORE INSERT avant de détecter le conflit : sur une facture déjà existante,
-- app.assign_number() consommait un numéro pour la ligne proposée (jamais insérée), puis
-- encore un dans le trigger BEFORE UPDATE. Résultat : la première facture émise recevait
-- F-AAAA-00002 et chaque modification d'une facture émise créait un trou.
-- On ne numérote plus dans la phase INSERT d'une ligne qui existe déjà : le trigger
-- BEFORE UPDATE s'en charge.
create or replace function app.assign_number()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from coalesce(new.issue_date, current_date))::int;
  v_exists boolean;
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'invoices' then
      select exists (select 1 from public.invoices where id = new.id) into v_exists;
    else
      select exists (select 1 from public.quotes where id = new.id) into v_exists;
    end if;
    if v_exists then
      return new;  -- upsert d'une ligne existante : la branche UPDATE numérotera si besoin
    end if;
  end if;

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

-- 2. Praticien d'une facture (rapport « chiffre d'affaires par praticien »).
-- Les plans de traitement ne sont lisibles que par les dentistes : le comptable ne peut pas
-- retrouver le praticien par ce chemin, d'où une colonne sur la facture.
alter table public.invoices add column if not exists dentist_id uuid references auth.users(id);
create index if not exists invoices_dentist_idx on public.invoices (cabinet_id, dentist_id);
