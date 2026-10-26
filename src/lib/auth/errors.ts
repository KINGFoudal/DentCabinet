/**
 * Traduit une erreur de Supabase Auth ou d'une RPC en clé de traduction : on n'affiche
 * jamais le message brut du serveur (anglais, technique).
 */
export function authErrorKey(error: { code?: string | null; status?: number | null; name?: string | null; message?: string | null } | null | undefined): string {
  if (!error) return "auth.errors.generic";
  switch (error.code) {
    case "invalid_credentials":
      return "auth.invalidCredentials";
    case "email_not_confirmed":
      return "auth.errors.emailNotConfirmed";
    case "user_already_exists":
    case "email_exists":
    case "identity_already_exists":
      return "auth.errors.emailTaken";
    case "email_address_invalid":
    case "email_address_not_authorized":
      return "auth.errors.emailInvalid";
    case "weak_password":
      return "auth.errors.weakPassword";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "auth.errors.rateLimit";
    case "signup_disabled":
    case "email_provider_disabled":
      return "auth.errors.signupDisabled";
    // Postgres : contrainte d'unicité (adresse du cabinet déjà prise), valeur refusée.
    case "23505":
      return "auth.errors.slugTaken";
    case "23514":
    case "22023":
      return "auth.errors.slugInvalid";
  }
  if (error.status === 429) return "auth.errors.rateLimit";
  // Erreur réseau (fetch impossible, hors ligne).
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || /fetch/i.test(error.message ?? "")) return "auth.errors.network";
  return "auth.errors.generic";
}
