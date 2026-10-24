import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

let db: Client;
let ownerA: { id: string };
let ownerB: { id: string };
let assistantA: { id: string };
let accountantA: { id: string };
let cabA: string;
let cabB: string;
let patientA: string;
let patientB: string;

beforeAll(async () => {
  db = await connect();
  ownerA = await createUser(db);
  ownerB = await createUser(db);
  assistantA = await createUser(db);
  accountantA = await createUser(db);
  cabA = await createCabinet(db, ownerA.id);
  cabB = await createCabinet(db, ownerB.id);
  await addMember(db, cabA, assistantA.id, ["assistant"]);
  await addMember(db, cabA, accountantA.id, ["accountant"]);

  patientA = await asUser(db, ownerA.id, async () => {
    const { rows } = await db.query(
      `insert into public.patients (cabinet_id, first_name, last_name, phone) values ($1, 'Mariama', 'Diallo', '+224620000001') returning id`,
      [cabA],
    );
    await db.query(`insert into public.patient_medical (patient_id, cabinet_id, allergies) values ($1, $2, 'Pénicilline')`, [
      rows[0].id,
      cabA,
    ]);
    await db.query(
      `insert into public.clinical_notes (cabinet_id, patient_id, author_id, body) values ($1, $2, $3, 'Note clinique')`,
      [cabA, rows[0].id, ownerA.id],
    );
    return rows[0].id as string;
  }, true);

  patientB = await asUser(db, ownerB.id, async () => {
    const { rows } = await db.query(
      `insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'Ibrahima', 'Camara') returning id`,
      [cabB],
    );
    return rows[0].id as string;
  }, true);
});

afterAll(async () => {
  await db.end();
});

