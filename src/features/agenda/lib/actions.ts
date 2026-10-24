"use client";

import { mutate } from "@/lib/sync/mutate";
import { isActiveStatus, statusPatch, type Conflict, type Status } from "./grid";
import { localConflicts, type Appointment } from "./data";

export type SaveResult = { ok: true; appointment: Appointment } | { ok: false; conflicts: Conflict<Appointment>[] };

/**
 * Écrit un rendez-vous après vérification de chevauchement dans la base locale.
 * (Le serveur vérifie aussi : contrainte d'exclusion, refus visible dans la synchronisation.)
 */
export async function saveAppointment(cabinetId: string, patch: Partial<Appointment> & Pick<Appointment, "dentist_id" | "starts_at" | "ends_at">, current?: Appointment): Promise<SaveResult> {
  const merged = { ...(current ?? {}), ...patch } as Appointment;
  const conflicts = await localConflicts(cabinetId, {
    id: merged.id,
    dentist_id: merged.dentist_id,
    chair_id: merged.chair_id ?? null,
    starts_at: merged.starts_at,
    ends_at: merged.ends_at,
    status: merged.status ?? "scheduled",
    deleted_at: merged.deleted_at ?? null,
  });
  if (conflicts.length) return { ok: false, conflicts };
  const appointment = await mutate("appointments", { ...patch, id: current?.id ?? patch.id, cabinet_id: cabinetId });
  return { ok: true, appointment };
}

/** Changement de statut (actions rapides) ; réactiver un RDV annulé revérifie le créneau. */
export async function changeStatus(cabinetId: string, appt: Appointment, status: Status): Promise<SaveResult> {
  const patch = statusPatch(status, appt);
  if (isActiveStatus(status) && !isActiveStatus(appt.status)) {
    return saveAppointment(cabinetId, { ...patch, dentist_id: appt.dentist_id, starts_at: appt.starts_at, ends_at: appt.ends_at }, appt);
  }
  const appointment = await mutate("appointments", { id: appt.id, cabinet_id: cabinetId, ...patch });
  return { ok: true, appointment };
}
