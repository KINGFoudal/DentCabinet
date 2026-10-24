-- Données de démonstration (appliquées par `supabase db reset` en local uniquement).
--
-- Comptes (mot de passe : Demo12345) :
--   admin@demo.nimba.gn      administrateur + dentiste (Dr Mamadou Sylla)
--   dentiste@demo.nimba.gn   dentiste (Dr Fatoumata Camara)
--   accueil@demo.nimba.gn    secrétaire
--   compta@demo.nimba.gn     comptable
--   plateforme@demo.nimba.gn administrateur de la plateforme

do $$
declare
  v_cab uuid := '10000000-0000-0000-0000-000000000001';
  u_admin uuid := '20000000-0000-0000-0000-000000000001';
  u_dent uuid := '20000000-0000-0000-0000-000000000002';
  u_acc uuid := '20000000-0000-0000-0000-000000000003';
  u_compta uuid := '20000000-0000-0000-0000-000000000004';
  u_platform uuid := '20000000-0000-0000-0000-000000000005';
  v_chair1 uuid := '30000000-0000-0000-0000-000000000001';
  v_chair2 uuid := '30000000-0000-0000-0000-000000000002';
  v_today date := (now() at time zone 'Africa/Conakry')::date;
  v_patients uuid[] := array[]::uuid[];
  v_types uuid[];
  v_pid uuid;
  v_inv uuid;
  v_quote uuid;
  v_plan uuid;
  r record;
  i int;
