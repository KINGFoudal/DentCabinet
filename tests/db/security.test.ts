import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

// Correctifs de sécurité (migration 20261026010000_security_fixes.sql).

let db: Client;
let owner: { id: string };
let dentist: { id: string };
let assistant: { id: string };
let attacker: { id: string };
let platformAdmin: { id: string };
let cab: string;
let attackerCab: string;
let patient: string;
let invoice: string;
let chair: string;
let apptType: string;
let act: string;
let attackerPatient: string;

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

/** Exécute fn avec la clé service (rôle service_role, comme PostgREST). Transaction annulée. */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await q("begin");
  try {
    await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "service_role" })]);
    await q("set local role service_role");
    return await fn();
  } finally {
    await q("rollback");
  }
}

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db);
  dentist = await createUser(db);
  assistant = await createUser(db);
  attacker = await createUser(db);
  platformAdmin = await createUser(db);
  await q(`update public.profiles set is_platform_admin = true where id = $1`, [platformAdmin.id]);

  cab = await createCabinet(db, owner.id);
  await addMember(db, cab, dentist.id, ["dentist"]);
  await addMember(db, cab, assistant.id, ["assistant"]);

  ({ patient, invoice, chair, apptType, act } = await asUser(
    db,
    owner.id,
    async () => {
      const p = (
        await q(`insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'Mariama', 'Diallo') returning id`, [cab])
      ).rows[0].id as string;
      const inv = (await q(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2) returning id`, [cab, p])).rows[0]
        .id as string;
      await q(`insert into public.invoice_items (cabinet_id, invoice_id, label, unit_price_gnf) values ($1, $2, 'Soin', 300000)`, [
        cab,
        inv,
      ]);
      await q(`update public.invoices set status = 'issued' where id = $1`, [inv]);
      const a = (
        await q(`insert into public.acts (cabinet_id, label, price_gnf) values ($1, 'Consultation', 100000) returning id`, [cab])
      ).rows[0].id as string;
      return {
        patient: p,
        invoice: inv,
        chair: (await q(`select id from public.chairs where cabinet_id = $1 limit 1`, [cab])).rows[0].id as string,
        apptType: (await q(`select id from public.appointment_types where cabinet_id = $1 limit 1`, [cab])).rows[0].id as string,
        act: a,
      };
    },
    true,
  ));

  // L'attaquant (par exemple un patient du cabinet) crée son propre cabinet.
  attackerCab = await createCabinet(db, attacker.id);
  attackerPatient = await asUser(
    db,
    attacker.id,
    async () =>
      (await q(`insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'A', 'B') returning id`, [attackerCab]))
        .rows[0].id as string,
    true,
  );
});

afterAll(async () => {
  await db.end();
});

describe("références vers un autre cabinet", () => {
  it("refuse un paiement rattaché à son cabinet sur la facture d'un autre cabinet", async () => {
    await expect(
      asUser(db, attacker.id, () =>
        q(`insert into public.payments (cabinet_id, invoice_id, amount_gnf, method) values ($1, $2, 300000, 'cash')`, [
          attackerCab,
          invoice,
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
    const inv = (await q(`select status, paid_gnf from public.invoices where id = $1`, [invoice])).rows[0];
    expect(inv.status).toBe("issued");
    expect(Number(inv.paid_gnf)).toBe(0);
  });

  it("refuse les lignes de facture, échéances et transactions sur la facture d'un autre cabinet", async () => {
    await expect(
      asUser(db, attacker.id, () =>
        q(`insert into public.invoice_items (cabinet_id, invoice_id, label, unit_price_gnf) values ($1, $2, 'X', 1)`, [attackerCab, invoice]),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      asUser(db, attacker.id, () =>
        q(`insert into public.payment_installments (cabinet_id, invoice_id, due_date, amount_gnf) values ($1, $2, current_date, 1)`, [
          attackerCab,
          invoice,
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
    // Même la clé service ne peut pas créer une transaction incohérente.
    await expect(
      asService(() =>
        q(
          `insert into public.payment_transactions (cabinet_id, purpose, invoice_id, provider, amount_gnf, payer_phone)
           values ($1, 'invoice', $2, 'orange_money', 1000, '+224620000000')`,
          [attackerCab, invoice],
        ),
      ),
    ).rejects.toThrow(/does not belong|foreign key/);
  });

  it("refuse les fiches et le dossier clinique d'un patient d'un autre cabinet", async () => {
    const attempts: [string, unknown[]][] = [
      [`insert into public.patient_medical (patient_id, cabinet_id, allergies) values ($2, $1, 'x')`, [attackerCab, patient]],
      [`insert into public.tooth_records (cabinet_id, patient_id, tooth) values ($1, $2, 11)`, [attackerCab, patient]],
      [`insert into public.treatment_plans (cabinet_id, patient_id, dentist_id, title) values ($1, $2, $3, 'P')`, [attackerCab, patient, attacker.id]],
      [`insert into public.prescriptions (cabinet_id, patient_id, dentist_id) values ($1, $2, $3)`, [attackerCab, patient, attacker.id]],
      [`insert into public.clinical_notes (cabinet_id, patient_id, author_id, body) values ($1, $2, $3, 'n')`, [attackerCab, patient, attacker.id]],
      [`insert into public.quotes (cabinet_id, patient_id) values ($1, $2)`, [attackerCab, patient]],
      [`insert into public.invoices (cabinet_id, patient_id) values ($1, $2)`, [attackerCab, patient]],
      [
        `insert into public.documents (cabinet_id, patient_id, title, storage_path) values ($1, $2, 'D', $3)`,
        [attackerCab, patient, `${attackerCab}/${patient}/f.jpg`],
      ],
      [
        `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at) values ($1, $2, $3, '2031-01-06 09:00+00', '2031-01-06 09:30+00')`,
        [attackerCab, patient, attacker.id],
      ],
    ];
    for (const [sql, params] of attempts) {
      await expect(asUser(db, attacker.id, () => q(sql, params)), sql).rejects.toThrow(/foreign key/);
    }
  });

  it("refuse le fauteuil, le type de RDV, l'acte, le devis ou le plan d'un autre cabinet", async () => {
    const appt = `insert into public.appointments (cabinet_id, patient_id, dentist_id, chair_id, type_id, starts_at, ends_at)
                  values ($1, $2, $3, $4, $5, '2031-01-06 10:00+00', '2031-01-06 10:30+00')`;
    const ownChair = (await q(`select id from public.chairs where cabinet_id = $1 limit 1`, [attackerCab])).rows[0].id;
    const ownType = (await q(`select id from public.appointment_types where cabinet_id = $1 limit 1`, [attackerCab])).rows[0].id;
    await expect(asUser(db, attacker.id, () => q(appt, [attackerCab, attackerPatient, attacker.id, chair, ownType]))).rejects.toThrow(
      /foreign key/,
    );
    await expect(asUser(db, attacker.id, () => q(appt, [attackerCab, attackerPatient, attacker.id, ownChair, apptType]))).rejects.toThrow(
      /foreign key/,
    );

    const { victimQuote, victimPlan } = await asUser(db, owner.id, async () => {
      const qt = (await q(`insert into public.quotes (cabinet_id, patient_id) values ($1, $2) returning id`, [cab, patient])).rows[0].id;
      const pl = (
        await q(`insert into public.treatment_plans (cabinet_id, patient_id, dentist_id, title) values ($1, $2, $3, 'P') returning id`, [
          cab,
          patient,
          owner.id,
        ])
      ).rows[0].id;
      return { victimQuote: qt, victimPlan: pl };
    }, true);

    await asUser(db, attacker.id, async () => {
      const own = (await q(`insert into public.quotes (cabinet_id, patient_id) values ($1, $2) returning id`, [attackerCab, attackerPatient]))
        .rows[0].id;
      await q("savepoint s");
      for (const [sql, params] of [
        [`insert into public.quote_items (cabinet_id, quote_id, label, unit_price_gnf) values ($1, $2, 'X', 1)`, [attackerCab, victimQuote]],
        [`insert into public.quote_items (cabinet_id, quote_id, act_id, label, unit_price_gnf) values ($1, $2, $3, 'X', 1)`, [attackerCab, own, act]],
        [`update public.quotes set plan_id = $2 where id = $1`, [own, victimPlan]],
        [`insert into public.invoices (cabinet_id, patient_id, quote_id) values ($1, $2, $3)`, [attackerCab, attackerPatient, victimQuote]],
        [`insert into public.treatment_plan_items (cabinet_id, plan_id, label, unit_price_gnf) values ($1, $2, 'X', 1)`, [attackerCab, victimPlan]],
      ] as [string, unknown[]][]) {
        await expect(q(sql, params), sql).rejects.toThrow(/foreign key/);
        await q("rollback to savepoint s");
      }
    });
  });

  it("refuse un praticien qui n'est pas membre actif du cabinet", async () => {
    // L'admin du cabinet ne peut pas attribuer un RDV, un plan ou une facture à un étranger.
    const attempts: [string, unknown[]][] = [
      [
        `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at) values ($1, $2, $3, '2031-02-03 09:00+00', '2031-02-03 09:30+00')`,
        [cab, patient, attacker.id],
      ],
      [`insert into public.treatment_plans (cabinet_id, patient_id, dentist_id, title) values ($1, $2, $3, 'P')`, [cab, patient, attacker.id]],
      [`insert into public.prescriptions (cabinet_id, patient_id, dentist_id) values ($1, $2, $3)`, [cab, patient, attacker.id]],
      [`insert into public.invoices (cabinet_id, patient_id, dentist_id) values ($1, $2, $3)`, [cab, patient, attacker.id]],
      [`insert into public.quotes (cabinet_id, patient_id, dentist_id) values ($1, $2, $3)`, [cab, patient, attacker.id]],
      [
        `insert into public.practitioner_schedules (cabinet_id, dentist_id, weekday, start_time, end_time) values ($1, $2, 1, '08:00', '12:00')`,
        [cab, attacker.id],
      ],
      [`insert into public.time_off (cabinet_id, dentist_id, starts_at, ends_at) values ($1, $2, now(), now() + interval '1 hour')`, [cab, attacker.id]],
    ];
    for (const [sql, params] of attempts) {
      await expect(asUser(db, owner.id, () => q(sql, params)), sql).rejects.toThrow(/must be an active member/);
    }
  });

  it("garde le refus RLS quand l'écriture vise un autre cabinet", async () => {
    await expect(
      asUser(db, attacker.id, () =>
        q(`insert into public.practitioner_schedules (cabinet_id, dentist_id, weekday, start_time, end_time) values ($1, $2, 1, '08:00', '12:00')`, [
          cab,
          attacker.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("accepte les écritures légitimes du cabinet", async () => {
    await asUser(db, assistant.id, async () => {
      const appt = (
        await q(
          `insert into public.appointments (cabinet_id, patient_id, dentist_id, chair_id, type_id, starts_at, ends_at)
           values ($1, $2, $3, $4, $5, '2031-03-03 09:00+00', '2031-03-03 09:30+00') returning id`,
          [cab, patient, dentist.id, chair, apptType],
        )
      ).rows[0].id;
      // Upsert d'une ligne existante (moteur de synchronisation).
      await q(
        `insert into public.appointments (id, cabinet_id, patient_id, dentist_id, chair_id, type_id, starts_at, ends_at, status)
         values ($1, $2, $3, $4, $5, $6, '2031-03-03 09:00+00', '2031-03-03 09:30+00', 'confirmed')
         on conflict (id) do update set status = excluded.status, dentist_id = excluded.dentist_id`,
        [appt, cab, patient, dentist.id, chair, apptType],
      );
      await q(`insert into public.payments (cabinet_id, invoice_id, amount_gnf, method) values ($1, $2, 100000, 'cash')`, [cab, invoice]);
      await q(`insert into public.payment_installments (cabinet_id, invoice_id, due_date, amount_gnf) values ($1, $2, current_date, 1000)`, [
        cab,
        invoice,
      ]);
      const inv = (await q(`select status from public.invoices where id = $1`, [invoice])).rows[0];
      expect(inv.status).toBe("partially_paid");
    });
    await asUser(db, dentist.id, async () => {
      const plan = (
        await q(`insert into public.treatment_plans (cabinet_id, patient_id, dentist_id, title) values ($1, $2, $3, 'P') returning id`, [
          cab,
          patient,
          dentist.id,
        ])
      ).rows[0].id;
      const item = (
        await q(
          `insert into public.treatment_plan_items (cabinet_id, plan_id, act_id, label, unit_price_gnf) values ($1, $2, $3, 'C', 100000) returning id`,
          [cab, plan, act],
        )
      ).rows[0].id;
      const quote = (
        await q(`insert into public.quotes (cabinet_id, patient_id, plan_id, dentist_id) values ($1, $2, $3, $4) returning id`, [
          cab,
          patient,
          plan,
          dentist.id,
        ])
      ).rows[0].id;
      await q(`insert into public.quote_items (cabinet_id, quote_id, act_id, label, unit_price_gnf) values ($1, $2, $3, 'C', 100000)`, [
        cab,
        quote,
        act,
      ]);
      const inv = (
        await q(`insert into public.invoices (cabinet_id, patient_id, quote_id, dentist_id) values ($1, $2, $3, $4) returning id`, [
          cab,
          patient,
          quote,
          dentist.id,
        ])
      ).rows[0].id;
      await q(
        `insert into public.invoice_items (cabinet_id, invoice_id, act_id, plan_item_id, label, unit_price_gnf) values ($1, $2, $3, $4, 'C', 100000)`,
        [cab, inv, act, item],
      );
    });
  });

  it("une ligne dont le praticien a quitté le cabinet reste modifiable", async () => {
    const leaver = await createUser(db);
    await addMember(db, cab, leaver.id, ["dentist"]);
    const appt = await asUser(
      db,
      owner.id,
      async () =>
        (
          await q(
            `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
             values ($1, $2, $3, '2031-04-07 09:00+00', '2031-04-07 09:30+00') returning id`,
            [cab, patient, leaver.id],
          )
        ).rows[0].id as string,
      true,
    );
    await q(`update public.memberships set active = false where cabinet_id = $1 and user_id = $2`, [cab, leaver.id]);
    const n = await asUser(db, owner.id, async () => {
      const r = await q(`update public.appointments set status = 'cancelled', dentist_id = dentist_id where id = $1`, [appt]);
      return r.rowCount;
    });
    expect(n).toBe(1);
    // Mais on ne peut plus lui attribuer de nouveau rendez-vous.
    await expect(
      asUser(db, owner.id, () =>
        q(
          `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
           values ($1, $2, $3, '2031-04-08 09:00+00', '2031-04-08 09:30+00')`,
          [cab, patient, leaver.id],
        ),
      ),
    ).rejects.toThrow(/must be an active member/);
  });

  it("la suppression d'un patient détache ses rendez-vous sans toucher cabinet_id", async () => {
    await q("begin");
    try {
      const p = (await q(`insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'T', 'T') returning id`, [cab])).rows[0]
        .id;
      const a = (
        await q(
          `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
           values ($1, $2, $3, '2031-05-05 09:00+00', '2031-05-05 09:30+00') returning id`,
          [cab, p, owner.id],
        )
      ).rows[0].id;
      await q(`delete from public.patients where id = $1`, [p]);
      const row = (await q(`select patient_id, cabinet_id from public.appointments where id = $1`, [a])).rows[0];
      expect(row.patient_id).toBeNull();
      expect(row.cabinet_id).toBe(cab);
    } finally {
      await q("rollback");
    }
  });
});

describe("chemin des documents", () => {
  const insertDoc = (path: string, cabinet = cab, pat = patient) =>
    q(`insert into public.documents (cabinet_id, patient_id, kind, title, storage_path) values ($1, $2, 'xray', 'R', $3) returning id`, [
      cabinet,
      pat,
      path,
    ]);

  it("impose le préfixe {cabinet_id}/{patient_id}/", async () => {
    for (const bad of ["x.jpg", `${attackerCab}/${patient}/x.jpg`, `${cab}/${randomUUID()}/x.jpg`, `${cab}/${patient}x.jpg`]) {
      await expect(asUser(db, owner.id, () => insertDoc(bad)), bad).rejects.toThrow(/documents_storage_path_check/);
    }
    await asUser(db, owner.id, async () => {
      const id = (await insertDoc(`${cab}/${patient}/${randomUUID()}-ok.jpg`)).rows[0].id;
      await expect(q(`update public.documents set storage_path = 'autre/chemin.jpg' where id = $1`, [id])).rejects.toThrow(
        /documents_storage_path_check/,
      );
    });
  });

  it("un autre cabinet ne peut pas pointer vers le fichier d'un patient du cabinet", async () => {
    const victimPath = `${cab}/${patient}/${randomUUID()}-pano.jpg`;
    await expect(
      asUser(db, attacker.id, () => insertDoc(victimPath, attackerCab, attackerPatient)),
    ).rejects.toThrow(/documents_storage_path_check/);
  });

  it("le praticien lit toujours les fichiers de son cabinet", async () => {
    const path = `${cab}/${patient}/${randomUUID()}-ok.jpg`;
    await q("begin");
    try {
      await q(`insert into public.documents (cabinet_id, patient_id, kind, title, storage_path) values ($1, $2, 'xray', 'R', $3)`, [
        cab,
        patient,
        path,
      ]);
      await q(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [path]);
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: dentist.id, role: "authenticated" })]);
      await q("set local role authenticated");
      const mine = (await q(`select name from storage.objects where bucket_id = 'documents' and name = $1`, [path])).rowCount;
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: attacker.id, role: "authenticated" })]);
      const theirs = (await q(`select name from storage.objects where bucket_id = 'documents' and name = $1`, [path])).rowCount;
      expect(mine).toBe(1);
      expect(theirs).toBe(0);
    } finally {
      await q("rollback");
    }
  });
});

describe("acceptation d'une invitation", () => {
  async function invite(email: string) {
    return asUser(
      db,
      owner.id,
      async () =>
        (await q(`insert into public.invitations (cabinet_id, email, roles) values ($1, $2, '{assistant}') returning token`, [cab, email]))
          .rows[0].token as string,
      true,
    );
  }

  it("refuse un compte dont l'email n'est pas confirmé", async () => {
    const u = await createUser(db);
    const token = await invite(u.email);
    await expect(asUser(db, u.id, () => q(`select public.accept_invitation($1)`, [token]))).rejects.toThrow(/email not confirmed/);
  });

  it("refuse un compte sans email (connexion par téléphone)", async () => {
    const u = await createUser(db);
    const phone = `2246${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    await q(`update auth.users set email = null, phone = $2, phone_confirmed_at = now() where id = $1`, [u.id, phone]);
    const token = await invite(u.email);
    await expect(asUser(db, u.id, () => q(`select public.accept_invitation($1)`, [token]))).rejects.toThrow(/email not confirmed/);
  });

  it("accepte un compte dont l'email est confirmé", async () => {
    // En local (enable_confirmations = false), l'inscription par l'API renseigne email_confirmed_at.
    const u = await createUser(db);
    await q(`update auth.users set email_confirmed_at = now() where id = $1`, [u.id]);
    const token = await invite(u.email.toUpperCase());
    const { cabinetId, roles } = await asUser(db, u.id, async () => ({
      cabinetId: (await q(`select public.accept_invitation($1) as id`, [token])).rows[0].id,
      roles: (await q(`select roles::text from public.memberships where cabinet_id = $1 and user_id = $2`, [cab, u.id])).rows[0]?.roles,
    }));
    expect(cabinetId).toBe(cab);
    expect(roles).toBe("{assistant}");
  });

  it("refuse l'invitation adressée à un autre email", async () => {
    const u = await createUser(db);
    await q(`update auth.users set email_confirmed_at = now() where id = $1`, [u.id]);
    const token = await invite(`${randomUUID()}@test.local`);
    await expect(asUser(db, u.id, () => q(`select public.accept_invitation($1)`, [token]))).rejects.toThrow(/invalid invitation/);
  });
});

