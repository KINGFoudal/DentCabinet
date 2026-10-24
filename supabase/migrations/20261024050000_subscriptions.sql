-- Nimba Dentaire : abonnements, paiements mobiles, administration plateforme.
--
-- Contenu :
-- * Formules (paliers Solo / Cabinet / Clinique) avec des prix PROVISOIRES, modifiables par
--   l'admin plateforme (page /admin, table public.plans).
-- * Colonnes complémentaires de payment_transactions et table des secrets opérateur.
-- * app.complete_transaction : finalisation atomique et idempotente d'une transaction
--   (facture -> payments ; abonnement -> subscription_payments + prolongation du cabinet).
--   Exposée par public.complete_transaction, réservée à la clé service.
-- * app.expire_subscriptions : essai terminé -> expiré ; période terminée -> past_due
--   (7 jours de grâce) puis expiré. Planifiée par pg_cron quand l'extension est disponible.
-- * RPC de l'administration plateforme (admin_cabinets, admin_metrics).
-- * Garde-fous : le dernier administrateur actif d'un cabinet ne peut pas perdre son rôle ;
--   une transaction de facture appartient au cabinet de la facture.
--
-- Désigner le premier admin plateforme (une seule fois, avec un accès SQL à la base, par ex.
-- l'éditeur SQL de Supabase ou psql avec l'utilisateur postgres) :
--
--   update public.profiles set is_platform_admin = true
--   where id = (select id from auth.users where email = 'admin@exemple.com');
--
-- Ensuite, un admin plateforme peut en désigner d'autres de la même façon (le trigger
-- app.protect_profile l'y autorise).

-- ---------------------------------------------------------------------------
-- Formules (prix de départ indicatifs, PROVISOIRES : à valider commercialement)
-- ---------------------------------------------------------------------------

insert into public.plans (code, name, min_dentists, max_dentists, price_monthly_gnf, price_per_extra_dentist_gnf,
                          yearly_discount_pct, active, sort_order)
values
  ('solo', 'Solo', 1, 1, 150000, 0, 15, true, 1),
  ('cabinet', 'Cabinet', 2, 3, 300000, 0, 15, true, 2),
  ('clinique', 'Clinique', 4, null, 450000, 100000, 15, true, 3)
on conflict (code) do nothing;

-- Les cabinets créés avant cette migration reçoivent la formule correspondant à leurs dentistes.
update public.cabinets c
set plan_id = (select sp.plan_id from public.subscription_price(public.active_dentist_count(c.id), 'monthly') sp)
where c.plan_id is null;

-- ---------------------------------------------------------------------------
-- Transactions : colonnes complémentaires
-- ---------------------------------------------------------------------------

alter table public.payment_transactions
  add column if not exists plan_id uuid references public.plans(id),
  add column if not exists dentist_count int,
  add column if not exists completed_at timestamptz;

create index if not exists payment_transactions_cabinet_idx on public.payment_transactions (cabinet_id, created_at desc);
create index if not exists payment_transactions_invoice_idx on public.payment_transactions (invoice_id);

-- Secrets renvoyés par l'opérateur à l'initiation (ex. notif_token Orange Money), servant à
-- authentifier le webhook. RLS activée sans politique : seule la clé service y accède.
create table if not exists public.payment_transaction_secrets (
  transaction_id uuid primary key references public.payment_transactions(id) on delete cascade,
  secret text not null,
  created_at timestamptz not null default now()
);
alter table public.payment_transaction_secrets enable row level security;
revoke all on public.payment_transaction_secrets from anon, authenticated;

-- Une transaction de facture appartient au cabinet de la facture.
create or replace function app.check_transaction_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.purpose = 'invoice' and not exists (
    select 1 from public.invoices i where i.id = new.invoice_id and i.cabinet_id = new.cabinet_id
  ) then
    raise exception 'invoice does not belong to this cabinet';
  end if;
  if new.purpose = 'subscription' and new.subscription_cycle is null then
    raise exception 'subscription transactions need a cycle';
  end if;
  return new;
end $$;

drop trigger if exists payment_transactions_check_invoice on public.payment_transactions;
create trigger payment_transactions_check_invoice before insert or update of invoice_id, cabinet_id, purpose
  on public.payment_transactions for each row execute function app.check_transaction_invoice();

-- ---------------------------------------------------------------------------
-- Finalisation d'une transaction (idempotente)
-- ---------------------------------------------------------------------------

