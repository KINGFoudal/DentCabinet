import { localDb, SYNCED_TABLES, type Row, type SyncedTable } from "@/lib/local/db";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Appelé après chaque écriture locale (le moteur de synchronisation s'y abonne). */
export function onLocalWrite(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Écrit une ligne dans la base locale et la met en file d'envoi.
 * `patch` est fusionné avec la ligne locale existante (même clé primaire) s'il y en a une.
 * Renvoie la ligne complète écrite localement.
 *
 * Exemple : await mutate("patients", { cabinet_id, first_name: "Mariama", last_name: "Diallo" })
 */
export async function mutate<T extends SyncedTable>(table: T, patch: Partial<Row<T>>): Promise<Row<T>> {
  const db = localDb();
  const { pk } = SYNCED_TABLES[table];
  const rec = patch as Record<string, unknown>;
  if (rec[pk] == null) {
    if (pk !== "id") throw new Error(`${table}: ${pk} is required`);
    rec[pk] = newId();
  }
  const key = String(rec[pk]);
  const tbl = db.table(table);

  const row = await db.transaction("rw", tbl, db.outbox, async () => {
    const existing = (await tbl.get(key)) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    const merged: Record<string, unknown> = {
      ...(existing ?? { created_at: now }),
      ...rec,
      updated_at: now,
      _dirty: 1,
    };
    await tbl.put(merged);

    const pending = await db.outbox
      .where("[table+pk]")
      .equals([table, key])
      .filter((e) => e.status === "pending")
      .first();
    if (pending) {
      await db.outbox.update(pending.seq!, { row: merged });
    } else {
      await db.outbox.add({ table, pk: key, row: merged, status: "pending", createdAt: now, attempts: 0 });
    }
    return merged;
  });

  for (const fn of listeners) fn();
  return row as unknown as Row<T>;
}

/** Suppression logique (deleted_at). */
export function softDelete<T extends SyncedTable>(table: T, key: string) {
  const { pk } = SYNCED_TABLES[table];
  return mutate(table, { [pk]: key, deleted_at: new Date().toISOString() } as unknown as Partial<Row<T>>);
}
