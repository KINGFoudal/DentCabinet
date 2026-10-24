import { describe, expect, it } from "vitest";
import {
  applyDrag,
  availabilityWarnings,
  displayHours,
  findConflicts,
  isoToMinutes,
  isoWeekday,
  layoutLanes,
  minutesToHHMM,
  minutesToISO,
  nextStatuses,
  snap,
  statusPatch,
  unavailableIntervals,
  viewDays,
  viewRange,
  waitingMinutes,
  workingIntervals,
  type AvailabilityCtx,
} from "./grid";

const TZ = "Africa/Conakry";

describe("dates et plages", () => {
  it("numérote les jours de lundi (1) à dimanche (7)", () => {
    expect(isoWeekday("2026-10-26")).toBe(1);
    expect(isoWeekday("2026-10-25")).toBe(7);
  });

  it("semaine du lundi au dimanche, mois complété en semaines entières", () => {
    expect(viewDays("week", "2026-10-28")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    const month = viewDays("month", "2026-10-15");
    expect(month[0]).toBe("2026-09-28");
    expect(month.at(-1)).toBe("2026-11-01");
    expect(month.length % 7).toBe(0);
  });

  it("bornes UTC de la vue", () => {
    expect(viewRange("day", "2026-10-26", TZ)).toEqual(["2026-10-26T00:00:00.000Z", "2026-10-27T00:00:00.000Z"]);
    // Paris (UTC+1 en hiver) : minuit local = 23 h UTC la veille.
    expect(viewRange("day", "2026-11-02", "Europe/Paris")[0]).toBe("2026-11-01T23:00:00.000Z");
  });

  it("minutes <-> ISO", () => {
    expect(isoToMinutes("2026-10-26T09:30:00Z", "2026-10-26", TZ)).toBe(570);
    expect(minutesToISO("2026-10-26", 570, TZ)).toBe("2026-10-26T09:30:00.000Z");
    expect(minutesToHHMM(570)).toBe("09:30");
  });

  it("plage affichée élargie aux RDV", () => {
    expect(displayHours([])).toEqual([420, 1200]);
    expect(displayHours([[390, 450], [1170, 1290]])).toEqual([360, 1320]);
  });
});

describe("grille", () => {
  it("aligne sur 15 minutes", () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(52)).toBe(45);
  });

  it("place les RDV qui se chevauchent côte à côte", () => {
    const lanes = layoutLanes([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 570, end: 630 },
      { id: "c", start: 600, end: 660 },
      { id: "d", start: 700, end: 730 },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 2 }); // réutilise le couloir libéré par a
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("glisser-déposer", () => {
  it("déplace en conservant la durée, au pas de 15 min", () => {
    expect(applyDrag({ start: 540, end: 570 }, 22, "move")).toEqual({ start: 555, end: 585 });
    expect(applyDrag({ start: 540, end: 570 }, -7, "move")).toEqual({ start: 540, end: 570 });
  });

  it("reste dans les bornes de la grille", () => {
    expect(applyDrag({ start: 540, end: 600 }, -1000, "move", [420, 1200])).toEqual({ start: 420, end: 480 });
    expect(applyDrag({ start: 540, end: 600 }, 1000, "move", [420, 1200])).toEqual({ start: 1140, end: 1200 });
  });

  it("redimensionne la fin, durée minimale 15 min", () => {
    expect(applyDrag({ start: 540, end: 570 }, 31, "resize")).toEqual({ start: 540, end: 600 });
    expect(applyDrag({ start: 540, end: 570 }, -60, "resize")).toEqual({ start: 540, end: 555 });
  });
});

describe("chevauchements", () => {
  const base = { dentist_id: "d1", chair_id: "c1", status: "scheduled", deleted_at: null };
  const others = [
    { ...base, id: "x", starts_at: "2026-10-26T09:00:00Z", ends_at: "2026-10-26T09:30:00Z" },
    { ...base, id: "y", dentist_id: "d2", starts_at: "2026-10-26T10:00:00Z", ends_at: "2026-10-26T10:30:00Z" },
    { ...base, id: "z", status: "cancelled", starts_at: "2026-10-26T11:00:00Z", ends_at: "2026-10-26T11:30:00Z" },
    { ...base, id: "w", deleted_at: "2026-10-25T00:00:00Z", starts_at: "2026-10-26T12:00:00Z", ends_at: "2026-10-26T12:30:00Z" },
  ];

  it("même praticien", () => {
    const c = findConflicts({ ...base, chair_id: null, starts_at: "2026-10-26T09:15:00Z", ends_at: "2026-10-26T09:45:00Z" }, others);
    expect(c.map((x) => [x.appointment.id, x.reason])).toEqual([["x", "dentist"]]);
  });

  it("même fauteuil, autre praticien", () => {
    const c = findConflicts({ ...base, dentist_id: "d3", starts_at: "2026-10-26T10:15:00Z", ends_at: "2026-10-26T10:20:00Z" }, others);
    expect(c.map((x) => [x.appointment.id, x.reason])).toEqual([["y", "chair"]]);
  });

  it("créneaux bout à bout, annulés, supprimés ou le RDV lui-même : pas de conflit", () => {
    expect(findConflicts({ ...base, starts_at: "2026-10-26T09:30:00Z", ends_at: "2026-10-26T10:00:00Z" }, others)).toEqual([]);
    expect(findConflicts({ ...base, starts_at: "2026-10-26T11:00:00Z", ends_at: "2026-10-26T12:30:00Z" }, others)).toEqual([]);
    expect(findConflicts({ ...base, id: "x", starts_at: "2026-10-26T09:00:00Z", ends_at: "2026-10-26T09:30:00Z" }, others)).toEqual([]);
    expect(findConflicts({ ...base, status: "no_show", starts_at: "2026-10-26T09:00:00Z", ends_at: "2026-10-26T09:30:00Z" }, others)).toEqual([]);
  });

  it("sans fauteuil : seul le praticien compte", () => {
    const c = findConflicts({ ...base, dentist_id: "d3", chair_id: null, starts_at: "2026-10-26T10:00:00Z", ends_at: "2026-10-26T10:30:00Z" }, [
      { ...others[1], chair_id: null },
    ]);
    expect(c).toEqual([]);
  });
});

describe("disponibilités", () => {
  const ctx: AvailabilityCtx = {
    timeZone: TZ,
    openingHours: { "1": [["08:00", "12:00"], ["14:00", "18:00"]] },
    schedules: [{ dentist_id: "d1", weekday: 1, start_time: "09:00:00", end_time: "13:00:00", deleted_at: null }],
    timeOff: [{ dentist_id: "d2", starts_at: "2026-10-26T15:00:00Z", ends_at: "2026-10-26T16:00:00Z", deleted_at: null, reason: "Formation" }],
  };

  it("horaires du praticien, sinon du cabinet", () => {
    expect(workingIntervals("2026-10-26", "d1", ctx)).toEqual([[540, 780]]);
    expect(workingIntervals("2026-10-27", "d1", ctx)).toEqual([]); // mardi : ne travaille pas
    expect(workingIntervals("2026-10-26", "d2", ctx)).toEqual([[480, 720], [840, 1080]]);
    expect(workingIntervals("2026-10-26", "d2", { ...ctx, openingHours: {} })).toBeNull();
  });

  it("plages grisées : fermeture et absences", () => {
    const g = unavailableIntervals("2026-10-26", "d2", ctx);
    expect(g).toEqual([
      { start: 0, end: 480, kind: "closed" },
      { start: 720, end: 840, kind: "closed" },
      { start: 1080, end: 1440, kind: "closed" },
      { start: 900, end: 960, kind: "off", reason: "Formation" },
    ]);
  });

  it("avertit hors horaires et pendant une absence", () => {
    expect(availabilityWarnings({ dentist_id: "d1", starts_at: "2026-10-26T09:00:00Z", ends_at: "2026-10-26T09:30:00Z" }, ctx)).toEqual([]);
    expect(availabilityWarnings({ dentist_id: "d1", starts_at: "2026-10-26T12:45:00Z", ends_at: "2026-10-26T13:15:00Z" }, ctx)).toEqual(["outside_hours"]);
    expect(availabilityWarnings({ dentist_id: "d2", starts_at: "2026-10-26T15:30:00Z", ends_at: "2026-10-26T16:00:00Z" }, ctx)).toEqual(["time_off"]);
  });
});

describe("statuts", () => {
  it("actions rapides", () => {
    expect(nextStatuses("scheduled")).toContain("confirmed");
    expect(nextStatuses("arrived")).toContain("in_treatment");
    expect(nextStatuses("cancelled")).toEqual(["scheduled"]);
  });

  it("l'arrivée enregistre l'heure, une seule fois", () => {
    const now = new Date("2026-10-26T09:05:00Z");
    expect(statusPatch("arrived", { arrived_at: null }, now)).toEqual({ status: "arrived", arrived_at: "2026-10-26T09:05:00.000Z" });
    expect(statusPatch("in_treatment", { arrived_at: "2026-10-26T09:00:00Z" }, now)).toEqual({ status: "in_treatment" });
    expect(statusPatch("scheduled", { arrived_at: "2026-10-26T09:00:00Z" }, now)).toEqual({ status: "scheduled", arrived_at: null });
  });

  it("temps d'attente", () => {
    expect(waitingMinutes("2026-10-26T09:00:00Z", new Date("2026-10-26T09:17:30Z"))).toBe(17);
    expect(waitingMinutes(null)).toBeNull();
  });
});