describe("formules", () => {
  it("l'admin plateforme crée et modifie une formule mais ne peut pas la supprimer", async () => {
    await asUser(db, platformAdmin.id, async () => {
      const code = `t-${randomUUID().slice(0, 8)}`;
      const id = (
        await q(
          `insert into public.plans (code, name, min_dentists, max_dentists, price_monthly_gnf, active)
           values ($1, 'Test', 50, 60, 1, false) returning id`,
          [code],
        )
      ).rows[0].id;
      expect((await q(`update public.plans set name = 'Test 2' where id = $1`, [id])).rowCount).toBe(1);
      expect((await q(`delete from public.plans where id = $1`, [id])).rowCount).toBe(0);
      expect((await q(`select 1 from public.plans where id = $1`, [id])).rowCount).toBe(1);
    });
  });

  it("un utilisateur ordinaire ne modifie aucune formule", async () => {
    await expect(
      asUser(db, owner.id, () =>
        q(`insert into public.plans (code, name, min_dentists, price_monthly_gnf) values ('x-${randomUUID()}', 'X', 1, 1)`),
      ),
    ).rejects.toThrow(/row-level security/);
    const n = await asUser(db, owner.id, async () => (await q(`update public.plans set price_monthly_gnf = 1`)).rowCount);
    expect(n).toBe(0);
  });
});

