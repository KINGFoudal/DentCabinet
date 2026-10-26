# Nimba Dentaire

Logiciel SaaS de gestion de cabinets dentaires pour la Guinée : agenda et rappels WhatsApp, dossier patient avec schéma dentaire, devis et factures en GNF, paiements Orange Money et MTN Mobile Money, espace patient, abonnement par nombre de dentistes. L'espace cabinet fonctionne **hors ligne** et se synchronise au retour du réseau.

- Cahier des charges : [`PROMPT.md`](PROMPT.md)
- Architecture et règles de développement : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Stack

Next.js 16 (App Router, PWA) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage, Edge Functions) · Dexie (IndexedDB) · Vitest · Playwright.

## Démarrage en local

Prérequis : Node.js 22, Docker.

```bash
npm install
./scripts/setup-local-env.sh  # secret du hook d'envoi des codes
npx supabase start            # base, auth, storage, Edge Functions en local (Docker)
npx supabase db reset         # applique les migrations et les données de démonstration
./scripts/setup-local-env.sh  # crée .env.local avec les clés locales
npm run dev                   # http://localhost:3000
```

Espace patient de démonstration : http://localhost:3000/patient, numéro `620 11 11 11`, code `123456`.
Sans clés WhatsApp, les messages sont simulés en local (`MESSAGING_MODE=sandbox` dans
`supabase/functions/.env`) : rien n'est envoyé et les codes de connexion ne sont jamais journalisés ;
utilisez le numéro de démonstration. Les paiements Orange Money / MTN sont simulés
(`PAYMENTS_MODE=sandbox`, `PAYMENTS_SANDBOX_SECRET`, `NIMBA_ENV=development` dans `.env.local`).

Comptes de démonstration (mot de passe `Demo12345`) :

| Email | Rôle |
|---|---|
| admin@demo.nimba.gn | Administrateur + dentiste |
| dentiste@demo.nimba.gn | Dentiste |
| accueil@demo.nimba.gn | Secrétaire |
| compta@demo.nimba.gn | Comptable |
| plateforme@demo.nimba.gn | Administrateur de la plateforme |

Page publique de démonstration : http://localhost:3000/c/kaloum

## Vérifications

```bash
npm run check      # typage, lint, tests (unitaires + base de données), build
npm run test:db    # tests RLS et synchronisation (Supabase local requis)
```

## Déploiement

Procédure complète pas à pas : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

1. Créer un projet Supabase, puis `npx supabase link --project-ref <ref>` et `npx supabase db push`.
2. Déployer sur Vercel avec les variables de `.env.example` (la clé service uniquement côté serveur).
3. Désigner le premier administrateur de la plateforme :
   ```sql
   update public.profiles set is_platform_admin = true where id = (select id from auth.users where email = 'vous@exemple.com');
   ```

## Secrets de production

- Next.js (Vercel) : variables de `.env.example`, plus celles des opérateurs de paiement
  (`ORANGE_MONEY_*`, `MTN_MOMO_*`, `PAYMENTS_MODE=live`, `PAYMENTS_CALLBACK_BASE_URL`), voir `src/lib/payments/`.
- Edge Functions (`npx supabase secrets set ...`) : `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_REMINDER_TEMPLATE`, `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `REMINDERS_CRON_SECRET`, `SEND_SMS_HOOK_SECRETS`.
- Auth Supabase : activer le hook « Send SMS » vers la fonction `send-sms-hook`.
- Vault (rappels planifiés) :
  ```sql
  select vault.create_secret('https://<ref>.supabase.co', 'project_url');
  select vault.create_secret('<même valeur que REMINDERS_CRON_SECRET>', 'reminders_cron_secret');
  ```

## Points à valider avant la mise en production

- **MTN a cédé sa filiale guinéenne (Areeba) à l'État fin 2024** : confirmer l'accès à l'API MoMo Guinée,
  ou passer par un agrégateur local (un adaptateur se branche dans `src/lib/payments/registry.ts`).

- Accès marchand Orange Money et MTN Mobile Money en Guinée (API, environnement de test, webhooks).
- Modèles WhatsApp Business approuvés par Meta pour les rappels et les codes de connexion.
- Conformité à la législation guinéenne sur la protection des données de santé (avis d'un juriste local).
- Prix des formules d'abonnement (les prix fournis sont indicatifs).
