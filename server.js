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

const { pool } = require("./src/config/db");
const { runSetup } = require("./src/db/setup");
const { apiLimiter } = require("./src/middleware/security");
const errorHandler = require("./src/middleware/errorHandler");

const authRoutes = require("./src/routes/auth");
const studentRoutes = require("./src/routes/student");
const adminRoutes = require("./src/routes/admin");
const verifyRoutes = require("./src/routes/verify");

const app = express();
const PORT = process.env.PORT || 8080;

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        connectSrc: ["'self'", "https://res.cloudinary.com"],
        frameSrc: ["'self'", "https://res.cloudinary.com"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, db: "down" });
  }
});

app.use("/api", apiLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/verify", verifyRoutes);

app.use(express.static(path.join(__dirname, "public")));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(errorHandler);

async function start() {
  if (process.env.AUTO_SETUP !== "false") {
    console.log("[boot] Running database setup (idempotent) ...");
    try {
      await runSetup({ closePool: false });
    } catch (e) {
      console.warn("[boot] Auto-setup failed (server will still start):", e.message);
    }
  } else {
    console.log("[boot] AUTO_SETUP=false, skipping setup.");
  }
  app.listen(PORT, () => {
    console.log(`EduVerify server listening on port ${PORT}`);
    console.log("Health check: /api/health");
  });
}
start();