begin
  -- Utilisateurs
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
         extensions.crypt('Demo12345', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', name), now(), now(),
         '', '', '', ''
  from (values
    (u_admin, 'admin@demo.nimba.gn', 'Dr Mamadou Sylla'),
    (u_dent, 'dentiste@demo.nimba.gn', 'Dr Fatoumata Camara'),
    (u_acc, 'accueil@demo.nimba.gn', 'Aïssatou Bah'),
    (u_compta, 'compta@demo.nimba.gn', 'Ibrahima Soumah'),
    (u_platform, 'plateforme@demo.nimba.gn', 'Équipe Nimba')
  ) as u(id, email, name);

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), id, id::text, 'email', jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
         now(), now(), now()
  from auth.users where id in (u_admin, u_dent, u_acc, u_compta, u_platform);

  update public.profiles set is_platform_admin = true where id = u_platform;

  -- Cabinet (créé comme le ferait create_cabinet)
  insert into public.cabinets (id, name, slug, phone, email, address, city, public_description,
                               online_booking_enabled, opening_hours)
  values (v_cab, 'Cabinet Dentaire de Kaloum', 'kaloum', '+224620000000', 'contact@kaloum.demo.nimba.gn',
          'Avenue de la République, Kaloum', 'Conakry',
          'Soins dentaires pour toute la famille, au cœur de Kaloum.', true,
          '{"1":[["08:00","13:00"],["14:30","18:00"]],"2":[["08:00","13:00"],["14:30","18:00"]],
            "3":[["08:00","13:00"],["14:30","18:00"]],"4":[["08:00","13:00"],["14:30","18:00"]],
            "5":[["08:00","12:30"],["15:00","18:00"]],"6":[["09:00","13:00"]]}'::jsonb);

  insert into public.memberships (cabinet_id, user_id, roles, display_name, color) values
    (v_cab, u_admin, '{admin,dentist}', 'Dr Mamadou Sylla', '#0F766E'),
    (v_cab, u_dent, '{dentist}', 'Dr Fatoumata Camara', '#2563EB'),
    (v_cab, u_acc, '{assistant}', 'Aïssatou Bah', null),
    (v_cab, u_compta, '{accountant}', 'Ibrahima Soumah', null);

  insert into public.chairs (id, cabinet_id, name, sort_order) values
    (v_chair1, v_cab, 'Fauteuil 1', 1), (v_chair2, v_cab, 'Fauteuil 2', 2);

  insert into public.appointment_types (cabinet_id, name, duration_minutes, color, bookable_online, sort_order) values
    (v_cab, 'Consultation', 30, '#0F766E', true, 1),
    (v_cab, 'Détartrage', 30, '#14B8A6', true, 2),
    (v_cab, 'Soin de carie', 45, '#2563EB', false, 3),
    (v_cab, 'Extraction', 45, '#DC2626', false, 4),
    (v_cab, 'Urgence', 30, '#D97706', false, 5);
  select array_agg(id order by sort_order) into v_types from public.appointment_types where cabinet_id = v_cab;

  insert into public.practitioner_schedules (cabinet_id, dentist_id, weekday, start_time, end_time)
  select v_cab, d, wd, s, e
  from unnest(array[u_admin, u_dent]) d, generate_series(1, 5) wd,
       (values ('08:00'::time, '13:00'::time), ('14:30'::time, '18:00'::time)) h(s, e);

  insert into public.acts (cabinet_id, code, label, category, price_gnf, default_duration_minutes) values
    (v_cab, 'CONS', 'Consultation', 'Diagnostic', 100000, 30),
    (v_cab, 'RADR', 'Radio rétro-alvéolaire', 'Diagnostic', 75000, 10),
    (v_cab, 'PANO', 'Radio panoramique', 'Diagnostic', 250000, 15),
    (v_cab, 'DETA', 'Détartrage complet', 'Prévention', 200000, 30),
    (v_cab, 'COMP', 'Soin de carie (composite)', 'Soins', 300000, 45),
    (v_cab, 'DEVM', 'Dévitalisation monoradiculée', 'Endodontie', 500000, 60),
    (v_cab, 'DEVP', 'Dévitalisation pluriradiculée', 'Endodontie', 800000, 90),
    (v_cab, 'EXTS', 'Extraction simple', 'Chirurgie', 250000, 30),
    (v_cab, 'EXTC', 'Extraction chirurgicale', 'Chirurgie', 600000, 60),
    (v_cab, 'CCM', 'Couronne céramo-métallique', 'Prothèse', 2500000, 60),
    (v_cab, 'PAP', 'Prothèse amovible partielle', 'Prothèse', 3000000, 60);

  -- Patients
  for r in select * from (values
    ('Mariama', 'Diallo', 'female', '1988-03-12', '+224620111111', 'Kaloum'),
    ('Ibrahima', 'Camara', 'male', '1975-07-02', '+224621222222', 'Ratoma'),
    ('Fatoumata', 'Bah', 'female', '1995-11-23', '+224622333333', 'Dixinn'),
    ('Mamadou', 'Barry', 'male', '1960-01-30', '+224623444444', 'Matam'),
    ('Kadiatou', 'Sow', 'female', '2012-05-17', '+224624555555', 'Matoto'),
    ('Alpha', 'Condé', 'male', '1982-09-09', '+224625666666', 'Kaloum'),
    ('Aminata', 'Touré', 'female', '1999-02-14', '+224626777777', 'Ratoma'),
    ('Sékou', 'Keita', 'male', '1970-12-01', '+224627888888', 'Dixinn'),
    ('Hawa', 'Sylla', 'female', '1991-06-06', '+224628999999', 'Matam'),
    ('Ousmane', 'Kouyaté', 'male', '2005-08-25', '+224629000001', 'Kaloum'),
    ('Djénabou', 'Baldé', 'female', '1985-04-04', '+224629000002', 'Matoto'),
    ('Thierno', 'Diallo', 'male', '1978-10-19', '+224629000003', 'Ratoma')
  ) as t(first_name, last_name, sex, birth_date, phone, city) loop
    insert into public.patients (cabinet_id, first_name, last_name, sex, birth_date, phone, city, created_by)
    values (v_cab, r.first_name, r.last_name, r.sex::public.sex, r.birth_date::date, r.phone, r.city, u_acc)
    returning id into v_pid;
    v_patients := v_patients || v_pid;
  end loop;

  insert into public.patient_medical (patient_id, cabinet_id, alerts, allergies, medical_history) values
    (v_patients[2], v_cab, '{diabetes,hypertension}', null, 'Diabète de type 2 sous metformine.'),
    (v_patients[4], v_cab, '{anticoagulants}', 'Pénicilline', 'Fibrillation auriculaire.'),
    (v_patients[7], v_cab, '{pregnancy}', null, 'Grossesse 5e mois.');

  -- Rendez-vous : aujourd'hui et la semaine
  for i in 0..9 loop
    insert into public.appointments (cabinet_id, patient_id, dentist_id, chair_id, type_id, starts_at, ends_at, status, created_by)
    values (
      v_cab, v_patients[i + 1],
      case when i % 2 = 0 then u_admin else u_dent end,
      case when i % 2 = 0 then v_chair1 else v_chair2 end,
      v_types[1 + i % 5],
      (v_today + (i / 4) * interval '1 day' + time '08:30' + (i % 4) * interval '1 hour') at time zone 'Africa/Conakry',
      (v_today + (i / 4) * interval '1 day' + time '09:00' + (i % 4) * interval '1 hour') at time zone 'Africa/Conakry',
      (case when i = 0 then 'done' when i = 1 then 'arrived' else 'scheduled' end)::public.appointment_status,
      u_acc
    );
  end loop;

  -- Dossier clinique d'un patient
  insert into public.tooth_records (cabinet_id, patient_id, tooth, status, surfaces, updated_by) values
    (v_cab, v_patients[1], 16, 'caries', '{O,M}', u_admin),
    (v_cab, v_patients[1], 26, 'filled', '{O}', u_admin),
    (v_cab, v_patients[1], 36, 'missing', '{}', u_admin),
    (v_cab, v_patients[1], 46, 'root_canal', '{}', u_admin);
  insert into public.clinical_notes (cabinet_id, patient_id, author_id, body, signed_at) values
    (v_cab, v_patients[1], u_admin, 'Douleur à la mastication sur 16. Carie occluso-mésiale. Plan proposé.', now() - interval '2 days');

  insert into public.treatment_plans (cabinet_id, patient_id, dentist_id, title, status)
  values (v_cab, v_patients[1], u_admin, 'Remise en état secteur 1', 'accepted') returning id into v_plan;
  insert into public.treatment_plan_items (cabinet_id, plan_id, act_id, label, tooth, step, unit_price_gnf, status)
  select v_cab, v_plan, a.id, a.label, x.tooth, x.step, a.price_gnf, x.status::public.plan_item_status
  from (values ('DETA', null::int, 1, 'done'), ('COMP', 16, 2, 'planned'), ('CCM', 46, 3, 'planned')) x(code, tooth, step, status)
  join public.acts a on a.cabinet_id = v_cab and a.code = x.code;

  insert into public.prescriptions (cabinet_id, patient_id, dentist_id, items) values
    (v_cab, v_patients[1], u_admin,
     '[{"drug":"Amoxicilline 1 g","dosage":"1 comprimé matin et soir","duration":"7 jours","instructions":"Pendant les repas"},
       {"drug":"Paracétamol 1 g","dosage":"1 comprimé si douleur","duration":"5 jours","instructions":"Maximum 3 par jour"}]');

  -- Devis envoyé
  insert into public.quotes (cabinet_id, patient_id, plan_id, dentist_id, status, valid_until, created_by)
  values (v_cab, v_patients[1], v_plan, u_admin, 'sent', v_today + 30, u_admin) returning id into v_quote;
  insert into public.quote_items (cabinet_id, quote_id, label, tooth, unit_price_gnf, sort_order) values
    (v_cab, v_quote, 'Soin de carie (composite)', 16, 300000, 1),
    (v_cab, v_quote, 'Couronne céramo-métallique', 46, 2500000, 2);

  -- Factures : payée, partiellement payée, impayée
  for i in 1..3 loop
    insert into public.invoices (cabinet_id, patient_id, issue_date, due_date, created_by)
    values (v_cab, v_patients[i], v_today - (10 * i), v_today - (10 * i) + 15, u_acc) returning id into v_inv;
    insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf) values
      (v_cab, v_inv, 'Consultation', 1, 100000),
      (v_cab, v_inv, 'Détartrage complet', 1, 200000);
    update public.invoices set status = 'issued' where id = v_inv;
    if i = 1 then
      insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, paid_at, received_by)
      values (v_cab, v_inv, 300000, 'cash', now() - interval '9 days', u_acc);
    elsif i = 2 then
      insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, reference, paid_at, received_by)
      values (v_cab, v_inv, 150000, 'orange_money', 'OM240001', now() - interval '18 days', u_acc);
    end if;
  end loop;

  -- Paiement du jour
  insert into public.invoices (cabinet_id, patient_id, created_by) values (v_cab, v_patients[1], u_acc) returning id into v_inv;
  insert into public.invoice_items (cabinet_id, invoice_id, label, unit_price_gnf) values (v_cab, v_inv, 'Consultation', 100000);
  update public.invoices set status = 'issued' where id = v_inv;
  insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, reference, received_by)
  values (v_cab, v_inv, 100000, 'mtn_momo', 'MTN98765', u_acc);
end $$;
