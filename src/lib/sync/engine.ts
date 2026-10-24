import type { Supabase } from "@/lib/supabase/client";
import { localDb, SERVER_FIELDS, SYNCED_TABLES, type OutboxEntry, type SyncedTable } from "@/lib/local/db";

/**
 * Synchronisation base locale <-> Supabase.
 *
 * - Envoi (push) : la file `outbox` est rejouée dans l'ordre. Une erreur réseau arrête l'envoi
 *   (on réessaiera) ; un refus du serveur (RLS, contrainte, chevauchement de RDV) marque
 *   l'entrée « failed » et restaure la version serveur de la ligne.
 * - Réception (pull) : pour chaque table, lignes modifiées depuis le dernier curseur
 *   (updated_at, avec une marge de recouvrement). Une ligne locale en attente d'envoi
 *   n'est jamais écrasée par la réception.
 * - Conflits : dernière écriture gagnante au niveau de la ligne ; les refus sont affichés.
 */

const PAGE = 1000;
const OVERLAP_MS = 2 * 60 * 1000;

export type SyncState = {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

type Listener = (s: SyncState) => void;

export class NetworkError extends Error {}

function isNetworkError(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return false;
  const msg = error.message ?? "";
  return /fetch failed|Failed to fetch|NetworkError|Load failed|network/i.test(msg) || error.code === "";
}

function stripForPush(table: SyncedTable, row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const skip = new Set(["_dirty", "created_at", "updated_at", ...(SERVER_FIELDS[table] ?? [])]);
  for (const [k, v] of Object.entries(row)) if (!skip.has(k)) out[k] = v;
  return out;
}

export class SyncEngine {
  private state: SyncState = { online: true, syncing: false, pending: 0, failed: 0, lastSyncAt: null, lastError: null };
  private listeners = new Set<Listener>();
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private sb: Supabase,
    private cabinetId: string,
  ) {}

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getState() {
    return this.state;
  }

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  async refreshCounts() {
    const db = localDb();
    const [pending, failed] = await Promise.all([
      db.outbox.where("status").equals("pending").count(),
      db.outbox.where("status").equals("failed").count(),
    ]);
    this.set({ pending, failed });
  }

  setOnline(online: boolean) {
    this.set({ online });
    if (online) void this.sync();
  }

  /** Lance une synchronisation complète ; les appels concurrents sont regroupés. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      this.set({ syncing: true });
      try {
        do {
          this.again = false;
          await this.push();
          await this.pull();
        } while (this.again);
        this.set({ online: true, lastSyncAt: new Date().toISOString(), lastError: null });
      } catch (e) {
        if (e instanceof NetworkError) this.set({ online: false });
        else this.set({ lastError: e instanceof Error ? e.message : String(e) });
      } finally {
        await this.refreshCounts();
        this.set({ syncing: false });
        this.running = null;
      }
    })();
    return this.running;
  }

  async push() {
    const db = localDb();
    const entries = await db.outbox.where("status").equals("pending").sortBy("seq");
    for (const entry of entries) {
      const { pk } = SYNCED_TABLES[entry.table];
      const { data, error } = await this.sb
        .from(entry.table)
        .upsert(stripForPush(entry.table, entry.row) as never, { onConflict: pk })
        .select()
        .maybeSingle();

      if (error && isNetworkError(error)) throw new NetworkError(error.message);

      if (error) {
        await db.outbox.update(entry.seq!, {
          status: "failed",
          error: error.message,
          errorCode: error.code,
          attempts: entry.attempts + 1,
        });
        await this.restoreFromServer(entry);
        continue;
      }

      await db.transaction("rw", db.outbox, db.table(entry.table), async () => {
        await db.outbox.delete(entry.seq!);
        const stillPending = await db.outbox.where("[table+pk]").equals([entry.table, entry.pk]).count();
        if (!stillPending && data) await db.table(entry.table).put({ ...(data as object), _dirty: 0 });
      });
    }
  }

  /** Après un refus, remet la ligne locale dans l'état connu du serveur (ou la retire). */
  private async restoreFromServer(entry: OutboxEntry) {
    const db = localDb();
    const { pk } = SYNCED_TABLES[entry.table];
    const { data, error } = await this.sb.from(entry.table).select("*").eq(pk as never, entry.pk as never).maybeSingle();
    if (error) {
      if (isNetworkError(error)) throw new NetworkError(error.message);
      return;
    }
    const pendingOthers = await db.outbox
      .where("[table+pk]")
      .equals([entry.table, entry.pk])
      .filter((e) => e.status === "pending")
      .count();
    if (pendingOthers) return;
    if (data) await db.table(entry.table).put({ ...(data as object), _dirty: 0 });
    else await db.table(entry.table).delete(entry.pk);
  }

  async pull() {
    for (const table of Object.keys(SYNCED_TABLES) as SyncedTable[]) {
      await this.pullTable(table);
    }
  }

  private cursorKey(table: SyncedTable) {
    return `cursor:${this.cabinetId}:${table}`;
  }

  async pullTable(table: SyncedTable) {
    const db = localDb();
    const { pk, scope } = SYNCED_TABLES[table];
    const cursorRow = await db.meta.get(this.cursorKey(table));
    const cursor = (cursorRow?.value as string | undefined) ?? null;
    const since = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : null;

    let maxSeen = cursor;
    for (let offset = 0; ; offset += PAGE) {
      let q = this.sb.from(table).select("*");
      if (scope === "cabinet") q = q.eq("cabinet_id" as never, this.cabinetId as never);
      if (scope === "self") q = q.eq("id" as never, this.cabinetId as never);
      if (since) q = q.gte("updated_at" as never, since as never);
      const { data, error } = await q
        .order("updated_at" as never, { ascending: true })
        .order(pk as never, { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (error) {
        if (isNetworkError(error)) throw new NetworkError(error.message);
        throw new Error(`${table}: ${error.message}`);
      }
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      if (rows.length) {
        await db.transaction("rw", db.outbox, db.table(table), async () => {
          const dirtyKeys = new Set(
            (await db.outbox.where("table").equals(table).toArray())
              .filter((e) => e.status === "pending")
              .map((e) => e.pk),
          );
          const toPut = rows.filter((r) => !dirtyKeys.has(String(r[pk]))).map((r) => ({ ...r, _dirty: 0 }));
          if (toPut.length) await db.table(table).bulkPut(toPut);
        });
        const last = rows[rows.length - 1].updated_at as string;
        if (!maxSeen || last > maxSeen) maxSeen = last;
      }
      if (rows.length < PAGE) break;
    }
    if (maxSeen && maxSeen !== cursor) await db.meta.put({ key: this.cursorKey(table), value: maxSeen });
  }

  /** Abandonne une modification refusée. */
  async discard(seq: number) {
    await localDb().outbox.delete(seq);
    await this.refreshCounts();
  }

  /** Remet une modification refusée dans la file (après correction côté serveur, par exemple). */
  async retry(seq: number) {
    await localDb().outbox.update(seq, { status: "pending", error: undefined, errorCode: undefined });
    await this.refreshCounts();
    void this.sync();
  }
}
