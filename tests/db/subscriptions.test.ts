import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

let db: Client;
let ownerA: { id: string };
let ownerB: { id: string };
let assistantA: { id: string };
let cabA: string;
let cabB: string;
let invoiceA: string;
let invoiceB: string;

/** Facture émise de 200 000 GNF (une ligne). */
async function issuedInvoice(ownerId: string, cabinetId: string) {
  return asUser(
    db,
    ownerId,
    async () => {
      const { rows: p } = await db.query(
        `insert into public.patients (cabinet_id, first_name, last_name) values ($1, 'Aïssatou', 'Bah') returning id`,
        [cabinetId],
      );
      const { rows: inv } = await db.query(`insert into public.invoices (cabinet_id, patient_id) values ($1, $2) returning id`, [
        cabinetId,
        p[0].id,
      ]);
      await db.query(
        `insert into public.invoice_items (cabinet_id, invoice_id, label, quantity, unit_price_gnf) values ($1, $2, 'Détartrage', 1, 200000)`,
        [cabinetId, inv[0].id],
      );
      await db.query(`update public.invoices set status = 'issued' where id = $1`, [inv[0].id]);
      return inv[0].id as string;
    },
    true,
  );
}

async function newTransaction(fields: {
  cabinet: string;
  purpose: "invoice" | "subscription";
  invoice?: string | null;
  amount: number;
  cycle?: "monthly" | "yearly" | null;
  provider?: string;
}) {
  const { rows } = await db.query(
    `insert into public.payment_transactions (cabinet_id, purpose, invoice_id, provider, amount_gnf, payer_phone, subscription_cycle, plan_id, dentist_count)
     values ($1, $2, $3, $4, $5, '+224620000000', $6, (select id from public.plans where code = 'solo'), 1) returning id`,
    [fields.cabinet, fields.purpose, fields.invoice ?? null, fields.provider ?? "orange_money", fields.amount, fields.cycle ?? null],
  );
  return rows[0].id as string;
}

const complete = async (id: string, status = "succeeded", ref = `TXN-${id.slice(0, 8)}`) =>
  (await db.query(`select public.complete_transaction($1, $2, $3) as s`, [id, status, ref])).rows[0].s as string;

const cabinet = async (id: string) =>
  (await db.query(`select subscription_status, current_period_end, trial_ends_at, plan_id, billing_cycle from public.cabinets where id = $1`, [id]))
    .rows[0];

beforeAll(async () => {
  db = await connect();
  ownerA = await createUser(db);
  ownerB = await createUser(db);
  assistantA = await createUser(db);
  cabA = await createCabinet(db, ownerA.id);
  cabB = await createCabinet(db, ownerB.id);
  await addMember(db, cabA, assistantA.id, ["assistant"]);
  invoiceA = await issuedInvoice(ownerA.id, cabA);
  invoiceB = await issuedInvoice(ownerB.id, cabB);
});

afterAll(async () => {
  await db.end();
});

describe("formules", () => {
  it("calcule le prix selon le nombre de dentistes", async () => {
    const price = async (n: number, cycle: string) =>
      (await db.query(`select plan_code, amount_gnf from public.subscription_price($1, $2)`, [n, cycle])).rows[0];
    expect(await price(1, "monthly")).toMatchObject({ plan_code: "solo" });
    expect(await price(3, "monthly")).toMatchObject({ plan_code: "cabinet" });
    const k = await price(4, "monthly");
    const k6 = await price(6, "monthly");
    expect(k.plan_code).toBe("clinique");
    const plan = (await db.query(`select * from public.plans where code = 'clinique'`)).rows[0];
    expect(Number(k6.amount_gnf) - Number(k.amount_gnf)).toBe(2 * Number(plan.price_per_extra_dentist_gnf));
  });
});

describe("finalisation d'une transaction de facture", () => {
  it("enregistre le paiement une seule fois et solde la facture", async () => {
    const tx = await newTransaction({ cabinet: cabA, purpose: "invoice", invoice: invoiceA, amount: 200000 });
    expect(await complete(tx)).toBe("succeeded");
    expect(await complete(tx)).toBe("succeeded"); // webhook rejoué
    expect(await complete(tx, "failed")).toBe("succeeded"); // un échec tardif ne change rien

    const { rows: payments } = await db.query(`select amount_gnf, method, reference from public.payments where transaction_id = $1`, [tx]);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: "orange_money", reference: `TXN-${tx.slice(0, 8)}` });
    const { rows: inv } = await db.query(`select status, paid_gnf from public.invoices where id = $1`, [invoiceA]);
    expect(inv[0]).toMatchObject({ status: "paid" });
    expect(Number(inv[0].paid_gnf)).toBe(200000);
  });

  it("n'enregistre rien pour un échec et accepte une réussite tardive après expiration", async () => {
    const invoice = await issuedInvoice(ownerA.id, cabA);
    const failed = await newTransaction({ cabinet: cabA, purpose: "invoice", invoice, amount: 50000, provider: "mtn_momo" });
    expect(await complete(failed, "failed")).toBe("failed");
    expect((await db.query(`select count(*)::int as n from public.payments where transaction_id = $1`, [failed])).rows[0].n).toBe(0);

    const late = await newTransaction({ cabinet: cabA, purpose: "invoice", invoice, amount: 50000, provider: "mtn_momo" });
    expect(await complete(late, "expired")).toBe("expired");
    expect(await complete(late, "succeeded")).toBe("succeeded");
    const { rows } = await db.query(`select status, paid_gnf from public.invoices where id = $1`, [invoice]);
    expect(rows[0]).toMatchObject({ status: "partially_paid" });
    expect(Number(rows[0].paid_gnf)).toBe(50000);
  });

  it("refuse une transaction liée à la facture d'un autre cabinet", async () => {
    await expect(newTransaction({ cabinet: cabA, purpose: "invoice", invoice: invoiceB, amount: 1000 })).rejects.toThrow(
      /does not belong to this cabinet/,
    );
  });
});

