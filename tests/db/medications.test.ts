import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

let db: Client;
let owner: { id: string }; // admin + dentiste
let dentist: { id: string };
let assistant: { id: string };
let accountant: { id: string };
let adminOnly: { id: string };
let otherOwner: { id: string };
let cab: string;
let otherCab: string;
let patient: string;
let patient2: string;
let otherPatient: string;

async function newPatient(userId: string, cabinetId: string) {
  return asUser(
    db,
    userId,
    async () =>
      (await db.query(`insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'Fanta', 'Camara') returning id`, [cabinetId])).rows[0]
        .id as string,
    true,
  );
}

async function newInvoice(userId: string, cabinetId: string, patientId: string, appointmentId: string | null = null) {
  return asUser(
    db,
    userId,
    async () =>
      (
        await db.query(`insert into public.invoices (cabinet_id, patient_id, appointment_id) values ($1, $2, $3) returning id`, [
          cabinetId,
          patientId,
          appointmentId,
        ])
      ).rows[0].id as string,
    true,
  );
}

async function newAppointment(userId: string, cabinetId: string, patientId: string, dentistId: string, hour: number) {
  return asUser(
    db,
    userId,
    async () =>
      (
        await db.query(
          `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
           values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes') returning id`,
          [cabinetId, patientId, dentistId, `2031-03-0${hour % 9 + 1}T${String(8 + (hour % 10)).padStart(2, "0")}:00:00Z`],
        )
      ).rows[0].id as string,
    true,
  );
}

const insertMed = (cabinetId: string, name = "Eugénol", createdBy: string | null = null) =>
  db.query(`insert into public.medications (cabinet_id, name, form, posology, created_by) values ($1, $2, 'pâte', 'au fauteuil', $3) returning *`, [
    cabinetId,
    name,
    createdBy,
  ]);

const insertRx = (row: { cabinet: string; patient: string; dentist: string; invoice?: string | null; appointment?: string | null }) =>
  db.query(
    `insert into public.prescriptions (cabinet_id, patient_id, dentist_id, items, invoice_id, appointment_id)
     values ($1, $2, $3, '[{"drug":"Amoxicilline","strength":"1 g","dosage":"1 comprimé 3 fois par jour"}]', $4, $5) returning *`,
    [row.cabinet, row.patient, row.dentist, row.invoice ?? null, row.appointment ?? null],
  );

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db);
  dentist = await createUser(db);
  assistant = await createUser(db);
  accountant = await createUser(db);
  adminOnly = await createUser(db);
  otherOwner = await createUser(db);
  cab = await createCabinet(db, owner.id);
  otherCab = await createCabinet(db, otherOwner.id);
  await addMember(db, cab, dentist.id, ["dentist"]);
  await addMember(db, cab, assistant.id, ["assistant"]);
  await addMember(db, cab, accountant.id, ["accountant"]);
  await addMember(db, cab, adminOnly.id, ["admin"]);
  patient = await newPatient(owner.id, cab);
  patient2 = await newPatient(owner.id, cab);
  otherPatient = await newPatient(otherOwner.id, otherCab);
});

afterAll(async () => {
  await db.end();
});

