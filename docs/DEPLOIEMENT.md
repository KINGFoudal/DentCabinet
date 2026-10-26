# Déploiement de Nimba Dentaire

Procédure complète pour mettre l'application en ligne sur **Supabase** (base, authentification, fichiers, fonctions) et **Vercel** (site web).

Règle de sécurité : les mots de passe, clés et jetons se tapent uniquement dans votre terminal ou dans les tableaux de bord Supabase et Vercel. Jamais dans un chat, un email ou un fichier du dépôt.

Projet Supabase déjà créé : **nimba-dentaire**, identifiant `kxzqyexqwcuufacmzmbg`, région Paris, URL `https://kxzqyexqwcuufacmzmbg.supabase.co`.

---

## 0. Préparer son ordinateur

Prérequis : Node.js 22 et Git.

```bash
git clone https://github.com/KINGFoudal/DentCabinet.git
cd DentCabinet
git checkout nimba-v1
npm install
```

## 1. Base de données (Supabase)

```bash
npx supabase login                                   # ouvre le navigateur pour vous connecter
npx supabase link --project-ref kxzqyexqwcuufacmzmbg # demande le mot de passe de la base
npx supabase db push                                 # applique les 7 migrations de supabase/migrations
```

Le mot de passe de la base se trouve (ou se réinitialise) dans Supabase > projet nimba-dentaire > **Project Settings > Database**.

Vérification : dans Supabase > **Table Editor**, les tables `cabinets`, `patients`, `appointments`, `invoices`... doivent apparaître. Les données de démonstration (`supabase/seed.sql`) ne sont **pas** envoyées en production, c'est voulu.

## 2. Authentification (tableau de bord Supabase)

Dans Supabase > **Authentication** :

1. **URL Configuration**
   - Site URL : l'adresse Vercel (étape 5), par exemple `https://nimba-dentaire.vercel.app`
   - Redirect URLs : ajouter `https://nimba-dentaire.vercel.app/**`
