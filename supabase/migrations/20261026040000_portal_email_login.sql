-- Nimba Dentaire : connexion à l'espace patient par code reçu par email.
--
-- Le fournisseur SMS (Twilio) n'est pas activé en production : l'espace patient se connecte
-- désormais par un code à 6 chiffres envoyé par email (signInWithOtp + verifyOtp type 'email').
-- La connexion par téléphone reste possible (app.verified_phone() est inchangée).
-- Migration additive : nouvelles fonctions, nouveau déclencheur, link_portal_patients() élargie.
--
-- Choix de sécurité :
-- 1. « Email vérifié » (app.verified_email) = email confirmé ET session ouverte par un code ou
--    un lien reçu à cette adresse. email_confirmed_at ne suffit pas : quand « Confirm email »
--    est désactivé (c'est le cas de la configuration locale, et c'est un réglage du tableau de
--    bord en production), une inscription { email, password } ou un simple signInWithOtp reçoit
--    email_confirmed_at AVANT toute preuve. On exige donc aussi que le jeton de session (JWT,
--    signé par Supabase Auth) porte une méthode d'authentification « amr » qui prouve la
--    réception d'un message à l'adresse : otp (code), magiclink, email/signup (lien de
--    confirmation). Une session « password » ou « anonymous » ne compte pas.
--    Comme pour le téléphone, seuls comptent les comptes « email seul » (sans téléphone) : un
--    compte ouvert par code SMS (amr otp) qui ajouterait un email ne peut pas s'en servir.
--    Conséquence : un membre du personnel qui ouvre l'espace patient par code reçoit les fiches
--    portant son propre email (ce sont ses fiches patient), rien de plus ; connecté par mot de
--    passe, il ne rattache rien.
-- 2. Rattachement (link_portal_patients) : fiches non supprimées, non liées à un autre compte,
--    dont le téléphone est le téléphone vérifié OU dont lower(email) est l'email vérifié.
-- 3. Règle choisie quand le cabinet modifie le téléphone ou l'email d'une fiche déjà rattachée :
--    la fiche est DÉTACHÉE (portal_user_id remis à null) si ni son nouveau téléphone ni son
--    nouvel email ne correspondent plus au compte rattaché. Corriger une coordonnée mal saisie
--    retire donc l'accès à la mauvaise personne ; le bon titulaire est rattaché à sa prochaine
--    connexion. Changer la casse ou le format (« 620 00 00 00 » / « +224620000000 ») ne détache pas.
-- 4. portal_user_id n'est posé que par le serveur : une écriture du personnel (synchronisation
--    hors ligne, qui renvoie la ligne entière) ne peut ni le changer pour un autre compte, ni le
--    remettre à null ; la valeur du serveur est conservée sans erreur (une ligne locale ancienne
--    ne doit ni rétablir un rattachement retiré, ni en supprimer un). Seul « null -> soi-même »
--    est permis à un utilisateur connecté (c'est ce que font link_portal_patients et book_online).
-- Limite connue (comme pour le téléphone) : le rattachement repose sur la saisie du cabinet ;
-- un membre du personnel peut inscrire sur une fiche de son cabinet une adresse qu'il contrôle.
-- C'est tracé par le journal d'audit des patients s'il est actif ; c'est inhérent au parcours.

-- ---------------------------------------------------------------------------
-- 1. Email vérifié
-- ---------------------------------------------------------------------------

-- La session courante a-t-elle été ouverte par un code ou un lien reçu par message ?
create or replace function app.session_proves_inbox()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
    ) a(x)
    where x ->> 'method' in ('otp', 'magiclink', 'email/signup')
  )
$$;

-- Email vérifié de l'utilisateur connecté (minuscules), ou null.
create or replace function app.verified_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(btrim(u.email))
  from auth.users u
  where u.id = auth.uid()
    and coalesce(btrim(u.email), '') <> '' and u.email_confirmed_at is not null
    and coalesce(u.phone, '') = ''
    and not coalesce(u.is_anonymous, false)
    and app.session_proves_inbox()
$$;

create index if not exists patients_email_lower_idx on public.patients (lower(btrim(email)))
  where deleted_at is null and email is not null;

-- ---------------------------------------------------------------------------
-- 2. Rattachement par téléphone ou par email
-- ---------------------------------------------------------------------------

-- Rattache au compte connecté toutes les fiches (tous cabinets) dont le téléphone est son
-- téléphone vérifié ou dont l'email est son email vérifié, et qui ne sont liées à aucun autre
-- compte. Renvoie le nombre de fiches liées.
create or replace function public.link_portal_patients()
returns int language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_email text;
  v_count int := 0;
  v_n int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  v_phone := app.verified_phone();
  v_email := app.verified_email();
  if v_phone is not null then
    update public.patients p set portal_user_id = v_uid
    where p.deleted_at is null and p.portal_user_id is null and app.phone_digits(p.phone) = v_phone;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end if;
  if v_email is not null then
    update public.patients p set portal_user_id = v_uid
    where p.deleted_at is null and p.portal_user_id is null and p.email is not null
      and lower(btrim(p.email)) = v_email;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end if;
  return v_count;
end $$;

revoke execute on function public.link_portal_patients() from public, anon;
grant execute on function public.link_portal_patients() to authenticated;

-- ---------------------------------------------------------------------------
-- 3 et 4. Garde de portal_user_id
-- ---------------------------------------------------------------------------

create or replace function app.patients_portal_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  -- 4. Écriture d'un utilisateur connecté : seul « null -> soi-même » est accepté.
  --    (auth.uid() est null pour le service, les migrations et la mise à null par clé étrangère.)
  if v_uid is not null then
    if tg_op = 'INSERT' then
      if new.portal_user_id is distinct from v_uid then
        new.portal_user_id := null;
      end if;
    elsif new.portal_user_id is distinct from old.portal_user_id
          and not (old.portal_user_id is null and new.portal_user_id = v_uid) then
      new.portal_user_id := old.portal_user_id;
    end if;
  end if;

  -- 3. Coordonnées modifiées : détacher si elles ne désignent plus le compte rattaché.
  if tg_op = 'UPDATE' and new.portal_user_id is not null
     and new.portal_user_id is not distinct from old.portal_user_id
     and (new.phone is distinct from old.phone or new.email is distinct from old.email)
     and not exists (
       select 1 from auth.users u
       where u.id = new.portal_user_id
         and ((u.phone_confirmed_at is not null and coalesce(u.phone, '') <> ''
               and app.phone_digits(u.phone) = app.phone_digits(new.phone))
           or (u.email_confirmed_at is not null and coalesce(btrim(u.email), '') <> ''
               and lower(btrim(u.email)) = lower(btrim(new.email))))
     ) then
    new.portal_user_id := null;
  end if;
  return new;
end $$;

drop trigger if exists patients_portal_guard on public.patients;
create trigger patients_portal_guard before insert or update on public.patients
  for each row execute function app.patients_portal_guard();

-- ---------------------------------------------------------------------------
-- Droits : fonctions internes
-- ---------------------------------------------------------------------------

revoke execute on function app.session_proves_inbox() from public, anon, authenticated;
revoke execute on function app.verified_email() from public, anon, authenticated;
revoke execute on function app.patients_portal_guard() from public, anon, authenticated;
