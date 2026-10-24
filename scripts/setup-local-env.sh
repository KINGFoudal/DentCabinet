#!/bin/bash
# Prépare les fichiers d'environnement locaux (non versionnés) :
# - supabase/.env et supabase/functions/.env : secret du hook d'envoi des codes (send-sms-hook)
# - .env.local : URL et clés de la pile Supabase locale
# À lancer une fois, avant `npx supabase start` pour les deux premiers, après pour .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f supabase/.env ]; then
  secret="v1,whsec_$(openssl rand -base64 32)"
  printf 'SEND_SMS_HOOK_SECRETS="%s"\nSUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN="unused"\n' "$secret" > supabase/.env
  printf 'SEND_SMS_HOOK_SECRETS="%s"\n' "$secret" > supabase/functions/.env
  echo "supabase/.env et supabase/functions/.env créés"
fi

if npx supabase status -o env >/dev/null 2>&1; then
  eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
  cat > .env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
PAYMENTS_MODE=sandbox
ENV
  echo ".env.local créé"
else
  echo "Supabase local n'est pas démarré : relancez ce script après \`npx supabase start\` pour créer .env.local"
fi
