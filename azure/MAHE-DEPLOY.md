# MAHE EduVerify — Azure UAT & Production Deployment

**SPOC:** abhijit.das@manipal.edu  
**Public URL (prod):** https://maheblreduverify.manipal.edu  
**Subscription:** MAHEBLR-Admission

---

## Security — read first

1. **Never commit** storage keys, DB passwords, or connection strings to git.
2. Store secrets in **Key Vault** (`MAHE-CI-DOC-PRD-KV01`) — not in App Service plain text long-term.
3. If credentials were shared in email/chat, ask infra to **rotate** storage account keys and DB password after go-live.
4. Use local file `.env.azure-uat` (gitignored) only for one-time setup scripts.

---

## Deployed resources (from MAHE infra)

| Resource | UAT | Production |
|----------|-----|------------|
| App Service | `MAHE-CI-DOC-UAT-APP01` | `MAHE-CI-DOC-PRD-APP01` |
| PostgreSQL | `mahe-ci-doc-uat-psqlsvr01` | `mahe-ci-doc-prd-psqlsvr01` |
| Storage | `mahecidocuatstgacct01` | `mahecidocprdstgacct01` |
| Key Vault | _(request UAT KV or use PRD KV with UAT secrets)_ | `MAHE-CI-DOC-PRD-KV01` |
| Managed Identity | `97fb7c66-1571-43bb-96dd-814578216a4f` | same (confirm per env) |

**App Gateway** will be added after app deploy. Until then use:

- UAT: `https://mahe-ci-doc-uat-app01.azurewebsites.net`
- Prod: `https://mahe-ci-doc-prd-app01.azurewebsites.net`

---

## Reply to infra team (copy/adapt)

> We have reviewed the deployed resources. No changes required for First UAT. Please proceed with:
>
> 1. **Key Vault Secrets Officer** for `abhijit.das@manipal.edu` and `subin.k@manipal.edu` on `MAHE-CI-DOC-PRD-KV01` (and UAT KV if separate).
> 2. **Key Vault Secrets User** for managed identity `97fb7c66-1571-43bb-96dd-814578216a4f` (Get + List secrets).
> 3. **Storage Blob Data Contributor** on `mahecidocuatstgacct01` and `mahecidocprdstgacct01` for the App Service managed identity (if not using connection string long-term).
> 4. Create PostgreSQL database **`eduverify`** on both UAT and Prod servers (if not already created).
> 5. Create Blob container **`eduverify-documents`** (private, no public access) on both storage accounts.
> 6. Confirm UAT hostname for testing before App Gateway (azurewebsites.net or staging subdomain).
> 7. DNS + wildcard SSL for `maheblreduverify.manipal.edu` pointing to App Gateway once app is validated on UAT.

---

## GitHub Actions — deploy to UAT

Workflow file: `.github/workflows/mahe-uat-deploy.yml`  
Target: **`MAHE-CI-DOC-UAT-APP01`**

### One-time GitHub setup

#### 1. Create Azure service principal (run once, as Contributor on subscription or UAT resource group)

```bash
az login
az account set --subscription "MAHEBLR-Admission"

# Get UAT resource group name
RG=$(az webapp list --query "[?name=='MAHE-CI-DOC-UAT-APP01'].resourceGroup | [0]" -o tsv)
echo "Resource group: $RG"

SUB_ID=$(az account show --query id -o tsv)

az ad sp create-for-rbac \
  --name "github-eduverify-mahe-uat" \
  --role contributor \
  --scopes "/subscriptions/${SUB_ID}/resourceGroups/${RG}" \
  --sdk-auth
```

Copy the **entire JSON output** — this becomes the GitHub secret.

#### 2. Add GitHub repository secrets

Repo: `bnmitbsk2-collab/eduverifymy` → **Settings → Secrets and variables → Actions**

| Secret | Value |
|--------|--------|
| `AZURE_CREDENTIALS` | Full JSON from `create-for-rbac` above |

#### 3. Create GitHub Environment (optional but recommended)

**Settings → Environments → New environment → `uat`**

