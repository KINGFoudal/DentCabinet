import { describe, expect, it } from "vitest";
import {
  daysBetween,
  deriveInvoiceStatus,
  displayQuoteStatus,
  invoiceFigures,
  quoteFigures,
  sumLines,
  sumPayments,
} from "./totals";
import { addMonthsISO, allocateInstallments, overdueAmount, splitSchedule } from "./installments";
import { csvCell, toCSV } from "./csv";
import { canConvertQuote, planItemsToLines, plannedItems, quoteToInvoiceLines, uninvoicedDoneItems } from "./convert";
import { byDentist, byPaymentMethod, presetRange, revenueByDay, topActs } from "./reports";
import { actsToImport, BASE_ACTS } from "./catalog";
import { whatsappLink } from "./whatsapp";
import { initiateMobilePayment, mobilePaymentStatus } from "./mobile-payment";

describe("totaux", () => {
  const items = [
    { quantity: 1, unit_price_gnf: 150_000 },
    { quantity: 2, unit_price_gnf: 100_000 },
    { quantity: 5, unit_price_gnf: 1, deleted_at: "2026-01-01" },
  ];

  it("somme quantité × prix en ignorant les lignes supprimées", () => {
    expect(sumLines(items)).toBe(350_000);
  });

  it("ne compte que les paiements réussis et non supprimés", () => {
    expect(
      sumPayments([
        { amount_gnf: 100_000, status: "succeeded" },
        { amount_gnf: 50_000, status: "pending" },
        { amount_gnf: 20_000, status: "succeeded", deleted_at: "x" },
      ]),
    ).toBe(100_000);
  });

  it("applique la même règle de statut que le serveur", () => {
    expect(deriveInvoiceStatus("draft", 100, 100)).toBe("draft");
    expect(deriveInvoiceStatus("cancelled", 100, 0)).toBe("cancelled");
    expect(deriveInvoiceStatus("issued", 100, 0)).toBe("issued");
    expect(deriveInvoiceStatus("issued", 100, 40)).toBe("partially_paid");
    expect(deriveInvoiceStatus("partially_paid", 100, 100)).toBe("paid");
    expect(deriveInvoiceStatus("issued", 0, 0)).toBe("issued");
  });

  it("utilise les chiffres du serveur quand tout est synchronisé", () => {
    const f = invoiceFigures(
      { status: "partially_paid", total_gnf: 999, paid_gnf: 500, number: "F-2026-00001", _dirty: 0 },
      items,
      [{ amount_gnf: 1, status: "succeeded" }],
    );
    expect(f).toMatchObject({ total: 999, paid: 500, balance: 499, status: "partially_paid", provisional: false, numberPending: false });
  });

  it("calcule localement et marque provisoire si une ligne ou un paiement n'est pas synchronisé", () => {
    const f = invoiceFigures(
      { status: "issued", total_gnf: 0, paid_gnf: 0, number: null, _dirty: 0 },
      [...items, { quantity: 1, unit_price_gnf: 50_000, _dirty: 1 }],
      [{ amount_gnf: 400_000, status: "succeeded", _dirty: 1 }],
    );
    expect(f).toMatchObject({ total: 400_000, paid: 400_000, balance: 0, status: "paid", provisional: true, numberPending: true });
  });

  it("un brouillon n'a pas de reste à payer", () => {
    const f = invoiceFigures({ status: "draft", total_gnf: 0, paid_gnf: 0, number: null, _dirty: 1 }, items, []);
    expect(f.balance).toBe(0);
    expect(f.numberPending).toBe(false);
  });

  it("devis : total serveur ou local", () => {
    expect(quoteFigures({ total_gnf: 10, number: "D-1", status: "sent", _dirty: 0 }, items).total).toBe(10);
    expect(quoteFigures({ total_gnf: 10, number: null, status: "sent", _dirty: 1 }, items)).toMatchObject({
      total: 350_000,
      provisional: true,
      numberPending: true,
    });
  });

  it("un devis envoyé dont la validité est passée est affiché expiré", () => {
    expect(displayQuoteStatus({ status: "sent", valid_until: "2026-01-01" }, "2026-01-02")).toBe("expired");
    expect(displayQuoteStatus({ status: "sent", valid_until: "2026-01-02" }, "2026-01-02")).toBe("sent");
    expect(displayQuoteStatus({ status: "accepted", valid_until: "2020-01-01" }, "2026-01-02")).toBe("accepted");
  });

  it("compte les jours entre deux dates", () => {
    expect(daysBetween("2026-01-31", "2026-03-01")).toBe(29);
  });
});