describe("isolation entre cabinets", () => {
  it("un membre ne voit que les patients de son cabinet", async () => {
    const ids = await asUser(db, ownerA.id, async () => {
      const { rows } = await db.query(`select id from public.patients`);
      return rows.map((r) => r.id);
    });
    expect(ids).toContain(patientA);
    expect(ids).not.toContain(patientB);
  });

  it("un membre ne peut pas écrire dans un autre cabinet", async () => {
    await expect(
      asUser(db, ownerA.id, () =>
        db.query(`insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'X', 'Y')`, [cabB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("un membre ne peut pas modifier une ligne d'un autre cabinet", async () => {
    const count = await asUser(db, ownerA.id, async () => {
      const r = await db.query(`update public.patients set first_name = 'Pirate' where id = $1`, [patientB]);
      return r.rowCount;
    });
    expect(count).toBe(0);
  });

  it("cabinet_id ne peut pas être déplacé vers un autre cabinet", async () => {
    await expect(
      asUser(db, ownerA.id, () => db.query(`update public.patients set cabinet_id = $1 where id = $2`, [cabB, patientA])),
    ).rejects.toThrow();
  });

  it("un anonyme ne voit aucun patient", async () => {
    const n = await asUser(db, null, async () => (await db.query(`select id from public.patients`)).rowCount);
    expect(n).toBe(0);
  });
});

describe("rôles", () => {
  it("le secrétariat voit les alertes médicales mais pas les notes cliniques", async () => {
    const [medical, notes] = await asUser(db, assistantA.id, async () => [
      (await db.query(`select * from public.patient_medical`)).rowCount,
      (await db.query(`select * from public.clinical_notes`)).rowCount,
    ]);
    expect(medical).toBe(1);
    expect(notes).toBe(0);
  });

  it("le comptable ne voit ni les infos médicales ni les notes, mais voit les patients", async () => {
    const [patients, medical, notes] = await asUser(db, accountantA.id, async () => [
      (await db.query(`select * from public.patients`)).rowCount,
      (await db.query(`select * from public.patient_medical`)).rowCount,
      (await db.query(`select * from public.clinical_notes`)).rowCount,
    ]);
    expect(patients).toBe(1);
    expect(medical).toBe(0);
    expect(notes).toBe(0);
  });

  it("le comptable ne peut pas créer de facture", async () => {
    await expect(
      asUser(db, accountantA.id, () =>
        db.query(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2)`, [cabA, patientA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("un admin ne peut pas modifier son propre abonnement", async () => {
    await expect(
      asUser(db, ownerA.id, () =>
        db.query(`update public.cabinets set subscription_status = 'active' where id = $1`, [cabA]),
      ),
    ).rejects.toThrow(/managed by the platform/);
  });

  it("un utilisateur ne peut pas se déclarer admin plateforme", async () => {
    await expect(
      asUser(db, ownerA.id, () => db.query(`update public.profiles set is_platform_admin = true where id = $1`, [ownerA.id])),
    ).rejects.toThrow(/not allowed/);
  });
});

describe("agenda", () => {
  it("refuse deux rendez-vous qui se chevauchent pour le même praticien", async () => {
    await expect(
      asUser(db, ownerA.id, async () => {
        await db.query(
          `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
           values ($1, $2, $3, '2030-01-07 09:00+00', '2030-01-07 09:30+00')`,
          [cabA, patientA, ownerA.id],
        );
        await db.query(
          `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
           values ($1, $2, $3, '2030-01-07 09:15+00', '2030-01-07 09:45+00')`,
          [cabA, patientA, ownerA.id],
        );
      }),
    ).rejects.toThrow(/appointments_no_dentist_overlap/);
  });

  it("accepte un créneau libéré par une annulation", async () => {
    await asUser(db, ownerA.id, async () => {
      await db.query(
        `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at, status)
         values ($1, $2, $3, '2030-01-08 09:00+00', '2030-01-08 09:30+00', 'cancelled')`,
        [cabA, patientA, ownerA.id],
      );
      await db.query(
        `insert into public.appointments (cabinet_id, patient_id, dentist_id, starts_at, ends_at)
         values ($1, $2, $3, '2030-01-08 09:00+00', '2030-01-08 09:30+00')`,
        [cabA, patientA, ownerA.id],
      );
    });
  });
});

describe("facturation", () => {
  it("numérote, calcule les totaux côté serveur et suit les paiements", async () => {
    const result = await asUser(db, assistantA.id, async () => {
      const inv = await db.query(
        `insert into public.invoices (cabinet_id, patient_id, total_gnf, paid_gnf) values ($1, $2, 999, 999) returning *`,
        [cabA, patientA],
      );
      const id = inv.rows[0].id;
      const draft = inv.rows[0];
      await db.query(
        `insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf)
         values ($1, $2, 'Détartrage', 1, 150000), ($1, $2, 'Soin carie', 2, 100000)`,
        [cabA, id],
      );
      await db.query(`update public.invoices set status = 'issued' where id = $1`, [id]);
      const issued = (await db.query(`select * from public.invoices where id = $1`, [id])).rows[0];
      await db.query(`update public.invoices set total_gnf = 1 where id = $1`, [id]);
      const tampered = (await db.query(`select total_gnf from public.invoices where id = $1`, [id])).rows[0];
      await db.query(
        `insert into public.payments (cabinet_id, invoice_id, amount_gnf, method) values ($1, $2, 100000, 'cash')`,
        [cabA, id],
      );
      const partial = (await db.query(`select * from public.invoices where id = $1`, [id])).rows[0];
      await db.query(
        `insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, reference) values ($1, $2, 250000, 'orange_money', 'OM123')`,
        [cabA, id],
      );
      const paid = (await db.query(`select * from public.invoices where id = $1`, [id])).rows[0];
      return { draft, issued, tampered, partial, paid };
    });
    expect(result.draft.number).toBeNull();
    expect(Number(result.draft.total_gnf)).toBe(0);
    expect(result.issued.number).toMatch(/^F-\d{4}-\d{5}$/);
    expect(Number(result.issued.total_gnf)).toBe(350000);
    expect(Number(result.tampered.total_gnf)).toBe(350000);
    expect(result.partial.status).toBe("partially_paid");
    expect(Number(result.partial.paid_gnf)).toBe(100000);
    expect(result.paid.status).toBe("paid");
  });

  it("refuse un paiement lié à une transaction en ligne depuis le client", async () => {
    await expect(
      asUser(db, ownerA.id, async () => {
        const inv = await db.query(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2) returning id`, [
          cabA,
          patientA,
        ]);
        await db.query(
          `insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, transaction_id)
           values ($1, $2, 1000, 'orange_money', gen_random_uuid())`,
          [cabA, inv.rows[0].id],
        );
      }),
    ).rejects.toThrow(/recorded by the server/);
  });
});

describe("abonnement expiré", () => {
  it("passe le cabinet en lecture seule", async () => {
    await db.query(`update public.cabinets set subscription_status = 'expired' where id = $1`, [cabB]);
    try {
      const visible = await asUser(db, ownerB.id, async () => (await db.query(`select id from public.patients`)).rowCount);
      expect(visible).toBe(1);
      await expect(
        asUser(db, ownerB.id, () =>
          db.query(`insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'A', 'B')`, [cabB]),
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await db.query(`update public.cabinets set subscription_status = 'trialing' where id = $1`, [cabB]);
    }
  });
});

describe("espace patient", () => {
  it("le patient ne voit que ses factures émises", async () => {
    const portalUser = await createUser(db);
    await db.query(`update public.patients set portal_user_id = $1 where id = $2`, [portalUser.id, patientA]);
    await asUser(db, ownerA.id, async () => {
      await db.query(`insert into public.invoices (cabinet_id, patient_id, notes) values ($1, $2, 'brouillon')`, [cabA, patientA]);
    }, true);
    const rows = await asUser(db, portalUser.id, async () => {
      return {
        invoices: (await db.query(`select status from public.invoices`)).rows,
        patients: (await db.query(`select id from public.patients`)).rows,
        notes: (await db.query(`select id from public.clinical_notes`)).rowCount,
      };
    });
    expect(rows.invoices.every((i) => i.status !== "draft")).toBe(true);
    expect(rows.patients.map((p) => p.id)).toEqual([patientA]);
    expect(rows.notes).toBe(0);
  });

  it("la page publique est accessible sans compte", async () => {
    const slug = (await db.query(`select slug from public.cabinets where id = $1`, [cabA])).rows[0].slug;
    const page = await asUser(db, null, async () => (await db.query(`select public.public_cabinet($1) as p`, [slug])).rows[0].p);
    expect(page.name).toContain("Cabinet");
    expect(page.appointment_types.length).toBeGreaterThan(0);
  });
});
