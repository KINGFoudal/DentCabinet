import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

// Connexion de l'espace patient par code email (migration 20261026040000_portal_email_login.sql).
// Une session est simulée par les claims du JWT, dont « amr » (méthode d'authentification) :
// « otp » = code reçu, « password » = mot de passe, « anonymous » = compte anonyme.

let db: Client;
let owner: { id: string };
let cabA: string;
let cabB: string;

type Amr = "otp" | "magiclink" | "email/signup" | "password" | "anonymous" | null;

/** Exécute fn comme un utilisateur connecté dont la session a été ouverte par `amr`. */
async function asSession<T>(userId: string, amr: Amr, fn: () => Promise<T>, commit = false): Promise<T> {
  await db.query("begin");
  try {
    const claims: Record<string, unknown> = { sub: userId, role: "authenticated" };
    if (amr) claims.amr = [{ method: amr, timestamp: Math.floor(Date.now() / 1000) }];
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await db.query(`set local role authenticated`);
    const result = await fn();
    await db.query(commit ? "commit" : "rollback");
    return result;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

/** Compte « email » comme le crée Supabase Auth. */
async function createEmailUser(
  email: string,
  opts: { confirmed?: boolean; phone?: string; password?: boolean; anonymous?: boolean } = {},
) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, phone, phone_confirmed_at,
                             encrypted_password, is_anonymous, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3, $4, $5, $6, $7, now(), now())`,
    [
      id,
      email,
      opts.confirmed === false ? null : new Date(),
      opts.phone ?? null,
      opts.phone ? new Date() : null,
      opts.password ? "$2a$10$abcdefghijklmnopqrstuv" : "",
      opts.anonymous ?? false,
    ],
  );
  return id;
}

async function createPhoneUser(phoneDigits: string) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), now(), now())`,
    [id, phoneDigits],
  );
  return id;
}

const randomEmail = () => `patient-${randomUUID().slice(0, 8)}@exemple.gn`;
const randomPhone = () => "2246" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

async function patient(cab: string, fields: { email?: string | null; phone?: string | null; portal?: string | null; deleted?: boolean }) {
  const { rows } = await db.query(
    `insert into public.patients (cabinet_id, first_name, last_name, email, phone, portal_user_id, deleted_at)
     values ($1, 'Test', $2, $3, $4, $5, $6) returning id`,
    [cab, randomUUID().slice(0, 6), fields.email ?? null, fields.phone ?? null, fields.portal ?? null, fields.deleted ? new Date() : null],
  );
  return rows[0].id as string;
}

async function portalOf(id: string) {
  const { rows } = await db.query(`select portal_user_id from public.patients where id = $1`, [id]);
  return rows[0].portal_user_id as string | null;
}

const link = (uid: string, amr: Amr) =>
  asSession(uid, amr, async () => (await db.query(`select public.link_portal_patients() as n`)).rows[0].n as number, true);

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db);
  cabA = await createCabinet(db, owner.id);
  cabB = await createCabinet(db, (await createUser(db)).id);
});

afterAll(async () => {
  await db.end();
});

