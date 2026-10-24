import { describe, expect, it } from "vitest";
import { errorKey, rpcErrorCode } from "./errors";
import {
  authPhoneToE164,
  canCancelOnline,
  isOpenOn,
  isoWeekday,
  nextDays,
  splitAppointments,
  splitSlots,
  weekRows,
} from "./schedule";
import { initiatePayment, pollPaymentStatus, safeRedirect, validAmount } from "./payments";
import { parseOpeningHours, parsePublicCabinet } from "./types";
import { balance, normalizeItems } from "./portal-data";
import { whatsappLink } from "../components/public-cabinet-view";

describe("errors", () => {
  it("reconnaît les codes des RPC", () => {
    expect(rpcErrorCode({ message: "slot_unavailable" })).toBe("slot_unavailable");
    expect(errorKey({ message: "too_late" }, true)).toBe("portal.errors.too_late");
    expect(errorKey({ message: "boom" }, true)).toBe("portal.errors.generic");
    expect(errorKey({ message: "TypeError: Failed to fetch" }, true)).toBe("portal.errors.offline");
    expect(errorKey({ message: "x", status: 429 }, true)).toBe("portal.errors.rate_limited");
    expect(errorKey({ message: "slot_unavailable" }, false)).toBe("portal.errors.offline");
  });
});

