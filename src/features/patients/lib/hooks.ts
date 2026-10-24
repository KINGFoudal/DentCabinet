"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "@/lib/local/db";

/** Patient (y compris archivé) ; undefined pendant le chargement, null s'il n'existe pas. */
export function usePatient(cabinetId: string, id: string | null) {
  return useLiveQuery(async () => {
    if (!id) return null;
    const p = await localDb().patients.get(id);
    return p && p.cabinet_id === cabinetId ? p : null;
  }, [cabinetId, id]);
}

export function usePatientMedical(cabinetId: string, patientId: string, enabled = true) {
  return useLiveQuery(async () => {
    if (!enabled) return null;
    const m = await localDb().patient_medical.get(patientId);
    return m && m.cabinet_id === cabinetId && !m.deleted_at ? m : null;
  }, [cabinetId, patientId, enabled]);
}

/** Nom affiché de chaque membre du cabinet (praticiens, auteurs des notes…). */
export function useStaffNames(cabinetId: string) {
  return useLiveQuery(async () => {
    const db = localDb();
    const members = await db.memberships.where("cabinet_id").equals(cabinetId).toArray();
    const profiles = await db.profiles.bulkGet(members.map((m) => m.user_id));
    const map = new Map<string, string>();
    members.forEach((m, i) => {
      map.set(m.user_id, m.display_name || profiles[i]?.full_name || "—");
    });
    return map;
  }, [cabinetId]);
}

/** Libellé « Dr X » / nom d'un membre, avec repli. */
export function staffName(names: Map<string, string> | undefined, userId: string | null | undefined) {
  if (!userId) return "—";
  return names?.get(userId) ?? "—";
}

/** Vrai quand le navigateur est en ligne (rafraîchi sur les événements online/offline). */
export { useOnline } from "./use-online";
