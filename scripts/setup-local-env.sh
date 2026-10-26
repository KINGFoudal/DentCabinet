#!/bin/bash
# Prépare les fichiers d'environnement locaux (non versionnés) :
# - supabase/.env et supabase/functions/.env : secret du hook d'envoi des codes (send-sms-hook),
#   messagerie simulée (MESSAGING_MODE=sandbox) pour les Edge Functions locales
# - .env.local : URL et clés de la pile Supabase locale, paiements simulés
# À lancer une fois, avant `npx supabase start` pour les deux premiers, après pour .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f supabase/.env ]; then
  secret="v1,whsec_$(openssl rand -base64 32)"
  printf 'SEND_SMS_HOOK_SECRETS="%s"\nSUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN="unused"\n' "$secret" > supabase/.env
  printf 'SEND_SMS_HOOK_SECRETS="%s"\n' "$secret" > supabase/functions/.env
  echo "supabase/.env et supabase/functions/.env créés"
fi

# Messagerie simulée en local uniquement : sans cette variable, les fonctions refusent
# d'envoyer sans clés WhatsApp / email (jamais de faux succès en production).
touch supabase/functions/.env
if ! grep -q '^MESSAGING_MODE=' supabase/functions/.env; then
  printf 'MESSAGING_MODE=sandbox\n' >> supabase/functions/.env
  echo "MESSAGING_MODE=sandbox ajouté à supabase/functions/.env"
fi

if npx supabase status -o env >/dev/null 2>&1; then
  eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
  # Secret HMAC des paiements simulés : conservé d'une exécution à l'autre.
  sandbox_secret=""
  if [ -f .env.local ]; then
    sandbox_secret="$(grep -E '^PAYMENTS_SANDBOX_SECRET=' .env.local | head -n1 | cut -d= -f2- || true)"
  fi
  [ -n "$sandbox_secret" ] || sandbox_secret="$(openssl rand -hex 32)"
  cat > .env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Serveur local : autorise la simulation même avec \`next start\` (NODE_ENV=production).
NIMBA_ENV=development
PAYMENTS_MODE=sandbox
PAYMENTS_SANDBOX_SECRET=$sandbox_secret
ENV
  echo ".env.local créé"
else
  echo "Supabase local n'est pas démarré : relancez ce script après \`npx supabase start\` pour créer .env.local"
fi
