import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { connect } from "./helpers";

// Audit de sécurité (26/10/2026) : tests d'attaque par l'API publique (clé anon + jeton
// utilisateur, comme un navigateur ou un script malveillant), le stockage et les routes /api.
// Cabinet A = attaquant (tous les rôles) ; cabinet B = victime ; U1 et U2 = patients de B.

vi.mock("server-only", () => ({}));

const ENV = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
) as Record<string, string>;
const URL_ = ENV.NEXT_PUBLIC_SUPABASE_URL;
const ANON = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "PAYMENTS_SANDBOX_SECRET"]) {
  process.env[k] = ENV[k];
}
process.env.PAYMENTS_MODE = "sandbox";
process.env.NIMBA_ENV = "development";
delete process.env.VERCEL_ENV;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const anon = createClient(URL_, ANON, opts);

type U = { id: string; sb: SupabaseClient; token: string; email?: string };

const PASSWORD = "Attaque-2026!";

async function emailUser(): Promise<U> {
  const email = `${randomUUID()}@audit.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const sb = createClient(URL_, ANON, opts);
  const { data: s, error: e2 } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return { id: data.user.id, sb, token: s.session!.access_token, email };
}

function randomPhone() {
  return "2246" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}

/** Patient du portail. Le mot de passe ne sert qu'à obtenir un jeton dans le test. */
async function phoneUser(digits: string): Promise<U> {
  const { data, error } = await admin.auth.admin.createUser({ phone: digits, password: PASSWORD, phone_confirm: true });
  if (error) throw error;
  const sb = createClient(URL_, ANON, opts);
  const { data: s, error: e2 } = await sb.auth.signInWithPassword({ phone: digits, password: PASSWORD });
  if (e2) throw e2;
  return { id: data.user.id, sb, token: s.session!.access_token };
}

let db: Client;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];
const ins = async (sql: string, params: unknown[] = []) => (await one(sql + " returning id", params)).id as string;

// Cabinet A (attaquant)
let aOwner: U, aDentist: U, aAssistant: U, aAccountant: U, aAdminOnly: U;
let A: string;
// Cabinet B (victime)
let bOwner: U, bFormer: U, bRemoved: U, u1: U, u2: U;
let B: string;
let bSlug: string;
const b: Record<string, string> = {};
const a: Record<string, string> = {};

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" });

/** Empreinte de toutes les lignes du cabinet B (et de ses fichiers) : prouve qu'aucune attaque n'a rien modifié. */
const B_TABLES = [
  "chairs", "appointment_types", "practitioner_schedules", "time_off", "acts", "patients", "patient_medical",
  "appointments", "clinical_notes", "tooth_records", "treatment_plans", "treatment_plan_items", "prescriptions",
  "documents", "quotes", "quote_items", "invoices", "invoice_items", "payment_installments", "payment_transactions",
  "payments", "subscription_payments", "message_templates", "notification_log", "audit_log", "memberships",
  "invitations", "cabinet_counters",
];
async function fingerprintB() {
  const out: Record<string, string> = {};
  for (const t of B_TABLES) {
    out[t] = (await one(`select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) h, count(*) n
                         from public.${t} x where cabinet_id = $1`, [B])).h as string;
  }
  out.cabinets = (await one(`select md5(to_jsonb(c)::text) h from public.cabinets c where id = $1`, [B])).h as string;
  out.objects = (await one(`select md5(coalesce(string_agg(name || ':' || coalesce(metadata::text, ''), '|' order by name), '')) h
                            from storage.objects where name like $1 || '/%'`, [B])).h as string;
  return out;
}
let snapshot: Record<string, string>;

beforeAll(async () => {
  db = await connect();

  // --- Cabinet A : chaque rôle --------------------------------------------------------
  aOwner = await emailUser();
  const ra = await aOwner.sb.rpc("create_cabinet", { p_name: "Cabinet A", p_slug: `audit-a-${randomUUID().slice(0, 8)}` });
  if (ra.error) throw ra.error;
  A = ra.data as string;
  [aDentist, aAssistant, aAccountant, aAdminOnly] = await Promise.all([emailUser(), emailUser(), emailUser(), emailUser()]);
  for (const [u, roles] of [
    [aDentist, "{dentist}"],
    [aAssistant, "{assistant}"],
    [aAccountant, "{accountant}"],
    [aAdminOnly, "{admin}"],
  ] as const) {
    await q(`insert into public.memberships (cabinet_id, user_id, roles) values ($1, $2, $3)`, [A, u.id, roles]);
  }

  // --- Cabinet B : victime -----------------------------------------------------------------
  bOwner = await emailUser();
  bSlug = `audit-b-${randomUUID().slice(0, 8)}`;
  const rb = await bOwner.sb.rpc("create_cabinet", { p_name: "Cabinet B", p_slug: bSlug });
  if (rb.error) throw rb.error;
  B = rb.data as string;
  await q(`update public.cabinets set online_booking_enabled = true,
             opening_hours = '{"1":[["08:00","18:00"]],"2":[["08:00","18:00"]],"3":[["08:00","18:00"]],"4":[["08:00","18:00"]],"5":[["08:00","18:00"]],"6":[["08:00","18:00"]],"7":[["08:00","18:00"]]}'
           where id = $1`, [B]);
  [bFormer, bRemoved] = await Promise.all([emailUser(), emailUser()]);
  await q(`insert into public.memberships (cabinet_id, user_id, roles, active) values ($1, $2, '{admin,dentist}', false)`, [B, bFormer.id]);
  await q(`insert into public.memberships (cabinet_id, user_id, roles, deleted_at) values ($1, $2, '{admin,dentist}', now())`, [B, bRemoved.id]);

  const p1Phone = randomPhone();
  const p2Phone = randomPhone();
  b.p3Phone = randomPhone();
  u1 = await phoneUser(p1Phone);
  u2 = await phoneUser(p2Phone);

  b.chair = (await one(`select id from public.chairs where cabinet_id = $1`, [B])).id as string;
  b.type = (await one(`select id from public.appointment_types where cabinet_id = $1 and bookable_online limit 1`, [B])).id as string;
  b.p1 = await ins(`insert into public.patients (cabinet_id, first_name, last_name, phone, portal_user_id, admin_notes) values ($1, 'Aissatou', 'Bah', $2, $3, 'note interne')`, [B, "+" + p1Phone, u1.id]);
  b.p2 = await ins(`insert into public.patients (cabinet_id, first_name, last_name, phone, portal_user_id) values ($1, 'Mamadou', 'Camara', $2, $3)`, [B, "+" + p2Phone, u2.id]);
  b.p3 = await ins(`insert into public.patients (cabinet_id, first_name, last_name, phone) values ($1, 'Fatoumata', 'Sow', $2)`, [B, "+" + b.p3Phone]);
  await q(`insert into public.patient_medical (patient_id, cabinet_id, allergies) values ($1, $2, 'pénicilline')`, [b.p1, B]);
  const day = new Date(Date.now() + 3 * 86400_000);
  const tomorrow = day.toISOString().slice(0, 10);
  b.day = tomorrow;
  b.membership = (await one(`select id from public.memberships where cabinet_id = $1 and user_id = $2`, [B, bOwner.id])).id as string;
  b.appt1 = await ins(`insert into public.appointments (cabinet_id, patient_id, dentist_id, chair_id, type_id, starts_at, ends_at, notes)
                       values ($1, $2, $3, $4, $5, $6, $7, 'notes internes')`,
    [B, b.p1, bOwner.id, b.chair, b.type, `${tomorrow}T09:00:00Z`, `${tomorrow}T09:30:00Z`]);
  b.appt2 = await ins(`insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
                       values ($1, $2, $3, $4, $5)`, [B, b.p2, bOwner.id, `${tomorrow}T10:00:00Z`, `${tomorrow}T10:30:00Z`]);
  b.note = await ins(`insert into public.clinical_notes (cabinet_id, patient_id, author_id, body) values ($1, $2, $3, 'pulpite 36')`, [B, b.p1, bOwner.id]);
  b.tooth = await ins(`insert into public.tooth_records (cabinet_id, patient_id, tooth, status) values ($1, $2, 36, 'caries')`, [B, b.p1]);
  b.plan = await ins(`insert into public.treatment_plans (cabinet_id, patient_id, dentist_id, title) values ($1, $2, $3, 'Plan')`, [B, b.p1, bOwner.id]);
  b.planItem = await ins(`insert into public.treatment_plan_items (cabinet_id, plan_id, label, unit_price_gnf) values ($1, $2, 'Couronne', 900000)`, [B, b.plan]);
  b.rx1 = await ins(`insert into public.prescriptions (cabinet_id, patient_id, dentist_id, items, shared_with_patient) values ($1, $2, $3, '[{"drug":"Amoxicilline"}]', true)`, [B, b.p1, bOwner.id]);
  b.rx1Private = await ins(`insert into public.prescriptions (cabinet_id, patient_id, dentist_id, shared_with_patient) values ($1, $2, $3, false)`, [B, b.p1, bOwner.id]);
  b.rx2 = await ins(`insert into public.prescriptions (cabinet_id, patient_id, dentist_id, shared_with_patient) values ($1, $2, $3, true)`, [B, b.p2, bOwner.id]);
  b.act = await ins(`insert into public.acts (cabinet_id, label, price_gnf) values ($1, 'Détartrage', 150000)`, [B]);
  b.schedule = await ins(`insert into public.practitioner_schedules (cabinet_id, dentist_id, weekday, start_time, end_time) values ($1, $2, $3, '08:00', '18:00')`, [B, bOwner.id, ((day.getUTCDay() + 6) % 7) + 1]);
  b.timeOff = await ins(`insert into public.time_off (cabinet_id, dentist_id, starts_at, ends_at, reason) values ($1, $2, now() + interval '40 days', now() + interval '41 days', 'congé')`, [B, bOwner.id]);

  // Fichiers déposés par le praticien de B (vrai téléversement par l'API de stockage).
  const files = {
    doc1Shared: `${B}/${b.p1}/${randomUUID()}-radio.png`,
    doc1Private: `${B}/${b.p1}/${randomUUID()}-panoramique.png`,
    doc2Shared: `${B}/${b.p2}/${randomUUID()}-radio.png`,
  };
  for (const path of Object.values(files)) {
    const up = await bOwner.sb.storage.from("documents").upload(path, PNG, { contentType: "image/png" });
    if (up.error) throw up.error;
  }
  const logo = await bOwner.sb.storage.from("branding").upload(`${B}/logo.png`, PNG, { contentType: "image/png", upsert: true });
  if (logo.error) throw logo.error;
  Object.assign(b, files);
  b.docShared1 = await ins(`insert into public.documents (cabinet_id, patient_id, kind, title, storage_path, shared_with_patient) values ($1, $2, 'xray', 'Radio', $3, true)`, [B, b.p1, files.doc1Shared]);
  b.docPrivate1 = await ins(`insert into public.documents (cabinet_id, patient_id, kind, title, storage_path, shared_with_patient) values ($1, $2, 'xray', 'Pano', $3, false)`, [B, b.p1, files.doc1Private]);
  b.docShared2 = await ins(`insert into public.documents (cabinet_id, patient_id, kind, title, storage_path, shared_with_patient) values ($1, $2, 'xray', 'Radio', $3, true)`, [B, b.p2, files.doc2Shared]);

  b.quote1 = await ins(`insert into public.quotes (cabinet_id, patient_id, status) values ($1, $2, 'sent')`, [B, b.p1]);
  b.quoteItem1 = await ins(`insert into public.quote_items (cabinet_id, quote_id, label, unit_price_gnf) values ($1, $2, 'Couronne', 900000)`, [B, b.quote1]);
  b.quote2 = await ins(`insert into public.quotes (cabinet_id, patient_id, status) values ($1, $2, 'sent')`, [B, b.p2]);
  b.inv1 = await ins(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2)`, [B, b.p1]);
  b.invItem1 = await ins(`insert into public.invoice_items (cabinet_id, invoice_id, label, unit_price_gnf) values ($1, $2, 'Soin', 300000)`, [B, b.inv1]);
  await q(`update public.invoices set status = 'issued' where id = $1`, [b.inv1]);
  b.pay1 = await ins(`insert into public.payments (cabinet_id, invoice_id, amount_gnf, method) values ($1, $2, 50000, 'cash')`, [B, b.inv1]);
  b.inst1 = await ins(`insert into public.payment_installments (cabinet_id, invoice_id, due_date, amount_gnf) values ($1, $2, current_date + 30, 100000)`, [B, b.inv1]);
  b.inv1Draft = await ins(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2)`, [B, b.p1]);
  b.inv2 = await ins(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2)`, [B, b.p2]);
  await q(`insert into public.invoice_items (cabinet_id, invoice_id, label, unit_price_gnf) values ($1, $2, 'Extraction', 200000)`, [B, b.inv2]);
  await q(`update public.invoices set status = 'issued' where id = $1`, [b.inv2]);
  b.tx2 = await ins(`insert into public.payment_transactions (cabinet_id, purpose, invoice_id, provider, amount_gnf, payer_phone, initiated_by, provider_reference)
                     values ($1, 'invoice', $2, 'orange_money', 200000, '+224620000000', $3, $4)`, [B, b.inv2, u2.id, `SBX-${randomUUID()}`]);
  b.subTx = await ins(`insert into public.payment_transactions (cabinet_id, purpose, provider, amount_gnf, payer_phone, initiated_by, subscription_cycle, status)
                       values ($1, 'subscription', 'orange_money', 150000, '+224620000001', $2, 'monthly', 'succeeded')`, [B, bOwner.id]);
  b.subPay = await ins(`insert into public.subscription_payments (cabinet_id, transaction_id, amount_gnf, dentist_count, cycle, period_start, period_end)
                        values ($1, $2, 150000, 1, 'monthly', now(), now() + interval '1 month')`, [B, b.subTx]);
  b.notif = await ins(`insert into public.notification_log (cabinet_id, appointment_id, patient_id, kind, channel, recipient, status)
                       values ($1, $2, $3, 'reminder_day_before', 'whatsapp', '+224620000000', 'sent')`, [B, b.appt1, b.p1]);
  b.invitation = await ins(`insert into public.invitations (cabinet_id, email, roles) values ($1, 'nouveau@audit.local', '{dentist}')`, [B]);
  b.invitationToken = (await one(`select token from public.invitations where id = $1`, [b.invitation])).token as string;
  b.template = (await one(`select id from public.message_templates where cabinet_id = $1 limit 1`, [B])).id as string;

  // --- Données du cabinet A (rôles internes) --------------------------------------------
  a.patient = await ins(`insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'Ibrahima', 'Diallo')`, [A]);
  await q(`insert into public.patient_medical (patient_id, cabinet_id, alerts) values ($1, $2, '{diabetes}')`, [a.patient, A]);
  a.note = await ins(`insert into public.clinical_notes (cabinet_id, patient_id, author_id, body) values ($1, $2, $3, 'note A')`, [A, a.patient, aOwner.id]);
  await q(`insert into public.tooth_records (cabinet_id, patient_id, tooth) values ($1, $2, 11)`, [A, a.patient]);
  a.plan = await ins(`insert into public.treatment_plans (cabinet_id, patient_id, dentist_id, title) values ($1, $2, $3, 'Plan A')`, [A, a.patient, aOwner.id]);
  await q(`insert into public.treatment_plan_items (cabinet_id, plan_id, label, unit_price_gnf) values ($1, $2, 'x', 1)`, [A, a.plan]);
  await q(`insert into public.prescriptions (cabinet_id, patient_id, dentist_id) values ($1, $2, $3)`, [A, a.patient, aOwner.id]);
  a.xrayPath = `${A}/${a.patient}/${randomUUID()}-radio.png`;
  a.adminPath = `${A}/${a.patient}/${randomUUID()}-assurance.png`;
  for (const path of [a.xrayPath, a.adminPath]) {
    const up = await aOwner.sb.storage.from("documents").upload(path, PNG, { contentType: "image/png" });
    if (up.error) throw up.error;
  }
  a.xray = await ins(`insert into public.documents (cabinet_id, patient_id, kind, title, storage_path) values ($1, $2, 'xray', 'Radio', $3)`, [A, a.patient, a.xrayPath]);
  a.adminDoc = await ins(`insert into public.documents (cabinet_id, patient_id, kind, title, storage_path) values ($1, $2, 'administrative', 'Assurance', $3)`, [A, a.patient, a.adminPath]);
  a.invoice = await ins(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2)`, [A, a.patient]);
  await q(`insert into public.invoice_items (cabinet_id, invoice_id, label, unit_price_gnf) values ($1, $2, 'Soin', 100000)`, [A, a.invoice]);
  await q(`update public.invoices set status = 'issued' where id = $1`, [a.invoice]);

  snapshot = await fingerprintB();
}, 120_000);

afterAll(async () => {
  await db?.end();
});

/** Tous les acteurs extérieurs au cabinet B (ou qui l'ont quitté). */
const outsiders = () =>
  [
    ["admin+dentiste de A", aOwner],
    ["dentiste de A", aDentist],
    ["secrétaire de A", aAssistant],
    ["comptable de A", aAccountant],
    ["admin (sans rôle dentiste) de A", aAdminOnly],
    ["ancien membre désactivé de B", bFormer],
    ["membre retiré de B", bRemoved],
  ] as const;

// ---------------------------------------------------------------------------------------
// a. Isolation entre cabinets
// ---------------------------------------------------------------------------------------

describe("a. isolation entre cabinets (API REST, stockage, RPC)", () => {
  /** [table, colonne d'identifiant, clé de b] */
  const READ_TARGETS: [string, string, string][] = [
    ["cabinets", "id", "B"],
    ["patients", "id", "p1"],
    ["patient_medical", "patient_id", "p1"],
    ["appointments", "id", "appt1"],
    ["clinical_notes", "id", "note"],
    ["tooth_records", "id", "tooth"],
    ["treatment_plans", "id", "plan"],
    ["treatment_plan_items", "id", "planItem"],
    ["prescriptions", "id", "rx1"],
    ["documents", "id", "docShared1"],
    ["quotes", "id", "quote1"],
    ["quote_items", "id", "quoteItem1"],
    ["invoices", "id", "inv1"],
    ["invoice_items", "id", "invItem1"],
    ["payment_installments", "id", "inst1"],
    ["payments", "id", "pay1"],
    ["payment_transactions", "id", "tx2"],
    ["subscription_payments", "id", "subPay"],
    ["chairs", "id", "chair"],
    ["appointment_types", "id", "type"],
    ["acts", "id", "act"],
    ["practitioner_schedules", "id", "schedule"],
    ["time_off", "id", "timeOff"],
    ["message_templates", "id", "template"],
    ["notification_log", "id", "notif"],
    ["invitations", "id", "invitation"],
  ];
  const idOf = (key: string) => (key === "B" ? B : b[key]);

  it("contrôle positif : le praticien de B lit bien ses propres données", async () => {
    for (const [table, col, key] of READ_TARGETS) {
      const { data, error } = await bOwner.sb.from(table).select("*").eq(col, idOf(key));
      expect(error, table).toBeNull();
      expect(data!.length, table).toBe(1);
    }
  });

  it("aucun rôle de A (ni ancien membre de B, ni anonyme) ne lit une ligne de B", async () => {
    for (const [label, u] of [...outsiders(), ["anonyme", { sb: anon }] as const]) {
      for (const [table, col, key] of READ_TARGETS) {
        const byId = await u.sb.from(table).select("*").eq(col, idOf(key));
        expect(byId.data ?? [], `${label} / ${table}`).toEqual([]);
        if (table !== "cabinets") {
          const byCab = await u.sb.from(table).select("*").eq("cabinet_id", B);
          expect(byCab.data ?? [], `${label} / ${table} (cabinet_id)`).toEqual([]);
        }
      }
      for (const table of ["audit_log", "memberships", "cabinet_counters"]) {
        const r = await u.sb.from(table).select("*").eq("cabinet_id", B);
        // L'ancien membre voit sa propre ligne de membre (désactivée), rien d'autre.
        const rows = (r.data ?? []).filter((x: { user_id?: string }) => !(table === "memberships" && x.user_id === (u as U).id));
        expect(rows, `${label} / ${table}`).toEqual([]);
      }
      const secrets = await u.sb.from("payment_transaction_secrets").select("*");
      expect(secrets.data ?? [], `${label} / secrets`).toEqual([]);
      const profiles = await u.sb.from("profiles").select("id").eq("id", bOwner.id);
      expect(profiles.data ?? [], `${label} / profil du praticien de B`).toEqual([]);
    }
  });

  it("aucun rôle de A ne crée de ligne dans B (RLS 42501), y compris s'inviter comme admin", async () => {
    const soon = new Date(Date.now() + 50 * 86400_000).toISOString();
    const later = new Date(Date.now() + 50 * 86400_000 + 1800_000).toISOString();
    for (const [label, u] of outsiders()) {
      const payloads: [string, Record<string, unknown>][] = [
        ["cabinets", { id: B, name: "pwned", slug: bSlug }],
        ["memberships", { cabinet_id: B, user_id: u.id, roles: ["admin", "dentist"] }],
        ["invitations", { cabinet_id: B, email: u.email, roles: ["admin"] }],
        ["chairs", { cabinet_id: B, name: "x" }],
        ["appointment_types", { cabinet_id: B, name: "x" }],
        ["acts", { cabinet_id: B, label: "x", price_gnf: 1 }],
        ["practitioner_schedules", { cabinet_id: B, dentist_id: u.id, weekday: 2, start_time: "08:00", end_time: "09:00" }],
        ["time_off", { cabinet_id: B, starts_at: soon, ends_at: later }],
        ["patients", { cabinet_id: B, first_name: "x", last_name: "y" }],
        ["patient_medical", { cabinet_id: B, patient_id: b.p3 }],
        ["appointments", { cabinet_id: B, patient_id: b.p1, dentist_id: bOwner.id, starts_at: soon, ends_at: later }],
        ["clinical_notes", { cabinet_id: B, patient_id: b.p1, author_id: u.id, body: "x" }],
        ["tooth_records", { cabinet_id: B, patient_id: b.p3, tooth: 11 }],
        ["treatment_plans", { cabinet_id: B, patient_id: b.p1, dentist_id: bOwner.id, title: "x" }],
        ["treatment_plan_items", { cabinet_id: B, plan_id: b.plan, label: "x", unit_price_gnf: 1 }],
        ["prescriptions", { cabinet_id: B, patient_id: b.p1, dentist_id: bOwner.id }],
        ["documents", { cabinet_id: B, patient_id: b.p1, title: "x", kind: "administrative", storage_path: `${B}/${b.p1}/x.png` }],
        ["quotes", { cabinet_id: B, patient_id: b.p1 }],
        ["quote_items", { cabinet_id: B, quote_id: b.quote1, label: "x", unit_price_gnf: 1 }],
        ["invoices", { cabinet_id: B, patient_id: b.p1 }],
        ["invoice_items", { cabinet_id: B, invoice_id: b.inv1, label: "x", unit_price_gnf: 1 }],
        ["payment_installments", { cabinet_id: B, invoice_id: b.inv1, due_date: "2027-01-01", amount_gnf: 1 }],
        ["payments", { cabinet_id: B, invoice_id: b.inv1, amount_gnf: 250000, method: "cash" }],
        ["payment_transactions", { cabinet_id: B, purpose: "invoice", invoice_id: b.inv1, provider: "orange_money", amount_gnf: 1, payer_phone: "+224620000000", status: "succeeded" }],
        ["subscription_payments", { cabinet_id: B, amount_gnf: 1, dentist_count: 1, cycle: "yearly", period_start: soon, period_end: later }],
        ["message_templates", { cabinet_id: B, kind: "otp", channel: "sms", body: "x" }],
        ["notification_log", { cabinet_id: B, kind: "otp", channel: "sms", recipient: "x" }],
        ["audit_log", { cabinet_id: B, action: "x", table_name: "x" }],
        ["cabinet_counters", { cabinet_id: B, kind: "invoice", year: 2026, value: 0 }],
        ["payment_transaction_secrets", { transaction_id: b.tx2, secret: "x" }],
      ];
      for (const [table, row] of payloads) {
        const { error } = await u.sb.from(table).insert(row);
        expect(error?.code, `${label} / insert ${table}`).toBe("42501");
      }
    }
  });

  it("aucun rôle de A ne modifie ni ne supprime une ligne de B", async () => {
    const changes: [string, string, Record<string, unknown>][] = [
      ["cabinets", B, { name: "pwned", public_page_enabled: false }],
      ["patients", b.p1, { deleted_at: new Date().toISOString(), phone: "+224600000000" }],
      ["patient_medical", b.p1, { allergies: "x" }],
      ["appointments", b.appt1, { status: "cancelled" }],
      ["clinical_notes", b.note, { body: "x" }],
      ["prescriptions", b.rx1, { shared_with_patient: false }],
      ["documents", b.docShared1, { kind: "administrative" }],
      ["invoices", b.inv1, { status: "cancelled" }],
      ["payments", b.pay1, { status: "refunded" }],
      ["payment_transactions", b.tx2, { status: "succeeded" }],
      ["memberships", b.membership, { roles: ["accountant"], active: false }],
      ["invitations", b.invitation, { email: "x@x" }],
      ["message_templates", b.template, { body: "pwned" }],
      ["acts", b.act, { price_gnf: 1 }],
    ];
    for (const [label, u] of outsiders()) {
      for (const [table, id, patch] of changes) {
        const col = table === "patient_medical" ? "patient_id" : "id";
        const up = await u.sb.from(table).update(patch).eq(col, id).select();
        expect(up.data ?? [], `${label} / update ${table}`).toEqual([]);
        const del = await u.sb.from(table).delete().eq(col, id).select();
        expect(del.data ?? [], `${label} / delete ${table}`).toEqual([]);
      }
      // Rattacher la membre de B à soi ou se donner des rôles dans B.
      const m = await u.sb.from("memberships").update({ user_id: u.id, active: true, deleted_at: null }).eq("cabinet_id", B).select();
      expect(m.data ?? [], `${label} / memberships de B`).toEqual([]);
    }
  });

  it("stockage : ni lecture, ni liste, ni dépôt, ni remplacement, ni suppression dans les dossiers de B", async () => {
    for (const [label, u] of [...outsiders(), ["anonyme", { sb: anon, id: "" }] as const]) {
      const dl = await u.sb.storage.from("documents").download(b.doc1Shared);
      expect(dl.data, `${label} / download`).toBeNull();
      const signed = await u.sb.storage.from("documents").createSignedUrl(b.doc1Private, 60);
      expect(signed.data, `${label} / signed url`).toBeNull();
      const list = await u.sb.storage.from("documents").list(`${B}/${b.p1}`);
      expect(list.data ?? [], `${label} / list`).toEqual([]);
      const up = await u.sb.storage.from("documents").upload(`${B}/${b.p1}/${randomUUID()}-x.png`, PNG, { contentType: "image/png" });
      expect(up.error, `${label} / upload documents`).not.toBeNull();
      const over = await u.sb.storage.from("documents").upload(b.doc1Shared, PNG, { contentType: "image/png", upsert: true });
      expect(over.error, `${label} / overwrite documents`).not.toBeNull();
      await u.sb.storage.from("documents").remove([b.doc1Shared, b.doc1Private]);
      const logo = await u.sb.storage.from("branding").upload(`${B}/logo.png`, PNG, { contentType: "image/png", upsert: true });
      expect(logo.error, `${label} / logo de B`).not.toBeNull();
      await u.sb.storage.from("branding").remove([`${B}/logo.png`]);
    }
    // Les fichiers de B sont intacts et lisibles par B.
    expect((await bOwner.sb.storage.from("documents").download(b.doc1Shared)).error).toBeNull();
    expect((await bOwner.sb.storage.from("documents").download(b.doc1Private)).error).toBeNull();
  });

  it("RPC : aucune fonction n'expose ni ne modifie les données de B", async () => {
    for (const [label, u] of outsiders()) {
      const calls: [string, Record<string, unknown>][] = [
        ["log_patient_view", { p_patient: b.p1 }],
        ["active_dentist_count", { p_cabinet: B }],
        ["cancel_online", { p_appointment: b.appt1 }],
        ["accept_invitation", { p_token: b.invitationToken }],
        ["admin_cabinets", {}],
        ["admin_metrics", {}],
        ["complete_transaction", { p_transaction: b.tx2, p_status: "succeeded" }],
        ["expire_subscriptions", {}],
        ["reminders_cron_secret", {}],
      ];
      for (const [fn, args] of calls) {
        const { error } = await u.sb.rpc(fn, args);
        expect(error, `${label} / ${fn}`).not.toBeNull();
      }
      const pc = await u.sb.rpc("portal_cabinets");
      expect(JSON.stringify(pc.data ?? []), `${label} / portal_cabinets`).not.toContain(B);
    }
    // Le schéma interne n'est pas exposé par l'API.
    const internal = createClient(URL_, ANON, { ...opts, db: { schema: "app" } });
    const r = await internal.rpc("next_counter", { p_cabinet: B, p_kind: "invoice", p_year: 2026 });
    expect(r.error).not.toBeNull();
  });

  it("aucune des attaques n'a modifié une ligne ou un fichier de B", async () => {
    expect(await fingerprintB()).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------------------
// b. Isolation entre patients
// ---------------------------------------------------------------------------------------

describe("b. isolation entre patients (espace patient)", () => {
  it("U1 ne voit que ses propres données, jamais celles de U2 (même cabinet)", async () => {
    const own = (rows: { id: string }[] | null) => (rows ?? []).map((r) => r.id).sort();
    const pats = await u1.sb.from("patients").select("id");
    expect(own(pats.data)).toEqual([b.p1]);
    expect(own((await u1.sb.from("appointments").select("id")).data)).toEqual([b.appt1]);
    expect(own((await u1.sb.from("invoices").select("id")).data)).toEqual([b.inv1]); // ni brouillon, ni facture de U2
    expect(own((await u1.sb.from("quotes").select("id")).data)).toEqual([b.quote1]);
    expect(own((await u1.sb.from("prescriptions").select("id")).data)).toEqual([b.rx1]); // pas l'ordonnance non partagée
    expect(own((await u1.sb.from("documents").select("id")).data)).toEqual([b.docShared1]);
    expect(own((await u1.sb.from("payments").select("id")).data)).toEqual([b.pay1]);
    expect(own((await u1.sb.from("invoice_items").select("id")).data)).toEqual([b.invItem1]);
    expect(own((await u1.sb.from("quote_items").select("id")).data)).toEqual([b.quoteItem1]);
    expect((await u1.sb.from("payment_transactions").select("id")).data).toEqual([]);
    // Même en visant explicitement les identifiants de U2.
    for (const [table, id] of [
      ["patients", b.p2], ["appointments", b.appt2], ["invoices", b.inv2], ["quotes", b.quote2],
      ["prescriptions", b.rx2], ["documents", b.docShared2], ["payment_transactions", b.tx2],
    ]) {
      expect((await u1.sb.from(table).select("*").eq("id", id)).data, table).toEqual([]);
    }
  });

  it("U1 ne lit rien du dossier clinique ni des données internes du cabinet", async () => {
    for (const table of [
      "clinical_notes", "patient_medical", "tooth_records", "treatment_plans", "treatment_plan_items", "cabinets",
      "chairs", "acts", "appointment_types", "message_templates", "notification_log", "audit_log", "invitations",
      "time_off", "practitioner_schedules", "subscription_payments", "payment_installments", "cabinet_counters",
    ]) {
      expect((await u1.sb.from(table).select("*")).data ?? [], table).toEqual([]);
    }
    expect((await u1.sb.from("memberships").select("*")).data).toEqual([]);
    expect(((await u1.sb.from("profiles").select("id")).data ?? []).map((p) => p.id)).toEqual([u1.id]);
  });

  it("stockage : U1 lit son document partagé, pas son document non partagé ni celui de U2", async () => {
    expect((await u1.sb.storage.from("documents").download(b.doc1Shared)).error).toBeNull();
    expect((await u1.sb.storage.from("documents").download(b.doc1Private)).data).toBeNull();
    expect((await u1.sb.storage.from("documents").download(b.doc2Shared)).data).toBeNull();
    expect((await u1.sb.storage.from("documents").createSignedUrl(b.doc2Shared, 60)).data).toBeNull();
    expect((await u1.sb.storage.from("documents").list(`${B}/${b.p2}`)).data ?? []).toEqual([]);
    const up = await u1.sb.storage.from("documents").upload(`${B}/${b.p1}/${randomUUID()}-x.png`, PNG, { contentType: "image/png" });
    expect(up.error).not.toBeNull();
  });

  it("RPC portail : pas d'action sur le RDV d'un autre, pas d'énumération", async () => {
    const c = await u1.sb.rpc("cancel_online", { p_appointment: b.appt2 });
    expect(c.error?.message).toBe("not_found");
    const pc = await u1.sb.rpc("portal_cabinets");
    expect(pc.error).toBeNull();
    const cabs = pc.data as { id: string; patient_ids: string[] }[];
    expect(cabs.map((x) => x.id)).toEqual([B]);
    expect(cabs[0].patient_ids).toEqual([b.p1]);
    expect(JSON.stringify(cabs)).not.toContain(b.p2);

    // Page publique et créneaux (anonyme) : aucune donnée patient.
    const pub = await anon.rpc("public_cabinet", { p_slug: bSlug });
    expect(Object.keys(pub.data as object).sort()).toEqual(
      ["address", "appointment_types", "city", "dentists", "description", "email", "id", "logo_path", "name",
       "online_booking_enabled", "opening_hours", "phone", "slug", "timezone"].sort(),
    );
    expect(JSON.stringify(pub.data)).not.toMatch(/Bah|Camara|Sow|patient/i);
    const day = b.day;
    const slots = await anon.rpc("available_slots", { p_slug: bSlug, p_type: b.type, p_date: day });
    expect(slots.error).toBeNull();
    expect((slots.data as object[]).length).toBeGreaterThan(0);
    for (const s of slots.data as object[]) expect(Object.keys(s).sort()).toEqual(["ends_at", "starts_at"]);
    // Le créneau occupé par U2 n'apparaît pas, sans révéler qui l'occupe.
    expect((slots.data as { starts_at: string }[]).some((s) => s.starts_at.startsWith(`${day}T10:00`))).toBe(false);
  });

  it("attaque : s'inscrire avec le téléphone d'un patient (sans code) ne donne accès à rien", async () => {
    // Inscription { phone, password } par l'API publique, comme un attaquant.
    const attacker = createClient(URL_, ANON, opts);
    const { data, error } = await attacker.auth.signUp({ phone: b.p3Phone, password: PASSWORD });
    // Confirmations SMS actives (réglage attendu en production) : l'attaque échoue dès ici.
    if (error || !data.session) return;
    // Configuration locale : confirmations SMS désactivées, le numéro est marqué « confirmé »
    // sans code. C'est ce qui rendait l'attaque possible avant 20261026020000.
    const row = await one(`select phone_confirmed_at from auth.users where id = $1`, [data.user!.id]);
    expect(row.phone_confirmed_at).not.toBeNull();
    // L'ancienne règle (téléphone confirmé suffit) aurait accepté ce compte.
    const oldRule = await one(`select app.phone_digits(phone) d from auth.users where id = $1 and phone_confirmed_at is not null`, [data.user!.id]);
    expect(oldRule.d).toBe(b.p3Phone);
    const linked = await attacker.rpc("link_portal_patients");
    expect(linked.error).toBeNull();
    expect(linked.data).toBe(0);
    expect((await attacker.from("patients").select("id")).data).toEqual([]);
    const booked = await attacker.rpc("book_online", { p_slug: bSlug, p_type: b.type, p_starts_at: new Date().toISOString() });
    expect(booked.error?.message).toBe("phone_not_verified");
    expect((await one(`select portal_user_id from public.patients where id = $1`, [b.p3])).portal_user_id).toBeNull();
  });

  it("téléphone vérifié : seuls les comptes « téléphone seul » (code OTP) sont rattachés", async () => {
    const digits = randomPhone();
    const victim = await ins(`insert into public.patients (cabinet_id, first_name, last_name, phone) values ($1, 'V', 'W', $2)`, [B, "+" + digits]);
    /** Crée le compte (variante `extra`) et appelle link_portal_patients() en son nom, dans une transaction annulée. */
    const link = async (extra: string) => {
      const id = randomUUID();
      const [col, val] = extra ? extra.split("=") : [null, null];
      await q("begin");
      try {
        await q(`insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, created_at, updated_at${col ? ", " + col : ""})
                 values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), now(), now()${col ? ", " + val : ""})`,
          [id, digits]);
        await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: "authenticated" })]);
        await q("set local role authenticated");
        return (await one(`select public.link_portal_patients() as n`)).n as number;
      } finally {
        await q("rollback");
      }
    };
    // Compte email qui a changé de téléphone, compte avec mot de passe, compte anonyme : refusés.
    expect(await link(`email='${randomUUID()}@x.local'`)).toBe(0);
    expect(await link(`encrypted_password='$2a$10$abcdefghijklmnopqrstuv'`)).toBe(0);
    expect(await link(`is_anonymous=true`)).toBe(0);
    // Compte créé par signInWithOtp + verifyOtp : rattaché.
    expect(await link("")).toBe(1);
    expect((await one(`select portal_user_id from public.patients where id = $1`, [victim])).portal_user_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// c. Rôles dans un cabinet
// ---------------------------------------------------------------------------------------

describe("c. rôles dans le cabinet A", () => {
  const CLINICAL = ["clinical_notes", "tooth_records", "treatment_plans", "treatment_plan_items", "prescriptions"];

  it("tous les dentistes du cabinet voient tous les dossiers (choix du propriétaire), seul l'auteur modifie sa note", async () => {
    for (const t of CLINICAL) expect(((await aDentist.sb.from(t).select("id").eq("cabinet_id", A)).data ?? []).length, t).toBeGreaterThan(0);
    expect((await aDentist.sb.from("clinical_notes").select("id").eq("id", a.note)).data).toHaveLength(1);
    expect((await aDentist.sb.from("clinical_notes").update({ body: "modifiée" }).eq("id", a.note).select()).data).toEqual([]);
    expect((await aDentist.sb.storage.from("documents").download(a.xrayPath)).error).toBeNull();
  });

  it("secrétaire : ni notes cliniques, ni schéma, ni plans, ni ordonnances, ni radios ; alertes médicales oui", async () => {
    for (const t of CLINICAL) expect((await aAssistant.sb.from(t).select("id")).data ?? [], t).toEqual([]);
    expect(((await aAssistant.sb.from("documents").select("id")).data ?? []).map((d) => d.id)).toEqual([a.adminDoc]);
    expect((await aAssistant.sb.storage.from("documents").download(a.xrayPath)).data).toBeNull();
    expect((await aAssistant.sb.storage.from("documents").download(a.adminPath)).error).toBeNull();
    expect((await aAssistant.sb.from("patient_medical").select("patient_id")).data).toHaveLength(1);
    const note = await aAssistant.sb.from("clinical_notes").insert({ cabinet_id: A, patient_id: a.patient, author_id: aAssistant.id, body: "x" });
    expect(note.error?.code).toBe("42501");
    const xray = await aAssistant.sb.from("documents").insert({ cabinet_id: A, patient_id: a.patient, kind: "xray", title: "x", storage_path: `${A}/${a.patient}/x.png` });
    expect(xray.error?.code).toBe("42501");
    // Contournement : déclarer « administratif » une seconde ligne pointant vers la radio.
    const alias = await aAssistant.sb.from("documents").insert({ cabinet_id: A, patient_id: a.patient, kind: "administrative", title: "x", storage_path: a.xrayPath });
    expect(alias.error?.code).toBe("23505");
    expect((await aAssistant.sb.storage.from("documents").download(a.xrayPath)).data).toBeNull();
    expect((await aAssistant.sb.from("documents").update({ kind: "administrative" }).eq("id", a.xray).select()).data).toEqual([]);
    expect((await aAssistant.sb.from("audit_log").select("id")).data).toEqual([]);
  });

  it("comptable : aucune donnée médicale, aucune écriture", async () => {
    for (const t of [...CLINICAL, "patient_medical", "documents", "notification_log", "audit_log"]) {
      expect((await aAccountant.sb.from(t).select("*")).data ?? [], t).toEqual([]);
    }
    expect((await aAccountant.sb.storage.from("documents").download(a.adminPath)).data).toBeNull();
    expect((await aAccountant.sb.from("patients").select("id")).data).toHaveLength(1);
    expect((await aAccountant.sb.from("invoices").select("id")).data).toHaveLength(1);
    const writes: [string, Record<string, unknown>][] = [
      ["patients", { cabinet_id: A, first_name: "x", last_name: "y" }],
      ["invoices", { cabinet_id: A, patient_id: a.patient }],
      ["payments", { cabinet_id: A, invoice_id: a.invoice, amount_gnf: 100000, method: "cash" }],
      ["appointments", { cabinet_id: A, dentist_id: aOwner.id, starts_at: "2027-01-04T08:00:00Z", ends_at: "2027-01-04T08:30:00Z" }],
      ["patient_medical", { cabinet_id: A, patient_id: a.patient }],
    ];
    for (const [t, row] of writes) expect((await aAccountant.sb.from(t).insert(row)).error?.code, t).toBe("42501");
    expect((await aAccountant.sb.from("patients").update({ last_name: "x" }).eq("id", a.patient).select()).data).toEqual([]);
    expect((await aAccountant.sb.from("invoices").update({ status: "cancelled" }).eq("id", a.invoice).select()).data).toEqual([]);
    const up = await aAccountant.sb.storage.from("documents").upload(`${A}/${a.patient}/${randomUUID()}-x.png`, PNG, { contentType: "image/png" });
    expect(up.error).not.toBeNull();
  });

  it("admin sans rôle dentiste : pas de dossier clinique ; journal d'audit oui, y compris les changements de membres", async () => {
    for (const t of CLINICAL) expect((await aAdminOnly.sb.from(t).select("id")).data ?? [], t).toEqual([]);
    expect(((await aAdminOnly.sb.from("documents").select("id")).data ?? []).map((d) => d.id)).toEqual([a.adminDoc]);
    const m = await aAdminOnly.sb.from("memberships").update({ display_name: "Dr Test" }).eq("cabinet_id", A).eq("user_id", aDentist.id).select("id");
    expect(m.data).toHaveLength(1);
    const log = await aAdminOnly.sb.from("audit_log").select("action, table_name, record_id").eq("table_name", "memberships").eq("record_id", m.data![0].id);
    expect(log.data).toContainEqual({ action: "update", table_name: "memberships", record_id: m.data![0].id });
  });

  it("le journal trace l'ouverture d'un dossier (log_patient_view)", async () => {
    expect((await aAssistant.sb.rpc("log_patient_view", { p_patient: a.patient })).error).toBeNull();
    const row = await one(`select user_id, action from public.audit_log where patient_id = $1 and action = 'view' order by id desc limit 1`, [a.patient]);
    expect(row).toEqual({ user_id: aAssistant.id, action: "view" });
  });
});

// ---------------------------------------------------------------------------------------
// d. Paiements (routes /api réelles + écritures directes)
// ---------------------------------------------------------------------------------------

describe("d. paiements", () => {
  let initiate: (req: Request) => Promise<Response>;
  let status: (req: NextRequest) => Promise<Response>;
  let sandbox: (req: Request) => Promise<Response>;
  let webhook: (req: NextRequest, ctx: unknown) => Promise<Response>;
  let sign: (secret: string, p: { transaction_id: string; reference: string; status: "succeeded" | "failed" }) => { body: string; signature: string };

  beforeAll(async () => {
    initiate = (await import("@/app/api/payments/initiate/route")).POST;
    status = (await import("@/app/api/payments/status/route")).GET;
    sandbox = (await import("@/app/api/payments/sandbox/route")).POST;
    webhook = (await import("@/app/api/payments/webhook/[provider]/route")).POST as never;
    sign = (await import("@/lib/payments/providers/sandbox")).signedSandboxNotification;
  });

  const post = (u: U | null, body: unknown) =>
    initiate(
      new Request("http://localhost/api/payments/initiate", {
        method: "POST",
        headers: { "content-type": "application/json", ...(u ? { authorization: `Bearer ${u.token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const pay = (u: U | null, invoice: string, extra: Record<string, unknown> = {}) =>
    post(u, { purpose: "invoice", invoice_id: invoice, provider: "orange_money", phone: "620000000", ...extra });
  const getStatus = (u: U, id: string) =>
    status(new NextRequest(`http://localhost/api/payments/status?id=${id}`, { headers: { authorization: `Bearer ${u.token}` } }));
  const settle = (u: U, id: string, outcome = "succeeded") =>
    sandbox(
      new Request("http://localhost/api/payments/sandbox", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${u.token}` },
        body: JSON.stringify({ transaction_id: id, outcome }),
      }),
    );
  const hook = (body: string, signature?: string, provider = "orange_money") =>
    webhook(
      new NextRequest(`http://localhost/api/payments/webhook/${provider}`, {
        method: "POST",
        body,
        headers: signature ? { "x-nimba-sandbox-signature": signature } : {},
      }),
      { params: Promise.resolve({ provider }) },
    );
  const invoiceState = async (id: string) => one(`select status, paid_gnf::int paid from public.invoices where id = $1`, [id]);

  it("initiation : refusée sans jeton, pour une facture d'un autre cabinet, d'un autre patient, ou par le comptable", async () => {
    expect((await pay(null, b.inv1)).status).toBe(401);
    expect((await pay({ token: "faux.jeton.jwt" } as U, b.inv1)).status).toBe(401);
    for (const [, u] of outsiders()) expect((await pay(u, b.inv1)).status).toBe(403);
    expect((await pay(u1, b.inv2)).status).toBe(403);
    expect((await pay(aAccountant, a.invoice)).status).toBe(403);
    expect((await pay(u1, b.inv1Draft)).status).toBe(409);
  });

  it("initiation : le montant est vérifié côté serveur", async () => {
    expect((await pay(u1, b.inv1, { amount_gnf: 250001 })).status).toBe(409);
    expect((await pay(u1, b.inv1, { amount_gnf: -5 })).status).toBe(400);
    expect((await pay(u1, b.inv1, { amount_gnf: 10.5 })).status).toBe(400);
    const ok = await pay(u1, b.inv1);
    expect(ok.status).toBe(200);
    const { transaction_id } = (await ok.json()) as { transaction_id: string };
    const tx = await one(`select amount_gnf::int amount, status, initiated_by from public.payment_transactions where id = $1`, [transaction_id]);
    expect(tx).toEqual({ amount: 250000, status: "pending", initiated_by: u1.id });
    b.tx1 = transaction_id;
    expect(await invoiceState(b.inv1)).toEqual({ status: "partially_paid", paid: 50000 });
  });

  it("statut et simulation : invisibles pour un autre patient ou un autre cabinet", async () => {
    expect((await getStatus(u2, b.tx1)).status).toBe(404);
    expect((await getStatus(aOwner, b.tx1)).status).toBe(404);
    expect((await settle(u2, b.tx1)).status).toBe(404);
    expect((await settle(aOwner, b.tx1)).status).toBe(404);
    expect((await settle(u1, b.tx2)).status).toBe(404);
    expect((await getStatus(u1, b.tx1)).status).toBe(200);
  });

  it("webhook : refusé sans signature valide ; accepté une seule fois avec la bonne (idempotent)", async () => {
    const claim = { transaction_id: b.tx1, reference: `SBX-${b.tx1}`, status: "succeeded" as const };
    const body = JSON.stringify(claim);
    expect((await hook(body)).status).toBe(401);
    expect((await hook(body, "0".repeat(64))).status).toBe(401);
    expect((await hook(body, sign("mauvais-secret", claim).signature)).status).toBe(401);
    expect((await hook("pas du json", "x")).status).toBe(400);
    const unknown = sign(ENV.PAYMENTS_SANDBOX_SECRET, { ...claim, transaction_id: randomUUID(), reference: "SBX-inconnu" });
    expect((await hook(unknown.body, unknown.signature)).status).toBe(404);
    expect((await hook(body, undefined, "paypal")).status).toBe(404);
    expect(await invoiceState(b.inv1)).toEqual({ status: "partially_paid", paid: 50000 });

    const good = sign(ENV.PAYMENTS_SANDBOX_SECRET, claim);
    for (let i = 0; i < 3; i++) {
      const r = await hook(good.body, good.signature);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ status: "succeeded" });
    }
    const failed = sign(ENV.PAYMENTS_SANDBOX_SECRET, { ...claim, status: "failed" });
    expect(((await (await hook(failed.body, failed.signature)).json()) as { status: string }).status).toBe("succeeded");
    expect((await one(`select count(*)::int n from public.payments where transaction_id = $1`, [b.tx1])).n).toBe(1);
    expect(await invoiceState(b.inv1)).toEqual({ status: "paid", paid: 300000 });
    expect((await pay(u1, b.inv1)).status).toBe(409); // déjà payée
  });

  it("abonnement : réservé à l'admin du cabinet, montant fixé par le serveur, prolongé seulement par le webhook", async () => {
    const sub = (u: U, cabinet: string, extra: Record<string, unknown> = {}) =>
      post(u, { purpose: "subscription", cabinet_id: cabinet, provider: "orange_money", phone: "620000000", ...extra });
    for (const u of [aDentist, aAssistant, aAccountant, u1]) expect((await sub(u, A)).status).toBe(403);
    expect((await sub(aOwner, B)).status).toBe(403);
    expect((await sub(bFormer, B)).status).toBe(403);
    expect((await sub(aOwner, A, { amount_gnf: 1 })).status).toBe(409);
    const before = await one(`select subscription_status, current_period_end from public.cabinets where id = $1`, [A]);
    const ok = await sub(aOwner, A, { cycle: "yearly" });
    expect(ok.status).toBe(200);
    const { transaction_id } = (await ok.json()) as { transaction_id: string };
    expect(await one(`select subscription_status, current_period_end from public.cabinets where id = $1`, [A])).toEqual(before);
    const tx = await one(`select amount_gnf::int amount from public.payment_transactions where id = $1`, [transaction_id]);
    const price = await one(`select amount_gnf::int amount from public.subscription_price(public.active_dentist_count($1), 'yearly')`, [A]);
    expect(tx.amount).toBe(price.amount);
  });

  it("aucune écriture directe ne marque une facture ou un abonnement payé", async () => {
    // Paiement « en ligne » écrit par le client (même par le personnel).
    const fake = await aOwner.sb.from("payments").insert({ cabinet_id: A, invoice_id: a.invoice, amount_gnf: 100000, method: "orange_money", transaction_id: b.tx2 });
    expect(fake.error).not.toBeNull();
    // Paiement sur la facture d'un autre cabinet, rattaché à son propre cabinet.
    const cross = await aOwner.sb.from("payments").insert({ cabinet_id: A, invoice_id: b.inv2, amount_gnf: 200000, method: "cash" });
    expect(cross.error).not.toBeNull();
    // Le patient ne saisit pas de paiement au comptoir.
    const self = await u2.sb.from("payments").insert({ cabinet_id: B, invoice_id: b.inv2, amount_gnf: 200000, method: "cash" });
    expect(self.error?.code).toBe("42501");
    // Statut « payé » forcé.
    await aOwner.sb.from("invoices").update({ status: "paid", paid_gnf: 100000, total_gnf: 1 }).eq("id", a.invoice);
    expect(await invoiceState(a.invoice)).toEqual({ status: "issued", paid: 0 });
    // Transactions et abonnement : écriture serveur uniquement.
    const tx = await aOwner.sb.from("payment_transactions").insert({ cabinet_id: A, purpose: "subscription", provider: "orange_money", amount_gnf: 1, payer_phone: "+224620000000", subscription_cycle: "yearly", status: "succeeded" });
    expect(tx.error?.code).toBe("42501");
    expect((await aOwner.sb.rpc("complete_transaction", { p_transaction: b.tx2, p_status: "succeeded" })).error).not.toBeNull();
    const cab = await aOwner.sb.from("cabinets").update({ subscription_status: "active", current_period_end: "2099-01-01" }).eq("id", A);
    expect(cab.error).not.toBeNull();
    const sp = await aOwner.sb.from("subscription_payments").insert({ cabinet_id: A, amount_gnf: 1, dentist_count: 1, cycle: "yearly", period_start: "2026-01-01", period_end: "2099-01-01" });
    expect(sp.error?.code).toBe("42501");
    expect(await invoiceState(b.inv2)).toEqual({ status: "issued", paid: 0 });
    // Le personnel avec droits de facturation enregistre un paiement au comptoir.
    const counter = await aAssistant.sb.from("payments").insert({ cabinet_id: A, invoice_id: a.invoice, amount_gnf: 100000, method: "cash" });
    expect(counter.error).toBeNull();
    expect(await invoiceState(a.invoice)).toEqual({ status: "paid", paid: 100000 });
  });

  it("le mode simulation est inactif en production", async () => {
    process.env.VERCEL_ENV = "production";
    try {
      expect((await pay(u2, b.inv2)).status).toBe(503);
      expect((await settle(u2, b.tx2)).status).toBe(404);
      const n = sign(ENV.PAYMENTS_SANDBOX_SECRET, { transaction_id: b.tx2, reference: "x", status: "succeeded" });
      expect((await hook(n.body, n.signature)).status).toBe(503);
    } finally {
      delete process.env.VERCEL_ENV;
    }
    process.env.NIMBA_ENV = "production";
    try {
      expect((await pay(u2, b.inv2)).status).toBe(503);
    } finally {
      process.env.NIMBA_ENV = "development";
    }
    expect(await invoiceState(b.inv2)).toEqual({ status: "issued", paid: 0 });
  });
});

