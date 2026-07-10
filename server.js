/* ===========================================================
   EduVerify - server entry point
   Serves the REST API (/api/*) and the frontend (public/).
   Auto-runs database setup on boot (idempotent) unless
   AUTO_SETUP=false is set in the environment.
   =========================================================== */
require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

const { assertProductionConfig, storageProvider } = require("./src/config/env");
const { isConfigured: isStorageConfigured } = require("./src/config/storage");
assertProductionConfig();

const { pool } = require("./src/config/db");
const { getEmailHealth } = require("./src/lib/notifications");
const { runSetup } = require("./src/db/setup");
const { apiLimiter } = require("./src/middleware/security");
const errorHandler = require("./src/middleware/errorHandler");

const authRoutes = require("./src/routes/auth");
const studentRoutes = require("./src/routes/student");
const adminRoutes = require("./src/routes/admin");
const verifyRoutes = require("./src/routes/verify");
const commTrackRoutes = require("./src/routes/commTrack");
const { startCommunicationWorker } = require("./src/lib/communication/worker");

const app = express();
const PORT = process.env.PORT || 8080;

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "https://api.fontshare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://api.fontshare.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https://*.blob.core.windows.net"],
        connectSrc: ["'self'", "https://*.blob.core.windows.net"],
        frameSrc: ["'self'", "blob:", "https://*.blob.core.windows.net"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

const corsOrigin = (process.env.CORS_ORIGIN || "*").trim();
const corsOptions =
  corsOrigin === "*"
    ? { origin: true, credentials: false }
    : {
        origin(origin, cb) {
          const allowed = corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
          if (!origin || allowed.includes(origin)) return cb(null, true);
          return cb(null, false);
        },
        credentials: true,
      };
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const email = await getEmailHealth();
    res.json({
      ok: true,
      db: "up",
      email: email.configured ? "configured" : email.reason,
      emailLog: email.logTable,
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ ok: false, db: "down" });
  }
});

app.use("/api", apiLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/verify", verifyRoutes);
app.use("/api/comm", commTrackRoutes);

app.use(express.static(path.join(__dirname, "public")));
app.get(/^(?!\/api).*/, (req, res) => {
  if (/\.[a-z0-9]+$/i.test(req.path) && !req.path.endsWith(".html")) {
    return res.status(404).type("text/plain").send("Not found");
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(errorHandler);

async function start() {
  if (!process.env.DATABASE_URL) {
    console.warn("[boot] DATABASE_URL is not set — skipping auto-setup. The UI will load but API/login will not work until PostgreSQL is configured.");
  } else if (process.env.AUTO_SETUP !== "false") {
    console.log("[boot] Running database setup (idempotent) ...");
    try {
      await runSetup({ closePool: false });
    } catch (e) {
      console.warn("[boot] Auto-setup failed (server will still start):", e.message);
    }
  } else {
    console.log("[boot] AUTO_SETUP=false, skipping setup.");
  }
  const { getEmailStatus } = require("./src/lib/notifications");
  const emailBoot = getEmailStatus();
  app.listen(PORT, () => {
    console.log(`EduVerify server listening on port ${PORT}`);
    console.log(`Storage: ${storageProvider()}${isStorageConfigured() ? "" : " (not configured)"}`);
    console.log(`Email: ${emailBoot.configured ? `${emailBoot.mailProvider || "mail"} ready (${emailBoot.smtpUser})` : emailBoot.reason}`);
    console.log("Health check: /api/health");
    startCommunicationWorker(15000);
  });
}
start();