describe("email vérifié", () => {
  it("rattache par code email les fiches de tous les cabinets (casse et espaces ignorés)", async () => {
    const email = randomEmail();
    const uid = await createEmailUser(email);
    const a = await patient(cabA, { email: `  ${email.toUpperCase()} ` });
    const b = await patient(cabB, { email });
    const deleted = await patient(cabA, { email, deleted: true });
    const other = await patient(cabA, { email: randomEmail() });
    expect(await link(uid, "otp")).toBe(2);
    expect(await portalOf(a)).toBe(uid);
    expect(await portalOf(b)).toBe(uid);
    expect(await portalOf(deleted)).toBeNull();
    expect(await portalOf(other)).toBeNull();
    // Idempotent.
    expect(await link(uid, "otp")).toBe(0);
  });

  it("accepte aussi un lien magique ou un lien de confirmation", async () => {
    for (const amr of ["magiclink", "email/signup"] as const) {
      const email = randomEmail();
      const uid = await createEmailUser(email);
      const p = await patient(cabA, { email });
      expect(await link(uid, amr)).toBe(1);
      expect(await portalOf(p)).toBe(uid);
    }
  });

  it("refuse un email non confirmé", async () => {
    const email = randomEmail();
    const uid = await createEmailUser(email, { confirmed: false });
    const p = await patient(cabA, { email });
    expect(await link(uid, "otp")).toBe(0);
    expect(await portalOf(p)).toBeNull();
  });

  it("refuse une session sans code (inscription par mot de passe auto-confirmée, anonyme, sans amr)", async () => {
    const email = randomEmail();
    const p = await patient(cabA, { email });
    // « Confirm email » désactivé : l'inscription { email, password } est confirmée sans preuve.
    const pw = await createEmailUser(email, { password: true });
    expect(await link(pw, "password")).toBe(0);
    expect(await link(pw, null)).toBe(0);
    expect(await portalOf(p)).toBeNull();
    // Compte anonyme auquel une adresse a été ajoutée.
    const anonEmail = randomEmail();
    const q = await patient(cabA, { email: anonEmail });
    const anon = await createEmailUser(anonEmail, { anonymous: true });
    expect(await link(anon, "otp")).toBe(0);
    expect(await link(anon, "anonymous")).toBe(0);
    expect(await portalOf(q)).toBeNull();
  });

  it("ne compte pas l'email d'un compte téléphone, ni le téléphone d'un compte email", async () => {
    const email = randomEmail();
    const phone = randomPhone();
    const p = await patient(cabA, { email, phone: "+" + phone });
    // Compte ouvert par code SMS (amr otp) qui ajoute un email : ni l'un ni l'autre ne compte.
    const both = await createEmailUser(email, { phone });
    expect(await link(both, "otp")).toBe(0);
    expect(await portalOf(p)).toBeNull();
  });

  it("ne vole jamais une fiche déjà rattachée à un autre compte", async () => {
    const email = randomEmail();
    const first = await createEmailUser(email);
    const p = await patient(cabA, { email });
    expect(await link(first, "otp")).toBe(1);
    // Second compte avec la même adresse (ex. ancien compte supprimé puis recréé côté Auth).
    await db.query(`update auth.users set email = $2 where id = $1`, [first, randomEmail()]);
    const second = await createEmailUser(email);
    expect(await link(second, "otp")).toBe(0);
    expect(await portalOf(p)).toBe(first);
  });

  it("un patient ne voit que ses fiches et ses rendez-vous", async () => {
    const email = randomEmail();
    const uid = await createEmailUser(email);
    const mine = await patient(cabA, { email });
    const theirs = await patient(cabA, { email: randomEmail() });
    await asUser(
      db,
      owner.id,
      async () => {
        for (const [p, h] of [
          [mine, "09"],
          [theirs, "10"],
        ])
          await db.query(
            `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
             values ($1, $2, $3, $4, $5)`,
            [cabA, p, owner.id, `2027-03-01T${h}:00:00Z`, `2027-03-01T${h}:30:00Z`],
          );
      },
      true,
    );
    expect(await link(uid, "otp")).toBe(1);
    const seen = await asSession(uid, "otp", async () => ({
      patients: (await db.query(`select id from public.patients`)).rows.map((r) => r.id),
      appts: (await db.query(`select patient_id from public.appointments`)).rows.map((r) => r.patient_id),
      cabinets: (await db.query(`select id from public.cabinets`)).rowCount,
    }));
    expect(seen.patients).toEqual([mine]);
    expect(seen.appts).toEqual([mine]);
    expect(seen.cabinets).toBe(0);
  });

  it("un membre du personnel avec le même email n'obtient que ses propres fiches patient", async () => {
    const email = randomEmail();
    const staff = await createEmailUser(email, { password: true });
    await addMember(db, cabA, staff, ["assistant"]);
    const ownFileB = await patient(cabB, { email });
    const otherB = await patient(cabB, { email: randomEmail() });
    const otherA = await patient(cabA, { email: randomEmail() });
    // Connecté par mot de passe (espace cabinet) : rien n'est rattaché.
    expect(await link(staff, "password")).toBe(0);
    // Ouvre l'espace patient par code : seule sa fiche du cabinet B.
    expect(await link(staff, "otp")).toBe(1);
    expect(await portalOf(ownFileB)).toBe(staff);
    expect(await portalOf(otherB)).toBeNull();
    expect(await portalOf(otherA)).toBeNull();
    const seenB = await asSession(staff, "otp", async () =>
      (await db.query(`select id from public.patients where cabinet_id = $1`, [cabB])).rows.map((r) => r.id),
    );
    expect(seenB).toEqual([ownFileB]);
  });
});

