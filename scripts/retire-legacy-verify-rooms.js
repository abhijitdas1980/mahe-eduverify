#!/usr/bin/env node
/**
 * Remove AB4-101…115 verification slots, release any assigned students,
 * and re-allocate them to current rooms (AB4-203–502).
 *
 * Usage: node scripts/retire-legacy-verify-rooms.js
 */
require("dotenv").config();

const { pool } = require("../src/config/db");
const { retireLegacyVerifyRoomSlots } = require("../src/lib/verifySchedule");
const { tryAllocateVerifySlot } = require("../src/lib/verifyAlloc");

async function main() {
  const client = await pool.connect();
  let retired;
  try {
    await client.query("BEGIN");
    retired = await retireLegacyVerifyRoomSlots(client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  console.log(`Deleted ${retired.deletedSlots} legacy slot row(s) (AB4-101…115).`);
  console.log(`Released ${retired.releasedStudents.length} student(s) from legacy rooms.`);

  for (const row of retired.releasedStudents) {
    try {
      const out = await tryAllocateVerifySlot(row.student_id);
      const label = out.allocated ? "re-allocated" : out.reason;
      console.log(`  ${row.app_no}: ${label}`);
    } catch (e) {
      console.log(`  ${row.app_no}: re-allocate failed — ${e.message}`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
