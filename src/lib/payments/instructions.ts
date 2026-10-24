import type { ProviderId } from "./types";

/**
 * Consignes renvoyées par POST /api/payments/initiate (champ `instructions`), dans la langue
 * demandée par l'en-tête Accept-Language. Les codes USSD ne sont volontairement pas cités :
 * ils dépendent de l'opérateur et doivent être confirmés par lui.
 */
const TEXT = {
  fr: {
    orange_money:
      "Ouvrez la page de paiement Orange Money, saisissez votre numéro, puis le code temporaire obtenu depuis le menu Orange Money de votre téléphone (code secret requis).",
    mtn_momo: "Une demande de paiement a été envoyée sur votre téléphone. Validez-la avec votre code secret Mobile Money.",
    sandbox: "Mode test : aucune somme ne sera débitée. Utilisez les boutons de simulation pour confirmer ou refuser le paiement.",
  },
  en: {
    orange_money:
      "Open the Orange Money payment page, enter your number, then the temporary code obtained from the Orange Money menu on your phone (secret code required).",
    mtn_momo: "A payment request has been sent to your phone. Approve it with your Mobile Money PIN.",
    sandbox: "Test mode: no money will be taken. Use the simulation buttons to confirm or decline the payment.",
  },
} as const;

export function localeFromRequest(req: Request): "fr" | "en" {
  return (req.headers.get("accept-language") ?? "").toLowerCase().startsWith("en") ? "en" : "fr";
}

export function paymentInstructions(provider: ProviderId, locale: "fr" | "en", sandbox: boolean) {
  return sandbox ? TEXT[locale].sandbox : TEXT[locale][provider];
}
