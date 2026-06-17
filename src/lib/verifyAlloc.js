/* v14 — Auto-allocation of a document-verification slot.
   Called every time a student transitions a document to status='ready'.
   - Pre-assigned date is immutable on the student record.
   - Allocation is FCFS within that date, ordered (slot_no, room) so slot 1
     in all 15 rooms fills first (15 students processed in parallel at 1:00 PM),
     then slot 2 in all 15 rooms, etc.
   - FOR UPDATE SKIP LOCKED keeps two concurrent allocations from grabbing
     the same row.
*/
const { pool } = require("../config/db");
const { checklistFor } = require("../config/checklists");

async function tryAllocateVerifySlot(studentId) {
  const sr = await pool.query(
    `SELECT id, profile, assigned_verification_date, upload_completed_at,
            verify_schedule_id
       FROM students WHERE id=$1`,
    [studentId]
  );
  const s = sr.rows[0];
  if (!s) return { allocated: false, reason: "student-not-found" };
  if (s.verify_schedule_id) return { allocated: false, reason: "already-allocated", slotId: s.verify_schedule_id };
  if (!s.assigned_verification_date) return { allocated: false, reason: "no-assigned-date" };

  /* Every mandatory document must be Ready. */
  const mandatory = checklistFor(s.profile);
  if (!mandatory.length) return { allocated: false, reason: "no-checklist" };
  const dr = await pool.query(
    `SELECT doc_code, student_status FROM documents
      WHERE student_id=$1 AND doc_code = ANY($2::text[])`,
    [studentId, mandatory]
  );
  const ready = new Set(
    dr.rows.filter((d) => d.student_status === "ready").map((d) => d.doc_code)
  );
  if (mandatory.some((c) => !ready.has(c)))
    return { allocated: false, reason: "not-all-ready" };

  /* Stamp the upload-completion timestamp (only once). FCFS uses this. */
  if (!s.upload_completed_at) {
    await pool.query(
      "UPDATE students SET upload_completed_at=now() WHERE id=$1 AND upload_completed_at IS NULL",
      [studentId]
    );
  }

  /* Atomically grab the earliest open slot on the student's assigned date. */
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const slotR = await client.query(
      `SELECT id FROM verify_schedule
        WHERE schedule_date=$1 AND status='open' AND student_id IS NULL
        ORDER BY slot_no ASC, room ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [s.assigned_verification_date]
    );
    if (!slotR.rows.length) {
      await client.query("ROLLBACK");
      return { allocated: false, reason: "no-slots-available" };
    }
    const slotId = slotR.rows[0].id;
    await client.query(
      `UPDATE verify_schedule SET student_id=$1, status='booked', updated_at=now() WHERE id=$2`,
      [studentId, slotId]
    );
    await client.query(
      `UPDATE students SET verify_schedule_id=$1 WHERE id=$2`,
      [slotId, studentId]
    );
    await client.query("COMMIT");
    return { allocated: true, slotId };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { tryAllocateVerifySlot };
