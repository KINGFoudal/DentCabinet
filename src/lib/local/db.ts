import Dexie, { type Table } from "dexie";
import type { Tables } from "@/lib/database.types";

/**
 * Base locale (IndexedDB) : copie des données du cabinet pour le mode hors ligne.
 *
 * Chaque ligne locale porte `_dirty` (1 = modification pas encore acceptée par le serveur).
 * Les écritures passent par `mutate()` (src/lib/sync/mutate.ts), jamais directement par Dexie.
 */

export type Local<T> = T & { _dirty?: 0 | 1 };

/** Tables synchronisées et leur clé primaire. L'ordre compte : parents avant enfants. */
export const SYNCED_TABLES = {
  plans: { pk: "id", scope: "global" },
  cabinets: { pk: "id", scope: "self" },
  profiles: { pk: "id", scope: "global" },
  memberships: { pk: "id", scope: "cabinet" },
  chairs: { pk: "id", scope: "cabinet" },
  appointment_types: { pk: "id", scope: "cabinet" },
  practitioner_schedules: { pk: "id", scope: "cabinet" },
  time_off: { pk: "id", scope: "cabinet" },
  acts: { pk: "id", scope: "cabinet" },
  medications: { pk: "id", scope: "cabinet" },
  message_templates: { pk: "id", scope: "cabinet" },
  patients: { pk: "id", scope: "cabinet" },
  patient_medical: { pk: "patient_id", scope: "cabinet" },
  appointments: { pk: "id", scope: "cabinet" },
  clinical_notes: { pk: "id", scope: "cabinet" },
  tooth_records: { pk: "id", scope: "cabinet" },
  treatment_plans: { pk: "id", scope: "cabinet" },
  treatment_plan_items: { pk: "id", scope: "cabinet" },
  prescriptions: { pk: "id", scope: "cabinet" },
  documents: { pk: "id", scope: "cabinet" },
  quotes: { pk: "id", scope: "cabinet" },
  quote_items: { pk: "id", scope: "cabinet" },
  invoices: { pk: "id", scope: "cabinet" },
  invoice_items: { pk: "id", scope: "cabinet" },
  payment_installments: { pk: "id", scope: "cabinet" },
  payments: { pk: "id", scope: "cabinet" },
} as const satisfies Record<string, { pk: string; scope: "global" | "self" | "cabinet" }>;

export type SyncedTable = keyof typeof SYNCED_TABLES;
export type Row<T extends SyncedTable> = Tables<T>;

/** Champs calculés par le serveur : jamais envoyés lors d'une écriture. */
export const SERVER_FIELDS: Partial<Record<SyncedTable, string[]>> = {
  cabinets: ["subscription_status", "trial_ends_at", "current_period_end", "plan_id"],
  profiles: ["is_platform_admin"],
  patients: ["file_number"],
  quotes: ["number", "total_gnf"],
  invoices: ["number", "total_gnf", "paid_gnf"],
};

export type OutboxEntry = {
  seq?: number;
  table: SyncedTable;
  pk: string;
  row: Record<string, unknown>;
  status: "pending" | "failed";
  error?: string;
  errorCode?: string;
  createdAt: string;
  attempts: number;
};

export type MetaEntry = { key: string; value: unknown };

type LocalTables = { [K in SyncedTable]: Table<Local<Row<K>>, string> };

// Fusion de déclarations : expose chaque table typée (db.patients, db.appointments, ...).
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type
export interface NimbaDB extends LocalTables {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class NimbaDB extends Dexie {
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor(name = "nimba") {
    super(name);
    this.version(1).stores({
      plans: "&id",
      cabinets: "&id",
      profiles: "&id",
      memberships: "&id, cabinet_id, user_id",
      chairs: "&id, cabinet_id",
      appointment_types: "&id, cabinet_id",
      practitioner_schedules: "&id, cabinet_id, dentist_id",
      time_off: "&id, cabinet_id, dentist_id",
      acts: "&id, cabinet_id",
      message_templates: "&id, cabinet_id",
      patients: "&id, cabinet_id, [cabinet_id+last_name], phone, file_number, _dirty",
      patient_medical: "&patient_id, cabinet_id, _dirty",
      appointments: "&id, cabinet_id, [cabinet_id+starts_at], patient_id, dentist_id, _dirty",
      clinical_notes: "&id, cabinet_id, patient_id, _dirty",
      tooth_records: "&id, cabinet_id, patient_id, _dirty",
      treatment_plans: "&id, cabinet_id, patient_id, _dirty",
      treatment_plan_items: "&id, cabinet_id, plan_id, _dirty",
      prescriptions: "&id, cabinet_id, patient_id, _dirty",
      documents: "&id, cabinet_id, patient_id, _dirty",
      quotes: "&id, cabinet_id, patient_id, status, [cabinet_id+issue_date], _dirty",
      quote_items: "&id, cabinet_id, quote_id",
      invoices: "&id, cabinet_id, patient_id, status, [cabinet_id+issue_date], _dirty",
      invoice_items: "&id, cabinet_id, invoice_id",
      payment_installments: "&id, cabinet_id, invoice_id",
      payments: "&id, cabinet_id, invoice_id, [cabinet_id+paid_at]",
      outbox: "++seq, [table+pk], table, status",
      meta: "&key",
    });
    // Version 2 : médicaments du cabinet ; liens consultation (ordonnance -> facture / RDV,
    // facture -> RDV). Seules les tables modifiées sont redéclarées.
    this.version(2).stores({
      medications: "&id, cabinet_id",
      prescriptions: "&id, cabinet_id, patient_id, invoice_id, appointment_id, _dirty",
      invoices: "&id, cabinet_id, patient_id, status, [cabinet_id+issue_date], appointment_id, _dirty",
    });
  }
}

let instance: NimbaDB | null = null;

export function localDb(): NimbaDB {
  if (!instance) instance = new NimbaDB();
  return instance;
}

/** Remplace l'instance (tests). */
export function setLocalDb(db: NimbaDB | null) {
  instance = db;
}

/** Efface toutes les données locales (déconnexion). */
export async function wipeLocalDb() {
  const db = localDb();
  db.close();
  await Dexie.delete(db.name);
  instance = null;
}
