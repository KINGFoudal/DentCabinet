import { localDb, wipeLocalDb } from "./db";

/**
 * Données de santé conservées sur l'appareil : base IndexedDB et caches localStorage de
 * l'espace cabinet. Elles appartiennent à un seul utilisateur (clé `owner_user_id` de la
 * table `meta`) et sont effacées à la déconnexion ou quand un autre utilisateur se connecte.
 */

export const LOCAL_STORAGE_KEYS = ["nimba-cabinet", "nimba-memberships"] as const;
export const OWNER_KEY = "owner_user_id";

/** Efface toutes les données locales (base IndexedDB et caches). */
export async function wipeDeviceData() {
  try {
    for (const k of LOCAL_STORAGE_KEYS) localStorage.removeItem(k);
  } catch {}
  await wipeLocalDb();
}

/**
 * Rattache les données locales à `userId` avant tout chargement : si elles appartiennent à
 * un autre utilisateur, tout est effacé. Renvoie true si un effacement a eu lieu.
 * Une base sans propriétaire (créée avant ce contrôle) est attribuée à l'utilisateur courant.
 */
export async function claimLocalData(userId: string): Promise<boolean> {
  const owner = (await localDb().meta.get(OWNER_KEY))?.value;
  let wiped = false;
  if (owner !== undefined && owner !== userId) {
    await wipeDeviceData();
    wiped = true;
  }
  if (owner !== userId) await localDb().meta.put({ key: OWNER_KEY, value: userId });
  return wiped;
}