// ---------------------------------------------------------------------------------------
// e. Normes de sécurité de la base
// ---------------------------------------------------------------------------------------

describe("e. normes de sécurité de la base", () => {
  it("RLS activée sur toutes les tables exposées ; secrets sans aucun droit client", async () => {
    const rows = await q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
    const views = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind in ('v', 'm')`);
    expect(views).toEqual([]);
    const secrets = await one(`select has_table_privilege('anon', 'public.payment_transaction_secrets', 'select,insert,update,delete') a,
                                      has_table_privilege('authenticated', 'public.payment_transaction_secrets', 'select,insert,update,delete') b`);
    expect(secrets).toEqual({ a: false, b: false });
  });

  it("aucune politique DELETE ou FOR ALL, aucune politique « true » hors lecture publique voulue", async () => {
    const broad = await q(`select tablename, policyname from pg_policies where schemaname in ('public', 'storage') and cmd in ('ALL', 'DELETE')`);
    expect(broad).toEqual([]);
    const open = await q<{ policyname: string }>(
      `select policyname from pg_policies where schemaname in ('public', 'storage')
         and (qual in ('true', '(bucket_id = ''branding''::text)') or with_check = 'true') order by 1`,
    );
    expect(open.map((p) => p.policyname)).toEqual(["branding_bucket_read", "plans_read"]);
  });

  it("fonctions security definer : search_path fixe ; exécutables sans compte seulement pour la page publique", async () => {
    const noPath = await q(`select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname in ('public', 'app') and p.prosecdef
                              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(noPath).toEqual([]);
    const anonFns = await q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(anonFns.map((f) => f.proname)).toEqual(["available_slots", "public_cabinet", "subscription_price"]);
    const internal = await q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
    );
    // Seules les fonctions de droits utilisées par les politiques RLS restent appelables.
    expect(internal.map((f) => f.proname)).toEqual(["cabinet_writable", "can_write", "has_role", "is_member", "is_platform_admin"]);
    const serviceOnly = await q<{ proname: string; a: boolean; u: boolean }>(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('complete_transaction', 'expire_subscriptions', 'reminders_cron_secret')`,
    );
    expect(serviceOnly.every((f) => !f.a && !f.u)).toBe(true);
    expect(serviceOnly).toHaveLength(3);
  });

  it("journal d'audit : déclencheurs sur le dossier médical, les membres et les invitations", async () => {
    const audited = await q<{ t: string }>(
      `select c.relname t from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc p on p.oid = g.tgfoid
       where p.proname = 'audit_row' order by 1`,
    );
    expect(audited.map((r) => r.t)).toEqual(
      ["clinical_notes", "documents", "invitations", "memberships", "patient_medical", "patients", "prescriptions",
       "tooth_records", "treatment_plan_items", "treatment_plans"],
    );
  });

  it("schémas exposés par l'API : public et graphql_public seulement", async () => {
    for (const schema of ["app", "auth", "storage", "vault", "cron"]) {
      const r = await fetch(`${URL_}/rest/v1/rpc/x`, {
        method: "POST",
        headers: { apikey: ANON, "content-profile": schema, "content-type": "application/json" },
        body: "{}",
      });
      const j = (await r.json()) as { code?: string };
      expect(j.code, schema).toBe("PGRST106");
    }
  });
});