- Add required reviewers (e.g. abhijit.das@manipal.edu) before deploy
- Environment secret `AZURE_CREDENTIALS` can override repo secret if UAT/Prod use different SPs later

#### 4. Configure App Service env vars **before** first deploy

GitHub Actions deploys **code only** — database and storage settings must already be on the App Service (see Step 4 above or `configure-mahe-app.sh uat`).

### Run deployment

**Option A — Manual (recommended for first deploy)**

1. GitHub → **Actions** → **Deploy MAHE UAT** → **Run workflow**
2. Check **Skip health check** if App Service env vars are not ready yet
3. After success: `curl https://mahe-ci-doc-uat-app01.azurewebsites.net/api/health`

**Option B — Push to `uat` branch**

```bash
git checkout -b uat
git push -u origin uat
```

Every push to `uat` auto-deploys (with health check).

**Production** uses `.github/workflows/mahe-prod-deploy.yml` — manual only, requires typing `deploy-prod` to confirm.

---

## Phase 1 — UAT only (do this first)

### Step 1 — Prerequisites on your machine

```bash
az login
az account set --subscription "MAHEBLR-Admission"
az account show
```

### Step 2 — One-time Azure prep (portal or ask infra)

| Item | Action |
|------|--------|
| PostgreSQL database | `CREATE DATABASE eduverify;` on UAT server |
| Blob container | `eduverify-documents`, private access |
| App Service runtime | Linux, **Node 20 LTS**, Always On enabled |
| Firewall | Allow Azure services to PostgreSQL (for App Service) |

### Step 3 — Build `DATABASE_URL` for UAT

Password `P@ssw0rd@2026` must be **URL-encoded** (`@` → `%40`):

```
postgresql://psqladmin:P%40ssw0rd%402026@mahe-ci-doc-uat-psqlsvr01.postgres.database.azure.com:5432/eduverify?sslmode=require
```

Generate JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Step 4 — App Service settings (UAT)

Copy `azure/mahe-uat.env.example` → `.env.azure-uat`, fill values, then:

```bash
cd eduverify-server/azure
chmod +x configure-mahe-app.sh
./configure-mahe-app.sh uat
```

Or set manually in **Azure Portal → MAHE-CI-DOC-UAT-APP01 → Environment variables**:

| Name | Value |
|------|--------|
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `AUTO_SETUP` | `true` |
| `STORAGE_PROVIDER` | `azure` |
| `AZURE_STORAGE_ACCOUNT_NAME` | `mahecidocuatstgacct01` |
| `AZURE_STORAGE_CONTAINER` | `eduverify-documents` |
| `AZURE_STORAGE_CONNECTION_STRING` | _(UAT connection string — use Key Vault reference in prod)_ |
| `DATABASE_URL` | _(encoded URL above)_ |
| `JWT_SECRET` | _(64+ char random)_ |
| `JWT_EXPIRES_IN` | `12h` |
| `SEED_ADMIN_ID` | `ADM-001` |
| `SEED_ADMIN_NAME` | `Verification Cell Admin` |
| `SEED_ADMIN_PASSWORD` | _(strong UAT admin password)_ |
| `CORS_ORIGIN` | `https://mahe-ci-doc-uat-app01.azurewebsites.net` |
| `PG_POOL_MAX` | `25` |
| `NOTIFY_EMAIL_ENABLED` | `true` |
| `SMTP_HOST` | `smtp.office365.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `admissions.maheblr@manipal.edu` |
| `SMTP_PASS` | _(M365 mailbox password or app password — store in Key Vault)_ |
| `SMTP_FROM` | `MAHE Admissions <admissions.maheblr@manipal.edu>` |
| `PORTAL_URL` | UAT or prod portal URL (linked in rejection emails) |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~20` |

### Step 5 — Deploy application code to UAT

```bash
cd eduverify-server
az webapp deploy \
  --resource-group <MAHE-UAT-RG-NAME> \
  --name MAHE-CI-DOC-UAT-APP01 \
  --src-path . \
  --type zip
```

Or zip deploy:

