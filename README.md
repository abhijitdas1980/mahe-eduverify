# EduVerify — MAHE Document Pre-Verification Portal

Node.js + PostgreSQL + Azure Blob Storage portal for admission document verification.

**Production URL:** https://maheblreduverify.manipal.edu  
**Azure UAT:** `MAHE-CI-DOC-UAT-APP01`  
**SPOC:** abhijit.das@manipal.edu

---

## Stack

| Layer | Technology |
|-------|------------|
| Web + API | Node.js 20, Express |
| Metadata | Azure Database for PostgreSQL |
| Documents | Azure Blob Storage (private) |
| Hosting | Azure App Service |

---

## Quick start (local)

```bash
npm install
cp .env.example .env
# Set DATABASE_URL and storage (Azure connection string or Cloudinary for legacy)
npm run setup
npm start
```

Open http://localhost:8080

---

## Deploy to Azure (MAHE)

| Guide | Purpose |
|-------|---------|
| [azure/MAHE-DEPLOY.md](azure/MAHE-DEPLOY.md) | UAT + Production setup |
| [DEPLOY-AZURE.md](DEPLOY-AZURE.md) | Generic Azure architecture |

**GitHub Actions:** push to `uat` branch or run **Deploy MAHE UAT** workflow.

---

## New GitHub repository

See [GITHUB-SETUP.md](GITHUB-SETUP.md) if you are creating or moving this repo.

---

## Features

- Student portal: upload documents, self-verify, slot booking
- Admin portal: bulk student upload, document verification, exports
- Verification schedule dashboard (`/verify.html`) for orientation week
- Supports 5,000–10,000 students per admission cycle

---

## Security

- Never commit `.env` or `.env.azure-*` files
- Use Key Vault for production secrets
- Set `CORS_ORIGIN` to your exact site URL in production

See [README v10 details](#whats-new-in-v10) below for feature changelog.

---

# EduVerify — Full-Stack Pre-Verification Portal (v10)
