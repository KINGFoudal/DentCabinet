import { Client } from "pg";
import { randomUUID } from "node:crypto";

export const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export async function connect() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

/** Crée un utilisateur auth (le trigger crée son profil). */
export async function createUser(db: Client, email = `${randomUUID()}@test.local`) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3, now(), now())`,
    [id, email, JSON.stringify({ full_name: email.split("@")[0] })],
  );
  return { id, email };
}

/**
 * Exécute fn avec les droits d'un utilisateur connecté (rôle authenticated + RLS),
 * dans une transaction annulée à la fin sauf si commit = true.
 */
export async function asUser<T>(db: Client, userId: string | null, fn: () => Promise<T>, commit = false): Promise<T> {
  await db.query("begin");
  try {
    const claims = userId ? { sub: userId, role: "authenticated" } : { role: "anon" };
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await db.query(`set local role ${userId ? "authenticated" : "anon"}`);
    const result = await fn();
    await db.query(commit ? "commit" : "rollback");
    return result;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

/** Crée un cabinet dont `owner` est admin + dentiste. */
export async function createCabinet(db: Client, ownerId: string) {
  const slug = `cab-${randomUUID().slice(0, 8)}`;
  return asUser(
    db,
    ownerId,
    async () => {
      const { rows } = await db.query(`select public.create_cabinet($1, $2) as id`, [`Cabinet ${slug}`, slug]);
      return rows[0].id as string;
    },
    true,
  );
}

export async function addMember(db: Client, cabinetId: string, userId: string, roles: string[]) {
  await db.query(`insert into public.memberships (cabinet_id, user_id, roles) values ($1, $2, $3::public.app_role[])`, [
    cabinetId,
    userId,
    `{${roles.join(",")}}`,
  ]);
}
