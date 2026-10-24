"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuth } from "@/lib/auth/auth-provider";
import { supabase } from "@/lib/supabase/client";
import { localDb, type Row } from "@/lib/local/db";
import { SyncEngine, type SyncState } from "@/lib/sync/engine";
import { onLocalWrite } from "@/lib/sync/mutate";
import { cabinetWritable, permissions, type Permissions, type Role } from "@/lib/permissions";

export type MyMembership = {
  cabinet_id: string;
  roles: Role[];
  cabinet: { id: string; name: string; slug: string };
};

type CabinetCtx = {
  /** false tant que la liste des cabinets n'est pas connue. */
  ready: boolean;
  memberships: MyMembership[];
  cabinetId: string | null;
  cabinet: Row<"cabinets"> | null;
  roles: Role[];
  can: Permissions;
  readOnly: boolean;
  isPlatformAdmin: boolean;
  selectCabinet: (id: string) => void;
  reloadMemberships: () => Promise<void>;
  engine: SyncEngine | null;
  sync: SyncState;
};

const CabinetContext = createContext<CabinetCtx | null>(null);

const CABINET_KEY = "nimba-cabinet";
const MEMBERSHIPS_KEY = "nimba-memberships";
const SYNC_INTERVAL_MS = 30_000;

const emptySync: SyncState = { online: true, syncing: false, pending: 0, failed: 0, lastSyncAt: null, lastError: null };

function readJSON<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function CabinetProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [memberships, setMemberships] = useState<MyMembership[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [cabinetId, setCabinetId] = useState<string | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [sync, setSync] = useState<SyncState>(emptySync);

  const reloadMemberships = useCallback(async () => {
    if (!user) return;
    const sb = supabase();
    const [{ data, error }, profile] = await Promise.all([
      sb
        .from("memberships")
        .select("cabinet_id, roles, cabinet:cabinets(id, name, slug)")
        .eq("user_id", user.id)
        .eq("active", true)
        .is("deleted_at", null),
      sb.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle(),
    ]);
    if (!error && data) {
      const list = data.filter((m) => m.cabinet) as unknown as MyMembership[];
      setMemberships(list);
      try {
        localStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify({ list, admin: !!profile.data?.is_platform_admin }));
      } catch {}
    }
    if (profile.data) setIsPlatformAdmin(!!profile.data.is_platform_admin);
  }, [user]);

  // Liste des cabinets : d'abord le cache local (hors ligne), puis le serveur.
  useEffect(() => {
    if (!user) {
      /* eslint-disable react-hooks/set-state-in-effect -- réinitialisation à la déconnexion */
      setMemberships([]);
      setCabinetId(null);
      setReady(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const cached = readJSON<{ list: MyMembership[]; admin: boolean }>(MEMBERSHIPS_KEY);
    if (cached) {
      setMemberships(cached.list);
      setIsPlatformAdmin(cached.admin);
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(CABINET_KEY);
    } catch {}
    setCabinetId(saved);
    reloadMemberships().finally(() => setReady(true));
    if (cached) setReady(true);
  }, [user, reloadMemberships]);

  // Choix automatique s'il n'y a qu'un cabinet, ou si le cabinet mémorisé n'est plus accessible.
  useEffect(() => {
    if (!ready) return;
    if (cabinetId && memberships.some((m) => m.cabinet_id === cabinetId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sélection dérivée de la liste chargée
    setCabinetId(memberships.length === 1 ? memberships[0].cabinet_id : null);
  }, [ready, memberships, cabinetId]);

  const selectCabinet = useCallback((id: string) => {
    setCabinetId(id);
    try {
      localStorage.setItem(CABINET_KEY, id);
    } catch {}
  }, []);

  // Moteur de synchronisation du cabinet actif.
  useEffect(() => {
    if (!user || !cabinetId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pas de cabinet actif
      setEngine(null);
      return;
    }
    const e = new SyncEngine(supabase(), cabinetId);
    setEngine(e);
    const unsub = e.subscribe(setSync);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const offWrite = onLocalWrite(() => {
      void e.refreshCounts();
      clearTimeout(debounce);
      debounce = setTimeout(() => void e.sync(), 800);
    });
    const onOnline = () => e.setOnline(true);
    const onOffline = () => e.setOnline(false);
    const onVisible = () => document.visibilityState === "visible" && void e.sync();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => navigator.onLine && void e.sync(), SYNC_INTERVAL_MS);
    if (!navigator.onLine) e.setOnline(false);
    void e.sync();
    return () => {
      unsub();
      offWrite();
      clearTimeout(debounce);
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, cabinetId]);

  const cabinet = useLiveQuery(async () => (cabinetId ? ((await localDb().cabinets.get(cabinetId)) ?? null) : null), [cabinetId]) ?? null;

  const roles = useMemo(() => memberships.find((m) => m.cabinet_id === cabinetId)?.roles ?? [], [memberships, cabinetId]);
  // Tant que le cabinet n'est pas encore en local, on ne bloque pas l'écriture (le serveur tranchera).
  const writable = cabinet ? cabinetWritable(cabinet) : true;
  const can = useMemo(() => permissions(roles, writable), [roles, writable]);

  return (
    <CabinetContext
      value={{
        ready,
        memberships,
        cabinetId,
        cabinet,
        roles,
        can,
        readOnly: !writable,
        isPlatformAdmin,
        selectCabinet,
        reloadMemberships,
        engine,
        sync,
      }}
    >
      {children}
    </CabinetContext>
  );
}

export function useCabinet() {
  const ctx = useContext(CabinetContext);
  if (!ctx) throw new Error("useCabinet must be used within CabinetProvider");
  return ctx;
}

/** Identifiant du cabinet actif ; à n'utiliser que sous <AppGate> (garanti non nul). */
export function useCabinetId(): string {
  const { cabinetId } = useCabinet();
  if (!cabinetId) throw new Error("No active cabinet");
  return cabinetId;
}
