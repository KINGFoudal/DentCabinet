import { describe, expect, it } from "vitest";
import { formatGNF, formatPhone } from "@/lib/format";
import { waMeLink, waPhone } from "./wa-link";
import {
  appointmentVars,
  DEFAULT_TEXTS,
  effectiveText,
  formatAmountGNF,
  formatPhoneDisplay,
  invoiceVars,
  metaTemplateName,
  PATIENT_MESSAGE_KINDS,
  renderPatientMessage,
  unknownPatientVariables,
  VARIABLES_BY_KIND,
  type TemplateRow,
} from "../../../../supabase/functions/_shared/patient-messages";
import {
  isDue,
  phoneDigits,
  planNotification,
  reservationFilter,
  type NotifyContext,
  type QueueRow,
} from "../../../../supabase/functions/_shared/patient-notifications";

const TZ = "Africa/Conakry";
const cabinet = { name: "Cabinet Kaloum", phone: "+224620000001", address: "Rue KA-020", city: "Conakry", timezone: TZ, locale: "fr" };
const patient = { first_name: "Mariama", last_name: "Diallo" };

describe("gabarits des messages patients", () => {
  it("chaque type a un texte fr et en n'utilisant que ses variables", () => {
    for (const kind of PATIENT_MESSAGE_KINDS) {
      for (const lang of ["fr", "en"] as const) {
        const text = DEFAULT_TEXTS[kind][lang];
        expect(text.trim()).not.toBe("");
        expect(unknownPatientVariables(text, kind)).toEqual([]);
      }
    }
  });

  it("remplit les variables du RDV dans le fuseau du cabinet", () => {
    // 09:30 UTC = 09:30 à Conakry (UTC+0) ; 10:30 à Paris en hiver.
    const vars = appointmentVars(cabinet, patient, { starts_at: "2026-11-12T09:30:00Z" }, "Dr Camara");
    const text = renderPatientMessage(DEFAULT_TEXTS.booking_confirmation.fr, vars);
    expect(text).toBe(
      "Bonjour Mariama,\nVotre rendez-vous chez Cabinet Kaloum est confirmé le jeudi 12 novembre 2026 à 09:30.\nPraticien : Dr Camara\nAdresse : Rue KA-020, Conakry\nPour modifier ou annuler : +224 620 00 00 01\nÀ bientôt !",
    );
    const paris = appointmentVars({ ...cabinet, timezone: "Europe/Paris" }, patient, { starts_at: "2026-11-12T09:30:00Z" }, "");
    expect(paris.time).toBe("10:30");
  });

  it("retire une ligne dont la variable est vide (adresse, praticien absents)", () => {
    const vars = appointmentVars({ ...cabinet, address: null, city: null }, patient, { starts_at: "2026-11-12T09:30:00Z" }, null);
    const text = renderPatientMessage(DEFAULT_TEXTS.booking_confirmation.fr, vars);
    expect(text).not.toMatch(/Adresse|Praticien/);
    expect(text).toContain("Pour modifier ou annuler");
  });

  it("texte en anglais pour un cabinet anglophone", () => {
    const vars = appointmentVars({ ...cabinet, locale: "en" }, patient, { starts_at: "2026-11-12T09:30:00Z" }, "Dr Camara");
    expect(renderPatientMessage(DEFAULT_TEXTS.booking_confirmation.en, vars)).toContain("Thursday, 12 November 2026 at 09:30");
  });

  it("montants de facture identiques à formatGNF, reste à payer et moyens de paiement", () => {
    expect(formatAmountGNF(1250000, "fr")).toBe(formatGNF(1250000, "fr"));
    expect(formatAmountGNF(1250000, "en")).toBe(formatGNF(1250000, "en"));
    expect(formatPhoneDisplay("+224620000001")).toBe(formatPhone("+224620000001"));
    const vars = invoiceVars(cabinet, patient, { number: "F-2026-00012", total: 450000, paid: 150000 });
    const text = renderPatientMessage(DEFAULT_TEXTS.invoice_issued.fr, vars);
    expect(text).toContain("facture F-2026-00012");
    expect(text).toContain(`Montant total : ${formatGNF(450000)}`);
    expect(text).toContain(`Reste à payer : ${formatGNF(300000)}`);
    expect(text).toContain("espèces au cabinet, Orange Money ou MTN Mobile Money");
  });

  it("échéance et paiement reçu", () => {
    const due = invoiceVars(cabinet, patient, { number: "F-1", total: 300000, paid: 100000 }, { installment: { amount: 100000, due_date: "2026-12-05" } });
    expect(renderPatientMessage(DEFAULT_TEXTS.installment_due.fr, due)).toContain("le 5 décembre 2026");
    const paid = invoiceVars(cabinet, patient, { number: "F-1", total: 300000, paid: 300000 }, { amountPaid: 200000 });
    expect(renderPatientMessage(DEFAULT_TEXTS.payment_received.fr, paid)).toContain(`paiement de ${formatGNF(200000)}`);
    expect(VARIABLES_BY_KIND.payment_received).toContain("amount_paid");
  });

  it("personnalisation du cabinet, ancien texte par défaut ignoré, repli sur le défaut", () => {
    const rows: TemplateRow[] = [
      { cabinet_id: "c1", kind: "invoice_issued", channel: "whatsapp", locale: "fr", body: "Facture {{invoice_number}}", enabled: true },
      { cabinet_id: "c1", kind: "booking_confirmation", channel: "whatsapp", locale: "fr", body: "Bonjour {{patient_name}}, votre rendez-vous du {{date}} à {{time}} au {{cabinet_name}} est enregistré.", enabled: true },
      { cabinet_id: "c2", kind: "appointment_moved", channel: "whatsapp", locale: "fr", body: "Autre cabinet", enabled: true },
    ];
    expect(effectiveText(rows, "c1", "invoice_issued", "fr")).toBe("Facture {{invoice_number}}");
    expect(effectiveText(rows, "c1", "invoice_issued", "en")).toBe(DEFAULT_TEXTS.invoice_issued.en);
    expect(effectiveText(rows, "c1", "booking_confirmation", "fr")).toBe(DEFAULT_TEXTS.booking_confirmation.fr);
    expect(effectiveText(rows, "c1", "appointment_moved", "fr")).toBe(DEFAULT_TEXTS.appointment_moved.fr);
  });

  it("détecte les variables inconnues pour un type", () => {
    expect(unknownPatientVariables("{{invoice_total}} {{date}}", "checkup_reminder")).toEqual(["invoice_total", "date"]);
  });

  it("nom des modèles Meta configurable", () => {
    expect(metaTemplateName("invoice_issued", () => undefined)).toBe("nimba_facture_emise");
    expect(metaTemplateName("invoice_issued", (k) => (k === "WHATSAPP_INVOICE_TEMPLATE" ? "x" : undefined))).toBe("x");
  });
});

