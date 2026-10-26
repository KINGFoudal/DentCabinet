import type { Supabase } from "@/lib/supabase/client";
import { parsePublicCabinet, type OpeningHours, type PortalCabinet } from "./types";

/**
 * Horaires d'ouverture des cabinets du patient, lus sur leur page publique (RPC public_cabinet).
 * Un cabinet sans page publique n'expose pas ses horaires : il est simplement absent du résultat.
 */
export async function loadOpeningHours(sb: Supabase, cabinets: Pick<PortalCabinet, "id" | "slug" | "public_page_enabled">[]) {
  const out: Record<string, OpeningHours> = {};
  await Promise.all(
    cabinets
      .filter((c) => c.public_page_enabled && c.slug)
      .map(async (c) => {
        const { data, error } = await sb.rpc("public_cabinet", { p_slug: c.slug });
        if (error) return;
        const pub = parsePublicCabinet(data);
        if (pub && pub.id === c.id) out[c.id] = pub.opening_hours;
      }),
  );
  return out;
}
