import { NextResponse, type NextRequest } from "next/server";
import { publicCabinetExists, publicSlugFromPath } from "@/features/portal/server/cabinet-exists";

/** Page statique « cabinet introuvable » servie avec le statut 404 (src/app/c/Introuvable). */
const NOT_FOUND_PATH = "/c/Introuvable";

/**
 * Pages publiques des cabinets : un slug inconnu reçoit un vrai statut 404.
 * La page /c/[slug] est diffusée en flux (prérendu partiel) : le statut 200 est envoyé avec
 * la coquille, avant que notFound() puisse jouer. La vérification se fait donc ici, avant le rendu.
 */
export async function proxy(request: NextRequest) {
  const slug = publicSlugFromPath(request.nextUrl.pathname);
  if (!slug) return;
  if ((await publicCabinetExists(slug)) === false) return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
}

export const config = {
  matcher: ["/c/:slug", "/c/:slug/rdv"],
};
