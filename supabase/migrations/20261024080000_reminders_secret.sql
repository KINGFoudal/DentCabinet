-- Secret des rappels planifiés : généré et conservé dans Vault, jamais saisi à la main.
-- pg_cron l'envoie à l'Edge Function send-reminders, qui le relit ici avec la clé service
-- lorsque la variable REMINDERS_CRON_SECRET n'est pas définie.

create or replace function public.reminders_cron_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1
$$;

revoke execute on function public.reminders_cron_secret() from public, anon, authenticated;
grant execute on function public.reminders_cron_secret() to service_role;
