-- Durcissement signalé par les diagnostics de sécurité Supabase.

-- Les fonctions sont exécutables par PUBLIC par défaut : retirer le droit à « anon » ne suffit pas.
revoke execute on function public.create_cabinet(text, text, text, text, boolean) from public;
revoke execute on function public.accept_invitation(uuid) from public;
revoke execute on function public.log_patient_view(uuid) from public;
revoke execute on function public.active_dentist_count(uuid) from public;
revoke execute on function public.admin_cabinets() from public;
revoke execute on function public.admin_metrics() from public;
grant execute on function public.create_cabinet(text, text, text, text, boolean) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.log_patient_view(uuid) to authenticated;
grant execute on function public.active_dentist_count(uuid) to authenticated;
grant execute on function public.admin_cabinets() to authenticated;
grant execute on function public.admin_metrics() to authenticated;

-- search_path fixe pour les fonctions de déclencheurs (toutes les références sont qualifiées).
alter function app.touch_updated_at() set search_path = '';
alter function app.freeze_cabinet_id() set search_path = '';
alter function app.protect_totals() set search_path = '';
alter function app.protect_profile() set search_path = '';
alter function app.protect_cabinet_billing() set search_path = '';
alter function app.protect_signed_note() set search_path = '';
alter function app.protect_payment() set search_path = '';
alter function app.protect_patient_archive() set search_path = '';
alter function app.protect_signed_note_delete() set search_path = '';
