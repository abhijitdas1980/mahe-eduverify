#!/usr/bin/env node
/* Delete all student records and run database setup to refresh schedules. */
require("dotenv").config();

const { pool } = require("../src/config/db");
const { deleteAllStudents } = require("../src/lib/deleteStudent");
const { runSetup } = require("../src/db/setup");

async function main() {
  const countBefore = await pool.query("SELECT count(*)::int AS n FROM students");
  console.log(`[purge] Students before: ${countBefore.rows[0].n}`);

  const { deleted, count } = await deleteAllStudents(pool);
  console.log(`[purge] Removed ${count} student(s).`);
  if (deleted.length) {
    console.log(`[purge] Application numbers: ${deleted.join(", ")}`);
  }

  console.log("[purge] Running database setup (schema + verification grid refresh)...");
  await runSetup({ closePool: false, quiet: false });

  const countAfter = await pool.query("SELECT count(*)::int AS n FROM students");
  console.log(`[purge] Students after: ${countAfter.rows[0].n}`);
  console.log("[purge] Done.");
  await pool.end();
}

main().catch(async (e) => {
  console.error("\nPURGE FAILED:", e.message);
  try { await pool.end(); } catch (_) {}
  process.exitCode = 1;
});