-- p_status : 'succeeded' | 'failed' | 'expired'. Renvoie le statut final de la transaction.
-- * Déjà réussie : rien ne change (un webhook rejoué ne crée pas de second paiement).
-- * Réussite après un échec ou une expiration locale (le client a payé en retard) : la
--   réussite l'emporte, l'argent ayant été débité.
-- * Échec / expiration : seulement depuis 'pending'.
create or replace function app.complete_transaction(
  p_transaction uuid,
  p_status public.payment_status,
  p_provider_reference text default null,
  p_failure_reason text default null,
  p_raw jsonb default null
) returns public.payment_status
language plpgsql security definer set search_path = '' as $$
declare
  tx public.payment_transactions;
  cab public.cabinets;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_status not in ('succeeded', 'failed', 'expired') then
    raise exception 'invalid final status %', p_status;
  end if;

  select * into tx from public.payment_transactions where id = p_transaction for update;
  if tx.id is null then
    raise exception 'transaction not found';
  end if;

  if tx.status = 'succeeded' or tx.status = 'refunded' then
    return tx.status;
  end if;

  if p_status <> 'succeeded' then
    if tx.status = 'pending' then
      update public.payment_transactions
      set status = p_status,
          failure_reason = coalesce(p_failure_reason, failure_reason),
          provider_reference = coalesce(provider_reference, p_provider_reference),
          raw = coalesce(p_raw, raw),
          completed_at = now()
      where id = tx.id;
      return p_status;
    end if;
    return tx.status;
  end if;

  -- Réussite.
  update public.payment_transactions
  set status = 'succeeded',
      failure_reason = null,
      provider_reference = coalesce(provider_reference, p_provider_reference),
      raw = coalesce(p_raw, raw),
      completed_at = now()
  where id = tx.id;

  if tx.purpose = 'invoice' then
    insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, status, reference, transaction_id, paid_at, notes)
    values (tx.cabinet_id, tx.invoice_id, tx.amount_gnf, tx.provider::text::public.payment_method, 'succeeded',
            coalesce(p_provider_reference, tx.provider_reference), tx.id, now(), 'Paiement mobile en ligne')
    on conflict (transaction_id) do nothing;
  else
    select * into cab from public.cabinets where id = tx.cabinet_id for update;
    -- La nouvelle période commence à la fin de la période (ou de l'essai) en cours, ou maintenant.
    v_start := greatest(
      now(),
      coalesce(cab.current_period_end, now()),
      case when cab.subscription_status = 'trialing' then coalesce(cab.trial_ends_at, now()) else now() end
    );
    v_end := v_start + case when tx.subscription_cycle = 'yearly' then interval '1 year' else interval '1 month' end;

    insert into public.subscription_payments (cabinet_id, plan_id, transaction_id, amount_gnf, dentist_count, cycle,
                                              period_start, period_end)
    values (tx.cabinet_id, coalesce(tx.plan_id, cab.plan_id), tx.id, tx.amount_gnf, coalesce(tx.dentist_count, 1),
            tx.subscription_cycle, v_start, v_end)
    on conflict (transaction_id) do nothing;

    update public.cabinets
    set subscription_status = 'active',
        current_period_end = v_end,
        plan_id = coalesce(tx.plan_id, plan_id),
        billing_cycle = tx.subscription_cycle
    where id = tx.cabinet_id;
  end if;

  return 'succeeded';
end $$;

-- Point d'entrée PostgREST (clé service uniquement).
create or replace function public.complete_transaction(
  p_transaction uuid,
  p_status public.payment_status,
  p_provider_reference text default null,
  p_failure_reason text default null,
  p_raw jsonb default null
) returns public.payment_status
language sql security definer set search_path = '' as $$
  select app.complete_transaction(p_transaction, p_status, p_provider_reference, p_failure_reason, p_raw)
$$;

revoke execute on function app.complete_transaction(uuid, public.payment_status, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.complete_transaction(uuid, public.payment_status, text, text, jsonb) from public, anon, authenticated;
grant execute on function app.complete_transaction(uuid, public.payment_status, text, text, jsonb) to service_role;
grant execute on function public.complete_transaction(uuid, public.payment_status, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Expiration automatique
-- ---------------------------------------------------------------------------

create or replace function app.expire_subscriptions()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
  c int;
begin
  update public.cabinets set subscription_status = 'expired'
  where subscription_status = 'trialing' and trial_ends_at is not null and trial_ends_at <= now();
  get diagnostics c = row_count; n := n + c;

  update public.cabinets set subscription_status = 'past_due'
  where subscription_status = 'active' and current_period_end is not null and current_period_end <= now()
    and current_period_end > now() - interval '7 days';
  get diagnostics c = row_count; n := n + c;

  update public.cabinets set subscription_status = 'expired'
  where subscription_status in ('active', 'past_due') and current_period_end is not null
    and current_period_end <= now() - interval '7 days';
  get diagnostics c = row_count; n := n + c;

  -- Transactions restées en attente bien après leur échéance (l'opérateur n'a jamais répondu).
  -- Une réussite tardive reste possible : app.complete_transaction l'accepte depuis 'expired'.
  update public.payment_transactions set status = 'expired', completed_at = now(),
         failure_reason = coalesce(failure_reason, 'expired')
  where status = 'pending' and expires_at < now() - interval '1 hour';

  return n;
end $$;

create or replace function public.expire_subscriptions()
returns int language sql security definer set search_path = '' as $$
  select app.expire_subscriptions()
$$;

revoke execute on function app.expire_subscriptions() from public, anon, authenticated;
revoke execute on function public.expire_subscriptions() from public, anon, authenticated;
grant execute on function app.expire_subscriptions() to service_role;
grant execute on function public.expire_subscriptions() to service_role;

-- Planification horaire par pg_cron si l'extension est disponible (c'est le cas sur Supabase,
-- y compris en local). Sinon, appeler `select public.expire_subscriptions()` depuis un
-- planificateur externe (tâche cron appelant l'API avec la clé service).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'nimba-expire-subscriptions') then
      perform cron.unschedule('nimba-expire-subscriptions');
    end if;
    perform cron.schedule('nimba-expire-subscriptions', '7 * * * *', 'select app.expire_subscriptions()');
  else
    raise notice 'pg_cron indisponible : planifier public.expire_subscriptions() ailleurs';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Garde-fou : dernier administrateur
-- ---------------------------------------------------------------------------

create or replace function app.protect_last_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if 'admin' = any(old.roles) and old.active and old.deleted_at is null
     and not ('admin' = any(new.roles) and new.active and new.deleted_at is null)
     and not exists (
       select 1 from public.memberships m
       where m.cabinet_id = old.cabinet_id and m.id <> old.id
         and 'admin' = any(m.roles) and m.active and m.deleted_at is null
     ) then
    raise exception 'last administrator of the cabinet cannot be removed' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists memberships_protect_last_admin on public.memberships;
create trigger memberships_protect_last_admin before update on public.memberships
  for each row execute function app.protect_last_admin();

-- ---------------------------------------------------------------------------
-- Paramètres du cabinet : écriture par le moteur de synchronisation
-- ---------------------------------------------------------------------------

-- Le moteur envoie chaque ligne par un upsert (INSERT ... ON CONFLICT DO UPDATE), qui applique
-- aussi les politiques INSERT. Cette politique ne laisse passer que la ligne d'un cabinet dont
-- l'utilisateur est déjà administrateur (donc jamais la création d'un nouveau cabinet, qui
-- passe par public.create_cabinet).
drop policy if exists cabinets_upsert on public.cabinets;
create policy cabinets_upsert on public.cabinets for insert
  with check (app.can_write(id, '{admin}'));

-- ---------------------------------------------------------------------------
-- Administration plateforme
-- ---------------------------------------------------------------------------

create or replace function public.admin_cabinets()
returns table (
  id uuid, name text, slug text, city text, phone text, email text,
  subscription_status public.subscription_status, billing_cycle public.billing_cycle,
  trial_ends_at timestamptz, current_period_end timestamptz, plan_id uuid, plan_code text,
  active_dentists int, members int, last_payment_at timestamptz, last_payment_gnf bigint, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'not allowed';
  end if;
  return query
  select c.id, c.name, c.slug, c.city, c.phone, c.email, c.subscription_status, c.billing_cycle,
         c.trial_ends_at, c.current_period_end, c.plan_id, p.code,
         public.active_dentist_count(c.id),
         (select count(*)::int from public.memberships m where m.cabinet_id = c.id and m.active and m.deleted_at is null),
         lp.created_at, lp.amount_gnf, c.created_at
  from public.cabinets c
  left join public.plans p on p.id = c.plan_id
  left join lateral (
    select sp.created_at, sp.amount_gnf from public.subscription_payments sp
    where sp.cabinet_id = c.id order by sp.created_at desc limit 1
  ) lp on true
  order by c.created_at desc;
end $$;

create or replace function public.admin_metrics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'not allowed';
  end if;
  select jsonb_build_object(
    'cabinets', count(*),
    'active', count(*) filter (where c.subscription_status = 'active'),
    'trialing', count(*) filter (where c.subscription_status = 'trialing' and (c.trial_ends_at is null or c.trial_ends_at > now())),
    'past_due', count(*) filter (where c.subscription_status = 'past_due'),
    'expired', count(*) filter (where c.subscription_status = 'expired'
                                 or (c.subscription_status = 'trialing' and c.trial_ends_at <= now())),
    'cancelled', count(*) filter (where c.subscription_status = 'cancelled'),
    'revenue_month_gnf', (
      select coalesce(sum(sp.amount_gnf), 0) from public.subscription_payments sp
      where sp.created_at >= date_trunc('month', now() at time zone 'Africa/Conakry') at time zone 'Africa/Conakry'),
    'active_dentists', coalesce(sum(public.active_dentist_count(c.id)) filter (where c.subscription_status in ('active', 'past_due', 'trialing')), 0)
  ) into v
  from public.cabinets c;
  return v;
end $$;

revoke execute on function public.admin_cabinets() from public, anon;
revoke execute on function public.admin_metrics() from public, anon;
grant execute on function public.admin_cabinets() to authenticated;
grant execute on function public.admin_metrics() to authenticated;

-- ---------------------------------------------------------------------------
-- Logo du cabinet (bucket public « branding », chemin {cabinet_id}/logo.<ext>)
-- ---------------------------------------------------------------------------

-- Le remplacement d'un logo (upload avec upsert) exige que la ligne soit visible : le bucket
-- est public, la lecture des métadonnées ne divulgue rien de plus que l'URL publique.
drop policy if exists branding_bucket_read on storage.objects;
create policy branding_bucket_read on storage.objects for select using (bucket_id = 'branding');
