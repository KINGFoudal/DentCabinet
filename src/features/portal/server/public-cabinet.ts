import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { parsePublicCabinet, type PublicCabinet } from "@/features/portal/lib/types";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Données publiques d'un cabinet (RPC public_cabinet, sans compte), mises en cache quelques
 * minutes : la page publique reste rapide en 3G et ne sollicite pas la base à chaque visite.
 * La disponibilité réelle est toujours revérifiée par available_slots / book_online.
 */
export async function getPublicCabinet(slug: string): Promise<PublicCabinet | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`public-cabinet:${slug}`);
  if (slug.length > 64 || !SLUG_RE.test(slug)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  const res = await fetch(`${url}/rest/v1/rpc/public_cabinet`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!res.ok) throw new Error(`public_cabinet failed: ${res.status}`);
  return parsePublicCabinet(await res.json());
}