describe("échéancier", () => {
  it("ajoute des mois en restant en fin de mois", () => {
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("répartit le montant en entiers, l'arrondi sur la dernière échéance", () => {
    const s = splitSchedule(1_000_000, 3, "2026-10-24");
    expect(s.map((x) => x.amount_gnf)).toEqual([333_333, 333_333, 333_334]);
    expect(s.map((x) => x.due_date)).toEqual(["2026-10-24", "2026-11-24", "2026-12-24"]);
    expect(s.reduce((a, b) => a + b.amount_gnf, 0)).toBe(1_000_000);
    expect(splitSchedule(0, 3, "2026-10-24")).toEqual([]);
    expect(() => splitSchedule(2, 3, "2026-10-24")).toThrow();
  });

  it("affecte les paiements aux échéances les plus anciennes et repère les retards", () => {
    const inst = [
      { id: "c", due_date: "2026-12-01", amount_gnf: 100 },
      { id: "a", due_date: "2026-10-01", amount_gnf: 100 },
      { id: "b", due_date: "2026-11-01", amount_gnf: 100 },
      { id: "x", due_date: "2026-09-01", amount_gnf: 100, deleted_at: "y" },
    ];
    const r = allocateInstallments(inst, 150, "2026-11-15");
    expect(r.map((i) => [i.id, i.state, i.covered])).toEqual([
      ["a", "paid", 100],
      ["b", "overdue", 50],
      ["c", "upcoming", 0],
    ]);
    expect(overdueAmount(r)).toBe(50);
    expect(allocateInstallments(inst, 150, "2026-10-15")[1].state).toBe("partial");
    // Acompte de 200 versé avant d'échelonner le reste (300) d'une facture de 500.
    expect(allocateInstallments(inst, 200, "2026-10-15", 500).map((i) => i.covered)).toEqual([0, 0, 0]);
    expect(allocateInstallments(inst, 350, "2026-10-15", 500).map((i) => i.covered)).toEqual([100, 50, 0]);
  });
});

describe("export CSV", () => {
  it("échappe les cellules pour Excel", () => {
    expect(csvCell("Diallo; Mariama")).toBe('"Diallo; Mariama"');
    expect(csvCell('Dent "18"')).toBe('"Dent ""18"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(150000)).toBe("150000");
    expect(csvCell(null)).toBe("");
  });

  it("produit un fichier avec BOM UTF-8, « ; » et CRLF", () => {
    const csv = toCSV(["Numéro", "Montant"], [["F-2026-00001", 350000], ["F-2026-00002", 0]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe("﻿Numéro;Montant\r\nF-2026-00001;350000\r\nF-2026-00002;0\r\n");
  });
});

describe("conversions", () => {
  it("copie les lignes d'un devis dans l'ordre, sans les lignes supprimées", () => {
    const lines = quoteToInvoiceLines([
      { act_id: "b", label: "Couronne", tooth: 16, quantity: 1, unit_price_gnf: 2_500_000, sort_order: 2 },
      { act_id: null, label: "Supprimée", tooth: null, quantity: 1, unit_price_gnf: 1, sort_order: 0, deleted_at: "x" },
      { act_id: "a", label: "Dévitalisation", tooth: 16, quantity: 1, unit_price_gnf: 900_000, sort_order: 1 },
    ]);
    expect(lines.map((l) => [l.label, l.sort_order])).toEqual([
      ["Dévitalisation", 0],
      ["Couronne", 1],
    ]);
    expect(sumLines(lines)).toBe(3_400_000);
  });

  it("seul un devis accepté se convertit", () => {
    expect(canConvertQuote({ status: "accepted" })).toBe(true);
    expect(canConvertQuote({ status: "sent" })).toBe(false);
    expect(canConvertQuote({ status: "accepted", deleted_at: "x" })).toBe(false);
  });

  const plan = [
    { id: "1", act_id: null, label: "Détartrage", tooth: null, step: 1, quantity: 1, unit_price_gnf: 250_000, status: "done" as const },
    { id: "2", act_id: null, label: "Composite", tooth: 36, step: 2, quantity: 1, unit_price_gnf: 300_000, status: "planned" as const },
    { id: "3", act_id: null, label: "Extraction", tooth: 48, step: 1, quantity: 1, unit_price_gnf: 600_000, status: "done" as const },
    { id: "4", act_id: null, label: "Annulé", tooth: null, step: 1, quantity: 1, unit_price_gnf: 1, status: "cancelled" as const },
  ];

  it("transforme un plan en lignes (étapes dans l'ordre, sans les éléments annulés)", () => {
    const lines = planItemsToLines(plan, true);
    expect(lines.map((l) => l.plan_item_id)).toEqual(["1", "3", "2"]);
    expect(plannedItems(plan).map((i) => i.id)).toEqual(["2"]);
  });

  it("ne propose que les actes réalisés non encore facturés", () => {
    const invoices = [
      { id: "inv1", status: "issued" },
      { id: "inv2", status: "cancelled" },
    ];
    const invItems = [
      { plan_item_id: "1", invoice_id: "inv1" },
      { plan_item_id: "3", invoice_id: "inv2" },
    ];
    expect(uninvoicedDoneItems(plan, invItems, invoices).map((i) => i.id)).toEqual(["3"]);
  });
});

describe("rapports", () => {
  const invoices = [
    { id: "a", issue_date: "2026-10-01", status: "paid" as const, total: 300, dentist_id: "d1" },
    { id: "b", issue_date: "2026-10-02", status: "issued" as const, total: 200, dentist_id: null },
    { id: "c", issue_date: "2026-10-02", status: "draft" as const, total: 999, dentist_id: "d1" },
    { id: "d", issue_date: "2026-10-02", status: "cancelled" as const, total: 999, dentist_id: "d1" },
  ];
  const payments = [
    { paid_at: "2026-10-01T10:00:00Z", amount_gnf: 300, method: "cash", status: "succeeded" },
    { paid_at: "2026-10-02T23:30:00Z", amount_gnf: 50, method: "orange_money", status: "succeeded" },
    { paid_at: "2026-10-02T10:00:00Z", amount_gnf: 70, method: "orange_money", status: "succeeded", deleted_at: "x" },
  ];

  it("chiffre d'affaires facturé et encaissé par jour", () => {
    const r = revenueByDay(invoices, payments, "2026-10-01", "2026-10-03", "Africa/Conakry");
    expect(r).toEqual([
      { date: "2026-10-01", invoiced: 300, collected: 300 },
      { date: "2026-10-02", invoiced: 200, collected: 50 },
      { date: "2026-10-03", invoiced: 0, collected: 0 },
    ]);
  });

  it("par moyen de paiement et par praticien", () => {
    expect(byPaymentMethod(payments)).toEqual([
      { method: "cash", count: 1, amount: 300 },
      { method: "orange_money", count: 1, amount: 50 },
    ]);
    expect(byDentist(invoices)).toEqual([
      { dentist_id: "d1", count: 1, amount: 300 },
      { dentist_id: null, count: 1, amount: 200 },
    ]);
  });

  it("actes les plus fréquents", () => {
    const items = [
      { invoice_id: "a", act_id: "x", label: "Consultation", quantity: 1, unit_price_gnf: 100 },
      { invoice_id: "b", act_id: "x", label: "Consultation", quantity: 2, unit_price_gnf: 100 },
      { invoice_id: "b", act_id: null, label: "Divers ", quantity: 1, unit_price_gnf: 5 },
      { invoice_id: "c", act_id: "y", label: "Brouillon", quantity: 9, unit_price_gnf: 5 },
    ];
    const top = topActs(items, new Set(["a", "b"]));
    expect(top.map((t) => [t.label, t.quantity, t.amount])).toEqual([
      ["Consultation", 3, 300],
      ["Divers ", 1, 5],
    ]);
  });

  it("périodes prédéfinies", () => {
    expect(presetRange("lastMonth", "2026-03-15")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(presetRange("thisMonth", "2026-03-15")).toEqual(["2026-03-01", "2026-03-15"]);
    expect(presetRange("last30", "2026-03-15")).toEqual(["2026-02-14", "2026-03-15"]);
  });
});

describe("divers", () => {
  it("n'importe que les actes absents du catalogue", () => {
    const missing = actsToImport([
      { code: "cons", label: "Autre libellé" },
      { code: null, label: "Détartrage et polissage" },
      { code: "EXT-SIMP", label: "x", deleted_at: "y" },
    ]);
    expect(missing.length).toBe(BASE_ACTS.length - 2);
    expect(missing.some((a) => a.code === "EXT-SIMP")).toBe(true);
    expect(BASE_ACTS.every((a) => a.price_gnf > 0 && Number.isInteger(a.price_gnf))).toBe(true);
  });

  it("construit un lien WhatsApp", () => {
    expect(whatsappLink("+224620000001", "Bonjour & merci")).toBe("https://wa.me/224620000001?text=Bonjour%20%26%20merci");
    expect(whatsappLink(null, "x")).toBeNull();
  });

  it("appelle les routes de paiement mobile et gère l'absence de route", async () => {
    const calls: [string, RequestInit][] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ transaction_id: "t1", status: "pending" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await initiateMobilePayment("tok", { invoice_id: "i1", provider: "mtn_momo", phone: "+224660000000" }, ok);
    expect(r).toEqual({ ok: true, data: { transaction_id: "t1", status: "pending" } });
    expect(calls[0][0]).toBe("/api/payments/initiate");
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      purpose: "invoice",
      invoice_id: "i1",
      provider: "mtn_momo",
      phone: "+224660000000",
    });

    const notFound = (async () => new Response("<html>", { status: 404 })) as unknown as typeof fetch;
    expect(await mobilePaymentStatus("tok", "t1", notFound)).toMatchObject({ ok: false, kind: "not_found" });

    const bad = (async () => new Response(JSON.stringify({ error: "invalid phone" }), { status: 400 })) as unknown as typeof fetch;
    expect(await mobilePaymentStatus("tok", "t1", bad)).toEqual({ ok: false, kind: "error", status: 400, message: "invalid phone" });

    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await mobilePaymentStatus("tok", "t1", down)).toMatchObject({ ok: false, kind: "network" });
  });
});
