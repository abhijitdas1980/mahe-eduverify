# Deploy on Render when GitHub will not connect

Repo: `bnmitbsk2-collab/eduverifymy` (private). Render account: `dasanwita@gmail.com`.

If **Connect GitHub** keeps failing, use **Docker image deploy** (no GitHub link required).

## Option A — Docker image (recommended bypass)

### 1. Docker Hub (free, use dasanwita@gmail.com)

1. Create account at https://hub.docker.com/
2. Create a public repository, e.g. `dasanwita/eduverify`

### 2. Build and push (on your PC, from this folder)

```powershell
cd eduverify-server
docker login
docker build -t dasanwita/eduverify:latest .
docker push dasanwita/eduverify:latest
```

### 3. Render — deploy from image

1. https://dashboard.render.com/ → **New +** → **Web Service**
2. Choose **Deploy an existing image from a registry**
3. Image URL: `docker.io/dasanwita/eduverify:latest`
4. Plan: Free (or paid)
5. **Environment** — set at minimum:

| Variable | Value |
|----------|--------|
| `DATABASE_URL` | From Render PostgreSQL |
| `JWT_SECRET` | Long random string |
| `NODE_ENV` | `production` |
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary |
| `CLOUDINARY_API_KEY` | Your Cloudinary |
| `CLOUDINARY_API_SECRET` | Your Cloudinary |
| `SEED_ADMIN_PASSWORD` | Strong password |
| `CORS_ORIGIN` | `https://YOUR-SERVICE.onrender.com` |

6. Create **PostgreSQL** on Render if you do not have one; paste `DATABASE_URL` into the web service.

### 4. After code changes

```powershell
docker build -t dasanwita/eduverify:latest .
docker push dasanwita/eduverify:latest
```

Then Render → your service → **Manual Deploy** → **Deploy latest image**.

---

## Option B — Fix GitHub connect (if you want auto-deploy from git)

`bnmitbsk2-collab` is a **GitHub user account**. The repo is **private**. Render must use that same GitHub user.

1. Browser **Incognito** window
2. Sign out of all GitHub accounts: https://github.com/logout
3. Sign in **only** as `bnmitbsk2-collab`
4. Render → **Account Settings** → **Git Provider** → **Disconnect** GitHub
5. **Connect GitHub** → approve Render → **All repositories** → Save
6. New or existing Web Service → repo `bnmitbsk2-collab/eduverifymy`, branch `main`, root directory blank

If the GitHub popup never opens: disable ad-blocker, allow popups for render.com, try Chrome/Edge.

If **Suspend** was clicked on the Render GitHub App: GitHub → Settings → Applications → Render → **Unsuspend** or reinstall.

---

## Option C — Temporary public repo (quick test only)

GitHub as `bnmitbsk2-collab` → repo **Settings** → **Danger zone** → change visibility to **Public** → try Connect GitHub again on Render.

**Not recommended** for production (student data). Switch back to private after testing.

---

## Health check

After deploy: `https://YOUR-SERVICE.onrender.com/api/health` should return `{"ok":true,"db":"up",...}`.
