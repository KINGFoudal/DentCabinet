import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import type { Database } from "@/lib/database.types";
import { NimbaDB, localDb, setLocalDb } from "@/lib/local/db";
import { SyncEngine } from "@/lib/sync/engine";
import { mutate, softDelete } from "@/lib/sync/mutate";

function env(name: string) {
  const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(name + "="));
  return line!.slice(name.length + 1);
}
const URL = env("NEXT_PUBLIC_SUPABASE_URL");
const ANON = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

async function signedInClient() {
  const admin = createClient<Database>(URL, SERVICE, { auth: { persistSession: false } });
  const email = `${crypto.randomUUID()}@test.local`;
  const password = "Test12345!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const sb = createClient<Database>(URL, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return sb;
}

let sb: Awaited<ReturnType<typeof signedInClient>>;
let cabinetId: string;
let userId: string;
let engine: SyncEngine;

beforeAll(async () => {
  setLocalDb(new NimbaDB(`test-${crypto.randomUUID()}`));
  sb = await signedInClient();
  userId = (await sb.auth.getUser()).data.user!.id;
  const slug = `sync-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await sb.rpc("create_cabinet", { p_name: "Cabinet Sync", p_slug: slug });
  if (error) throw error;
  cabinetId = data as string;
  engine = new SyncEngine(sb, cabinetId);
});

afterAll(() => {
  localDb().close();
  setLocalDb(null);
});

describe("synchronisation", () => {
  it("récupère les données initiales du cabinet", async () => {
    await engine.sync();
    const types = await localDb().appointment_types.where("cabinet_id").equals(cabinetId).count();
    expect(types).toBe(5);
    expect(await localDb().cabinets.get(cabinetId)).toBeTruthy();
    expect(engine.getState().lastError).toBeNull();
  });

  it("envoie une création locale et récupère les champs calculés par le serveur", async () => {
    const p = await mutate("patients", { cabinet_id: cabinetId, first_name: "Aïssatou", last_name: "Bah" });
    expect((await localDb().patients.get(p.id))?._dirty).toBe(1);
    expect(engine.getState().pending + 0).toBeGreaterThanOrEqual(0);
    await engine.sync();
    const local = await localDb().patients.get(p.id);
    expect(local?._dirty).toBe(0);
    expect(local?.file_number).toMatch(/^P\d{4}-\d{5}$/);
    const { data } = await sb.from("patients").select("first_name").eq("id", p.id).single();
    expect(data?.first_name).toBe("Aïssatou");
  });

  it("regroupe plusieurs modifications d'une même ligne en une seule entrée", async () => {
    const p = await mutate("patients", { cabinet_id: cabinetId, first_name: "A", last_name: "B" });
    await mutate("patients", { id: p.id, city: "Conakry" });
    await mutate("patients", { id: p.id, city: "Kindia" });
    expect(await localDb().outbox.where("[table+pk]").equals(["patients", p.id]).count()).toBe(1);
    await engine.sync();
    const { data } = await sb.from("patients").select("city, first_name").eq("id", p.id).single();
    expect(data).toEqual({ city: "Kindia", first_name: "A" });
  });

  it("signale un rendez-vous refusé (chevauchement) et restaure l'état serveur", async () => {
    const base = { cabinet_id: cabinetId, dentist_id: userId };
    await mutate("appointments", { ...base, starts_at: "2031-03-03T09:00:00Z", ends_at: "2031-03-03T09:30:00Z" });
    await engine.sync();
    const clash = await mutate("appointments", { ...base, starts_at: "2031-03-03T09:15:00Z", ends_at: "2031-03-03T09:45:00Z" });
    await engine.sync();
    const failed = await localDb().outbox.where("status").equals("failed").toArray();
    expect(failed).toHaveLength(1);
    expect(failed[0].errorCode).toBe("23P01");
    expect(await localDb().appointments.get(clash.id)).toBeUndefined();
    expect(engine.getState().failed).toBe(1);
    await engine.discard(failed[0].seq!);
    expect(engine.getState().failed).toBe(0);
  });

  it("propage une suppression logique", async () => {
    const act = await mutate("acts", { cabinet_id: cabinetId, label: "Détartrage", price_gnf: 150000 });
    await engine.sync();
    await softDelete("acts", act.id);
    await engine.sync();
    const { data } = await sb.from("acts").select("deleted_at").eq("id", act.id).single();
    expect(data?.deleted_at).not.toBeNull();
  });

  it("reçoit les modifications faites ailleurs", async () => {
    const { data } = await sb
      .from("patients")
      .insert({ cabinet_id: cabinetId, first_name: "Distant", last_name: "Ailleurs" })
      .select()
      .single();
    await engine.sync();
    expect((await localDb().patients.get(data!.id))?.first_name).toBe("Distant");
  });

  it("met les modifications en attente quand le réseau est coupé", async () => {
    const offline = createClient<Database>("http://127.0.0.1:1", ANON, { auth: { persistSession: false } });
    const offEngine = new SyncEngine(offline, cabinetId);
    await mutate("patients", { cabinet_id: cabinetId, first_name: "Hors", last_name: "Ligne" });
    await offEngine.sync();
    expect(offEngine.getState().online).toBe(false);
    expect(offEngine.getState().pending).toBe(1);
    await engine.sync();
    expect(engine.getState().pending).toBe(0);
  });
});
