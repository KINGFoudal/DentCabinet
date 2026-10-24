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
npx supabase start            # base, auth, storage en local (Docker)
npx supabase db reset         # applique les migrations et les données de démonstration
cp .env.example .env.local    # puis renseigner les clés affichées par `npx supabase status`
npm run dev                   # http://localhost:3000
```

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

1. Créer un projet Supabase, puis `npx supabase link --project-ref <ref>` et `npx supabase db push`.
2. Déployer sur Vercel avec les variables de `.env.example` (la clé service uniquement côté serveur).
3. Désigner le premier administrateur de la plateforme :
   ```sql
   update public.profiles set is_platform_admin = true where id = (select id from auth.users where email = 'vous@exemple.com');
   ```

## Points à valider avant la mise en production

- Accès marchand Orange Money et MTN Mobile Money en Guinée (API, environnement de test, webhooks).
- Modèles WhatsApp Business approuvés par Meta pour les rappels et les codes de connexion.
- Conformité à la législation guinéenne sur la protection des données de santé (avis d'un juriste local).
- Prix des formules d'abonnement (les prix fournis sont indicatifs).
