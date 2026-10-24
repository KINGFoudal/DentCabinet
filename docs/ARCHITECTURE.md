# Architecture de Nimba Dentaire

À lire avant de modifier le code. Le cahier des charges complet est dans `PROMPT.md`.

## Vue d'ensemble

- **Next.js 16** (App Router, `cacheComponents` activé), TypeScript, Tailwind CSS 4. Cette version de Next diffère de ce que vous connaissez peut-être : lisez `node_modules/next/dist/docs/` avant d'utiliser une API Next.
- **Supabase** : Postgres + Auth + Storage. L'isolation entre cabinets est faite par **RLS** dans la base (`supabase/migrations/20261024000000_init.sql`). L'interface ne fait que refléter ces règles (`src/lib/permissions.ts`).
- **Hors ligne d'abord** pour l'espace cabinet (`/app/*`) : l'interface lit et écrit dans IndexedDB (Dexie). Un moteur de synchronisation échange avec Supabase.

## Règles pour l'espace cabinet (`/app/*`)

1. **Pages client.** Les pages de `/app` sont des composants client (`"use client"`) prérendus statiquement, pour être mises en cache par le service worker. Pas de lecture de cookies/headers côté serveur.
2. **Pas de segments dynamiques** sous `/app` : une page de détail utilise un paramètre de requête, par exemple `/app/patients/fiche?id=...`. Lire `useSearchParams()` dans un composant enveloppé par `<Suspense>`. Ajouter toute nouvelle page à `OFFLINE_ROUTES` (`src/components/service-worker.tsx`) seulement si elle doit marcher hors ligne (le fichier est partagé : signaler la route dans votre rapport plutôt que de l'éditer).
3. **Lecture** : `useLiveQuery` (dexie-react-hooks) sur `localDb()` (`src/lib/local/db.ts`). Toujours filtrer `cabinet_id` et ignorer les lignes `deleted_at`.
   ```ts
   const patients = useLiveQuery(
     () => localDb().patients.where("cabinet_id").equals(cabinetId).filter((p) => !p.deleted_at).toArray(),
     [cabinetId],
   );
   ```
4. **Écriture** : uniquement `mutate(table, patch)` / `softDelete(table, id)` (`src/lib/sync/mutate.ts`). Jamais `supabase().from(...).insert()` pour une table synchronisée, jamais d'écriture Dexie directe. Les identifiants sont générés côté client. Les champs calculés par le serveur (`number`, `total_gnf`, `paid_gnf`, `file_number`) restent vides tant que la ligne n'est pas synchronisée : afficher « provisoire » dans ce cas.
5. **Refus du serveur** : une écriture refusée (RLS, chevauchement de rendez-vous `23P01`...) apparaît dans l'indicateur de synchronisation et la ligne locale revient à l'état serveur. Pour une action où l'utilisateur doit savoir tout de suite (ex. créer un RDV), vérifier aussi côté client avant d'écrire (chevauchement dans la base locale).
6. **Actions en ligne uniquement** (paiement mobile, envoi de message, invitation, téléversement de fichier, RPC) : appeler Supabase ou une route `/api`, et afficher un message clair si `navigator.onLine` est faux.
7. **Contexte** : `useCabinet()` donne `cabinetId`, `cabinet`, `roles`, `can` (permissions), `readOnly`. `useCabinetId()` sous `/app`. `useAuth()` donne `user`.
8. **Tables synchronisées** : liste dans `SYNCED_TABLES`. Ajouter une table synchronisée demande une nouvelle version du schéma Dexie : à éviter ; sinon le signaler. Les index Dexie existants sont dans `src/lib/local/db.ts` ; pour un autre critère, filtrer en mémoire (quelques milliers de lignes par cabinet).

## Espace patient et pages publiques

`/c/[slug]` (page publique d'un cabinet) et `/patient/*` (espace patient) sont **en ligne** : requêtes Supabase directes (RLS « portal ») ou RPC `security definer`. Pas de base locale.

## Routes serveur

`src/app/api/**/route.ts`. Authentifier l'appelant avec `userFromRequest(req)` (`src/lib/supabase/server.ts`, en-tête `Authorization: Bearer <access_token>`), puis agir avec `userClient(token)` (RLS) ou `adminClient()` (clé service, seulement après vérification des droits). Le client envoie le jeton : `(await supabase().auth.getSession()).data.session?.access_token`.

## Base de données

- Une migration par lot de travail : `supabase/migrations/<horodatage>_<nom>.sql`. Ne jamais modifier une migration déjà fusionnée.
- Toute nouvelle table métier : `cabinet_id`, `created_at`, `updated_at`, `deleted_at`, triggers `touch_updated_at` et `freeze_cabinet_id`, RLS activée avec des politiques basées sur `app.has_role`, `app.can_write`, `app.is_member`. Pas de politique DELETE.
- Fonctions RPC exposées : schéma `public`, `security definer`, `set search_path = ''`, vérification explicite des droits au début.
- Base locale partagée : `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. **Ne pas lancer `supabase db reset`** (d'autres travaux l'utilisent). Appliquer sa migration avec `psql "$DB" -v ON_ERROR_STOP=1 -1 -f <fichier>`. La tester d'abord dans une transaction annulée si besoin.
- Après une migration : `npx supabase gen types typescript --local > src/lib/database.types.ts`.

## Interface

- Composants de base dans `src/components/ui/` (Button, Input, Select, Textarea, Field, Checkbox, Card, PageHeader, EmptyState, Badge, Dialog, ConfirmDialog, Table/Th/Td, Tabs, Spinner, useToast). Les réutiliser.
- Couleurs : uniquement les jetons du thème (`bg-primary`, `text-muted`, `border-border`, `bg-danger-soft`...), jamais de code hexadécimal dans les composants (sauf couleurs choisies par l'utilisateur, ex. types de RDV).
- Mobile d'abord : tout doit fonctionner sur un téléphone de 360 px de large ; tables larges dans `Table` (défilement horizontal) ou en liste sur mobile.
- Montants : `formatGNF`, `parseGNF` ; dates : `formatDate`, `formatTime`, `formatDateTime` avec `cabinet.timezone` ; téléphones : `normalizeGuineaPhone`, `formatPhone` (`src/lib/format.ts`). Jours : `todayISO`, `dayBounds`, `addDays` (`src/lib/dates.ts`).
- Impression (ordonnances, devis, factures, reçus) : page dédiée avec styles `@media print`, et la classe `no-print` sur ce qui ne doit pas sortir.

## Traductions

- Chaque module a son fichier `src/features/<module>/messages.ts` avec une clé racine propre (`patients`, `agenda`, `billing`, `portal`, `subscription`, `settings`, `admin`). Ne modifier que le sien. Textes communs : `src/i18n/common.ts`.
- `const t = useT(); t("patients.title")`, variables : `t("sync.pending", { count })`.
- Le test `src/i18n/i18n.test.ts` vérifie que fr et en ont les mêmes clés.

## Vérifications avant de livrer

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Tests : unitaires à côté du code (`*.test.ts`), tests base de données dans `tests/db/` (voir `tests/db/helpers.ts` : `asUser`, `createCabinet`, `addMember`).
