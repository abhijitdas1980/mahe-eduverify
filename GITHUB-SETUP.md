# Create GitHub repository `mahe-eduverify`

Target: **personal account**, **public** repo, name **`mahe-eduverify`**.

> **Note:** This app handles student PII. A **private** repo is usually safer. You can change visibility later in GitHub → Settings.

---

## Step 1 — Log in to GitHub CLI

```bash
gh auth login
```

Choose: GitHub.com → HTTPS → Login with browser → authorize.

Verify:

```bash
gh auth status
```

---

## Step 2 — Create repo and push (from `eduverify-server` folder)

```bash
cd eduverify-server

# Remove link to old repo (bnmitbsk2-collab/eduverifymy)
git remote remove origin

# Create new repo on your account and push main
gh repo create mahe-eduverify \
  --public \
  --source=. \
  --remote=origin \
  --description "MAHE EduVerify — admission document pre-verification portal (Azure)" \
  --push
```

If the repo name is already taken, pick another name:

```bash
gh repo create eduverify-mahe --public --source=. --remote=origin --push
```

---

## Step 3 — Add `uat` branch (for UAT auto-deploy)

```bash
git checkout -b uat
git push -u origin uat
git checkout main
```

---

## Step 4 — GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions** → **New repository secret**

| Secret | How to get it |
|--------|----------------|
| `AZURE_WEBAPP_PUBLISH_PROFILE` | UAT: App Service **MAHE-CI-DOC-UAT-APP01** → Download publish profile |
| `AZURE_WEBAPP_PUBLISH_PROFILE_PRD` | Prod: App Service **MAHE-CI-DOC-PRD-APP01** → Download publish profile |
| `AZURE_CREDENTIALS` | _(Optional)_ Service principal JSON — only if a workflow uses `azure/login` |

#### Publish profile (recommended if `az ad sp create-for-rbac` fails)

1. Azure Portal → **MAHE-CI-DOC-UAT-APP01** (activate PIM Contributor first)
2. **Overview** → top bar → **Download publish profile**
3. GitHub repo → **Settings → Secrets → Actions** → **New secret**
4. Name: `AZURE_WEBAPP_PUBLISH_PROFILE`
5. Value: paste the **entire** `.PublishSettings` XML file contents

**Production:** repeat for **MAHE-CI-DOC-PRD-APP01** → secret name `AZURE_WEBAPP_PUBLISH_PROFILE_PRD`

Optional: **Settings → Environments** → create `uat` and `production` with reviewers.

---

## Step 5 — Verify

1. Open `https://github.com/<your-username>/mahe-eduverify`
2. **Actions** tab → run **Deploy MAHE UAT** manually
3. Confirm `.env` is **not** in the repository (Settings → search files)

---

## One-command script (after `gh auth login`)

```bash
./scripts/create-github-repo.sh
```

---

## If you already created an empty repo on GitHub

```bash
git remote add origin https://github.com/<your-username>/mahe-eduverify.git
git push -u origin main
git checkout -b uat && git push -u origin uat
```
