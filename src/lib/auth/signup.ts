/** Email saisi à l'inscription, repris par la page de connexion (sessionStorage, pas l'URL). */
export const SIGNUP_EMAIL_KEY = "nimba-signup-email";

/**
 * Lien de confirmation envoyé par email : retour sur la page de connexion avec
 * « Email confirmé, connectez-vous », en conservant la page demandée (invitation...).
 * L'URL doit figurer dans les « Redirect URLs » de Supabase Auth.
 */
export function confirmationRedirect(origin: string, next?: string | null) {
  const url = new URL("/connexion", origin);
  url.searchParams.set("confirme", "1");
  if (next) url.searchParams.set("next", next);
  return url.toString();
}

/** Page de connexion après « Créer un compte » quand la confirmation d'email est requise. */
export function afterSignupPath(next?: string | null) {
  const sp = new URLSearchParams({ inscrit: "1" });
  if (next) sp.set("next", next);
  return `/connexion?${sp.toString()}`;
}
