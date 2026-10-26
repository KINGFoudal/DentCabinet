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
3. **Sign In / Providers > Phone** : *facultatif* (l'espace patient se connecte par email, voir 2 bis). À activer seulement le jour où un fournisseur SMS/WhatsApp est en place, avec la variable Vercel `NEXT_PUBLIC_PORTAL_PHONE_LOGIN=1` qui affiche le choix « Se connecter avec un numéro de téléphone ». Laisser **Confirm phone** (confirmation du téléphone) activé : sinon une inscription par téléphone et mot de passe marquerait n'importe quel numéro comme vérifié sans code. La base refuse déjà ces comptes pour l'espace patient (migration `20261026020000_security_audit_fixes.sql`), mais le réglage doit rester actif.
   - **Sign In / Providers > Email** et **Attack Protection** : activer la protection contre les mots de passe divulgués (« Leaked password protection », signalée par les diagnostics de sécurité Supabase ; offre Pro).
4. **Hooks > Send SMS hook** : activer, type HTTPS, URL `https://kxzqyexqwcuufacmzmbg.supabase.co/functions/v1/send-sms-hook`, puis **générer le secret**. Copiez ce secret (format `v1,whsec_...`) : il sert à l'étape 3. Le code de connexion partira alors par WhatsApp au lieu d'un SMS.

## 2 bis. Espace patient : connexion par code reçu par email (gratuit)

Le patient saisit son email sur `/patient/connexion`, reçoit un code à 6 chiffres, le saisit, et voit les fiches dont l'email (saisi par le cabinet) est cette adresse. Pas de SMS, donc pas de Twilio. Réglages dans le tableau de bord Supabase, projet nimba-dentaire :

1. **Authentication > Sign In / Providers > Email** :
   - **Enable Email provider** : activé.
   - **Confirm email** : **activé** (obligatoire). Désactivé, n'importe qui pourrait s'inscrire avec l'adresse d'un autre et Supabase la marquerait « confirmée ». La base exige en plus que la session ait été ouverte par un code (migration `20261026040000_portal_email_login.sql`), mais le réglage doit rester actif.
   - **Email OTP Expiration** : `600` (10 minutes) suffit ; maximum autorisé 86400.
   - **Email OTP Length** : `6`.
2. **Authentication > Emails > Templates** (page « Email Templates ») : modifier **deux** modèles, car Supabase envoie « Confirm sign up » au premier code d'un nouveau patient (Confirm email activé) et « Magic link or OTP » aux suivants. Sans `{{ .Token }}`, l'email ne contient qu'un lien et le patient n'a pas de code à saisir.
   - **Magic link or OTP** — Sujet : `Votre code de connexion Nimba Dentaire`. Corps (source : `supabase/templates/magic_link.html`) :
     ```html
     <h2>Votre code de connexion</h2>
     <p>Bonjour,</p>
     <p>Voici votre code pour ouvrir votre espace patient Nimba Dentaire :</p>
     <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
     <p>Ce code n'est valable que quelques minutes et ne sert qu'une fois. Ne le communiquez à personne, même au cabinet.</p>
     <p>Si vous n'avez rien demandé, ignorez ce message.</p>
     ```
   - **Confirm sign up** — Sujet : `Votre code de connexion Nimba Dentaire`. Corps : copier `supabase/templates/confirmation.html` (même code `{{ .Token }}`, plus le lien `{{ .ConfirmationURL }}` qui reste nécessaire aux comptes du personnel créés avec mot de passe).
3. **Envoi des emails (SMTP)** — indispensable : le service d'email intégré de Supabase n'envoie qu'aux membres de l'équipe du projet (les autres adresses échouent avec `email_address_not_authorized`) et seulement 2 emails par heure pour tout le projet. Option gratuite : **Resend** (offre gratuite : 3 000 emails/mois, 100 par jour ; à vérifier sur resend.com/pricing).
   1. Sur resend.com : créer un compte, **ajouter et vérifier un domaine** (enregistrements DNS, ex. `auth.votre-domaine.com`), créer une **API key** (droit « Sending access »).
   2. Supabase > **Authentication > Emails > SMTP Settings** : activer **Enable custom SMTP**, puis
      - Sender email : `no-reply@auth.votre-domaine.com` ; Sender name : `Nimba Dentaire`
      - Host : `smtp.resend.com` ; Port : `465` ; Username : `resend` ; Password : la clé API Resend (à coller uniquement dans ce champ).
   3. Supabase > **Authentication > Rate Limits** : après l'activation du SMTP, la limite passe à 30 emails/heure ; la relever (ex. 100/heure) selon le nombre de patients. Laisser la limite « un code toutes les 60 s par adresse » (l'interface affiche déjà un délai de 60 s avant renvoi).
4. Côté cabinet : l'email du patient doit être saisi sur sa fiche. Règles appliquées par la base :
   - une fiche n'est rattachée qu'à un seul compte, jamais « volée » à un autre ;
   - si le cabinet **change l'email (ou le téléphone)** d'une fiche déjà rattachée et que la nouvelle valeur ne correspond plus au compte, la fiche est **détachée** : la personne précédente perd l'accès, le bon titulaire est rattaché à sa prochaine connexion ;
   - un membre du personnel connecté par mot de passe ne rattache rien ; s'il ouvre l'espace patient par code, il ne voit que les fiches portant son propre email.

Test en local : `npx supabase status` donne l'adresse de Mailpit (http://127.0.0.1:54324) où arrivent les emails. Les modèles de `supabase/config.toml` ne sont pris en compte qu'après `npx supabase stop && npx supabase start`.

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

> Vercel : le projet de production est `nimba-dentaire` (équipe « kingfoudal's projects »), branche de production `nimba-v1`. Chaque push sur cette branche redéploie le site.

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
- [ ] Espace patient `/patient/connexion` : avec une fiche patient portant votre email, demander le code, le recevoir par email (pas en spam), se connecter : les rendez-vous de la fiche s'affichent. Un code faux affiche « Code incorrect ou expiré ».
- [ ] Supabase > **Advisors** : aucune alerte de sécurité critique.
