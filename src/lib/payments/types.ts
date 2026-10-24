/**
 * Couche de paiement mobile : interface commune à tous les opérateurs.
 *
 * Le reste de l'application ne connaît que ce contrat (et les routes /api/payments/*). Pour
 * changer d'opérateur ou passer par un agrégateur, il suffit d'écrire un nouvel adaptateur
 * qui implémente `PaymentProviderAdapter` et de l'enregistrer dans `registry.ts`.
 */

export type ProviderId = "orange_money" | "mtn_momo";
export const PROVIDERS: readonly ProviderId[] = ["orange_money", "mtn_momo"] as const;

/** Statut tel que vu par l'application (les statuts opérateur y sont ramenés). */
export type ProviderStatus = "pending" | "succeeded" | "failed" | "expired";

export type InitiateInput = {
  /** Identifiant de notre transaction (uuid v4), réutilisé comme référence externe. */
  transactionId: string;
  amountGnf: number;
  /** Numéro du payeur au format E.164 (+224...). */
  phone: string;
  /** Libellé court affiché au payeur (facture, abonnement). */
  description: string;
  /** URL de notification serveur à serveur (webhook). */
  notifyUrl: string;
  /** URL de retour du navigateur après paiement (opérateurs à redirection). */
  returnUrl: string;
  cancelUrl: string;
  locale: "fr" | "en";
};

export type InitiateResult = {
  status: "pending" | "succeeded" | "failed";
  /** Référence de l'opérateur (pay_token Orange, X-Reference-Id MTN...). */
  providerReference: string;
  /** Page de paiement de l'opérateur, si le parcours passe par une redirection. */
  redirectUrl?: string;
  /** Secret à conserver côté serveur pour authentifier le webhook (ex. notif_token Orange). */
  webhookSecret?: string;
  failureReason?: string;
  raw?: unknown;
};

export type StatusQuery = {
  transactionId: string;
  providerReference: string | null;
  amountGnf: number;
};

export type StatusResult = {
  status: ProviderStatus;
  /** Référence de la transaction financière chez l'opérateur (txnid, financialTransactionId). */
  providerTransactionId?: string;
  failureReason?: string;
  raw?: unknown;
};

/** Ce qu'un webhook permet d'identifier, avant vérification. */
export type ParsedWebhook = {
  transactionId?: string;
  providerReference?: string;
  /** Statut annoncé par la notification (non fiable tant que non vérifié). */
  claimedStatus?: ProviderStatus;
  providerTransactionId?: string;
  failureReason?: string;
  raw: unknown;
};

export type WebhookContext = {
  parsed: ParsedWebhook;
  body: string;
  headers: Headers;
  transaction: StatusQuery;
  /** Secret enregistré à l'initiation (peut être absent). */
  secret: string | null;
};

/** Résultat d'une vérification : null = notification non authentique. */
export type VerifiedWebhook = StatusResult | null;

export interface PaymentProviderAdapter {
  /** Nom technique de l'adaptateur (orange_money, mtn_momo, sandbox...). */
  readonly name: string;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  status(query: StatusQuery): Promise<StatusResult>;
  /** Analyse le corps brut d'un webhook ; lève une erreur si le format est inconnu. */
  parseWebhook(body: string, url: URL, headers: Headers): ParsedWebhook;
  /** Vérifie l'authenticité selon la méthode de l'opérateur et renvoie le statut à appliquer. */
  verifyWebhook(ctx: WebhookContext): Promise<VerifiedWebhook>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/** Petit utilitaire injectable dans les adaptateurs (remplacé dans les tests). */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
