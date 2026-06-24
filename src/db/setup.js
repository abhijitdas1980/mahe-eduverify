/* ===========================================================
   Database setup & migration.
   - Idempotent: safe to run on every server boot (auto-setup).
   - Students come only via admin bulk upload (no demo seed data).
   - Run manually with:  npm run setup
   =========================================================== */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { isProduction, DEFAULT_ADMIN_PASS } = require("../config/env");
const { normalize, SEED_BLACKLIST } = require("../lib/blacklist");
const {
  generateEmptySchedule,
  purgeLegacyDemoStudents,
  purgeLegacyReportingSlots,
} = require("../lib/verifySchedule");

async function runSetup({ closePool = false, quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  const client = await pool.connect();
  try {
    log("[setup] Creating / upgrading tables ...");
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await client.query(schema);

    log("[setup] Seeding supervisor admin account (if missing) ...");
    const adminId = process.env.SEED_ADMIN_ID || "ADM-001";
    const adminName = process.env.SEED_ADMIN_NAME || "Verification Cell Admin";
    const adminPass = process.env.SEED_ADMIN_PASSWORD || DEFAULT_ADMIN_PASS;
    if (isProduction() && adminPass === DEFAULT_ADMIN_PASS) {
      throw new Error("SEED_ADMIN_PASSWORD must be set in production.");
    }
    const adminHash = await bcrypt.hash(adminPass, 12);
    const syncPassword = process.env.SEED_ADMIN_SYNC_PASSWORD === "true";
    if (syncPassword) {
      await client.query(
        `INSERT INTO admins (staff_id, name, password_hash, role)
         VALUES ($1,$2,$3,'supervisor')
         ON CONFLICT (staff_id) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               name = EXCLUDED.name`,
        [adminId, adminName, adminHash]
      );
      log("[setup] Supervisor admin password synced from SEED_ADMIN_PASSWORD.");
    } else {
      await client.query(
        `INSERT INTO admins (staff_id, name, password_hash, role)
         VALUES ($1,$2,$3,'supervisor')
         ON CONFLICT (staff_id) DO NOTHING`,
        [adminId, adminName, adminHash]
      );
    }

    log("[setup] Removing legacy demo/seed students (if any) ...");
    const purged = await purgeLegacyDemoStudents(client);
    if (purged.demoRemoved || purged.seedRemoved) {
      log(`[setup]   removed demo=${purged.demoRemoved} seed=${purged.seedRemoved}`);
    }

    log("[setup] Removing legacy prefilled reporting slots (if any) ...");
    const slotsRemoved = await purgeLegacyReportingSlots(client);
    if (slotsRemoved) log(`[setup]   removed reporting slots=${slotsRemoved}`);

    log("[setup] Ensuring empty verification schedule grid exists ...");
    const sched = await generateEmptySchedule(client);
    if (sched.inserted) log(`[setup]   verify_schedule slots inserted=${sched.inserted}`);

    const exists = await client.query("SELECT count(*)::int AS n FROM blacklist_institutions");
    if (exists.rows[0].n === 0) {
      log("[setup] Seeding blacklist of fake/non-recognised institutions ...");
      for (const [name, region] of SEED_BLACKLIST) {
        await client.query(
          `INSERT INTO blacklist_institutions (name, name_normalized, region, reason)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (name_normalized) DO NOTHING`,
          [name, normalize(name), region, "Not recognised by UGC / regulator (initial seed)"]
        );
      }
    } else {
      log("[setup] Blacklist already has entries, skipping seed.");
    }

    await client.query(
      `INSERT INTO audit_log (actor_type, actor_id, action, detail)
       VALUES ('system','setup','DB_SETUP','Schema upgraded; students via bulk upload only')`
    );

    log("[setup] DONE. Database is ready.");
  } finally {
    client.release();
    if (closePool) await pool.end();
  }
}

if (require.main === module) {
  runSetup({ closePool: true }).catch((e) => {
    console.error("\nSETUP FAILED:", e.message);
    process.exitCode = 1;
  });
}

module.exports = { runSetup };
