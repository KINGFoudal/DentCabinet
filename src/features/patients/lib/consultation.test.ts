import { describe, expect, it } from "vitest";
import { emptyRxItem } from "./clinical";
import {
  checkConsultation,
  consultationHref,
  consultationPrintHref,
  parseActDraft,
  pickConsultationAppointment,
  prescriptionsForInvoice,
  type ActDraft,
} from "./consultation";

const act = (patch: Partial<ActDraft>): ActDraft => ({ key: "k", act_id: null, label: "Détartrage", tooth: "", quantity: "1", price: "150 000", ...patch });

describe("terminer la consultation", () => {
  it("actes : lignes valides, dent FDI, lignes vides ignorées", () => {
    expect(parseActDraft(act({ tooth: "16", quantity: "2" }), 3)).toEqual({
      act_id: null,
      plan_item_id: null,
      label: "Détartrage",
      tooth: 16,
      quantity: 2,
      unit_price_gnf: 150000,
      sort_order: 3,
    });
    expect(parseActDraft(act({ tooth: "99" }))).toBeNull();
    expect(parseActDraft(act({ price: "abc" }))).toBeNull();
    expect(parseActDraft(act({ quantity: "0" }))).toBeNull();
  });

  it("au moins un acte ou un médicament ; les médicaments ne sont pas facturés", () => {
    const rx = [{ ...emptyRxItem, drug: "Paracétamol" }];
    expect(checkConsultation([], [{ ...emptyRxItem }], true)).toEqual({ ok: false, error: "nothing" });
    expect(checkConsultation([act({ label: "", price: "" })], rx, false)).toEqual({ ok: false, error: "nothing" });
    expect(checkConsultation([act({ price: "x" })], rx, true)).toEqual({ ok: false, error: "invalidLine" });
    const ok = checkConsultation([act({}), act({ label: "", price: "" })], rx, true);
    expect(ok.ok && ok.lines.map((l) => l.label)).toEqual(["Détartrage"]);
    expect(ok.ok && ok.rxItems.map((i) => i.drug)).toEqual(["Paracétamol"]);
    const rxOnly = checkConsultation([], rx, true);
    expect(rxOnly.ok && rxOnly.lines).toEqual([]);
    const noRx = checkConsultation([act({})], rx, false);
    expect(noRx.ok && noRx.rxItems).toEqual([]);
  });

  it("rendez-vous du jour : en soin > arrivé > prévu le plus proche ; jamais annulé, absent ou autre patient", () => {
    const day: [string, string] = ["2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z"];
    const now = new Date("2026-10-26T10:00:00Z");
    const a = (id: string, starts_at: string, status: string, patient_id = "p") => ({ id, starts_at, status, patient_id, deleted_at: null });
    const list = [
      a("cancel", "2026-10-26T10:00:00Z", "cancelled"),
      a("other", "2026-10-26T10:00:00Z", "in_treatment", "q"),
      a("late", "2026-10-26T16:00:00Z", "scheduled"),
      a("soon", "2026-10-26T10:30:00Z", "confirmed"),
      a("yesterday", "2026-10-25T10:00:00Z", "in_treatment"),
    ];
    expect(pickConsultationAppointment(list, "p", ...day, now)?.id).toBe("soon");
    expect(pickConsultationAppointment([...list, a("arr", "2026-10-26T08:00:00Z", "arrived")], "p", ...day, now)?.id).toBe("arr");
    expect(pickConsultationAppointment([...list, a("tx", "2026-10-26T09:00:00Z", "in_treatment"), a("arr", "2026-10-26T08:00:00Z", "arrived")], "p", ...day, now)?.id).toBe("tx");
    expect(pickConsultationAppointment([a("x", "2026-10-26T09:00:00Z", "no_show")], "p", ...day, now)).toBeNull();
  });

  it("ordonnance associée à une facture : lien direct ou même rendez-vous", () => {
    const rx = (id: string, invoice_id: string | null, appointment_id: string | null, deleted_at: string | null = null) => ({ id, invoice_id, appointment_id, deleted_at });
    const list = [rx("direct", "i1", null), rx("byAppt", null, "a1"), rx("otherInvoice", "i2", "a1"), rx("deleted", "i1", null, "2026-10-26"), rx("none", null, null)];
    expect(prescriptionsForInvoice(list, { id: "i1", appointment_id: "a1" }).map((r) => r.id)).toEqual(["direct", "byAppt"]);
    expect(prescriptionsForInvoice(list, { id: "i1", appointment_id: null }).map((r) => r.id)).toEqual(["direct"]);
  });

  it("adresses des écrans", () => {
    expect(consultationHref("p1", "a1")).toBe("/app/patients/consultation?patient=p1&appointment=a1");
    expect(consultationHref("p1")).toBe("/app/patients/consultation?patient=p1");
    expect(consultationPrintHref({ patientId: "p1", invoiceId: "i1", rxId: null })).toBe("/app/patients/impression?patient=p1&invoice=i1");
  });
});
