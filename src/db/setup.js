/* ===========================================================
   Database setup & migration.
   - Idempotent: safe to run on every server boot (auto-setup).
   - Run manually with:  npm run setup
   =========================================================== */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { checklistFor } = require("../config/checklists");
const { normalize, SEED_BLACKLIST } = require("../lib/blacklist");

const STUDENTS = [
  { app_no:"CSE2026001", name:"Aarav Sharma",      dob:"2007-03-12", email:"aarav@example.com",  phone:"9000000001", program:"B.E. Computer Science",      department:"Computer Science",          batch:"2026", category:"OBC", section:"A", profile:"UG-Indian",             orientation_date:"2026-06-10" },
  { app_no:"CSE2026002", name:"Priya Iyer",        dob:"2006-11-04", email:"priya@example.com",  phone:"9000000002", program:"B.E. Computer Science",      department:"Computer Science",          batch:"2026", category:"SC",  section:"A", profile:"UG-Indian-Scholarship", orientation_date:"2026-06-10" },
  { app_no:"ECE2026003", name:"Vihaan Mehta",      dob:"2007-01-22", email:"vihaan@example.com", phone:"9000000003", program:"B.E. Electronics & Comm.",   department:"Electronics & Communication", batch:"2026", category:"GEN", section:"B", profile:"UG-Indian",             orientation_date:"2026-06-10" },
  { app_no:"MEC2026004", name:"Ananya Nair",       dob:"2006-08-18", email:"ananya@example.com", phone:"9000000004", program:"B.E. Mechanical",            department:"Mechanical Engineering",     batch:"2026", category:"ST",  section:"A", profile:"UG-Indian-Scholarship", orientation_date:"2026-06-10" },
  { app_no:"CSE2026005", name:"Mohammed Al-Faraj", dob:"2006-05-30", email:"moh@example.com",    phone:"9000000005", program:"B.E. Computer Science",      department:"Computer Science",          batch:"2026", category:"NRI", section:"C", profile:"UG-NRI",                orientation_date:"2026-06-10" },
  { app_no:"CSE2026006", name:"Sophia Williams",   dob:"2006-09-09", email:"sophia@example.com", phone:"9000000006", program:"B.E. Computer Science",      department:"Computer Science",          batch:"2026", category:"FN",  section:"C", profile:"UG-Foreign",            orientation_date:"2026-06-10" },
  { app_no:"CSE2026007", name:"Karthik Reddy",     dob:"2005-02-14", email:"karthik@example.com",phone:"9000000007", program:"B.E. Computer Science (Lat)",department:"Computer Science",          batch:"2026", category:"GEN", section:"B", profile:"UG-Lateral",            orientation_date:"2026-06-10" },
  { app_no:"MCA2026008", name:"Divya Krishnan",    dob:"2002-07-20", email:"divya@example.com",  phone:"9000000008", program:"M.C.A.",                     department:"Computer Applications",      batch:"2026", category:"GEN", section:"A", profile:"PG-Indian",             orientation_date:"2026-06-12" },
  { app_no:"MBA2026009", name:"Rohan Kapoor",      dob:"2001-12-05", email:"rohan@example.com",  phone:"9000000009", program:"M.B.A. (Finance)",           department:"Business Administration",    batch:"2026", category:"OBC", section:"A", profile:"PG-Indian",             orientation_date:"2026-06-12" },
  { app_no:"MTC2026010", name:"Lakshmi Pillai",    dob:"2001-03-28", email:"lakshmi@example.com",phone:"9000000010", program:"M.Tech. (AI & ML)",          department:"Computer Science",          batch:"2026", category:"SC",  section:"A", profile:"PG-Indian-Scholarship", orientation_date:"2026-06-12" },
];

const SLOT_DATES = ["2026-06-05","2026-06-06","2026-06-07","2026-06-08","2026-06-09"];
const SLOT_TIMES = ["09:00 AM","10:00 AM","11:00 AM","12:00 PM","02:00 PM","03:00 PM","04:00 PM"];

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
    const adminPass = process.env.SEED_ADMIN_PASSWORD || "ChangeMe@2026";
    const adminHash = await bcrypt.hash(adminPass, 12);
    await client.query(
      `INSERT INTO admins (staff_id, name, password_hash, role)
       VALUES ($1,$2,$3,'supervisor')
       ON CONFLICT (staff_id) DO NOTHING`,
      [adminId, adminName, adminHash]
    );

    log("[setup] Seeding reporting slots (if missing) ...");
    for (const d of SLOT_DATES) {
      for (const t of SLOT_TIMES) {
        await client.query(
          `INSERT INTO slots (slot_date, slot_time, capacity, booked)
           VALUES ($1,$2,20,0)
           ON CONFLICT (slot_date, slot_time) DO NOTHING`,
          [d, t]
        );
      }
    }

    log("[setup] Seeding demo students (if missing) ...");
    for (const s of STUDENTS) {
      const r = await client.query(
        `INSERT INTO students
           (app_no,name,dob,email,phone,program,department,batch,category,section,profile,orientation_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (app_no) DO NOTHING
         RETURNING id`,
        [s.app_no,s.name,s.dob,s.email,s.phone,s.program,s.department,s.batch,s.category,s.section,s.profile,s.orientation_date]
      );
      let studentId = r.rows[0]?.id;
      if (!studentId) {
        const ex = await client.query("SELECT id FROM students WHERE app_no=$1", [s.app_no]);
        studentId = ex.rows[0].id;
      }
      for (const code of checklistFor(s.profile)) {
        await client.query(
          `INSERT INTO documents (student_id, doc_code)
           VALUES ($1,$2)
           ON CONFLICT (student_id, doc_code) DO NOTHING`,
          [studentId, code]
        );
      }
    }

    // Seed the blacklist ONLY if the table is currently empty.
    // After first seed, admins manage it through the UI (re-runs do not undo deletes).
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
       VALUES ('system','setup','DB_SETUP','Schema created/upgraded and data seeded')`
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
