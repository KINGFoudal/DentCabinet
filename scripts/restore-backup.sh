#!/usr/bin/env bash
# Restaure une sauvegarde chiffrée de la base Nimba Dentaire (fichier .dump.gpg produit par
# le workflow .github/workflows/backup-database.yml). Procédure complète : docs/DEPLOIEMENT.md,
# section « Sauvegarde automatique de la base ».
#
# Variables d'environnement :
#   BACKUP_FILE           fichier .dump.gpg (chiffré) ou .dump (déjà déchiffré)          [obligatoire]
#   TARGET_DATABASE_URL   adresse de la base cible (postgresql://...)                   [obligatoire]
#   BACKUP_PASSPHRASE     phrase de passe ; si absente, elle est demandée au clavier (sans affichage)
#   RESTORE_MODE          empty    (défaut) : base PostgreSQL 17 vide (contrôle, consultation) ;
#                                  le schéma et les données sont recréés.
#                         supabase : nouveau projet Supabase dont le schéma a déjà été créé avec
#                                  `npx supabase db push` ; seules les données sont remplacées
#                                  (schémas public, app, auth, storage).
#   CONFIRM_REPLACE_DATA  doit valoir « oui » en mode supabase (les données de la cible sont effacées)
#   CONFIRM_PRODUCTION    doit valoir « OUI-ECRASER-LA-PRODUCTION » si la cible est la production
#   PRODUCTION_PROJECT_REF  identifiant du projet de production (défaut : kxzqyexqwcuufacmzmbg)
#   CHECK_TABLES          tables de public à contrôler (défaut : « cabinets patients appointments invoices »)
#   PG_BIN                dossier des outils PostgreSQL 17 (défaut : détection automatique)
#
# Le script n'affiche jamais l'adresse de la base ni la phrase de passe, seulement des nombres de lignes.
set -euo pipefail

die() { echo "ERREUR : $*" >&2; exit 1; }

: "${BACKUP_FILE:?BACKUP_FILE manquant (fichier .dump.gpg)}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL manquant (base cible)}"
RESTORE_MODE="${RESTORE_MODE:-empty}"
PRODUCTION_PROJECT_REF="${PRODUCTION_PROJECT_REF:-kxzqyexqwcuufacmzmbg}"
CHECK_TABLES="${CHECK_TABLES:-cabinets patients appointments invoices}"
[ -f "$BACKUP_FILE" ] || die "fichier introuvable : $BACKUP_FILE"
case "$RESTORE_MODE" in empty|supabase) ;; *) die "RESTORE_MODE doit valoir empty ou supabase" ;; esac

# --- Garde-fous sur la cible -------------------------------------------------------------
if [[ "$TARGET_DATABASE_URL" == *"$PRODUCTION_PROJECT_REF"* ]]; then
  [ "${CONFIRM_PRODUCTION:-}" = "OUI-ECRASER-LA-PRODUCTION" ] ||
    die "la cible est la base de PRODUCTION ($PRODUCTION_PROJECT_REF). Refusé. Restaurez plutôt dans un nouveau projet. Pour forcer : CONFIRM_PRODUCTION=OUI-ECRASER-LA-PRODUCTION"
  echo "ATTENTION : restauration vers la PRODUCTION confirmée explicitement."
fi
if [ "$RESTORE_MODE" = "supabase" ] && [ "${CONFIRM_REPLACE_DATA:-}" != "oui" ]; then
  die "le mode supabase EFFACE puis remplace les données de la cible. Relancez avec CONFIRM_REPLACE_DATA=oui"
fi

# --- Outils PostgreSQL 17 ------------------------------------------------------------------
if [ -z "${PG_BIN:-}" ]; then
  for d in /usr/lib/postgresql/17/bin /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin; do
    [ -x "$d/pg_restore" ] && PG_BIN="$d" && break
  done
fi
PG_RESTORE="${PG_BIN:+$PG_BIN/}pg_restore"
PSQL="${PG_BIN:+$PG_BIN/}psql"
command -v "$PG_RESTORE" >/dev/null || die "pg_restore introuvable (installez le client PostgreSQL 17)"
command -v "$PSQL" >/dev/null || die "psql introuvable (installez le client PostgreSQL 17)"
client_major="$("$PG_RESTORE" --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/')"
[ "$client_major" -ge 17 ] 2>/dev/null || die "pg_restore $client_major trouvé, version 17 ou plus requise (PG_BIN=...)"

