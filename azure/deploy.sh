#!/usr/bin/env bash
# Provision EduVerify on Azure (App Service + PostgreSQL + Blob Storage).
# Prerequisites: Azure CLI (az), logged in (`az login`), subscription selected.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RG="${RG:-rg-eduverify-prod}"
LOCATION="${LOCATION:-centralindia}"
PARAMS_FILE="${PARAMS_FILE:-$SCRIPT_DIR/parameters.prod.json}"

if [[ ! -f "$PARAMS_FILE" ]]; then
  echo "Copy parameters.prod.json.example to parameters.prod.json and fill secrets."
  exit 1
fi

echo "Creating resource group: $RG ($LOCATION)"
az group create --name "$RG" --location "$LOCATION" --output none

echo "Deploying Bicep template..."
az deployment group create \
  --resource-group "$RG" \
  --template-file "$SCRIPT_DIR/main.bicep" \
  --parameters "@$PARAMS_FILE" \
  --output table

echo ""
echo "Deployment complete. Fetching outputs..."
WEB_URL=$(az deployment group show -g "$RG" -n main --query properties.outputs.webAppUrl.value -o tsv 2>/dev/null || true)
if [[ -z "$WEB_URL" ]]; then
  WEB_URL=$(az deployment group list -g "$RG" --query "[0].properties.outputs.webAppUrl.value" -o tsv)
fi

echo "Web app URL: $WEB_URL"
echo ""
echo "Next steps:"
echo "  1. Deploy app code:  cd $ROOT_DIR && az webapp up --resource-group $RG --name app-eduverifyprod --runtime NODE:20-lts"
echo "     Or push to GitHub and use .github/workflows/azure-deploy.yml"
echo "  2. Wait for /api/health to return {\"ok\":true,\"db\":\"up\"}"
echo "  3. Sign in as ADM-001 with your SEED_ADMIN_PASSWORD"
echo "  4. Point your college DNS / custom domain to the App Service"
