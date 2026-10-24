import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

let db: Client;
let owner: { id: string };
let assistant: { id: string };
let accountant: { id: string };
let otherOwner: { id: string };
let cab: string;
let otherCab: string;
let patient: string;
let otherPatient: string;

async function newPatient(userId: string, cabinetId: string) {
  return asUser(
    db,
    userId,
    async () => {
      const { rows } = await db.query(
        `insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'Aïssatou', 'Bah') returning id`,
        [cabinetId],
      );
      return rows[0].id as string;
    },
    true,
  );
}

/** Upsert comme le moteur de synchronisation (PostgREST : INSERT ... ON CONFLICT (id) DO UPDATE). */
async function upsertInvoice(row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const values = cols.map((_, i) => `$${i + 1}`).join(", ");
  const set = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
  const { rows } = await db.query(
    `insert into public.invoices (${cols.join(", ")}) values (${values}) on conflict (id) do update set ${set} returning *`,
    cols.map((c) => row[c]),
  );
  return rows[0];
}

async function issuedInvoice(cabinetId: string, patientId: string, issueDate?: string) {
  const { rows } = await db.query(
    `insert into public.invoices (cabinet_id, patient_id, status, issue_date) values ($1, $2, 'issued', coalesce($3::date, current_date)) returning *`,
    [cabinetId, patientId, issueDate ?? null],
  );
  return rows[0];
}

const invoice = async (id: string) => (await db.query(`select * from public.invoices where id = $1`, [id])).rows[0];

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db);
  assistant = await createUser(db);
  accountant = await createUser(db);
  otherOwner = await createUser(db);
  cab = await createCabinet(db, owner.id);
  otherCab = await createCabinet(db, otherOwner.id);
  await addMember(db, cab, assistant.id, ["assistant"]);
  await addMember(db, cab, accountant.id, ["accountant"]);
  patient = await newPatient(owner.id, cab);
  otherPatient = await newPatient(otherOwner.id, otherCab);
});

afterAll(async () => {
  await db.end();
});

