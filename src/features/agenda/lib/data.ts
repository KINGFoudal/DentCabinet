"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb, type Local, type Row } from "@/lib/local/db";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { fullName } from "@/lib/format";
import { findConflicts, type AvailabilityCtx, type OpeningHours, type Slot } from "./grid";

export type Appointment = Local<Row<"appointments">>;
export type Dentist = { id: string; name: string; color: string | null };

/** Praticiens actifs du cabinet (membres ayant le rôle dentiste). */
export function useDentists(): Dentist[] | undefined {
  const cabinetId = useCabinetId();
  return useLiveQuery(async () => {
    const db = localDb();
    const members = (await db.memberships.where("cabinet_id").equals(cabinetId).toArray()).filter(
      (m) => m.active && !m.deleted_at && m.roles.includes("dentist"),
    );
    const profiles = await db.profiles.bulkGet(members.map((m) => m.user_id));
    return members
      .map((m, i) => ({
        id: m.user_id,
        name: m.display_name || profiles[i]?.full_name || "—",
        color: m.color,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cabinetId]);
}

export function useChairs() {
  const cabinetId = useCabinetId();
  return useLiveQuery(
    async () =>
      (await localDb().chairs.where("cabinet_id").equals(cabinetId).toArray())
        .filter((c) => !c.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [cabinetId],
  );
}

export function useAppointmentTypes() {
  const cabinetId = useCabinetId();
  return useLiveQuery(
    async () =>
      (await localDb().appointment_types.where("cabinet_id").equals(cabinetId).toArray())
        .filter((c) => !c.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [cabinetId],
  );
}

/** Horaires, absences et heures d'ouverture : contexte des disponibilités. */
export function useAvailability(): AvailabilityCtx | undefined {
  const cabinetId = useCabinetId();
  const { cabinet } = useCabinet();
  const data = useLiveQuery(async () => {
    const db = localDb();
    const [schedules, timeOff] = await Promise.all([
      db.practitioner_schedules.where("cabinet_id").equals(cabinetId).filter((s) => !s.deleted_at).toArray(),
      db.time_off.where("cabinet_id").equals(cabinetId).filter((s) => !s.deleted_at).toArray(),
    ]);
    return { schedules, timeOff };
  }, [cabinetId]);
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const oh = cabinet?.opening_hours as OpeningHours | null | undefined;
  return useMemo(
    () => (data ? { timeZone: tz, openingHours: oh, schedules: data.schedules, timeOff: data.timeOff } : undefined),
    [data, tz, oh],
  );
}

/** RDV qui touchent la plage [start, end[, avec le nom des patients. */
export function useAppointmentsInRange(start: string, end: string) {
  const cabinetId = useCabinetId();
  return useLiveQuery(async () => {
    const db = localDb();
    // Un RDV commencé la veille peut déborder : marge de 24 h.
    const from = new Date(new Date(start).getTime() - 24 * 3600 * 1000).toISOString();
    const appts = (
      await db.appointments.where("[cabinet_id+starts_at]").between([cabinetId, from], [cabinetId, end], true, false).toArray()
    ).filter((a) => !a.deleted_at && a.ends_at > start);
    const patientIds = [...new Set(appts.map((a) => a.patient_id).filter(Boolean))] as string[];
    const patients = new Map(
      (await db.patients.bulkGet(patientIds)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.id, p]),
    );
    return { appts, patients };
  }, [cabinetId, start, end]);
}

export function appointmentLabel(a: Appointment, patients: Map<string, Row<"patients">>) {
  const p = a.patient_id ? patients.get(a.patient_id) : undefined;
  return (p && fullName(p)) || a.title || "—";
}

/** Libellé d'un RDV lu dans la base locale (ex. RDV en conflit hors de la plage affichée). */
export async function appointmentLabelLocal(a: Appointment) {
  const p = a.patient_id ? await localDb().patients.get(a.patient_id) : undefined;
  return appointmentLabel(a, new Map(p ? [[p.id, p]] : []));
}

/** Vérification de chevauchement dans la base locale, avant toute écriture. */
export async function localConflicts(cabinetId: string, candidate: Slot) {
  const db = localDb();
  const from = new Date(new Date(candidate.starts_at).getTime() - 24 * 3600 * 1000).toISOString();
  const others = await db.appointments
    .where("[cabinet_id+starts_at]")
    .between([cabinetId, from], [cabinetId, candidate.ends_at], true, false)
    .toArray();
  return findConflicts(candidate, others);
}