describe("lien wa.me", () => {
  it("numéro guinéen au format 224XXXXXXXXX", () => {
    expect(waPhone("620 00 00 00")).toBe("224620000000");
    expect(waPhone("+224 620 00 00 00")).toBe("224620000000");
    expect(waPhone("00224620000000")).toBe("224620000000");
    expect(waPhone("12")).toBeNull();
    expect(waPhone(null)).toBeNull();
  });

  it("encode le texte (accents, retours à la ligne, &, #)", () => {
    const link = waMeLink("620000000", "Bonjour Aïssatou,\nRDV à 9h & #2 ?");
    expect(link).toBe("https://wa.me/224620000000?text=Bonjour%20A%C3%AFssatou%2C%0ARDV%20%C3%A0%209h%20%26%20%232%20%3F");
    expect(decodeURIComponent(new URL(link!).searchParams.get("text")!)).toBe("Bonjour Aïssatou,\nRDV à 9h & #2 ?");
  });

  it("refuse un texte vide ou un numéro invalide", () => {
    expect(waMeLink("620000000", "   \n ")).toBeNull();
    expect(waMeLink("", "Bonjour")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Envoi automatique : décision au moment de l'envoi
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-10T10:00:00Z");

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    id: "n1",
    cabinet_id: "c1",
    patient_id: "p1",
    event: "appointment_created",
    appointment_id: "a1",
    invoice_id: null,
    payment_id: null,
    ref_starts_at: "2026-11-12T09:30:00Z",
    status: "pending",
    attempts: 0,
    created_at: "2026-11-10T09:55:00Z",
    updated_at: "2026-11-10T09:55:00Z",
    ...over,
  };
}

function ctx(over: Partial<NotifyContext> = {}): NotifyContext {
  return {
    now: NOW,
    cabinets: new Map([["c1", { id: "c1", ...cabinet, active: true, notify_invoice_issued: true, notify_payment_received: true }]]),
    patients: new Map([["p1", { id: "p1", cabinet_id: "c1", ...patient, phone: "+224620000000", whatsapp_opt_in: true, deleted_at: null }]]),
    appointments: new Map([
      ["a1", { id: "a1", cabinet_id: "c1", patient_id: "p1", dentist_id: "d1", starts_at: "2026-11-12T09:30:00Z", status: "scheduled", deleted_at: null }],
    ]),
    invoices: new Map([["i1", { id: "i1", cabinet_id: "c1", patient_id: "p1", number: "F-2026-00012", status: "issued", total_gnf: 450000, paid_gnf: 0, deleted_at: null }]]),
    payments: new Map([["pay1", { id: "pay1", cabinet_id: "c1", invoice_id: "i1", amount_gnf: 150000, status: "succeeded", created_at: "2026-11-10T09:56:00Z", deleted_at: null }]]),
    templates: [],
    dentistNames: { d1: "Dr Camara" },
    staffPhones: new Map([["c1", new Set(["224620000099"])]]),
    queue: [],
    ...over,
  };
}

describe("planNotification", () => {
  it("confirmation de RDV au téléphone de la fiche patient", () => {
    const plan = planNotification(row(), ctx());
    expect(plan).toMatchObject({ action: "send", recipient: "+224620000000", event: "appointment_created" });
    if (plan.action === "send") expect(plan.text).toContain("Dr Camara");
  });

  it("facture émise : numéro, total, reste à payer", () => {
    const plan = planNotification(row({ event: "invoice_issued", appointment_id: null, invoice_id: "i1" }), ctx());
    expect(plan.action).toBe("send");
    if (plan.action === "send") expect(plan.text).toContain(formatGNF(450000));
  });

  it("jamais vers un numéro du cabinet ou de l'équipe", () => {
    const staff = ctx();
    staff.patients.get("p1")!.phone = "+224620000099";
    expect(planNotification(row(), staff)).toEqual({ action: "skip", reason: "phone belongs to the practice" });
    const office = ctx();
    office.patients.get("p1")!.phone = "+224620000001";
    expect(planNotification(row(), office)).toEqual({ action: "skip", reason: "phone belongs to the practice" });
  });

  it("rien pour un RDV supprimé, un patient sans téléphone ou opposé, un cabinet qui a désactivé", () => {
    const deleted = ctx();
    deleted.appointments.get("a1")!.deleted_at = NOW.toISOString();
    expect(planNotification(row(), deleted).action).toBe("skip");
    const noPhone = ctx();
    noPhone.patients.get("p1")!.phone = null;
    expect(planNotification(row(), noPhone)).toEqual({ action: "skip", reason: "no valid phone" });
    const optOut = ctx();
    optOut.patients.get("p1")!.whatsapp_opt_in = false;
    expect(planNotification(row(), optOut)).toEqual({ action: "skip", reason: "patient opted out" });
    const off = ctx();
    off.cabinets.get("c1")!.notify_appointment_created = false;
    expect(planNotification(row(), off)).toEqual({ action: "skip", reason: "disabled by cabinet" });
  });

  it("déplacement remplacé par un plus récent, message trop ancien", () => {
    expect(planNotification(row({ event: "appointment_moved", ref_starts_at: "2026-11-11T09:30:00Z" }), ctx())).toEqual({ action: "skip", reason: "superseded" });
    expect(planNotification(row({ created_at: "2026-11-08T09:00:00Z" }), ctx())).toEqual({ action: "skip", reason: "expired" });
  });

  it("facture pas encore complète : attente, puis abandon", () => {
    const empty = ctx();
    empty.invoices.get("i1")!.total_gnf = 0;
    expect(planNotification(row({ event: "invoice_issued", invoice_id: "i1" }), empty).action).toBe("defer");
    expect(planNotification(row({ event: "invoice_issued", invoice_id: "i1", created_at: "2026-11-10T08:00:00Z" }), empty).action).toBe("skip");
  });

  it("paiement déjà annoncé par le message de facture : pas de doublon", () => {
    const pay = row({ id: "n2", event: "payment_received", appointment_id: null, invoice_id: "i1", payment_id: "pay1" });
    expect(planNotification(pay, ctx()).action).toBe("send");
    const issued = row({ id: "n1", event: "invoice_issued", invoice_id: "i1", status: "sent", sent_at: "2026-11-10T09:57:00Z" });
    expect(planNotification(pay, ctx({ queue: [issued] }))).toEqual({ action: "skip", reason: "covered by invoice message" });
  });

  it("tentatives limitées, réservation conditionnelle", () => {
    expect(isDue(row({ status: "failed", attempts: 2 }), NOW)).toBe(true);
    expect(isDue(row({ status: "failed", attempts: 3 }), NOW)).toBe(false);
    expect(isDue(row({ status: "sending", attempts: 1, updated_at: "2026-11-10T09:58:00Z" }), NOW)).toBe(false);
    expect(isDue(row({ status: "sending", attempts: 1, updated_at: "2026-11-10T09:30:00Z" }), NOW)).toBe(true);
    expect(reservationFilter(row())).toBe("id=eq.n1&status=eq.pending&attempts=eq.0&updated_at=eq.2026-11-10T09%3A55%3A00Z");
    expect(phoneDigits("620 00 00 00")).toBe("224620000000");
  });
});