```bash
zip -r deploy.zip . -x "node_modules/*" ".git/*" ".env*"
az webapp deployment source config-zip \
  --resource-group <MAHE-UAT-RG-NAME> \
  --name MAHE-CI-DOC-UAT-APP01 \
  --src deploy.zip
```

> Find resource group: `az webapp list --query "[?name=='MAHE-CI-DOC-UAT-APP01'].resourceGroup" -o tsv`

### Step 6 — Verify deployment

```bash
curl -s https://mahe-ci-doc-uat-app01.azurewebsites.net/api/health
# Expected: {"ok":true,"db":"up",...}
```

Portal checks:

- **Log stream** — no boot errors
- **Application Insights** (if linked) — no exceptions
- **Storage** — after test upload, blob appears under `{appNo}/...`

### Step 7 — First UAT (50 students)

1. Open UAT URL → **Verification Cell Login** → `ADM-001`
2. **Bulk Upload** → 50 test students
3. Test 5 student logins (app no + DOB → set password)
4. Upload PDF + image per student
5. Verifier: preview, verify, ZIP download
6. **Verify Schedule** → generate + allocate (if using orientation week flow)

---

## Phase 2 — Production (after UAT sign-off)

Repeat Steps 3–6 using:

| Setting | Production value |
|---------|------------------|
| App Service | `MAHE-CI-DOC-PRD-APP01` |
| PostgreSQL host | `mahe-ci-doc-prd-psqlsvr01.postgres.database.azure.com` |
| Storage account | `mahecidocprdstgacct01` |
| `CORS_ORIGIN` | `https://maheblreduverify.manipal.edu` |
| Secrets | Key Vault references only |

**Do not copy UAT student data to production** unless formally migrated.

---

## Key Vault secrets (recommended names)

| Secret name | Purpose |
|-------------|---------|
| `DATABASE-URL` | PostgreSQL connection string |
| `JWT-SECRET` | Token signing |
| `SEED-ADMIN-PASSWORD` | ADM-001 password |
| `AZURE-STORAGE-CONNECTION-STRING` | UAT only; prod should use Managed Identity |

App Service reference format:

```
@Microsoft.KeyVault(SecretUri=https://mahe-ci-doc-prd-kv01.vault.azure.net/secrets/JWT-SECRET/)
```

---

## Verification checklist for infra sign-off

| # | Check | UAT | Prod |
|---|--------|-----|------|
| 1 | `/api/health` → db up | ☐ | ☐ |
| 2 | Admin login works | ☐ | ☐ |
| 3 | Student upload → blob created | ☐ | ☐ |
| 4 | Document preview in admin | ☐ | ☐ |
| 5 | Bulk upload 50 rows | ☐ | ☐ |
| 6 | Blob container not public | ☐ | ☐ |
| 7 | CORS set to exact URL | ☐ | ☐ |
| 8 | Managed identity → Key Vault | ☐ | ☐ |
| 9 | SSL on custom domain | N/A until gateway | ☐ |
| 10 | Services locked down (private) | After UAT | After prod UAT |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `db: down` | Check `DATABASE_URL`, URL-encode password, DB `eduverify` exists, firewall allows Azure |
| App won't start | Logs: missing `JWT_SECRET` or `SEED_ADMIN_PASSWORD` in production mode |
| Upload fails | Container `eduverify-documents` exists; connection string or MI has Blob Contributor |
| Login fails | `AUTO_SETUP=true`, restart app; check `SEED_ADMIN_PASSWORD` |
| CORS errors | `CORS_ORIGIN` must match browser URL exactly |
| Rejection email not sent | Check `SMTP_USER`/`SMTP_PASS` in App Service; query `notification_log` for `failed`/`skipped` rows |

---

## Timeline alignment

| When | Action |
|------|--------|
| **Now** | Configure UAT App Service + deploy code |
| **This week** | First UAT with 50–100 students |
| **After UAT pass** | Deploy to PRD App Service |
| **After PRD smoke test** | App Gateway + `maheblreduverify.manipal.edu` |
| **After gateway** | Lock down public access (private endpoints) |
