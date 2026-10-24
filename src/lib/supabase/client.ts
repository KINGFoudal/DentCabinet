import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type Supabase = SupabaseClient<Database>;

let client: Supabase | null = null;

/**
 * Client Supabase du navigateur. La session est conservée dans localStorage,
 * ce qui permet de continuer à travailler hors ligne avec la dernière session connue.
 */
export function supabase(): Supabase {
  if (!client) {
    client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "nimba-auth" },
    });
  }
  return client;
}