describe("active_dentist_count", () => {
  const count = `select public.active_dentist_count($1) as n`;

  it("refuse un utilisateur extérieur au cabinet", async () => {
    await expect(asUser(db, attacker.id, () => q(count, [cab]))).rejects.toThrow(/not allowed/);
  });

  it("répond aux membres, à l'admin plateforme et à la clé service", async () => {
    const member = await asUser(db, assistant.id, async () => (await q(count, [cab])).rows[0].n);
    const admin = await asUser(db, platformAdmin.id, async () => (await q(count, [cab])).rows[0].n);
    const service = await asService(async () => (await q(count, [cab])).rows[0].n);
    expect(member).toBeGreaterThanOrEqual(2);
    expect(admin).toBe(member);
    expect(service).toBe(member);
  });

  it("admin_cabinets et admin_metrics fonctionnent toujours", async () => {
    const res = await asUser(db, platformAdmin.id, async () => ({
      cabinets: (await q(`select id, active_dentists from public.admin_cabinets() where id = $1`, [cab])).rows,
      metrics: (await q(`select public.admin_metrics() as m`)).rows[0].m,
    }));
    expect(res.cabinets[0].active_dentists).toBeGreaterThanOrEqual(2);
    expect(Number(res.metrics.active_dentists)).toBeGreaterThan(0);
  });
});