2. **Sign In / Providers > Email** : laisser activé. La confirmation par email est activée par défaut : le nouvel utilisateur clique le lien reçu, se connecte, puis crée son cabinet. L'envoi d'emails intégré de Supabase est très limité en nombre : configurer un SMTP (**Authentication > Emails > SMTP Settings**, par exemple Resend) avant d'ouvrir aux vrais cabinets.
3. **Sign In / Providers > Phone** : activer (connexion de l'espace patient par code).
4. **Hooks > Send SMS hook** : activer, type HTTPS, URL `https://kxzqyexqwcuufacmzmbg.supabase.co/functions/v1/send-sms-hook`, puis **générer le secret**. Copiez ce secret (format `v1,whsec_...`) : il sert à l'étape 3. Le code de connexion partira alors par WhatsApp au lieu d'un SMS.

## 3. Fonctions (rappels, codes WhatsApp)

Déployer les 3 fonctions (les réglages `verify_jwt = false` sont lus dans `supabase/config.toml`) :

```bash
npx supabase functions deploy send-reminders
npx supabase functions deploy send-sms-hook
npx supabase functions deploy whatsapp-webhook
```

Définir les secrets des fonctions (à taper dans votre terminal) :

```bash
openssl rand -hex 32    # génère le secret des rappels : notez-le dans votre gestionnaire de mots de passe
npx supabase secrets set SEND_SMS_HOOK_SECRETS='v1,whsec_...'   # le secret généré à l'étape 2.4
npx supabase secrets set REMINDERS_CRON_SECRET='<secret des rappels>'
```

Sans clés WhatsApp ni email, les fonctions **refusent d'envoyer** : le code de connexion de l'espace patient n'est pas envoyé (erreur) et les rappels passent en « failed » avec « whatsapp/email not configured ». Ne définissez jamais `MESSAGING_MODE=sandbox` en production (simulation réservée au local). Quand vous aurez les accès :

```bash
npx supabase secrets set WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...
npx supabase secrets set WHATSAPP_REMINDER_TEMPLATE=nimba_rappel_rdv WHATSAPP_OTP_TEMPLATE=nimba_code_connexion
npx supabase secrets set WHATSAPP_APP_SECRET=... WHATSAPP_WEBHOOK_VERIFY_TOKEN=...
npx supabase secrets set RESEND_API_KEY=... EMAIL_FROM='Nimba Dentaire <rappels@votre-domaine.com>'
```

Les deux modèles WhatsApp doivent d'abord être créés et approuvés dans Meta Business : `nimba_rappel_rdv` (catégorie Utilitaire, une variable `{{1}}`) et `nimba_code_connexion` (catégorie Authentification, bouton « copier le code »).

## 4. Rappels automatiques (planification)

Les rappels sont lancés toutes les 15 minutes par la base (pg_cron). Il faut lui donner l'adresse du projet et le même secret que `REMINDERS_CRON_SECRET`. Dans Supabase > **SQL Editor** :

```sql
select vault.create_secret('https://kxzqyexqwcuufacmzmbg.supabase.co', 'project_url');
select vault.create_secret('<même valeur que REMINDERS_CRON_SECRET>', 'reminders_cron_secret');
```

## 5. Site web (Vercel)

1. Aller sur **https://vercel.com/new**, équipe « foudal's projects ».
2. **Import Git Repository** > `KINGFoudal/DentCabinet`. S'il n'apparaît pas : **Adjust GitHub App Permissions** et autoriser ce dépôt.
3. Framework : Next.js (détecté automatiquement). Ne rien changer aux commandes de build.
4. **Environment Variables** :

   | Nom | Valeur |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://kxzqyexqwcuufacmzmbg.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_ZUqdWpNcn1XaJujknhetLg_-p7R21Q1` (clé publique) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > **API Keys** > clé secrète (`service_role` ou `sb_secret_...`) |
   | `NEXT_PUBLIC_SITE_URL` | `https://nimba-dentaire.vercel.app` (ou votre domaine) |
   | `NIMBA_ENV` | `production` |
   | `PAYMENTS_MODE` | `live` quand les contrats opérateurs sont signés (voir étape 7) ; sans valeur, paiements mobiles désactivés |

5. **Deploy**.
6. L'application est sur la branche `nimba-v1`. Deux possibilités :
   - fusionner `nimba-v1` dans `master` (pull request sur GitHub), `master` étant la branche de production de Vercel ;
   - ou, dans Vercel > **Settings > Git > Production Branch**, mettre `nimba-v1`.
7. Revenir à l'étape 2.1 si l'adresse finale diffère de `nimba-dentaire.vercel.app`.

## 6. Premier administrateur de la plateforme

1. Ouvrir le site, **Créer un compte** avec votre email, confirmer l'email, se connecter, créer votre cabinet (ou non).
2. Supabase > **SQL Editor** :
   ```sql
   update public.profiles set is_platform_admin = true
   where id = (select id from auth.users where email = 'votre-email@exemple.com');
   ```
3. Se déconnecter / reconnecter : le menu **Administration** apparaît. Y fixer les **prix des formules** (les prix actuels sont provisoires).

## 7. Paiements Orange Money et MTN Mobile Money

En production, le mode simulation est refusé : tant que `PAYMENTS_MODE=live` et les clés ne sont pas configurés, les boutons de paiement mobile affichent une erreur. Les paiements au comptoir (espèces, référence Orange Money / MTN saisie à la main) fonctionnent normalement.

Quand les contrats marchands sont obtenus, ajouter dans Vercel (Environment Variables) :

- Orange Money Web Payment : `ORANGE_MONEY_CLIENT_ID`, `ORANGE_MONEY_CLIENT_SECRET` (ou `ORANGE_MONEY_AUTH_HEADER`), `ORANGE_MONEY_MERCHANT_KEY`, `ORANGE_MONEY_API_BASE`, `ORANGE_MONEY_TOKEN_URL`, `ORANGE_MONEY_WEBPAY_PATH`, `ORANGE_MONEY_CURRENCY`, `ORANGE_MONEY_REFERENCE`
- MTN MoMo : `MTN_MOMO_BASE_URL`, `MTN_MOMO_TARGET_ENV`, `MTN_MOMO_CURRENCY`, `MTN_MOMO_SUBSCRIPTION_KEY`, `MTN_MOMO_API_USER`, `MTN_MOMO_API_KEY`, `MTN_MOMO_SEND_CALLBACK`
- `PAYMENTS_CALLBACK_BASE_URL` = adresse du site, `PAYMENTS_MODE=live`

Puis **Redeploy**. Les valeurs exactes (adresses de production, devise) sont fournies par l'opérateur avec le contrat. Rappel : MTN a cédé sa filiale guinéenne à l'État fin 2024 ; vérifier l'accès MoMo ou passer par un agrégateur local.

## 8. Vérifications après déploiement

- [ ] Page d'accueil et `/connexion` s'affichent.
- [ ] Création de compte, email de confirmation reçu, création du cabinet.
- [ ] Création d'un patient, d'un rendez-vous, d'une facture ; numéro attribué (F-2026-00001).
- [ ] Mode avion sur le téléphone : l'agenda et les patients restent consultables ; une modification faite hors ligne se synchronise au retour du réseau.
- [ ] Paramètres > Cabinet : activer la réservation en ligne ; la page `/c/<adresse-du-cabinet>` s'affiche.
- [ ] Espace patient `/patient` : réception du code par WhatsApp (nécessite les clés WhatsApp ; le code n'est jamais écrit dans les journaux).
- [ ] Supabase > **Advisors** : aucune alerte de sécurité critique.
