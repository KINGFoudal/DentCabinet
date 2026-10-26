import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { localDb, wipeLocalDb } from "./db";
import { claimLocalData, OWNER_KEY, wipeDeviceData } from "./device-data";

const patient = (id: string) => ({ id, cabinet_id: "c1", first_name: "A", last_name: "B" }) as never;

describe("données locales de l'appareil", () => {
  beforeEach(async () => {
    await wipeLocalDb();
  });

  it("attribue une base sans propriétaire à l'utilisateur connecté", async () => {
    await localDb().patients.put(patient("p1"));
    expect(await claimLocalData("u1")).toBe(false);
    expect((await localDb().meta.get(OWNER_KEY))?.value).toBe("u1");
    expect(await localDb().patients.count()).toBe(1);
  });

  it("garde les données du même utilisateur", async () => {
    await claimLocalData("u1");
    await localDb().patients.put(patient("p1"));
    expect(await claimLocalData("u1")).toBe(false);
    expect(await localDb().patients.count()).toBe(1);
  });

  it("efface tout si un autre utilisateur se connecte", async () => {
    await claimLocalData("u1");
    await localDb().patients.put(patient("p1"));
    await localDb().outbox.add({ table: "patients", pk: "p1", row: {}, status: "pending", createdAt: "", attempts: 0 });
    expect(await claimLocalData("u2")).toBe(true);
    expect(await localDb().patients.count()).toBe(0);
    expect(await localDb().outbox.count()).toBe(0);
    expect((await localDb().meta.get(OWNER_KEY))?.value).toBe("u2");
  });

  it("efface tout à la déconnexion", async () => {
    await claimLocalData("u1");
    await localDb().patients.put(patient("p1"));
    await wipeDeviceData();
    expect(await localDb().patients.count()).toBe(0);
    expect(await localDb().meta.get(OWNER_KEY)).toBeUndefined();
  });
});
