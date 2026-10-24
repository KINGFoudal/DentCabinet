import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

let db: Client;
let owner: { id: string };
let dentist2: { id: string };
let cab: string;
let slug: string;
let cabB: string;
let consultation: string;
let notBookable: string;
let monday: string; // AAAA-MM-JJ, lundi de la semaine prochaine (Africa/Conakry = UTC)

/** Utilisateur « téléphone » comme le crée Supabase Auth (numéro sans « + »). */
async function createPhoneUser(phoneDigits: string, verified = true) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3, now(), now())`,
    [id, phoneDigits, verified ? new Date() : null],
  );
  return id;
}

function randomPhone() {
  return "2246" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}

async function slots(userId: string | null, date: string, dentist: string | null = null, type = consultation, s = slug) {
  return asUser(db, userId, async () => {
    const { rows } = await db.query(`select starts_at, ends_at from public.available_slots($1, $2, $3, $4)`, [s, type, date, dentist]);
    return rows.map((r) => (r.starts_at as Date).toISOString().slice(11, 16));
  });
}

async function book(userId: string, startsAt: string, opts: { dentist?: string; first?: string; last?: string; commit?: boolean } = {}) {
  return asUser(
    db,
    userId,
    async () => {
      const { rows } = await db.query(`select public.book_online($1, $2, $3, $4, $5, $6) as r`, [
        slug,
        consultation,
        startsAt,
        opts.dentist ?? null,
        opts.first ?? null,
        opts.last ?? null,
      ]);
      return rows[0].r as { appointment_id: string; patient_id: string; dentist_id: string; starts_at: string };
    },
    opts.commit ?? false,
  );
}

const at = (time: string) => `${monday}T${time}:00Z`;

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db);
  dentist2 = await createUser(db);
  cab = await createCabinet(db, owner.id);
  cabB = await createCabinet(db, (await createUser(db)).id);
  await addMember(db, cab, dentist2.id, ["dentist"]);
  const { rows: c } = await db.query(`select slug from public.cabinets where id = $1`, [cab]);
  slug = c[0].slug;
  await db.query(
    `update public.cabinets set online_booking_enabled = true, online_cancel_min_hours = 24,
       opening_hours = '{"1": [["08:00","12:00"],["14:00","16:00"]]}'::jsonb where id = $1`,
    [cab],
  );
  const { rows: t } = await db.query(
    `select id, bookable_online from public.appointment_types where cabinet_id = $1 and name in ('Consultation', 'Extraction')`,
    [cab],
  );
  consultation = t.find((r) => r.bookable_online).id;
  notBookable = t.find((r) => !r.bookable_online).id;
  const { rows: d } = await db.query(
    `select (current_date + ((8 - extract(isodow from current_date)::int) % 7) + 7)::text as d`,
  );
  monday = d[0].d;

  // Dentiste 2 : uniquement le lundi de 09:00 à 10:00 (et le mardi).
  await db.query(
    `insert into public.practitioner_schedules (cabinet_id, dentist_id, weekday, start_time, end_time)
     values ($1, $2, 1, '09:00', '10:00'), ($1, $2, 2, '08:00', '18:00')`,
    [cab, dentist2.id],
  );
  // Propriétaire : absent de 10:00 à 11:00, un RDV à 08:00 ; tout le cabinet fermé de 15:00 à 16:00.
  await db.query(
    `insert into public.time_off (cabinet_id, dentist_id, starts_at, ends_at) values
       ($1, $2, $3, $4), ($1, null, $5, $6)`,
    [cab, owner.id, at("10:00"), at("11:00"), at("15:00"), at("16:00")],
  );
  await db.query(
    `insert into public.appointments (cabinet_id, dentist_id, starts_at, ends_at, title) values ($1, $2, $3, $4, 'Existant')`,
    [cab, owner.id, at("08:00"), at("08:30")],
  );
});

afterAll(async () => {
  await db.end();
});

describe("available_slots", () => {
  it("respecte horaires, absences et rendez-vous existants (praticien sans horaires propres)", async () => {
    expect(await slots(null, monday, owner.id)).toEqual(["08:30", "09:00", "09:30", "11:00", "11:30", "14:00", "14:30"]);
  });

  it("utilise les horaires du praticien s'il en a", async () => {
    expect(await slots(null, monday, dentist2.id)).toEqual(["09:00", "09:30"]);
  });

  it("réunit les praticiens quand aucun n'est choisi", async () => {
    expect(await slots(null, monday)).toEqual(["08:30", "09:00", "09:30", "11:00", "11:30", "14:00", "14:30"]);
  });

  it("jour fermé, date passée ou trop lointaine : aucun créneau", async () => {
    const sunday = new Date(`${monday}T00:00:00Z`);
    sunday.setUTCDate(sunday.getUTCDate() - 1);
    expect(await slots(null, sunday.toISOString().slice(0, 10))).toEqual([]);
    expect(await slots(null, "2020-01-06")).toEqual([]);
    const far = new Date(`${monday}T00:00:00Z`);
    far.setUTCDate(far.getUTCDate() + 7 * 12);
    expect(await slots(null, far.toISOString().slice(0, 10))).toEqual([]);
  });

  it("respecte le délai minimum de 2 h", async () => {
    await db.query(`update public.cabinets set opening_hours = '{"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","23:59"]],"6":[["00:00","23:59"]],"7":[["00:00","23:59"]]}'::jsonb where id = $1`, [cab]);
    try {
      const { rows } = await db.query(`select (now() at time zone 'Africa/Conakry')::date::text as d`);
      const result = await asUser(db, null, async () => {
        const r = await db.query(`select min(starts_at) as first from public.available_slots($1, $2, $3, $4)`, [
          slug,
          consultation,
          rows[0].d,
          owner.id,
        ]);
        return r.rows[0].first as Date | null;
      });
      if (result) expect(result.getTime()).toBeGreaterThanOrEqual(Date.now() + 2 * 3600 * 1000 - 60_000);
    } finally {
      await db.query(
        `update public.cabinets set opening_hours = '{"1": [["08:00","12:00"],["14:00","16:00"]]}'::jsonb where id = $1`,
        [cab],
      );
    }
  });

  it("refuse un type non réservable en ligne", async () => {
    await expect(slots(null, monday, null, notBookable)).rejects.toThrow(/type_not_bookable/);
  });

  it("refuse si la réservation est désactivée ou l'abonnement expiré", async () => {
    await db.query(`update public.cabinets set online_booking_enabled = false where id = $1`, [cab]);
    await expect(slots(null, monday)).rejects.toThrow(/booking_disabled/);
    await db.query(`update public.cabinets set online_booking_enabled = true, subscription_status = 'expired' where id = $1`, [cab]);
    await expect(slots(null, monday)).rejects.toThrow(/booking_disabled/);
    await db.query(`update public.cabinets set subscription_status = 'trialing' where id = $1`, [cab]);
    await expect(slots(null, monday, null, consultation, "inexistant-xyz")).rejects.toThrow(/cabinet_not_found/);
  });
});

describe("book_online", () => {
  it("rattache le RDV au patient existant ayant le même téléphone vérifié", async () => {
    const phone = randomPhone();
    const { rows } = await db.query(
      `insert into public.patients (cabinet_id, first_name, last_name, phone) values ($1, 'Aïssatou', 'Bah', $2) returning id`,
      [cab, "+" + phone],
    );
    const user = await createPhoneUser(phone);
    const r = await book(user, at("09:00"), { first: "Autre", last: "Nom" });
    expect(r.patient_id).toBe(rows[0].id);
    expect([owner.id, dentist2.id]).toContain(r.dentist_id);
    // Transaction annulée : rien n'a été écrit.
    const { rows: p } = await db.query(`select portal_user_id, first_name from public.patients where id = $1`, [rows[0].id]);
    expect(p[0].portal_user_id).toBeNull();

    const r2 = await book(user, at("09:00"), { commit: true });
    const { rows: a } = await db.query(`select source, status, patient_id, created_by from public.appointments where id = $1`, [
      r2.appointment_id,
    ]);
    expect(a[0]).toMatchObject({ source: "online", status: "scheduled", patient_id: rows[0].id, created_by: user });
    const { rows: p2 } = await db.query(`select portal_user_id, first_name from public.patients where id = $1`, [rows[0].id]);
    expect(p2[0]).toEqual({ portal_user_id: user, first_name: "Aïssatou" });
  });

  it("choisit un autre praticien libre, puis refuse quand le créneau est complet", async () => {
    // 09:30 : le propriétaire et le dentiste 2 sont libres.
    const u1 = await createPhoneUser(randomPhone());
    const u2 = await createPhoneUser(randomPhone());
    const u3 = await createPhoneUser(randomPhone());
    const a = await book(u1, at("09:30"), { first: "A", last: "Un", commit: true });
    const b = await book(u2, at("09:30"), { first: "B", last: "Deux", commit: true });
    expect(a.dentist_id).not.toBe(b.dentist_id);
    await expect(book(u3, at("09:30"), { first: "C", last: "Trois" })).rejects.toThrow(/slot_unavailable/);
    expect(await slots(null, monday)).not.toContain("09:30");
  });

  it("refuse un créneau hors horaires ou un praticien indisponible", async () => {
    const u = await createPhoneUser(randomPhone());
    await expect(book(u, at("12:30"), { first: "X", last: "Y" })).rejects.toThrow(/slot_unavailable/);
    await expect(book(u, at("14:00"), { first: "X", last: "Y", dentist: dentist2.id })).rejects.toThrow(/slot_unavailable/);
  });

  it("crée la fiche patient si le téléphone est inconnu (nom obligatoire)", async () => {
    const phone = randomPhone();
    const u = await createPhoneUser(phone);
    await expect(book(u, at("11:00"))).rejects.toThrow(/name_required/);
    const r = await book(u, at("11:00"), { first: " Fanta ", last: "Camara", commit: true });
    const { rows } = await db.query(`select first_name, last_name, phone, portal_user_id, cabinet_id from public.patients where id = $1`, [
      r.patient_id,
    ]);
    expect(rows[0]).toEqual({ first_name: "Fanta", last_name: "Camara", phone: "+" + phone, portal_user_id: u, cabinet_id: cab });
  });

  it("impossible sans téléphone vérifié, ou sans compte", async () => {
    const unverified = await createPhoneUser(randomPhone(), false);
    await expect(book(unverified, at("11:30"), { first: "X", last: "Y" })).rejects.toThrow(/phone_not_verified/);
    const emailUser = await createUser(db);
    await expect(book(emailUser.id, at("11:30"), { first: "X", last: "Y" })).rejects.toThrow(/phone_not_verified/);
    await expect(
      asUser(db, null, () => db.query(`select public.book_online($1, $2, $3)`, [slug, consultation, at("11:30")])),
    ).rejects.toThrow(/permission denied/);
  });

  it("ne rattache pas une fiche liée à un autre compte", async () => {
    const phone = randomPhone();
    const other = await createUser(db);
    const { rows } = await db.query(
      `insert into public.patients (cabinet_id, first_name, last_name, phone, portal_user_id) values ($1, 'Lié', 'Ailleurs', $2, $3) returning id`,
      [cab, "+" + phone, other.id],
    );
    const u = await createPhoneUser(phone);
    const r = await book(u, at("14:00"), { first: "Nouveau", last: "Patient" });
    expect(r.patient_id).not.toBe(rows[0].id);
  });

  it("limite à 3 rendez-vous à venir par patient et par cabinet", async () => {
    const u = await createPhoneUser(randomPhone());
    await book(u, at("11:30"), { first: "Mamadou", last: "Sow", commit: true });
    await book(u, at("14:00"), { commit: true });
    await book(u, at("14:30"), { commit: true });
    const tuesday = new Date(`${monday}T08:00:00Z`);
    tuesday.setUTCDate(tuesday.getUTCDate() + 1);
    await expect(
      asUser(db, u, () =>
        db.query(`select public.book_online($1, $2, $3, $4)`, [slug, consultation, tuesday.toISOString(), dentist2.id]),
      ),
    ).rejects.toThrow(/too_many_bookings/);
  });

  it("refuse si la réservation est désactivée ou l'abonnement expiré", async () => {
    const u = await createPhoneUser(randomPhone());
    const go = () =>
      asUser(db, u, () => db.query(`select public.book_online($1, $2, $3, null, 'A', 'B')`, [slug, consultation, at("08:30")]));
    await db.query(`update public.cabinets set online_booking_enabled = false where id = $1`, [cab]);
    await expect(go()).rejects.toThrow(/booking_disabled/);
    await db.query(`update public.cabinets set online_booking_enabled = true, subscription_status = 'expired' where id = $1`, [cab]);
    await expect(go()).rejects.toThrow(/booking_disabled/);
    await db.query(`update public.cabinets set subscription_status = 'trialing' where id = $1`, [cab]);
    await expect(go().then(() => "ok")).resolves.toBe("ok");
  });
});

describe("cancel_online", () => {
  it("annule dans le délai, refuse hors délai, refuse pour un autre patient", async () => {
    const phone = randomPhone();
    const u = await createPhoneUser(phone);
    const { rows: p } = await db.query(
      `insert into public.patients (cabinet_id, first_name, last_name, phone, portal_user_id) values ($1, 'Kadiatou', 'Barry', $2, $3) returning id`,
      [cab, "+" + phone, u],
    );
    const { rows: soon } = await db.query(
      `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
       values ($1, $2, $3, now() + interval '3 hours', now() + interval '3 hours 30 minutes') returning id`,
      [cab, p[0].id, dentist2.id],
    );
    const { rows: later } = await db.query(
      `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
       values ($1, $2, $3, now() + interval '5 days', now() + interval '5 days 30 minutes') returning id`,
      [cab, p[0].id, dentist2.id],
    );
    const cancel = (user: string, id: string, commit = false) =>
      asUser(db, user, () => db.query(`select public.cancel_online($1)`, [id]), commit);

    await expect(cancel(u, soon[0].id)).rejects.toThrow(/too_late/);
    const stranger = await createPhoneUser(randomPhone());
    await expect(cancel(stranger, later[0].id)).rejects.toThrow(/not_found/);
    await cancel(u, later[0].id, true);
    const { rows } = await db.query(`select status from public.appointments where id = $1`, [later[0].id]);
    expect(rows[0].status).toBe("cancelled");
    await expect(cancel(u, later[0].id)).rejects.toThrow(/not_cancellable/);
  });
});

describe("link_portal_patients et lecture portail", () => {
  it("rattache les fiches de tous les cabinets sans écraser un autre compte", async () => {
    const phone = randomPhone();
    const other = await createUser(db);
    const { rows: a } = await db.query(
      `insert into public.patients (cabinet_id, first_name, last_name, phone) values ($1, 'Ousmane', 'Diallo', $2) returning id`,
      [cab, `+${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6, 8)} ${phone.slice(8, 10)} ${phone.slice(10)}`],
    );
    const { rows: b } = await db.query(
      `insert into public.patients (cabinet_id, first_name, last_name, phone) values ($1, 'Ousmane', 'Diallo', $2) returning id`,
      [cabB, phone.slice(3)], // format local à 9 chiffres
    );
    const { rows: c } = await db.query(
      `insert into public.patients (cabinet_id, first_name, last_name, phone, portal_user_id) values ($1, 'Autre', 'Compte', $2, $3) returning id`,
      [cabB, "+" + phone, other.id],
    );
    const u = await createPhoneUser(phone);
    const count = await asUser(db, u, async () => (await db.query(`select public.link_portal_patients() as n`)).rows[0].n, true);
    expect(count).toBe(2);
    const { rows } = await db.query(`select id, portal_user_id from public.patients where id = any($1)`, [[a[0].id, b[0].id, c[0].id]]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.portal_user_id]));
    expect(byId[a[0].id]).toBe(u);
    expect(byId[b[0].id]).toBe(u);
    expect(byId[c[0].id]).toBe(other.id);

    const cabinets = await asUser(db, u, async () => (await db.query(`select public.portal_cabinets() as c`)).rows[0].c);
    expect(cabinets.map((x: { id: string }) => x.id).sort()).toEqual([cab, cabB].sort());
    expect(cabinets[0].dentists.length).toBeGreaterThan(0);

    const unverified = await createPhoneUser(randomPhone(), false);
    expect(await asUser(db, unverified, async () => (await db.query(`select public.link_portal_patients() as n`)).rows[0].n)).toBe(0);
  });

  it("un patient ne voit pas les données d'un autre patient", async () => {
    const pa = randomPhone();
    const pb = randomPhone();
    const ua = await createPhoneUser(pa);
    const ub = await createPhoneUser(pb);
    const ids: Record<string, { patient: string; invoice: string; appt: string }> = {};
    for (const [u, phone] of [
      [ua, pa],
      [ub, pb],
    ]) {
      const { rows: p } = await db.query(
        `insert into public.patients (cabinet_id, first_name, last_name, phone, portal_user_id) values ($1, 'P', $2, $3, $4) returning id`,
        [cab, phone, "+" + phone, u],
      );
      const { rows: i } = await db.query(
        `insert into public.invoices (cabinet_id, patient_id, status) values ($1, $2, 'issued') returning id`,
        [cab, p[0].id],
      );
      await db.query(`insert into public.invoice_items (cabinet_id, invoice_id, label, unit_price_gnf) values ($1, $2, 'Soin', 150000)`, [
        cab,
        i[0].id,
      ]);
      const { rows: ap } = await db.query(
        `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
         values ($1, $2, $3, now() + make_interval(days => $4), now() + make_interval(days => $4, mins => 30)) returning id`,
        [cab, p[0].id, dentist2.id, u === ua ? 20 : 21],
      );
      ids[u] = { patient: p[0].id, invoice: i[0].id, appt: ap[0].id };
    }
    const seen = await asUser(db, ua, async () => ({
      patients: (await db.query(`select id from public.patients`)).rows.map((r) => r.id),
      invoices: (await db.query(`select id, total_gnf from public.invoices`)).rows,
      items: (await db.query(`select invoice_id from public.invoice_items`)).rows.map((r) => r.invoice_id),
      appts: (await db.query(`select id from public.appointments`)).rows.map((r) => r.id),
      medical: (await db.query(`select 1 from public.patient_medical`)).rows.length,
      notes: (await db.query(`select 1 from public.clinical_notes`)).rows.length,
      cabinets: (await db.query(`select 1 from public.cabinets`)).rows.length,
    }));
    expect(seen.patients).toEqual([ids[ua].patient]);
    expect(seen.invoices).toEqual([{ id: ids[ua].invoice, total_gnf: "150000" }]);
    expect(seen.items).toEqual([ids[ua].invoice]);
    expect(seen.appts).toEqual([ids[ua].appt]);
    expect(seen.medical + seen.notes + seen.cabinets).toBe(0);
    await expect(asUser(db, ua, () => db.query(`select public.cancel_online($1)`, [ids[ub].appt]))).rejects.toThrow(/not_found/);
  });
});
