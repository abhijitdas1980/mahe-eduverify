#!/usr/bin/env bash
# Apply App Service settings from .env.azure-uat or .env.azure-prod
set -euo pipefail

ENV_TAG="${1:-uat}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.azure-${ENV_TAG}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Copy mahe-uat.env.example to .env.azure-uat and fill secrets."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${AZURE_RG:?Set AZURE_RG in $ENV_FILE}"
: "${AZURE_WEBAPP:?Set AZURE_WEBAPP in $ENV_FILE}"
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${JWT_SECRET:?Set JWT_SECRET}"
: "${SEED_ADMIN_PASSWORD:?Set SEED_ADMIN_PASSWORD}"
: "${AZURE_STORAGE_CONNECTION_STRING:?Set AZURE_STORAGE_CONNECTION_STRING}"

echo "Configuring $AZURE_WEBAPP in $AZURE_RG ..."

az webapp config appsettings set \
  --resource-group "$AZURE_RG" \
  --name "$AZURE_WEBAPP" \
  --settings \
    NODE_ENV="${NODE_ENV:-production}" \
    PORT="${PORT:-8080}" \
    AUTO_SETUP="${AUTO_SETUP:-true}" \
    STORAGE_PROVIDER="${STORAGE_PROVIDER:-azure}" \
    AZURE_STORAGE_ACCOUNT_NAME="$AZURE_STORAGE_ACCOUNT_NAME" \
    AZURE_STORAGE_CONTAINER="${AZURE_STORAGE_CONTAINER:-eduverify-documents}" \
    AZURE_STORAGE_CONNECTION_STRING="$AZURE_STORAGE_CONNECTION_STRING" \
    DATABASE_URL="$DATABASE_URL" \
    JWT_SECRET="$JWT_SECRET" \
    JWT_EXPIRES_IN="${JWT_EXPIRES_IN:-12h}" \
    SEED_ADMIN_ID="${SEED_ADMIN_ID:-ADM-001}" \
    SEED_ADMIN_NAME="${SEED_ADMIN_NAME:-Verification Cell Admin}" \
    SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
    CORS_ORIGIN="$CORS_ORIGIN" \
    PG_POOL_MAX="${PG_POOL_MAX:-25}" \
    NOTIFY_EMAIL_ENABLED="${NOTIFY_EMAIL_ENABLED:-true}" \
    SMTP_HOST="${SMTP_HOST:-smtp.office365.com}" \
    SMTP_PORT="${SMTP_PORT:-587}" \
    SMTP_USER="${SMTP_USER:-admissions.maheblr@manipal.edu}" \
    SMTP_PASS="${SMTP_PASS:-}" \
    SMTP_FROM="${SMTP_FROM:-MAHE Admissions <admissions.maheblr@manipal.edu>}" \
    PORTAL_URL="${PORTAL_URL:-$CORS_ORIGIN}" \
    WEBSITE_NODE_DEFAULT_VERSION="~20" \
  --output none

echo "Restarting web app..."
az webapp restart --resource-group "$AZURE_RG" --name "$AZURE_WEBAPP"

echo "Done. Check health:"
echo "  curl -s https://${AZURE_WEBAPP,,}.azurewebsites.net/api/health"
