import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

let db: Client;
let owner: { id: string };
let dentist2: { id: string };
let assistant: { id: string };
let accountant: { id: string };
let otherOwner: { id: string };
let cab: string;
let patient: string;

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db);
  dentist2 = await createUser(db);
  assistant = await createUser(db);
  accountant = await createUser(db);
  otherOwner = await createUser(db);
  cab = await createCabinet(db, owner.id);
  await createCabinet(db, otherOwner.id);
  await addMember(db, cab, dentist2.id, ["dentist"]);
  await addMember(db, cab, assistant.id, ["assistant"]);
  await addMember(db, cab, accountant.id, ["accountant"]);
  patient = await asUser(
    db,
    owner.id,
    async () => (await one(`insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'Awa', 'Bah') returning id`, [cab])).id as string,
    true,
  );
});

afterAll(async () => {
  await db.end();
});

const insertSchedule = (dentistId: string, cabinetId = cab) =>
  one(
    `insert into public.practitioner_schedules (cabinet_id, dentist_id, weekday, start_time, end_time)
     values ($1, $2, 1, '08:00', '12:00') returning id`,
    [cabinetId, dentistId],
  );

describe("horaires des praticiens (practitioner_schedules)", () => {
  it("un praticien crée et modifie ses propres horaires", async () => {
    await asUser(db, dentist2.id, async () => {
      const row = await insertSchedule(dentist2.id);
      const { rowCount } = await db.query(`update public.practitioner_schedules set end_time = '13:00' where id = $1`, [row.id]);
      expect(rowCount).toBe(1);
    });
  });

  it("un praticien ne crée pas d'horaires pour un autre", async () => {
    await expect(asUser(db, dentist2.id, () => insertSchedule(owner.id))).rejects.toThrow(/row-level security/);
  });

  it("un praticien ne modifie pas les horaires d'un autre (ni ne se les approprie)", async () => {
    const id = await asUser(db, owner.id, async () => (await insertSchedule(owner.id)).id as string, true);
    const updated = await asUser(db, dentist2.id, async () => {
      const { rowCount } = await db.query(`update public.practitioner_schedules set end_time = '18:00' where id = $1`, [id]);
      return rowCount;
    });
    expect(updated).toBe(0);
    // Ses propres horaires ne peuvent pas être réattribués à un autre praticien.
    const own = await asUser(db, dentist2.id, async () => (await insertSchedule(dentist2.id)).id as string, true);
    await expect(
      asUser(db, dentist2.id, () => db.query(`update public.practitioner_schedules set dentist_id = $1 where id = $2`, [owner.id, own])),
    ).rejects.toThrow(/row-level security/);
  });

  it("le secrétariat et l'admin gèrent les horaires de tous", async () => {
    await asUser(db, assistant.id, () => insertSchedule(dentist2.id));
    await asUser(db, owner.id, () => insertSchedule(dentist2.id));
  });

  it("le comptable lit mais ne modifie pas", async () => {
    await expect(asUser(db, accountant.id, () => insertSchedule(owner.id))).rejects.toThrow(/row-level security/);
    const n = await asUser(db, accountant.id, async () => (await one(`select count(*)::int as n from public.practitioner_schedules where cabinet_id = $1`, [cab])).n);
    expect(n).toBeGreaterThan(0);
  });

  it("isolation : un autre cabinet ne voit ni ne modifie rien", async () => {
    const n = await asUser(db, otherOwner.id, async () => (await one(`select count(*)::int as n from public.practitioner_schedules where cabinet_id = $1`, [cab])).n);
    expect(n).toBe(0);
    await expect(asUser(db, otherOwner.id, () => insertSchedule(otherOwner.id, cab))).rejects.toThrow(/row-level security/);
  });
});

describe("absences (time_off)", () => {
  const insertOff = (dentistId: string | null) =>
    one(
      `insert into public.time_off (cabinet_id, dentist_id, starts_at, ends_at, reason)
       values ($1, $2, '2026-12-24T00:00:00Z', '2026-12-26T00:00:00Z', 'Congés') returning id`,
      [cab, dentistId],
    );

  it("un praticien pose ses propres absences, pas celles des autres ni du cabinet", async () => {
    await asUser(db, dentist2.id, () => insertOff(dentist2.id));
    await expect(asUser(db, dentist2.id, () => insertOff(owner.id))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, dentist2.id, () => insertOff(null))).rejects.toThrow(/row-level security/);
  });

  it("le secrétariat pose une fermeture de tout le cabinet", async () => {
    await asUser(db, assistant.id, () => insertOff(null));
  });
});

