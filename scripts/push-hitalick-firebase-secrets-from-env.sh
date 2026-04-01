#!/usr/bin/env bash
# Load Stripe keys + Hit-A-Lick price IDs from functions/.env and push to Firebase Secret Manager.
# Requires: `firebase login` and `firebase use <project>` (e.g. hit-a-lick-database).
# Then: `firebase deploy --only functions:api,functions:stripeWebhook,hosting`
set -uo pipefail
# Note: `firebase functions:secrets:set` may exit 1 after a successful write when it prints
# "stale version" notices — do not use `set -e` for those calls.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_STRIPE="$ROOT/functions/.env.stripe.local"
ENV_FALLBACK="$ROOT/functions/.env"
if [[ -f "$ENV_STRIPE" ]]; then
  ENV_FILE="$ENV_STRIPE"
elif [[ -f "$ENV_FALLBACK" ]]; then
  ENV_FILE="$ENV_FALLBACK"
else
  echo "Missing $ENV_STRIPE (or $ENV_FALLBACK). See functions/.env.stripe.example"
  exit 1
fi
echo "Reading secrets from: $ENV_FILE"

get_val() {
  local k="$1"
  grep "^${k}=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r'
}

KEYS=(
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_REGULAR_MONTHLY
  STRIPE_PRICE_PREMIUM_BUNDLE_MONTHLY
  STRIPE_PRICE_PREMIUM_AI_ADDON_MONTHLY
  STRIPE_PRICE_BRUCE_PICKS_MONTHLY
  STRIPE_PRICE_GIAP_PICKS_MONTHLY
  STRIPE_PRICE_AI_CREDITS_50
)

for key in "${KEYS[@]}"; do
  val="$(get_val "$key")"
  if [[ -z "$val" ]]; then
    echo "Skip (empty in .env): $key"
    continue
  fi
  echo "Setting secret: $key"
  if printf '%s' "$val" | firebase functions:secrets:set "$key"; then
    echo "  OK $key"
  else
    ec=$?
    echo "  firebase exit $ec for $key (if the line above shows Created, you can ignore this)"
  fi
done

echo "Done. Deploy with: firebase deploy --only functions:api,functions:stripeWebhook,hosting"