describe("medications : RLS", () => {
  it("écriture : praticiens et admin ; refusée à l'assistant et au comptable", async () => {
    for (const u of [owner, dentist, adminOnly]) {
      const r = await asUser(db, u.id, () => insertMed(cab, "Eugénol", u.id));
      expect(r.rows[0].cabinet_id).toBe(cab);
    }
    for (const u of [assistant, accountant]) {
      await expect(asUser(db, u.id, () => insertMed(cab))).rejects.toThrow(/row-level security/);
    }
  });

  it("lecture : tous les membres du cabinet, personne d'autre", async () => {
    const id = (await asUser(db, dentist.id, () => insertMed(cab, "Hydroxyde de calcium", dentist.id), true)).rows[0].id;
    for (const u of [owner, dentist, assistant, accountant, adminOnly]) {
      const r = await asUser(db, u.id, () => db.query(`select id from public.medications where id = $1`, [id]));
      expect(r.rowCount).toBe(1);
    }
    const other = await asUser(db, otherOwner.id, () => db.query(`select id from public.medications where id = $1`, [id]));
    expect(other.rowCount).toBe(0);
    const anon = await asUser(db, null, () => db.query(`select id from public.medications where id = $1`, [id]));
    expect(anon.rowCount).toBe(0);
  });

  it("modification et suppression logique ; pas de DELETE ; cabinet_id figé ; autre cabinet refusé", async () => {
    const id = (await asUser(db, owner.id, () => insertMed(cab, "Gel fluoré", owner.id), true)).rows[0].id;
    const upd = await asUser(db, dentist.id, () => db.query(`update public.medications set posology = '1 application', deleted_at = now() where id = $1 returning *`, [id]));
    expect(upd.rows[0].posology).toBe("1 application");
    const asst = await asUser(db, assistant.id, () => db.query(`update public.medications set name = 'x' where id = $1`, [id]));
    expect(asst.rowCount).toBe(0);
    const del = await asUser(db, owner.id, () => db.query(`delete from public.medications where id = $1`, [id]));
    expect(del.rowCount).toBe(0);
    await expect(asUser(db, owner.id, () => db.query(`update public.medications set cabinet_id = $2 where id = $1`, [id, otherCab]))).rejects.toThrow(
      /cabinet_id is immutable|row-level security/,
    );
    await expect(asUser(db, otherOwner.id, () => insertMed(cab))).rejects.toThrow(/row-level security/);
    const other = await asUser(db, otherOwner.id, () => db.query(`update public.medications set name = 'x' where id = $1`, [id]));
    expect(other.rowCount).toBe(0);
  });

  it("created_by : membre actif du cabinet", async () => {
    await expect(asUser(db, owner.id, () => insertMed(cab, "Eugénol", otherOwner.id))).rejects.toThrow(/active member/);
  });

  it("updated_at est tenu par le serveur", async () => {
    const r = await asUser(db, owner.id, async () => {
      const m = (await insertMed(cab)).rows[0];
      const u = (await db.query(`update public.medications set name = 'Eugénol pur' where id = $1 returning *`, [m.id])).rows[0];
      return { m, u };
    });
    expect(new Date(r.u.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(r.m.updated_at).getTime());
  });
});

describe("liens ordonnance <-> facture <-> rendez-vous", () => {
  it("une ordonnance peut référencer la facture et le rendez-vous de la consultation", async () => {
    const appt = await newAppointment(owner.id, cab, patient, owner.id, 1);
    const inv = await newInvoice(owner.id, cab, patient, appt);
    const rx = await asUser(db, owner.id, () => insertRx({ cabinet: cab, patient, dentist: owner.id, invoice: inv, appointment: appt }));
    expect(rx.rows[0]).toMatchObject({ invoice_id: inv, appointment_id: appt });
    // Upsert du moteur de synchronisation : lien ajouté après coup.
    const later = await asUser(db, owner.id, async () => {
      const r = (await insertRx({ cabinet: cab, patient, dentist: owner.id })).rows[0];
      return (await db.query(`update public.prescriptions set invoice_id = $2 where id = $1 returning invoice_id`, [r.id, inv])).rows[0];
    });
    expect(later.invoice_id).toBe(inv);
  });

  it("refuse une facture ou un rendez-vous d'un autre cabinet", async () => {
    const otherInv = await newInvoice(otherOwner.id, otherCab, otherPatient);
    const otherAppt = await newAppointment(otherOwner.id, otherCab, otherPatient, otherOwner.id, 2);
    await expect(asUser(db, owner.id, () => insertRx({ cabinet: cab, patient, dentist: owner.id, invoice: otherInv }))).rejects.toThrow(
      /prescriptions_invoice_id_fkey/,
    );
    await expect(asUser(db, owner.id, () => insertRx({ cabinet: cab, patient, dentist: owner.id, appointment: otherAppt }))).rejects.toThrow(
      /prescriptions_appointment_id_fkey/,
    );
    await expect(
      asUser(db, owner.id, () => db.query(`insert into public.invoices (cabinet_id, patient_id, appointment_id) values ($1, $2, $3)`, [cab, patient, otherAppt])),
    ).rejects.toThrow(/invoices_appointment_id_fkey/);
  });

  it("refuse une facture ou un rendez-vous d'un autre patient du même cabinet", async () => {
    const inv2 = await newInvoice(owner.id, cab, patient2);
    const appt2 = await newAppointment(owner.id, cab, patient2, owner.id, 3);
    await expect(asUser(db, owner.id, () => insertRx({ cabinet: cab, patient, dentist: owner.id, invoice: inv2 }))).rejects.toThrow(/same patient/);
    await expect(asUser(db, owner.id, () => insertRx({ cabinet: cab, patient, dentist: owner.id, appointment: appt2 }))).rejects.toThrow(/same patient/);
    await expect(
      asUser(db, owner.id, () => db.query(`insert into public.invoices (cabinet_id, patient_id, appointment_id) values ($1, $2, $3)`, [cab, patient, appt2])),
    ).rejects.toThrow(/same patient/);
    // Changer le lien d'une ordonnance existante est vérifié aussi.
    const inv = await newInvoice(owner.id, cab, patient);
    await expect(
      asUser(db, owner.id, async () => {
        const r = (await insertRx({ cabinet: cab, patient, dentist: owner.id, invoice: inv })).rows[0];
        await db.query(`update public.prescriptions set invoice_id = $2 where id = $1`, [r.id, inv2]);
      }),
    ).rejects.toThrow(/same patient/);
  });

  it("les ordonnances restent réservées aux dentistes (l'assistant ne peut pas en lier une)", async () => {
    const inv = await newInvoice(owner.id, cab, patient);
    await expect(asUser(db, assistant.id, () => insertRx({ cabinet: cab, patient, dentist: owner.id, invoice: inv }))).rejects.toThrow(/row-level security/);
    const read = await asUser(db, assistant.id, () => db.query(`select id from public.prescriptions where invoice_id = $1`, [inv]));
    expect(read.rowCount).toBe(0);
  });

  it("suppression physique de la facture : le lien passe à null, cabinet_id intact", async () => {
    const inv = await newInvoice(owner.id, cab, patient);
    const rx = (await asUser(db, owner.id, () => insertRx({ cabinet: cab, patient, dentist: owner.id, invoice: inv }), true)).rows[0];
    await db.query(`delete from public.invoices where id = $1`, [inv]); // connexion de service (hors RLS)
    const after = (await db.query(`select cabinet_id, invoice_id from public.prescriptions where id = $1`, [rx.id])).rows[0];
    expect(after).toEqual({ cabinet_id: cab, invoice_id: null });
  });
});
