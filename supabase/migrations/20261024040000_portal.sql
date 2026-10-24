-- Nimba Dentaire : page publique, réservation en ligne et espace patient.
--
-- Choix de sécurité (voir aussi les commentaires de chaque fonction) :
-- * Aucune fonction ne prend un numéro de téléphone ou un identifiant de patient en paramètre :
--   le patient est toujours déduit du téléphone VÉRIFIÉ de l'utilisateur connecté
--   (auth.users.phone + phone_confirmed_at). On ne peut donc pas sonder l'existence
--   d'un patient à partir d'un numéro (énumération), ni réserver au nom d'un autre.
-- * available_slots est public (anon) mais ne renvoie que des heures libres : ni nom,
--   ni motif, ni praticien occupé. L'horizon est limité (MAX_DAYS) et une seule journée
--   est calculée par appel, ce qui borne le coût d'un robot qui interrogerait en boucle.
-- * book_online est limité : MAX_FUTURE rendez-vous à venir par patient et par cabinet,
--   et MAX_PER_DAY réservations en ligne par compte sur 24 h (tous cabinets), pour
--   empêcher de bloquer l'agenda en réservant et annulant en boucle. Le délai minimum
--   (LEAD_HOURS) évite les réservations de dernière minute que le cabinet ne verrait pas.
-- * Les erreurs sont des codes courts (message de l'exception) traduits par l'interface.
-- * Un rattachement par téléphone repose sur la saisie du cabinet : un numéro mal saisi
--   donnerait accès à la fiche au titulaire du numéro. C'est inhérent au parcours OTP ;
--   on ne rattache jamais une fiche déjà liée à un autre compte.

-- ---------------------------------------------------------------------------
-- Utilitaires
-- ---------------------------------------------------------------------------

-- Chiffres d'un numéro, au format international sans « + » (comme auth.users.phone).
-- « +224 620 00 00 00 », « 00224620000000 », « 620000000 » -> « 224620000000 ».
create or replace function app.phone_digits(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case
    when d is null or d = '' then null
    when d ~ '^00' then substr(d, 3)
    when length(d) = 9 then '224' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;

create index if not exists patients_phone_digits_idx on public.patients (app.phone_digits(phone))
  where deleted_at is null;

-- Téléphone vérifié de l'utilisateur connecté (chiffres), ou null.
create or replace function app.verified_phone()
returns text language sql stable security definer set search_path = '' as $$
  select app.phone_digits(u.phone)
  from auth.users u
  where u.id = auth.uid() and u.phone is not null and u.phone <> '' and u.phone_confirmed_at is not null
$$;

-- Cabinet ouvert à la réservation en ligne (page publique, option activée, abonnement valide).
create or replace function app.booking_cabinet(p_slug text)
returns public.cabinets language plpgsql stable security definer set search_path = '' as $$
declare
  c public.cabinets;
begin
  select * into c from public.cabinets where slug = p_slug and public_page_enabled;
  if c.id is null then
    raise exception 'cabinet_not_found';
  end if;
  if not c.online_booking_enabled or not app.cabinet_writable(c.id) then
    raise exception 'booking_disabled';
  end if;
  return c;
end $$;

-- Créneaux libres d'une journée, avec chaque praticien disponible.
-- Usage interne : ne pas exposer (révèle quel praticien est libre).
--   * horaires d'ouverture du cabinet (opening_hours, clé 1 = lundi ... 7 = dimanche) ;
--   * intersectés avec les horaires du praticien s'il en a défini (sinon ceux du cabinet) ;
--   * moins les absences (time_off du praticien ou de tout le cabinet) ;
--   * moins les rendez-vous actifs du praticien ;
--   * à partir de maintenant + LEAD_HOURS, jusqu'à MAX_DAYS jours.
create or replace function app.online_slot_candidates(
  p_cabinet uuid, p_duration int, p_date date, p_dentist uuid default null
) returns table (starts_at timestamptz, ends_at timestamptz, dentist_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  c_lead constant interval := interval '2 hours';   -- LEAD_HOURS
  c_max_days constant int := 60;                    -- MAX_DAYS
  v_tz text;
  v_today date;
  v_dow int := extract(isodow from p_date)::int;
  v_dur interval := make_interval(mins => p_duration);
  v_step interval := case when p_duration >= 30 then interval '30 minutes' else interval '15 minutes' end;
begin
  select c.timezone into v_tz from public.cabinets c where c.id = p_cabinet;
  if v_tz is null then
    return;
  end if;
  v_today := (now() at time zone v_tz)::date;
  if p_date < v_today or p_date > v_today + c_max_days then
    return;
  end if;

  return query
  with dentists as (
    select m.user_id as id
    from public.memberships m
    where m.cabinet_id = p_cabinet and m.active and m.deleted_at is null and 'dentist' = any(m.roles)
      and (p_dentist is null or m.user_id = p_dentist)
  ),
  hours as (
    select (h ->> 0)::time as st, (h ->> 1)::time as en
    from public.cabinets c,
         jsonb_array_elements(
           case when jsonb_typeof(c.opening_hours -> v_dow::text) = 'array'
                then c.opening_hours -> v_dow::text else '[]'::jsonb end) h
    where c.id = p_cabinet and jsonb_typeof(h) = 'array'
  ),
  with_schedule as (
    select distinct s.dentist_id from public.practitioner_schedules s
    where s.cabinet_id = p_cabinet and s.deleted_at is null
  ),
  windows as (
    -- Praticien sans horaires propres : horaires du cabinet.
    select d.id as dentist_id, h.st, h.en
    from dentists d cross join hours h
    where d.id not in (select w.dentist_id from with_schedule w)
    union all
    -- Praticien avec horaires : intersection avec l'ouverture du cabinet.
    select d.id, greatest(h.st, s.start_time), least(h.en, s.end_time)
    from dentists d
    join public.practitioner_schedules s
      on s.dentist_id = d.id and s.cabinet_id = p_cabinet and s.deleted_at is null and s.weekday = v_dow
    cross join hours h
  ),
  candidates as (
    select w.dentist_id, g as s, g + v_dur as e
    from windows w,
         generate_series(((p_date + w.st) at time zone v_tz), ((p_date + w.en) at time zone v_tz) - v_dur, v_step) g
    where w.en > w.st
  )
  select distinct cd.s, cd.e, cd.dentist_id
  from candidates cd
  where cd.s >= now() + c_lead
    and not exists (
      select 1 from public.time_off t
      where t.cabinet_id = p_cabinet and t.deleted_at is null
        and (t.dentist_id is null or t.dentist_id = cd.dentist_id)
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(cd.s, cd.e))
    and not exists (
      select 1 from public.appointments a
      where a.dentist_id = cd.dentist_id and a.deleted_at is null
        and a.status not in ('cancelled', 'no_show')
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(cd.s, cd.e))
  order by cd.s;
end $$;

-- ---------------------------------------------------------------------------
-- RPC publiques
-- ---------------------------------------------------------------------------

-- Créneaux libres pour un type de rendez-vous réservable en ligne (accessible sans compte).
-- Ne renvoie que des heures : aucune information sur les autres patients ni sur l'occupation
-- de chaque praticien.
create or replace function public.available_slots(
  p_slug text, p_type uuid, p_date date, p_dentist uuid default null
) returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.cabinets;
  v_duration int;
begin
  c := app.booking_cabinet(p_slug);
  select t.duration_minutes into v_duration from public.appointment_types t
  where t.id = p_type and t.cabinet_id = c.id and t.bookable_online and t.deleted_at is null;
  if v_duration is null then
    raise exception 'type_not_bookable';
  end if;
  return query
    select distinct x.starts_at, x.ends_at
    from app.online_slot_candidates(c.id, v_duration, p_date, p_dentist) x
    order by x.starts_at;
end $$;

-- Réservation en ligne par un patient connecté avec un téléphone vérifié.
-- * Rattache la fiche du cabinet portant ce téléphone (déjà liée à ce compte ou non liée),
--   sinon crée la fiche (nom et prénom alors obligatoires). Une fiche existante n'est jamais
--   modifiée, sauf portal_user_id quand il est vide.
-- * Revérifie la disponibilité et choisit un praticien libre si aucun n'est demandé ;
--   la contrainte d'exclusion de appointments protège contre deux réservations simultanées.
create or replace function public.book_online(
  p_slug text, p_type uuid, p_starts_at timestamptz, p_dentist uuid default null,
  p_first_name text default null, p_last_name text default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_max_future constant int := 3;   -- MAX_FUTURE : RDV à venir par patient et par cabinet
  c_max_per_day constant int := 6;  -- MAX_PER_DAY : réservations en ligne par compte sur 24 h
  v_uid uuid := auth.uid();
  v_phone text;
  c public.cabinets;
  t public.appointment_types;
  v_patient uuid;
  v_portal uuid;
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_slot record;
  v_appt uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  v_phone := app.verified_phone();
  if v_phone is null then
    raise exception 'phone_not_verified';
  end if;

  c := app.booking_cabinet(p_slug);
  select * into t from public.appointment_types
  where id = p_type and cabinet_id = c.id and bookable_online and deleted_at is null;
  if t.id is null then
    raise exception 'type_not_bookable';
  end if;

  -- Évite de créer deux fiches pour le même téléphone lors de deux réservations simultanées.
  perform pg_advisory_xact_lock(hashtextextended(c.id::text || ':' || v_phone, 0));

  if (select count(*) from public.appointments a
      where a.created_by = v_uid and a.source = 'online' and a.created_at > now() - interval '24 hours') >= c_max_per_day then
    raise exception 'too_many_bookings';
  end if;

  select p.id, p.portal_user_id into v_patient, v_portal
  from public.patients p
  where p.cabinet_id = c.id and p.deleted_at is null
    and app.phone_digits(p.phone) = v_phone
    and (p.portal_user_id is null or p.portal_user_id = v_uid)
  order by (p.portal_user_id = v_uid) desc nulls last, p.created_at
  limit 1;

  if v_patient is null then
    if v_first is null or v_last is null or length(v_first) > 100 or length(v_last) > 100 then
      raise exception 'name_required';
    end if;
    insert into public.patients (cabinet_id, first_name, last_name, phone, portal_user_id, created_by)
    values (c.id, v_first, v_last, '+' || v_phone, v_uid, v_uid)
    returning id into v_patient;
  elsif v_portal is null then
    update public.patients set portal_user_id = v_uid where id = v_patient;
  end if;

  if (select count(*) from public.appointments a
      where a.patient_id = v_patient and a.cabinet_id = c.id and a.deleted_at is null
        and a.status in ('scheduled', 'confirmed') and a.starts_at > now()) >= c_max_future then
    raise exception 'too_many_bookings';
  end if;

  -- Praticiens libres sur ce créneau exact, le moins chargé de la journée d'abord.
  for v_slot in
    select x.dentist_id, x.ends_at
    from app.online_slot_candidates(c.id, t.duration_minutes, (p_starts_at at time zone c.timezone)::date, p_dentist) x
    where x.starts_at = p_starts_at
    order by (select count(*) from public.appointments a
              where a.dentist_id = x.dentist_id and a.deleted_at is null
                and a.status not in ('cancelled', 'no_show')
                and (a.starts_at at time zone c.timezone)::date = (p_starts_at at time zone c.timezone)::date),
             random()
  loop
    begin
      insert into public.appointments (cabinet_id, patient_id, dentist_id, type_id, starts_at, ends_at,
                                       status, source, title, created_by)
      values (c.id, v_patient, v_slot.dentist_id, t.id, p_starts_at, v_slot.ends_at,
              'scheduled', 'online', t.name, v_uid)
      returning id into v_appt;
      return jsonb_build_object(
        'appointment_id', v_appt, 'patient_id', v_patient, 'dentist_id', v_slot.dentist_id,
        'starts_at', p_starts_at, 'ends_at', v_slot.ends_at);
    exception when exclusion_violation then
      -- Pris entre-temps : essayer le praticien suivant.
      null;
    end;
  end loop;

  raise exception 'slot_unavailable';
end $$;

-- Annulation par le patient, si le délai du cabinet (online_cancel_min_hours) est respecté.
-- Autorisée même si l'abonnement du cabinet a expiré : libérer un créneau ne nuit pas au cabinet.
create or replace function public.cancel_online(p_appointment uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_status public.appointment_status;
  v_starts timestamptz;
  v_min_hours int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select a.status, a.starts_at, c.online_cancel_min_hours into v_status, v_starts, v_min_hours
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  join public.cabinets c on c.id = a.cabinet_id
  where a.id = p_appointment and a.deleted_at is null and p.portal_user_id = v_uid
  for update of a;
  if v_status is null then
    raise exception 'not_found';
  end if;
  if v_status not in ('scheduled', 'confirmed') then
    raise exception 'not_cancellable';
  end if;
  if v_starts - now() < make_interval(hours => v_min_hours) then
    raise exception 'too_late';
  end if;
  update public.appointments set status = 'cancelled' where id = p_appointment;
end $$;

-- Rattache au compte connecté toutes les fiches (tous cabinets) dont le téléphone est son
-- téléphone vérifié et qui ne sont liées à aucun autre compte. Renvoie le nombre de fiches liées.
create or replace function public.link_portal_patients()
returns int language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  v_phone := app.verified_phone();
  if v_phone is null then
    return 0;
  end if;
  update public.patients p set portal_user_id = v_uid
  where p.deleted_at is null and p.portal_user_id is null and app.phone_digits(p.phone) = v_phone;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Cabinets où le patient connecté est suivi. La table cabinets n'est lisible que par les
-- membres : cette fonction expose au patient ce dont l'espace patient a besoin (en-tête
-- d'ordonnance, noms des praticiens et des types de rendez-vous, règle d'annulation).
create or replace function public.portal_cabinets()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'slug', c.slug, 'phone', c.phone, 'email', c.email,
    'address', c.address, 'city', c.city, 'timezone', c.timezone, 'logo_path', c.logo_path,
    'public_page_enabled', c.public_page_enabled,
    'online_booking_enabled', c.public_page_enabled and c.online_booking_enabled and app.cabinet_writable(c.id),
    'online_cancel_min_hours', c.online_cancel_min_hours,
    'patient_ids', (select jsonb_agg(p.id) from public.patients p
                    where p.cabinet_id = c.id and p.portal_user_id = auth.uid() and p.deleted_at is null),
    'dentists', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', coalesce(m.display_name, pr.full_name)))
      from public.memberships m left join public.profiles pr on pr.id = m.user_id
      where m.cabinet_id = c.id and 'dentist' = any(m.roles)), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
      from public.appointment_types t where t.cabinet_id = c.id), '[]'::jsonb)
  ) order by c.name), '[]'::jsonb)
  from public.cabinets c
  where auth.uid() is not null and exists (
    select 1 from public.patients p
    where p.cabinet_id = c.id and p.portal_user_id = auth.uid() and p.deleted_at is null)
$$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------

revoke execute on function app.online_slot_candidates(uuid, int, date, uuid) from public, anon, authenticated;
revoke execute on function app.verified_phone() from public, anon;
revoke execute on function public.available_slots(text, uuid, date, uuid) from public;
revoke execute on function public.book_online(text, uuid, timestamptz, uuid, text, text) from public, anon;
revoke execute on function public.cancel_online(uuid) from public, anon;
revoke execute on function public.link_portal_patients() from public, anon;
revoke execute on function public.portal_cabinets() from public, anon;

grant execute on function public.available_slots(text, uuid, date, uuid) to anon, authenticated;
grant execute on function public.book_online(text, uuid, timestamptz, uuid, text, text) to authenticated;
grant execute on function public.cancel_online(uuid) to authenticated;
grant execute on function public.link_portal_patients() to authenticated;
grant execute on function public.portal_cabinets() to authenticated;