describe("numérotation", () => {
  it("est séquentielle par cabinet et par année, sans numéro pour les brouillons", async () => {
    const r = await asUser(db, owner.id, async () => {
      const draft = (
        await db.query(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2) returning *`, [cab, patient])
      ).rows[0];
      const a = await issuedInvoice(cab, patient, "2026-03-01");
      const b = await issuedInvoice(cab, patient, "2026-05-01");
      const old = await issuedInvoice(cab, patient, "2025-12-31");
      const c = await issuedInvoice(cab, patient, "2026-06-01");
      return { draft, a, b, old, c };
    });
    expect(r.draft.number).toBeNull();
    expect([r.a.number, r.b.number, r.c.number]).toEqual(["F-2026-00001", "F-2026-00002", "F-2026-00003"]);
    expect(r.old.number).toBe("F-2025-00001");

    // Un autre cabinet a sa propre séquence.
    const other = await asUser(db, otherOwner.id, () => issuedInvoice(otherCab, otherPatient, "2026-03-01"));
    expect(other.number).toBe("F-2026-00001");
  });

  it("ne crée pas de trou quand la synchronisation émet ou modifie une facture par upsert", async () => {
    const numbers = await asUser(db, owner.id, async () => {
      const cabinetId = cab;
      const id = randomUUID();
      const base = { id, cabinet_id: cabinetId, patient_id: patient, issue_date: "2027-01-10" };
      await upsertInvoice({ ...base, status: "draft" });
      const issued = await upsertInvoice({ ...base, status: "issued" }); // brouillon -> émise
      await upsertInvoice({ ...base, status: "issued", notes: "modifiée" }); // simple modification
      const id2 = randomUUID();
      const second = await upsertInvoice({ id: id2, cabinet_id: cabinetId, patient_id: patient, issue_date: "2027-02-01", status: "issued" });
      return [issued.number, (await invoice(id)).number, second.number];
    });
    expect(numbers).toEqual(["F-2027-00001", "F-2027-00001", "F-2027-00002"]);
  });

  it("numérote les devis à l'envoi (D-AAAA-NNNNN) et le numéro est immuable", async () => {
    await expect(
      asUser(db, owner.id, async () => {
        const q = (
          await db.query(
            `insert into public.quotes (cabinet_id, patient_id, issue_date) values ($1, $2, '2028-01-05') returning id, number`,
            [cab, patient],
          )
        ).rows[0];
        expect(q.number).toBeNull();
        const sent = (await db.query(`update public.quotes set status = 'sent' where id = $1 returning number`, [q.id])).rows[0];
        expect(sent.number).toBe("D-2028-00001");
        await db.query(`update public.quotes set number = 'D-2028-99999' where id = $1`, [q.id]);
      }),
    ).rejects.toThrow(/number is immutable/);
  });
});

describe("totaux et paiements", () => {
  it("calcule les totaux côté serveur et ignore les valeurs envoyées par le client", async () => {
    const r = await asUser(db, assistant.id, async () => {
      const q = (
        await db.query(`insert into public.quotes (cabinet_id, patient_id, total_gnf) values ($1, $2, 5) returning id, total_gnf`, [
          cab,
          patient,
        ])
      ).rows[0];
      await db.query(
        `insert into public.quote_items (cabinet_id, quote_id, label, quantity, unit_price_gnf) values ($1, $2, 'Couronne', 2, 2500000)`,
        [cab, q.id],
      );
      await db.query(`update public.quotes set total_gnf = 1 where id = $1`, [q.id]);
      const quoteTotal = (await db.query(`select total_gnf from public.quotes where id = $1`, [q.id])).rows[0].total_gnf;

      const inv = await issuedInvoice(cab, patient);
      const items = await db.query(
        `insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf)
         values ($1, $2, 'Consultation', 1, 100000), ($1, $2, 'Composite', 3, 300000) returning id`,
        [cab, inv.id],
      );
      const full = await invoice(inv.id);
      await db.query(`update public.invoice_items set deleted_at = now() where id = $1`, [items.rows[0].id]);
      const afterDelete = await invoice(inv.id);
      return { initial: q.total_gnf, quoteTotal, full, afterDelete };
    });
    expect(Number(r.initial)).toBe(0);
    expect(Number(r.quoteTotal)).toBe(5_000_000);
    expect(Number(r.full.total_gnf)).toBe(1_000_000);
    expect(Number(r.afterDelete.total_gnf)).toBe(900_000);
  });

  it("suit les paiements partiels et le statut payé, y compris après annulation d'un paiement", async () => {
    const r = await asUser(db, assistant.id, async () => {
      const inv = await issuedInvoice(cab, patient);
      await db.query(
        `insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf) values ($1, $2, 'Bridge', 1, 600000)`,
        [cab, inv.id],
      );
      const p1 = (
        await db.query(
          `insert into public.payments (cabinet_id, invoice_id, amount_gnf, method) values ($1, $2, 200000, 'cash') returning id`,
          [cab, inv.id],
        )
      ).rows[0].id;
      const partial = await invoice(inv.id);
      await db.query(
        `insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, reference) values ($1, $2, 400000, 'mtn_momo', 'MP2610.1234')`,
        [cab, inv.id],
      );
      const paid = await invoice(inv.id);
      // Le client ne peut pas forcer le statut « payé ».
      await db.query(`update public.payments set deleted_at = now() where id = $1`, [p1]);
      const reopened = await invoice(inv.id);
      await db.query(`update public.invoices set status = 'paid' where id = $1`, [inv.id]);
      const forced = await invoice(inv.id);
      // Un paiement en attente ne compte pas.
      await db.query(
        `insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, status) values ($1, $2, 200000, 'transfer', 'pending')`,
        [cab, inv.id],
      );
      const pending = await invoice(inv.id);
      return { partial, paid, reopened, forced, pending };
    });
    expect(r.partial.status).toBe("partially_paid");
    expect(Number(r.partial.paid_gnf)).toBe(200_000);
    expect(r.paid.status).toBe("paid");
    expect(Number(r.paid.paid_gnf)).toBe(600_000);
    expect(r.reopened.status).toBe("partially_paid");
    expect(Number(r.reopened.paid_gnf)).toBe(400_000);
    expect(r.forced.status).toBe("partially_paid");
    expect(r.pending.status).toBe("partially_paid");
  });

  it("une facture annulée le reste et un paiement est immuable", async () => {
    const status = await asUser(db, owner.id, async () => {
      const inv = await issuedInvoice(cab, patient);
      await db.query(
        `insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf) values ($1, $2, 'Radio', 1, 75000)`,
        [cab, inv.id],
      );
      await db.query(`update public.invoices set status = 'cancelled' where id = $1`, [inv.id]);
      await db.query(
        `insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf) values ($1, $2, 'Radio', 1, 75000)`,
        [cab, inv.id],
      );
      return (await invoice(inv.id)).status;
    });
    expect(status).toBe("cancelled");

    await expect(
      asUser(db, owner.id, async () => {
        const inv = await issuedInvoice(cab, patient);
        const p = (
          await db.query(
            `insert into public.payments (cabinet_id, invoice_id, amount_gnf, method) values ($1, $2, 1000, 'cash') returning id`,
            [cab, inv.id],
          )
        ).rows[0].id;
        await db.query(`update public.payments set amount_gnf = 2000 where id = $1`, [p]);
      }),
    ).rejects.toThrow(/immutable/);
  });

  it("enregistre le praticien de la facture et l'échéancier", async () => {
    const r = await asUser(db, owner.id, async () => {
      const inv = (
        await db.query(`insert into public.invoices (cabinet_id, patient_id, dentist_id) values ($1, $2, $3) returning *`, [
          cab,
          patient,
          owner.id,
        ])
      ).rows[0];
      await db.query(
        `insert into public.payment_installments (cabinet_id, invoice_id, due_date, amount_gnf) values ($1, $2, '2026-11-01', 100000), ($1, $2, '2026-12-01', 100000)`,
        [cab, inv.id],
      );
      const n = (await db.query(`select count(*)::int as n from public.payment_installments where invoice_id = $1`, [inv.id])).rows[0].n;
      return { dentist: inv.dentist_id, n };
    });
    expect(r).toEqual({ dentist: owner.id, n: 2 });
  });
});

describe("comptable", () => {
  let invoiceId: string;

  beforeAll(async () => {
    invoiceId = await asUser(
      db,
      owner.id,
      async () => {
        const inv = await issuedInvoice(cab, patient);
        await db.query(
          `insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf) values ($1, $2, 'Consultation', 1, 100000)`,
          [cab, inv.id],
        );
        await db.query(`insert into public.payments (cabinet_id, invoice_id, amount_gnf, method) values ($1, $2, 50000, 'cash')`, [
          cab,
          inv.id,
        ]);
        return inv.id as string;
      },
      true,
    );
  });

  it("lit les factures, lignes, paiements et devis", async () => {
    const counts = await asUser(db, accountant.id, async () => {
      const q = async (sql: string) => (await db.query(sql, [invoiceId])).rows[0].n as number;
      return {
        invoices: await q(`select count(*)::int as n from public.invoices where id = $1`),
        items: await q(`select count(*)::int as n from public.invoice_items where invoice_id = $1`),
        payments: await q(`select count(*)::int as n from public.payments where invoice_id = $1`),
      };
    });
    expect(counts).toEqual({ invoices: 1, items: 1, payments: 1 });
  });

  it("ne peut rien écrire", async () => {
    await expect(
      asUser(db, accountant.id, () =>
        db.query(`insert into public.payments (cabinet_id, invoice_id, amount_gnf, method) values ($1, $2, 50000, 'cash')`, [
          cab,
          invoiceId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, accountant.id, () =>
        db.query(`insert into public.quotes (cabinet_id, patient_id) values ($1, $2)`, [cab, patient]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, accountant.id, () =>
        db.query(`insert into public.acts (cabinet_id, label, price_gnf) values ($1, 'Test', 1)`, [cab]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await asUser(db, accountant.id, async () => {
      const a = await db.query(`update public.invoices set status = 'cancelled' where id = $1`, [invoiceId]);
      const b = await db.query(`update public.payments set deleted_at = now() where invoice_id = $1`, [invoiceId]);
      return (a.rowCount ?? 0) + (b.rowCount ?? 0);
    });
    expect(updated).toBe(0);
  });

  it("un autre cabinet ne voit pas ces factures", async () => {
    const n = await asUser(db, otherOwner.id, async () => {
      return (await db.query(`select count(*)::int as n from public.invoices where cabinet_id = $1`, [cab])).rows[0].n;
    });
    expect(n).toBe(0);
  });
});
