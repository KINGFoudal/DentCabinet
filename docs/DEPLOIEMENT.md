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
- [ ] Sauvegarde : secrets créés, branche par défaut `nimba-v1`, premier lancement manuel vert (section 9).

## 9. Sauvegarde automatique de la base (gratuite)

L'offre gratuite de Supabase ne fournit **aucune sauvegarde téléchargeable**. Le workflow GitHub `.github/workflows/backup-database.yml` en fait une chaque nuit à **02:17, heure de Conakry** (UTC+0) :

1. copie de la base (`pg_dump`, client PostgreSQL 17 comme le serveur) : tables de l'application (`public`, `app`), comptes utilisateurs (`auth`), liste des fichiers (`storage`, sans le contenu des fichiers) et historique des migrations ;
2. **chiffrement** AES-256 avec votre phrase de passe, avant tout stockage : la copie en clair n'est jamais écrite sur le disque ;
3. **test de restauration** dans une base PostgreSQL 17 vide, avec contrôle des tables `cabinets`, `patients`, `appointments`, `invoices` (le journal n'affiche que des nombres de lignes). Si le test échoue, le workflow est rouge ;
4. conservation du fichier chiffré **30 jours** dans GitHub (onglet Actions), sous le nom `nimba-db-backup-AAAA-MM-JJ_HHMM`.

Ce qui n'est **pas** sauvegardé : le contenu des fichiers déposés (Storage), les secrets du Vault (`project_url`, `reminders_cron_secret` : à recréer, étape 4), les réglages du tableau de bord (Authentication, hooks), les fonctions (elles sont dans le dépôt) et la planification des rappels (recréée par les migrations).

### 9.1 Préparer l'adresse de connexion (secret `SUPABASE_DB_URL`)

1. Supabase > projet nimba-dentaire > bouton **Connect** (en haut) > **Session pooler**. Copier l'adresse : elle ressemble à `postgresql://postgres.kxzqyexqwcuufacmzmbg:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres` (port **5432**). Prenez bien « Session pooler » : la connexion directe passe par IPv6, que les machines de GitHub ne savent pas joindre.
2. Ne collez cette adresse **nulle part ailleurs** que dans GitHub (pas de fichier, pas de chat, pas d'email). Collez-la directement dans le champ du secret (étape 9.2), puis, dans ce même champ, remplacez `[YOUR-PASSWORD]` (crochets compris) par le mot de passe de la base.
3. Le mot de passe se trouve (ou se réinitialise) dans **Project Settings > Database**. S'il contient des caractères spéciaux (`@ : / ? # & %` ou espace), le plus simple est d'en générer un nouveau composé uniquement de lettres et chiffres ; sinon ces caractères doivent être encodés (`@` devient `%40`, `#` devient `%23`…). Après une réinitialisation, attendre quelques minutes, et mettre à jour le mot de passe partout où il sert (`npx supabase link`).

### 9.2 Créer les deux secrets dans GitHub

Sur GitHub > dépôt **KINGFoudal/DentCabinet** > **Settings > Secrets and variables > Actions** > **New repository secret** :

| Nom | Valeur |
|---|---|
| `SUPABASE_DB_URL` | l'adresse « Session pooler » avec le mot de passe (9.1) |
| `BACKUP_PASSPHRASE` | la phrase de passe de chiffrement (9.3), 20 caractères minimum |

GitHub ne réaffiche jamais un secret enregistré et le masque (`***`) dans les journaux.

### 9.3 Phrase de passe de chiffrement

**Sans cette phrase de passe, les sauvegardes sont illisibles, pour tout le monde, y compris vous.** Avant de créer le secret :

1. Créez-la dans votre **gestionnaire de mots de passe** (Bitwarden, 1Password, KeePassXC…) avec son générateur : 6 mots ou plus (« phrase de passe ») ou 32 caractères aléatoires. Ou dans un terminal : `openssl rand -base64 32`.
2. Enregistrez-la dans le gestionnaire sous un nom clair, par exemple « Nimba – phrase de passe des sauvegardes ».
3. Copiez-la depuis le gestionnaire dans le secret `BACKUP_PASSPHRASE`. Ne la changez pas sans raison : les anciennes sauvegardes restent chiffrées avec l'ancienne phrase (gardez donc les deux tant que les anciennes existent, soit 30 jours).

### 9.4 Branche par défaut : condition pour que la sauvegarde tourne seule

D'après la documentation GitHub, **les workflows planifiés ne tournent que sur la branche par défaut du dépôt**, et le bouton « Run workflow » n'apparaît que si le fichier du workflow existe sur cette branche. Aujourd'hui la branche par défaut est `master`, alors que le code est sur `nimba-v1`. Deux solutions :

- **recommandé** : GitHub > **Settings > General > Default branch** > icône des flèches > choisir `nimba-v1` > **Update** (Vercel utilise déjà `nimba-v1` en production) ;
- ou fusionner `nimba-v1` dans `master` (pull request), et continuer ensuite à fusionner régulièrement.

À savoir : si le dépôt est **public**, GitHub désactive les workflows planifiés après **60 jours sans activité** sur le dépôt (un email prévient ; il suffit de les réactiver dans l'onglet Actions). GitHub peut aussi retarder un lancement planifié en période de forte charge.

### 9.5 Premier lancement à la main

1. GitHub > onglet **Actions** > **Sauvegarde de la base** (colonne de gauche) > **Run workflow** > branche `nimba-v1` > **Run workflow**.
2. Attendre quelques minutes : le rond doit devenir **vert**. En cas d'échec, ouvrir l'étape en rouge : « Secret … absent » (9.2), « Connexion à Supabase impossible » (adresse ou mot de passe, 9.1), « TEST-ECHOUE » dans le nom de la sauvegarde (le test de restauration a échoué : prévenir le développeur).
3. En bas de la page de l'exécution, rubrique **Artifacts** : `nimba-db-backup-…` (un fichier `.dump.gpg` et son empreinte `.sha256`).
4. Ensuite, vérifier une fois par semaine que les exécutions nocturnes sont vertes. Pour recevoir un email en cas d'échec : GitHub > avatar > **Settings > Notifications > System > Actions** > « Only notify for failed workflows ».

### 9.6 Quotas gratuits de GitHub

Compte GitHub Free, dépôt privé : **500 Mo de stockage d'artefacts** et **2 000 minutes d'Actions par mois** (dépôt public : minutes gratuites illimitées sur les machines standard). Le stockage est compté heure par heure : avec 30 sauvegardes conservées, il faut que chacune fasse moins d'environ 15 Mo (taille affichée dans l'étape « Sauvegarder et chiffrer »). Une exécution dure environ 2 à 4 minutes, soit environ 100 minutes par mois. Si la base grossit, réduire `retention-days` dans le workflow (par exemple 14) ou supprimer d'anciens artefacts (page de l'exécution > icône corbeille). Rétention maximale autorisée : 90 jours (public) ou 400 jours (privé).

### 9.7 Restaurer une sauvegarde

Il faut le client PostgreSQL 17 (`psql`, `pg_restore`) et `gpg` : sur Ubuntu, `sudo apt install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh` puis `sudo apt install -y postgresql-client-17 gnupg` ; sur Mac, `brew install postgresql@17 gnupg`.

1. Télécharger l'artefact : onglet **Actions** > l'exécution voulue > **Artifacts** > `nimba-db-backup-…` (fichier zip). Le dézipper, puis vérifier l'empreinte : `sha256sum -c nimba-db-*.dump.gpg.sha256`.
2. **Vérifier le contenu dans une base vide** (sans risque, sur votre ordinateur, avec Docker) :
   ```bash
   docker run -d --name nimba-restore -e POSTGRES_HOST_AUTH_METHOD=trust -p 55432:5432 postgres:17
   BACKUP_FILE=nimba-db-AAAA-MM-JJ_HHMM.dump.gpg \
   TARGET_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres \
   bash scripts/restore-backup.sh        # demande la phrase de passe sans l'afficher
   ```
   Le script affiche le nombre de lignes des tables principales. Pour supprimer la base de test : `docker rm -f nimba-restore`.
3. **Remettre en service après une perte de la production** : créer un **nouveau** projet Supabase (région Paris), puis :
   ```bash
   npx supabase link --project-ref <ref-du-nouveau-projet>
   npx supabase db push                  # recrée le schéma à partir des migrations du dépôt
   ```
   Puis restaurer les données (adresse « Session pooler » du **nouveau** projet, tapée dans votre terminal seulement) :
   ```bash
   read -r -s -p "Adresse du nouveau projet : " TARGET_DATABASE_URL; echo; export TARGET_DATABASE_URL
   BACKUP_FILE=nimba-db-AAAA-MM-JJ_HHMM.dump.gpg RESTORE_MODE=supabase CONFIRM_REPLACE_DATA=oui \
   bash scripts/restore-backup.sh
   ```
   Le mode `supabase` efface les données de la cible puis les remplace par celles de la sauvegarde, en une seule transaction (en cas d'erreur, rien n'est modifié). Le code du dépôt doit correspondre aux migrations de la sauvegarde. Refaire ensuite les étapes 2 à 5 de ce document pour le nouveau projet (réglages Authentication, fonctions et leurs secrets, Vault, variables Vercel) et changer `SUPABASE_DB_URL`. Les utilisateurs devront se reconnecter.
4. **Garde-fou** : le script refuse toute cible contenant l'identifiant de production `kxzqyexqwcuufacmzmbg`, sauf avec `CONFIRM_PRODUCTION=OUI-ECRASER-LA-PRODUCTION`. N'utilisez cette option qu'en dernier recours, après avoir fait une sauvegarde à la main (9.5) de l'état actuel.

### 9.8 Mise en pause du projet gratuit Supabase

Supabase met en pause les projets gratuits qui ont **trop peu d'activité sur 7 jours** (un email d'avertissement est envoyé avant). Un projet en pause se réactive depuis le tableau de bord (**Resume project**) pendant **90 jours** ; au-delà, il ne peut plus être restauré sur la plateforme, d'où l'importance de ces sauvegardes. La sauvegarde nocturne échoue si le projet est en pause : un workflow rouge est aussi un signal pour aller vérifier le projet. Seul le passage à l'offre Pro supprime la mise en pause automatique.