describe("abonnement", () => {
  it("prolonge la période depuis la fin de l'essai, puis depuis la fin de période", async () => {
    const before = await cabinet(cabA);
    expect(before.subscription_status).toBe("trialing");
    const trialEnd = new Date(before.trial_ends_at).getTime();

    const tx1 = await newTransaction({ cabinet: cabA, purpose: "subscription", amount: 150000, cycle: "monthly" });
    expect(await complete(tx1)).toBe("succeeded");
    const after1 = await cabinet(cabA);
    expect(after1.subscription_status).toBe("active");
    expect(after1.billing_cycle).toBe("monthly");
    const end1 = new Date(after1.current_period_end).getTime();
    const month = 27 * 24 * 3600 * 1000;
    expect(end1 - trialEnd).toBeGreaterThan(month);
    expect(end1 - trialEnd).toBeLessThan(32 * 24 * 3600 * 1000);

    // Rejouer la notification ne prolonge pas une seconde fois.
    await complete(tx1);
    expect(new Date((await cabinet(cabA)).current_period_end).getTime()).toBe(end1);

    const tx2 = await newTransaction({ cabinet: cabA, purpose: "subscription", amount: 1530000, cycle: "yearly" });
    await complete(tx2);
    const after2 = await cabinet(cabA);
    const end2 = new Date(after2.current_period_end).getTime();
    expect(after2.billing_cycle).toBe("yearly");
    expect(end2 - end1).toBeGreaterThan(364 * 24 * 3600 * 1000);
    expect(end2 - end1).toBeLessThan(367 * 24 * 3600 * 1000);

    const { rows } = await db.query(`select count(*)::int as n from public.subscription_payments where cabinet_id = $1`, [cabA]);
    expect(rows[0].n).toBe(2);
  });

  it("repart de maintenant quand la période est déjà terminée", async () => {
    const user = await createUser(db);
    const cab = await createCabinet(db, user.id);
    await db.query(`update public.cabinets set subscription_status = 'expired', current_period_end = now() - interval '60 days' where id = $1`, [cab]);
    const tx = await newTransaction({ cabinet: cab, purpose: "subscription", amount: 150000, cycle: "monthly" });
    await complete(tx);
    const c = await cabinet(cab);
    expect(c.subscription_status).toBe("active");
    const days = (new Date(c.current_period_end).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
  });

  it("expire les essais terminés et applique 7 jours de grâce", async () => {
    const mk = async () => createCabinet(db, (await createUser(db)).id);
    const [trialOver, justEnded, longEnded, stillActive] = await Promise.all([mk(), mk(), mk(), mk()]);
    await db.query(`update public.cabinets set trial_ends_at = now() - interval '1 hour' where id = $1`, [trialOver]);
    await db.query(`update public.cabinets set subscription_status = 'active', current_period_end = now() - interval '2 days' where id = $1`, [justEnded]);
    await db.query(`update public.cabinets set subscription_status = 'past_due', current_period_end = now() - interval '8 days' where id = $1`, [longEnded]);
    await db.query(`update public.cabinets set subscription_status = 'active', current_period_end = now() + interval '3 days' where id = $1`, [stillActive]);

    await db.query(`select public.expire_subscriptions()`);

    expect((await cabinet(trialOver)).subscription_status).toBe("expired");
    expect((await cabinet(justEnded)).subscription_status).toBe("past_due");
    expect((await cabinet(longEnded)).subscription_status).toBe("expired");
    expect((await cabinet(stillActive)).subscription_status).toBe("active");

    // past_due reste modifiable (grâce) ; expiré passe en lecture seule.
    const w = async (id: string) => (await db.query(`select app.cabinet_writable($1) as w`, [id])).rows[0].w;
    expect(await w(justEnded)).toBe(true);
    expect(await w(longEnded)).toBe(false);
  });
});

describe("droits", () => {
  it("un admin de cabinet ne peut pas modifier son abonnement", async () => {
    await expect(
      asUser(db, ownerB.id, () =>
        db.query(`update public.cabinets set subscription_status = 'active', current_period_end = now() + interval '10 years' where id = $1`, [cabB]),
      ),
    ).rejects.toThrow(/managed by the platform/);
  });

  it("un admin de cabinet ne peut ni finaliser ni créer de transaction", async () => {
    const tx = await newTransaction({ cabinet: cabB, purpose: "subscription", amount: 150000, cycle: "monthly" });
    await expect(asUser(db, ownerB.id, () => db.query(`select public.complete_transaction($1, 'succeeded')`, [tx]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(asUser(db, ownerB.id, () => db.query(`select app.complete_transaction($1, 'succeeded')`, [tx]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(db, ownerB.id, () =>
        db.query(
          `insert into public.payment_transactions (cabinet_id, purpose, provider, amount_gnf, payer_phone, subscription_cycle, status)
           values ($1, 'subscription', 'orange_money', 1, '+224620000000', 'monthly', 'succeeded')`,
          [cabB],
        ),
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
    await expect(asUser(db, ownerB.id, () => db.query(`select public.expire_subscriptions()`))).rejects.toThrow(/permission denied/);
  });

  it("le paiement en ligne ne peut pas être saisi depuis le navigateur", async () => {
    const tx = await newTransaction({ cabinet: cabB, purpose: "invoice", invoice: invoiceB, amount: 1000 });
    await expect(
      asUser(db, ownerB.id, () =>
        db.query(
          `insert into public.payments (cabinet_id, invoice_id, amount_gnf, method, transaction_id) values ($1, $2, 1000, 'orange_money', $3)`,
          [cabB, invoiceB, tx],
        ),
      ),
    ).rejects.toThrow(/recorded by the server/);
  });

  it("les secrets opérateur ne sont pas lisibles par les membres", async () => {
    const tx = await newTransaction({ cabinet: cabA, purpose: "subscription", amount: 150000, cycle: "monthly" });
    await db.query(`insert into public.payment_transaction_secrets (transaction_id, secret) values ($1, 'nt')`, [tx]);
    await expect(asUser(db, ownerA.id, () => db.query(`select * from public.payment_transaction_secrets`))).rejects.toThrow(/permission denied/);
  });

  it("le dernier administrateur ne peut pas retirer son rôle", async () => {
    const { rows } = await db.query(`select id from public.memberships where cabinet_id = $1 and user_id = $2`, [cabB, ownerB.id]);
    await expect(
      asUser(db, ownerB.id, () => db.query(`update public.memberships set roles = '{dentist}' where id = $1`, [rows[0].id])),
    ).rejects.toThrow(/last administrator/);
    await expect(
      asUser(db, ownerB.id, () => db.query(`update public.memberships set active = false where id = $1`, [rows[0].id])),
    ).rejects.toThrow(/last administrator/);

    // Avec un second administrateur, c'est possible.
    const other = await createUser(db);
    await addMember(db, cabB, other.id, ["admin"]);
    await asUser(db, ownerB.id, () => db.query(`update public.memberships set roles = '{dentist}' where id = $1`, [rows[0].id]));
  });

  it("l'admin d'un cabinet peut enregistrer ses paramètres par upsert, pas créer un cabinet", async () => {
    await asUser(db, ownerA.id, () =>
      db.query(
        `insert into public.cabinets (id, name, slug) select id, 'Cabinet renommé', slug from public.cabinets where id = $1
         on conflict (id) do update set name = excluded.name`,
        [cabA],
      ),
    );
    await expect(
      asUser(db, ownerA.id, () => db.query(`insert into public.cabinets (name, slug) values ('Pirate', 'pirate-${Date.now()}')`)),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, assistantA.id, () =>
        db.query(
          `insert into public.cabinets (id, name, slug) select id, 'X', slug from public.cabinets where id = $1 on conflict (id) do update set name = excluded.name`,
          [cabA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("les RPC d'administration sont réservées à l'admin plateforme", async () => {
    await expect(asUser(db, ownerA.id, () => db.query(`select * from public.admin_cabinets()`))).rejects.toThrow(/not allowed/);
    const admin = await createUser(db);
    await db.query(`update public.profiles set is_platform_admin = true where id = $1`, [admin.id]);
    const rows = await asUser(db, admin.id, async () => (await db.query(`select * from public.admin_cabinets()`)).rows);
    const a = rows.find((r) => r.id === cabA);
    expect(a).toMatchObject({ subscription_status: "active", active_dentists: 1 });
    expect(a.last_payment_at).not.toBeNull();
    const m = await asUser(db, admin.id, async () => (await db.query(`select public.admin_metrics() as m`)).rows[0].m);
    expect(m.active).toBeGreaterThanOrEqual(1);
    expect(Number(m.revenue_month_gnf)).toBeGreaterThan(0);
  });
});