describe("fiche modifiée par le cabinet après rattachement", () => {
  it("détache la fiche si le nouvel email ne correspond plus au compte", async () => {
    const email = randomEmail();
    const uid = await createEmailUser(email);
    const p = await patient(cabA, { email });
    expect(await link(uid, "otp")).toBe(1);
    // Autre champ, ou même adresse en majuscules : reste rattachée.
    await asUser(db, owner.id, () => db.query(`update public.patients set city = 'Kindia', email = upper(email) where id = $1`, [p]), true);
    expect(await portalOf(p)).toBe(uid);
    // Adresse corrigée : la mauvaise personne perd l'accès.
    await asUser(db, owner.id, () => db.query(`update public.patients set email = $2 where id = $1`, [p, randomEmail()]), true);
    expect(await portalOf(p)).toBeNull();
    const seen = await asSession(uid, "otp", async () => (await db.query(`select id from public.patients`)).rowCount);
    expect(seen).toBe(0);
  });

  it("garde une fiche rattachée par téléphone si seul l'email change, la détache si le téléphone change", async () => {
    const phone = randomPhone();
    const uid = await createPhoneUser(phone);
    const p = await patient(cabA, { phone: `+${phone}` });
    expect(await link(uid, "otp")).toBe(1);
    await asUser(
      db,
      owner.id,
      () => db.query(`update public.patients set email = $2, phone = $3 where id = $1`, [p, randomEmail(), phone.slice(3)]),
      true,
    );
    expect(await portalOf(p)).toBe(uid); // « 6xxxxxxxx » = même numéro
    await asUser(db, owner.id, () => db.query(`update public.patients set phone = $2 where id = $1`, [p, "+" + randomPhone()]), true);
    expect(await portalOf(p)).toBeNull();
  });

  it("le personnel ne peut ni poser, ni changer, ni retirer un rattachement", async () => {
    const victimEmail = randomEmail();
    const victim = await createEmailUser(victimEmail);
    const linked = await createEmailUser(randomEmail());
    const p = await patient(cabA, {});
    await asUser(db, owner.id, () => db.query(`update public.patients set portal_user_id = $2 where id = $1`, [p, victim]), true);
    expect(await portalOf(p)).toBeNull();
    const { rows } = await asUser(
      db,
      owner.id,
      () =>
        db.query(`insert into public.patients (cabinet_id, first_name, last_name, portal_user_id) values ($1, 'X', 'Y', $2) returning portal_user_id`, [
          cabA,
          victim,
        ]),
      true,
    );
    expect(rows[0].portal_user_id).toBeNull();
    // Fiche rattachée côté serveur ; une ligne locale ancienne (portal_user_id null) est renvoyée par la synchronisation.
    const q = await patient(cabA, { portal: linked });
    await asUser(db, owner.id, () => db.query(`update public.patients set portal_user_id = null, city = 'Labé' where id = $1`, [q]), true);
    expect(await portalOf(q)).toBe(linked);
    await asUser(db, owner.id, () => db.query(`update public.patients set portal_user_id = $2 where id = $1`, [q, victim]), true);
    expect(await portalOf(q)).toBe(linked);
  });
});

describe("droits et règle téléphone", () => {
  it("les fonctions internes ne sont pas exécutables par les clients", async () => {
    for (const fn of ["app.verified_email()", "app.session_proves_inbox()", "app.verified_phone()"]) {
      await expect(asSession(owner.id, "otp", () => db.query(`select ${fn}`))).rejects.toThrow(/permission denied/);
    }
    const { rows } = await db.query(
      `select has_function_privilege('anon', 'public.link_portal_patients()', 'execute') as anon,
              has_function_privilege('authenticated', 'app.patients_portal_guard()', 'execute') as guard`,
    );
    expect(rows[0]).toEqual({ anon: false, guard: false });
  });

  it("la règle téléphone n'est pas affaiblie (compte email + mot de passe avec téléphone confirmé)", async () => {
    const phone = randomPhone();
    const p = await patient(cabA, { phone: `+${phone}` });
    const u = await createEmailUser(randomEmail(), { phone, password: true });
    expect(await link(u, "otp")).toBe(0);
    expect(await portalOf(p)).toBeNull();
    await db.query(`update auth.users set phone = null where id = $1`, [u]);
    const ok = await createPhoneUser(phone);
    expect(await link(ok, "otp")).toBe(1);
    expect(await portalOf(p)).toBe(ok);
  });
});
