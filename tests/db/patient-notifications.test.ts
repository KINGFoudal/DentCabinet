import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { asUser, connect, createCabinet, createUser } from "./helpers";

// File des messages WhatsApp aux patients (migration 20261027020000_patient_notifications.sql).

let db: Client;
let owner: { id: string };
let otherOwner: { id: string };
let cab: string;
let otherCab: string;

const phone = () => `+22466${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const future = (days = 2) => new Date(Date.now() + days * 86400000);
const iso = (d: Date) => d.toISOString();

async function newPatient(userId: string, cabinetId: string, p: { phone?: string | null; opt_in?: boolean } = {}) {
  return asUser(
    db,
    userId,
    async () => {
      const { rows } = await db.query(
        `insert into public.patients (cabinet_id, first_name, last_name, phone, whatsapp_opt_in) values ($1, 'Mariama', 'Diallo', $2, $3) returning id`,
        [cabinetId, p.phone === undefined ? phone() : p.phone, p.opt_in ?? true],
      );
      return rows[0].id as string;
    },
    true,
  );
}

/** Upsert comme le moteur de synchronisation (INSERT ... ON CONFLICT (id) DO UPDATE). */
async function upsert(userId: string, table: string, row: Record<string, unknown>) {
  return asUser(
    db,
    userId,
    async () => {
      const cols = Object.keys(row);
      const set = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
      const { rows } = await db.query(
        `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (id) do update set ${set} returning *`,
        cols.map((c) => row[c]),
      );
      return rows[0];
    },
    true,
  );
}

async function appointment(userId: string, cabinetId: string, patientId: string, startsAt = future(), extra: Record<string, unknown> = {}) {
  const id = (extra.id as string) ?? randomUUID();
  await upsert(userId, "appointments", {
    id,
    cabinet_id: cabinetId,
    patient_id: patientId,
    dentist_id: userId,
    starts_at: iso(startsAt),
    ends_at: iso(new Date(startsAt.getTime() + 30 * 60000)),
    status: "scheduled",
    ...extra,
  });
  return id;
}

const queue = async (where: string, params: unknown[]) =>
  (await db.query(`select * from public.patient_notifications where ${where} order by created_at, event`, params)).rows;

async function setCabinet(cabinetId: string, patch: Record<string, unknown>) {
  const cols = Object.keys(patch);
  await db.query(`update public.cabinets set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`, [cabinetId, ...cols.map((c) => patch[c])]);
}

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db);
  otherOwner = await createUser(db);
  cab = await createCabinet(db, owner.id);
  otherCab = await createCabinet(db, otherOwner.id);
  // Créneaux uniques : pas de chevauchement de praticien entre les tests.
});

afterAll(async () => {
  await db.end();
});

let slot = 0;
const nextSlot = () => new Date(future(3).getTime() + ++slot * 3600000);

describe("rendez-vous", () => {
  it("met en file une confirmation au patient à la création, une seule fois", async () => {
    const patient = await newPatient(owner.id, cab);
    const start = nextSlot();
    const id = await appointment(owner.id, cab, patient, start);
    // Nouvel envoi de la même ligne par la synchronisation, puis modification sans effet sur l'heure.
    await appointment(owner.id, cab, patient, start, { id });
    await upsert(owner.id, "appointments", { id, cabinet_id: cab, patient_id: patient, dentist_id: owner.id, starts_at: iso(start), ends_at: iso(new Date(start.getTime() + 1800000)), status: "confirmed", notes: "x" });
    const rows = await queue("appointment_id = $1", [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "appointment_created", patient_id: patient, cabinet_id: cab, status: "pending", attempts: 0 });
  });

  it("rien pour un patient sans téléphone, opposé à WhatsApp, ou un RDV passé", async () => {
    const noPhone = await newPatient(owner.id, cab, { phone: null });
    const optOut = await newPatient(owner.id, cab, { opt_in: false });
    const ok = await newPatient(owner.id, cab);
    const a1 = await appointment(owner.id, cab, noPhone, nextSlot());
    const a2 = await appointment(owner.id, cab, optOut, nextSlot());
    const a3 = await appointment(owner.id, cab, ok, new Date(Date.now() - 86400000 - ++slot * 3600000));
    expect(await queue("appointment_id = any($1)", [[a1, a2, a3]])).toHaveLength(0);
  });

  it("jamais vers un membre du personnel ni le numéro du cabinet", async () => {
    const staffPhone = phone();
    await db.query(`update public.profiles set phone = $2 where id = $1`, [owner.id, staffPhone]);
    const cabinetPhone = phone();
    await setCabinet(cab, { phone: cabinetPhone });
    const p1 = await newPatient(owner.id, cab, { phone: staffPhone });
    const p2 = await newPatient(owner.id, cab, { phone: cabinetPhone });
    const a1 = await appointment(owner.id, cab, p1, nextSlot());
    const a2 = await appointment(owner.id, cab, p2, nextSlot());
    expect(await queue("appointment_id = any($1)", [[a1, a2]])).toHaveLength(0);
    // Aucun message de la file ne vise le téléphone d'un membre ou du cabinet.
    const { rows } = await db.query(
      `select n.id from public.patient_notifications n
       join public.patients p on p.id = n.patient_id
       where n.cabinet_id = $1 and (app.phone_digits(p.phone) = app.phone_digits($2) or app.phone_digits(p.phone) = app.phone_digits($3))`,
      [cab, staffPhone, cabinetPhone],
    );
    expect(rows).toHaveLength(0);
    await db.query(`update public.profiles set phone = null where id = $1`, [owner.id]);
    await setCabinet(cab, { phone: null });
  });

  it("cabinet qui désactive : aucun message", async () => {
    await setCabinet(cab, { notify_appointment_created: false });
    try {
      const patient = await newPatient(owner.id, cab);
      const id = await appointment(owner.id, cab, patient, nextSlot());
      expect(await queue("appointment_id = $1", [id])).toHaveLength(0);
    } finally {
      await setCabinet(cab, { notify_appointment_created: true });
    }
  });

  it("déplacement puis annulation après une confirmation envoyée ; suppression = plus rien", async () => {
    const patient = await newPatient(owner.id, cab);
    const start = nextSlot();
    const id = await appointment(owner.id, cab, patient, start);
    // Tant que la confirmation n'est pas partie, un déplacement ne crée pas de second message.
    const moved0 = new Date(start.getTime() + 15 * 60000);
    await appointment(owner.id, cab, patient, moved0, { id });
    expect((await queue("appointment_id = $1", [id])).map((r) => r.event)).toEqual(["appointment_created"]);

    await db.query(`update public.patient_notifications set status = 'sent', sent_at = now() where appointment_id = $1`, [id]);
    const moved = new Date(start.getTime() + 30 * 60000);
    await appointment(owner.id, cab, patient, moved, { id });
    let rows = await queue("appointment_id = $1 and event = 'appointment_moved'", [id]);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].ref_starts_at).getTime()).toBe(moved.getTime());

    await appointment(owner.id, cab, patient, moved, { id, status: "cancelled" });
    rows = await queue("appointment_id = $1", [id]);
    expect(rows.map((r) => [r.event, r.status])).toEqual(
      expect.arrayContaining([
        ["appointment_moved", "skipped"],
        ["appointment_cancelled", "pending"],
      ]),
    );

    await appointment(owner.id, cab, patient, moved, { id, status: "cancelled", deleted_at: iso(new Date()) });
    rows = await queue("appointment_id = $1 and status in ('pending', 'failed')", [id]);
    expect(rows).toHaveLength(0);
  });

  it("annulation avant tout envoi : la confirmation est abandonnée, pas de message d'annulation", async () => {
    const patient = await newPatient(owner.id, cab);
    const start = nextSlot();
    const id = await appointment(owner.id, cab, patient, start);
    await appointment(owner.id, cab, patient, start, { id, status: "cancelled" });
    const rows = await queue("appointment_id = $1", [id]);
    expect(rows.map((r) => [r.event, r.status])).toEqual([["appointment_created", "skipped"]]);
  });

  it("pas de message pour un autre cabinet, ni lisible par lui", async () => {
    const theirs = await newPatient(otherOwner.id, otherCab);
    const id = await appointment(otherOwner.id, otherCab, theirs, nextSlot());
    const rows = await queue("appointment_id = $1", [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cabinet_id).toBe(otherCab);
    const seen = await asUser(db, owner.id, async () => (await db.query(`select id from public.patient_notifications where cabinet_id = $1`, [otherCab])).rows);
    expect(seen).toHaveLength(0);
    const mine = await asUser(db, otherOwner.id, async () => (await db.query(`select id from public.patient_notifications where appointment_id = $1`, [id])).rows);
    expect(mine).toHaveLength(1);
  });

  it("les clients ne peuvent ni écrire dans la file ni appeler les fonctions internes", async () => {
    const patient = await newPatient(owner.id, cab);
    await expect(
      asUser(db, owner.id, () =>
        db.query(`insert into public.patient_notifications (cabinet_id, patient_id, event, event_key) values ($1, $2, 'appointment_created', 'x')`, [cab, patient]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(db, owner.id, () => db.query(`select app.enqueue_patient_notification($1, $2, 'appointment_created', 'y')`, [cab, patient])),
    ).rejects.toThrow();
  });
});

describe("factures et paiements", () => {
  async function draftInvoice(patient: string) {
    const inv = await upsert(owner.id, "invoices", { id: randomUUID(), cabinet_id: cab, patient_id: patient, status: "draft" });
    await asUser(
      db,
      owner.id,
      () =>
        db.query(`insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf) values ($1, $2, 'Détartrage', 1, 300000)`, [
          cab,
          inv.id,
        ]),
      true,
    );
    return inv.id as string;
  }

  it("désactivé par défaut : pas de message de facture", async () => {
    const { rows } = await db.query(`select notify_invoice_issued, notify_payment_received, notify_appointment_created from public.cabinets where id = $1`, [cab]);
    expect(rows[0]).toEqual({ notify_invoice_issued: false, notify_payment_received: false, notify_appointment_created: true });
    const patient = await newPatient(owner.id, cab);
    const id = await draftInvoice(patient);
    await upsert(owner.id, "invoices", { id, cabinet_id: cab, patient_id: patient, status: "issued" });
    expect(await queue("invoice_id = $1", [id])).toHaveLength(0);
  });

  it("émission (brouillon -> émise) : un message au patient, pas de doublon ; paiement reçu", async () => {
    await setCabinet(cab, { notify_invoice_issued: true, notify_payment_received: true });
    try {
      const patient = await newPatient(owner.id, cab);
      const id = await draftInvoice(patient);
      expect(await queue("invoice_id = $1", [id])).toHaveLength(0);
      await upsert(owner.id, "invoices", { id, cabinet_id: cab, patient_id: patient, status: "issued" });
      await upsert(owner.id, "invoices", { id, cabinet_id: cab, patient_id: patient, status: "issued", notes: "renvoi" });
      let rows = await queue("invoice_id = $1", [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ event: "invoice_issued", patient_id: patient, status: "pending" });

      const pay = await upsert(owner.id, "payments", { id: randomUUID(), cabinet_id: cab, invoice_id: id, amount_gnf: 100000, method: "cash" });
      rows = await queue("invoice_id = $1 and event = 'payment_received'", [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].payment_id).toBe(pay.id);

      // Paiement annulé : son message n'est plus envoyé.
      await upsert(owner.id, "payments", { id: pay.id, cabinet_id: cab, invoice_id: id, amount_gnf: 100000, method: "cash", deleted_at: iso(new Date()) });
      rows = await queue("payment_id = $1", [pay.id]);
      expect(rows[0].status).toBe("skipped");
    } finally {
      await setCabinet(cab, { notify_invoice_issued: false, notify_payment_received: false });
    }
  });
});