describe("paramétrage réservé à l'admin", () => {
  it("fauteuils, types de RDV et modèles de messages : admin seulement", async () => {
    await asUser(db, owner.id, async () => {
      await db.query(`insert into public.chairs (cabinet_id, name) values ($1, 'Fauteuil 2')`, [cab]);
      await db.query(`insert into public.appointment_types (cabinet_id, name, duration_minutes, color) values ($1, 'Prothèse', 60, '#7C3AED')`, [cab]);
      await db.query(`update public.message_templates set body = 'Bonjour {{patient_name}}' where cabinet_id = $1 and kind = 'reminder_same_day'`, [cab]);
    });
    for (const u of [dentist2, assistant]) {
      await expect(asUser(db, u.id, () => db.query(`insert into public.chairs (cabinet_id, name) values ($1, 'X')`, [cab]))).rejects.toThrow(/row-level security/);
      const { rowCount } = await asUser(db, u.id, () => db.query(`update public.message_templates set body = 'x' where cabinet_id = $1`, [cab]));
      expect(rowCount).toBe(0);
    }
  });
});

describe("rendez-vous et journal des rappels", () => {
  let appt: string;

  beforeAll(async () => {
    appt = await asUser(
      db,
      assistant.id,
      async () =>
        (
          await one(
            `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
             values ($1, $2, $3, '2026-11-02T09:00:00Z', '2026-11-02T09:30:00Z') returning id`,
            [cab, patient, dentist2.id],
          )
        ).id as string,
      true,
    );
    // Écriture serveur (clé service) : contournement RLS comme l'Edge Function.
    await db.query(
      `insert into public.notification_log (cabinet_id, appointment_id, patient_id, kind, channel, recipient, status)
       values ($1, $2, $3, 'reminder_day_before', 'whatsapp', '+224621000000', 'sent')`,
      [cab, appt, patient],
    );
  });

  it("chevauchement refusé par la base (23P01)", async () => {
    await expect(
      asUser(db, assistant.id, () =>
        db.query(
          `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
           values ($1, $2, $3, '2026-11-02T09:15:00Z', '2026-11-02T09:45:00Z')`,
          [cab, patient, dentist2.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("le journal n'accepte aucune écriture depuis l'application", async () => {
    await expect(
      asUser(db, owner.id, () =>
        db.query(`insert into public.notification_log (cabinet_id, kind, channel, recipient) values ($1, 'otp', 'whatsapp', 'x')`, [cab]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("le praticien voit les rappels de ses RDV ; le comptable et un autre cabinet non", async () => {
    const count = (uid: string) =>
      asUser(db, uid, async () => (await one(`select count(*)::int as n from public.notification_log where appointment_id = $1`, [appt])).n);
    expect(await count(dentist2.id)).toBe(1);
    expect(await count(assistant.id)).toBe(1);
    expect(await count(accountant.id)).toBe(0);
    expect(await count(otherOwner.id)).toBe(0);
  });

  it("le praticien ne voit pas les rappels des RDV d'un autre praticien", async () => {
    // RDV d'un autre praticien (owner) : dentist2 ne voit pas son journal.
    const n = await asUser(db, owner.id, async () => {
      const a = await one(
        `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
         values ($1, $2, $3, '2026-11-03T09:00:00Z', '2026-11-03T09:30:00Z') returning id`,
        [cab, patient, owner.id],
      );
      return a.id as string;
    }, true);
    await db.query(
      `insert into public.notification_log (cabinet_id, appointment_id, patient_id, kind, channel, recipient, status)
       values ($1, $2, $3, 'reminder_day_before', 'email', 'awa@example.com', 'sent')`,
      [cab, n, patient],
    );
    const seen = await asUser(db, dentist2.id, async () => (await one(`select count(*)::int as n from public.notification_log where appointment_id = $1`, [n])).n);
    expect(seen).toBe(0);
  });

  it("un même rappel n'est journalisé qu'une fois par canal", async () => {
    await expect(
      db.query(
        `insert into public.notification_log (cabinet_id, appointment_id, patient_id, kind, channel, recipient)
         values ($1, $2, $3, 'reminder_day_before', 'whatsapp', '+224621000000')`,
        [cab, appt, patient],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("un RDV déplacé libère ses rappels (historique conservé)", async () => {
    await asUser(
      db,
      assistant.id,
      () => db.query(`update public.appointments set starts_at = '2026-11-04T09:00:00Z', ends_at = '2026-11-04T09:30:00Z' where id = $1`, [appt]),
      true,
    );
    const attached = await one(`select count(*)::int as n from public.notification_log where appointment_id = $1`, [appt]);
    expect(attached.n).toBe(0);
    const kept = await one(`select count(*)::int as n from public.notification_log where patient_id = $1 and error = 'rescheduled'`, [patient]);
    expect(kept.n).toBe(1);
  });

  it("la fonction de planification n'est pas exécutable par les utilisateurs", async () => {
    await expect(asUser(db, owner.id, () => db.query(`select app.invoke_send_reminders()`))).rejects.toThrow(/permission denied/);
  });
});
