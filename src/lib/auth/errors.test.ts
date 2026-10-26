import { describe, expect, it } from "vitest";
import { authErrorKey } from "./errors";
import { dictionaries, translate } from "@/i18n/messages";

describe("erreurs d'authentification", () => {
  it("traduit les codes connus en clés de traduction", () => {
    expect(authErrorKey({ code: "invalid_credentials" })).toBe("auth.invalidCredentials");
    expect(authErrorKey({ code: "email_not_confirmed" })).toBe("auth.errors.emailNotConfirmed");
    expect(authErrorKey({ code: "user_already_exists" })).toBe("auth.errors.emailTaken");
    expect(authErrorKey({ code: "weak_password" })).toBe("auth.errors.weakPassword");
    expect(authErrorKey({ code: "over_email_send_rate_limit" })).toBe("auth.errors.rateLimit");
    expect(authErrorKey({ code: "23505" })).toBe("auth.errors.slugTaken");
  });

  it("n'expose jamais le message brut du serveur", () => {
    expect(authErrorKey({ code: "something_new", message: "Database error saving new user" })).toBe("auth.errors.generic");
    expect(authErrorKey({ name: "AuthRetryableFetchError", message: "Failed to fetch" })).toBe("auth.errors.network");
    expect(authErrorKey(null)).toBe("auth.errors.generic");
  });

  it("chaque clé renvoyée existe en français et en anglais", () => {
    const codes = ["invalid_credentials", "email_not_confirmed", "email_exists", "email_address_invalid", "weak_password", "over_request_rate_limit", "signup_disabled", "23505", "23514", "x"];
    for (const code of codes) {
      const key = authErrorKey({ code });
      expect(translate("fr", key)).not.toBe(key);
      expect(translate("en", key)).not.toBe(key);
    }
    expect(dictionaries.fr).toBeDefined();
  });
});