describe("schedule", () => {
  const hours = parseOpeningHours({ "1": [["08:00", "12:00"]], "6": [["09:00:00", "13:00:00"]], "7": [], x: 1, "2": [["bad"]] });

  it("analyse les horaires", () => {
    expect(hours).toEqual({ "1": [["08:00", "12:00"]], "6": [["09:00", "13:00"]] });
    expect(weekRows(hours).map((r) => r.intervals.length)).toEqual([1, 0, 0, 0, 0, 1, 0]);
  });

  it("jours de la semaine ISO", () => {
    expect(isoWeekday("2026-10-26")).toBe(1); // lundi
    expect(isoWeekday("2026-11-01")).toBe(7); // dimanche
    expect(isOpenOn(hours, "2026-10-26")).toBe(true);
    expect(isOpenOn(hours, "2026-10-27")).toBe(false);
    expect(isOpenOn({}, "2026-10-27")).toBe(true);
    expect(nextDays("2026-12-30", 3)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("sépare matin et après-midi dans le fuseau du cabinet", () => {
    const slots = [
      { starts_at: "2026-10-26T11:30:00Z", ends_at: "" },
      { starts_at: "2026-10-26T12:00:00Z", ends_at: "" },
    ];
    expect(splitSlots(slots, "Africa/Conakry").morning).toHaveLength(1);
    // À Lagos (UTC+1), 11:30Z est déjà l'après-midi.
    expect(splitSlots(slots, "Africa/Lagos").afternoon).toHaveLength(2);
  });

  it("règle d'annulation identique au serveur", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    expect(canCancelOnline({ status: "scheduled", starts_at: "2026-10-25T10:00:00Z" }, 24, now)).toBe(true);
    expect(canCancelOnline({ status: "scheduled", starts_at: "2026-10-25T09:59:00Z" }, 24, now)).toBe(false);
    expect(canCancelOnline({ status: "done", starts_at: "2026-11-25T10:00:00Z" }, 24, now)).toBe(false);
  });

  it("sépare rendez-vous à venir et historique", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const a = (id: string, status: string, start: string) => ({ id, status, starts_at: start, ends_at: start.replace(":00:00Z", ":30:00Z") });
    const { upcoming, past } = splitAppointments(
      [a("1", "scheduled", "2026-10-30T09:00:00Z"), a("2", "scheduled", "2026-10-25T09:00:00Z"), a("3", "cancelled", "2026-10-30T09:00:00Z"), a("4", "done", "2026-10-01T09:00:00Z")],
      now,
    );
    expect(upcoming.map((x) => x.id)).toEqual(["2", "1"]);
    expect(past.map((x) => x.id)).toEqual(["3", "4"]);
  });

  it("téléphone Supabase -> E.164 et lien WhatsApp", () => {
    expect(authPhoneToE164("224620000000")).toBe("+224620000000");
    expect(authPhoneToE164("")).toBeNull();
    expect(whatsappLink("620 00 00 00")).toBe("https://wa.me/224620000000");
    expect(whatsappLink(null)).toBeNull();
  });
});

describe("public_cabinet", () => {
  it("valide la réponse", () => {
    expect(parsePublicCabinet(null)).toBeNull();
    const c = parsePublicCabinet({
      id: "c1",
      name: "Cabinet",
      slug: "cab",
      online_booking_enabled: true,
      opening_hours: {},
      dentists: [{ id: "d1", name: null }],
      appointment_types: [{ id: "t1", name: "Consultation", duration_minutes: 30 }],
    });
    expect(c).toMatchObject({ timezone: "Africa/Conakry", online_booking_enabled: true, phone: null });
    expect(c?.appointment_types[0].duration_minutes).toBe(30);
  });
});

describe("factures", () => {
  it("reste à payer", () => {
    expect(balance({ total_gnf: 150000, paid_gnf: 50000, status: "partially_paid" })).toBe(100000);
    expect(balance({ total_gnf: 150000, paid_gnf: 200000, status: "paid" })).toBe(0);
    expect(balance({ total_gnf: 150000, paid_gnf: 0, status: "cancelled" })).toBe(0);
    expect(validAmount(100000, 100000)).toBe(true);
    expect(validAmount(100001, 100000)).toBe(false);
    expect(validAmount(0, 100000)).toBe(false);
    expect(validAmount(null, 100000)).toBe(false);
  });

  it("normalise les lignes d'ordonnance", () => {
    expect(normalizeItems([{ drug: "Amoxicilline", dosage: 1 }, null, "x"])).toEqual([
      { drug: "Amoxicilline", dosage: undefined, duration: undefined, instructions: undefined },
    ]);
    expect(normalizeItems(null)).toEqual([]);
  });
});

describe("paiements", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const body = { purpose: "invoice" as const, invoice_id: "i1", provider: "orange_money" as const, phone: "+224620000000" };

  it("envoie le contrat attendu et lit la réponse", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const r = await initiatePayment(
      async (url, init) => {
        seen = { url, init };
        return json(200, { transaction_id: "tx", status: "pending", instructions: "Composez #144#", redirect_url: "javascript:alert(1)" });
      },
      "tok",
      body,
    );
    expect(seen!.url).toBe("/api/payments/initiate");
    expect((seen!.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(seen!.init?.body))).toEqual(body);
    expect(r).toEqual({ ok: true, transaction_id: "tx", status: "pending", instructions: "Composez #144#", redirect_url: undefined });
  });

  it("gère route absente, erreurs et coupure réseau", async () => {
    expect(await initiatePayment(async () => new Response("", { status: 404 }), "t", body)).toEqual({ ok: false, reason: "unavailable" });
    expect(await initiatePayment(async () => json(400, { error: "Montant invalide" }), "t", body)).toEqual({
      ok: false,
      reason: "error",
      message: "Montant invalide",
    });
    expect(
      await initiatePayment(
        async () => {
          throw new TypeError("Failed to fetch");
        },
        "t",
        body,
      ),
    ).toEqual({ ok: false, reason: "offline" });
    expect(safeRedirect("https://pay.example/x")).toBe("https://pay.example/x");
    expect(safeRedirect("http://pay.example/x")).toBeUndefined();
  });

  it("interroge jusqu'à un état final", async () => {
    const answers = ["pending", "error", "pending", "succeeded"];
    let calls = 0;
    const r = await pollPaymentStatus({
      fetchFn: async (url) => {
        expect(url).toBe("/api/payments/status?id=tx%201");
        const a = answers[calls++];
        return a === "error" ? new Response("", { status: 500 }) : json(200, { status: a });
      },
      token: "t",
      id: "tx 1",
      sleep: async () => undefined,
    });
    expect(r).toBe("succeeded");
    expect(calls).toBe(4);
  });

  it("abandonne après 2 minutes", async () => {
    let clock = 0;
    let calls = 0;
    const r = await pollPaymentStatus({
      fetchFn: async () => {
        calls++;
        return json(200, { status: "pending" });
      },
      token: "t",
      id: "tx",
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    expect(r).toBe("timeout");
    expect(calls).toBe(24);
  });

  it("s'arrête si annulé", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await pollPaymentStatus({ fetchFn: async () => json(200, { status: "pending" }), token: "t", id: "x", signal: ctrl.signal, sleep: async () => undefined });
    expect(r).toBe("aborted");
  });
});
