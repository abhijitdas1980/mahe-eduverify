#!/usr/bin/env node
/* Reset supervisor password from SEED_ADMIN_PASSWORD (or NEW_ADMIN_PASSWORD). */
require("dotenv").config();

const bcrypt = require("bcryptjs");
const { pool } = require("../src/config/db");

async function main() {
  const staffId = process.env.SEED_ADMIN_ID || "ADM-001";
  const pass = process.env.NEW_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
  if (!pass || pass.length < 8) {
    console.error("Set SEED_ADMIN_PASSWORD or NEW_ADMIN_PASSWORD (min 8 chars) in the environment.");
    process.exitCode = 1;
    return;
  }
  const hash = await bcrypt.hash(pass, 12);
  const r = await pool.query(
    "UPDATE admins SET password_hash=$1 WHERE LOWER(staff_id)=LOWER($2) RETURNING staff_id, name, role",
    [hash, staffId]
  );
  if (!r.rows.length) {
    console.error(`No admin found with staff_id "${staffId}". Run npm run setup first.`);
    process.exitCode = 1;
  } else {
    console.log(`Password updated for ${r.rows[0].staff_id} (${r.rows[0].name}, ${r.rows[0].role}).`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