psql_target() { "$PSQL" "$TARGET_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
psql_target -Atc 'select 1' >/dev/null || die "connexion à la base cible impossible"

# --- Déchiffrement dans un dossier temporaire privé -----------------------------------------
umask 077
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

case "$BACKUP_FILE" in
  *.gpg)
    command -v gpg >/dev/null || die "gpg introuvable"
    if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
      [ -t 0 ] || die "BACKUP_PASSPHRASE manquante"
      read -r -s -p "Phrase de passe de la sauvegarde : " BACKUP_PASSPHRASE; echo
    fi
    mkdir -p "$WORK/gnupg"
    GNUPGHOME="$WORK/gnupg" gpg --quiet --batch --pinentry-mode loopback --passphrase-fd 3 \
      --decrypt --output "$WORK/backup.dump" "$BACKUP_FILE" 3< <(printf '%s' "$BACKUP_PASSPHRASE") ||
      die "déchiffrement impossible (phrase de passe incorrecte ou fichier abîmé)"
    DUMP="$WORK/backup.dump"
    ;;
  *) DUMP="$BACKUP_FILE" ;;
esac

"$PG_RESTORE" --list "$DUMP" > "$WORK/full.list" || die "le fichier n'est pas une sauvegarde pg_dump valide"
echo "Sauvegarde lisible : $(grep -c ' TABLE DATA ' "$WORK/full.list") tables avec données."

if [ "$RESTORE_MODE" = "empty" ]; then
  # La cible doit être vide : on ne mélange jamais une sauvegarde avec des données existantes.
  existing="$(psql_target -Atc "select count(*) from pg_tables where schemaname in ('public','app','auth','storage')")"
  [ "$existing" = "0" ] || die "la base cible contient déjà $existing tables. Utilisez une base vide (ou RESTORE_MODE=supabase)."
  # Extensions utilisées par le schéma (btree_gist pour l'agenda, pgcrypto et uuid-ossp pour auth/storage).
  psql_target -c 'create schema if not exists extensions' \
    -c 'create extension if not exists btree_gist with schema extensions' \
    -c 'create extension if not exists pgcrypto with schema extensions' \
    -c 'create extension if not exists "uuid-ossp" with schema extensions'
  # Le schéma public existe déjà dans toute base neuve : on saute sa création.
  grep -vE ' SCHEMA - public | COMMENT - SCHEMA public ' "$WORK/full.list" > "$WORK/restore.list"
  "$PG_RESTORE" --dbname "$TARGET_DATABASE_URL" --no-owner --no-acl --exit-on-error --single-transaction \
    --use-list "$WORK/restore.list" "$DUMP" || die "la restauration a échoué"
else
  # Données seulement, vers un projet Supabase dont le schéma vient des migrations du dépôt.
  # Tables exclues : suivi interne des migrations (déjà rempli par la cible) et tables vectorielles.
  grep -E ' TABLE DATA (public|app|auth|storage) ' "$WORK/full.list" |
    grep -vE ' TABLE DATA (auth schema_migrations|storage migrations|storage buckets_vectors|storage vector_indexes) ' \
    > "$WORK/data.list" || true
  grep -E ' SEQUENCE SET (public|app|auth|storage) ' "$WORK/full.list" >> "$WORK/data.list" || true
  [ -s "$WORK/data.list" ] || die "aucune donnée à restaurer dans la sauvegarde"
  # Vide les tables restaurées (données de départ créées par les migrations) avant de les remplir.
  awk '/ TABLE DATA / { for (i = 1; i <= NF; i++) if ($i == "DATA") { print $(i+1) "\t" $(i+2); break } }' "$WORK/data.list" |
    while IFS=$'\t' read -r s t; do
      printf 'delete from %s.%s;\n' "\"$s\"" "\"$t\""
    done > "$WORK/clear.sql"
  # session_replication_role = replica : triggers et contrôles de clés étrangères suspendus pendant
  # l'import (méthode de la documentation Supabase). Le tout en une seule transaction.
  "$PG_RESTORE" --data-only --use-list "$WORK/data.list" --file - "$DUMP" |
    psql_target --single-transaction \
      -c 'set session_replication_role = replica' \
      -f "$WORK/clear.sql" \
      -f - > /dev/null || die "la restauration des données a échoué (rien n'a été modifié)"
fi

# --- Contrôle : tables principales présentes, nombre de lignes ------------------------------
echo "Contrôle des tables principales (nombre de lignes) :"
missing=0
for t in $CHECK_TABLES; do
  if [ "$(psql_target -Atc "select to_regclass('public.$t') is not null")" = "t" ]; then
    echo "  $t : $(psql_target -Atc "select count(*) from public.\"$t\"")"
  else
    echo "  $t : ABSENTE"; missing=1
  fi
done
[ "$missing" = 0 ] || die "des tables principales sont absentes après restauration"
echo "Restauration terminée."
