# Deploy EduVerify on Azure (production)

Azure-only stack for **5,000–10,000 students** going live online:

| Layer | Azure service |
|-------|----------------|
| Web + API | **App Service** (Linux, Node 20, P1v3) |
| Metadata | **Azure Database for PostgreSQL** Flexible Server |
| Documents | **Azure Blob Storage** (private container) |
| Monitoring | **Application Insights** |

Student files never sit in PostgreSQL — only metadata (`file_public_id`, name, size). PDFs/images go to Blob Storage.

---

## What’s in this repo

- `src/config/blobStorage.js` — Azure Blob adapter
- `src/config/storage.js` — picks Azure or legacy Cloudinary
- `azure/main.bicep` — infrastructure as code
- `azure/deploy.sh` — one-command provisioning
- `.github/workflows/azure-deploy.yml` — CI/CD to App Service

---

## Quick start (Azure CLI)

### 1. Prerequisites

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed
- Azure subscription with permission to create resources
- `az login` completed

### 2. Configure parameters

```bash
cd eduverify-server/azure
cp parameters.prod.json.example parameters.prod.json
```

Edit `parameters.prod.json`:

| Parameter | What to set |
|-----------|-------------|
| `postgresAdminPassword` | Strong DB password (letters + numbers, avoid `@` in password) |
| `jwtSecret` | 64+ random hex: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `seedAdminPassword` | Verification Cell admin login password (not `ChangeMe@2026`) |
| `corsOrigin` | Your public URL, e.g. `https://eduverify.yourcollege.edu` |
| `location` | e.g. `centralindia` |

### 3. Provision infrastructure

```bash
chmod +x deploy.sh
./deploy.sh
```

This creates: resource group, App Service Plan (P1v3), Web App, PostgreSQL (2 vCore, 64 GB), Storage Account, Blob container, Managed Identity + RBAC, Application Insights.

### 4. Deploy application code

**Option A — Azure CLI (first deploy)**

```bash
cd eduverify-server
az webapp up \
  --resource-group rg-eduverify-prod \
  --name app-eduverifyprod \
  --runtime "NODE:20-lts" \
  --sku P1V3
```

**Option B — GitHub Actions**

1. Create a service principal and add `AZURE_CREDENTIALS` secret to GitHub.
2. Set `AZURE_WEBAPP_NAME` in `.github/workflows/azure-deploy.yml` if your web app name differs.
3. Push to `main` — workflow deploys automatically.

### 5. Verify

```bash
curl https://app-eduverifyprod.azurewebsites.net/api/health
# {"ok":true,"db":"up",...}
```

Open the site → **Verification Cell Login** → `ADM-001` + your `seedAdminPassword`.

---

## Environment variables (App Service)

Set automatically by Bicep. For manual setup:

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string (`?sslmode=require`) |
| `STORAGE_PROVIDER` | `azure` |
| `AZURE_STORAGE_ACCOUNT_NAME` | Storage account name |
| `AZURE_STORAGE_CONTAINER` | `eduverify-documents` |
| `JWT_SECRET` | Token signing secret |
| `SEED_ADMIN_PASSWORD` | Admin password |
| `CORS_ORIGIN` | Public site URL |
| `AUTO_SETUP` | `true` (runs schema on boot) |
| `PG_POOL_MAX` | `25` (tune for peak load) |

**Managed Identity** authenticates to Blob — no storage keys in production when using Bicep deploy.

For local Azure testing, set `AZURE_STORAGE_CONNECTION_STRING` from the portal.

---

## Scale: 5,000–10,000 students

| Resource | Starter (5k) | Growth (10k) |
|----------|--------------|--------------|
| App Service | P1v3, 1 instance | P1v3, auto-scale 2–3 |
| PostgreSQL | GP 2 vCore, 64 GB | GP 4 vCore, 128 GB |
| Blob Storage | ~100 GB Hot (ZRS) | ~200 GB Hot |

Peak load is **200–500 concurrent users**, not all students at once. Enable App Service **auto-scale** on CPU > 70% during orientation week.

---

## Custom domain & HTTPS

1. App Service → **Custom domains** → add `eduverify.yourcollege.edu`
2. Create DNS CNAME to `app-eduverifyprod.azurewebsites.net`
3. Enable **Managed certificate**
4. Update `CORS_ORIGIN` to the custom domain and restart

---

## Bulk student upload

After deploy:

1. Sign in as supervisor (`ADM-001`)
2. Use **Bulk Upload** with the Excel template
3. Upload 5k–10k rows in batches if needed (test with 100 first)

---

## Security checklist

- [ ] `SEED_ADMIN_PASSWORD` is strong and not the default
- [ ] `JWT_SECRET` is 32+ random characters
- [ ] `CORS_ORIGIN` is your exact public URL (not `*`)
- [ ] PostgreSQL firewall allows Azure services only (Bicep default)
- [ ] Blob container has **no public access**
- [ ] Custom domain + HTTPS enabled before go-live

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/api/health` → `db: down` | Check `DATABASE_URL`, PostgreSQL firewall, SSL |
| Upload fails | Confirm Managed Identity has **Storage Blob Data Contributor** on the storage account |
| Admin login fails | Run `npm run setup` or redeploy with `AUTO_SETUP=true` |
| App won’t start | Check App Service logs — production requires `JWT_SECRET` and `SEED_ADMIN_PASSWORD` |

---

## Cost estimate (Central India, indicative)

| Service | Monthly |
|---------|---------|
| App Service P1v3 | ₹8,000 – ₹12,000 |
| PostgreSQL GP 2 vCore | ₹10,000 – ₹18,000 |
| Blob ~100 GB | ₹1,500 – ₹3,000 |
| App Insights | ₹1,000 – ₹2,000 |
| **Total** | **~₹20,000 – ₹35,000** |

---

## Legacy Cloudinary

Set `STORAGE_PROVIDER=cloudinary` and Cloudinary env vars only if migrating from an old Render deploy. New Azure deployments use Blob only.
