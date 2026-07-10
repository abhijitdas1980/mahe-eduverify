const { destroyAsset } = require("../config/storage");

async function deleteOneStudent(client, studentId) {
  const sr = await client.query("SELECT * FROM students WHERE id=$1 FOR UPDATE", [studentId]);
  const s = sr.rows[0];
  if (!s) return null;

  const docs = await client.query(
    "SELECT file_public_id, file_resource_type FROM documents WHERE student_id=$1 AND file_public_id IS NOT NULL",
    [studentId]
  );
  for (const d of docs.rows) {
    await destroyAsset(d.file_public_id, d.file_resource_type);
  }

  if (s.slot_id) {
    await client.query("UPDATE slots SET booked = GREATEST(booked - 1, 0) WHERE id=$1", [s.slot_id]);
  }

  await client.query(
    `UPDATE verify_schedule
        SET student_id = NULL,
            status = CASE WHEN status IN ('booked','pending','verified','absent') THEN 'open' ELSE status END,
            verified_at = NULL,
            verified_by = NULL,
            updated_at = now()
      WHERE student_id = $1`,
    [studentId]
  );

  const del = await client.query("DELETE FROM students WHERE id=$1 RETURNING app_no", [studentId]);
  return del.rows[0]?.app_no || s.app_no;
}

/** Delete students by application number. Runs in a single transaction. */
async function deleteStudentsByAppNos(pool, appNos) {
  const unique = [...new Set((appNos || []).map((a) => String(a || "").trim()).filter(Boolean))];
  const client = await pool.connect();
  const deleted = [];
  const notFound = [];
  try {
    await client.query("BEGIN");
    for (const appNo of unique) {
      const sr = await client.query(
        "SELECT id FROM students WHERE LOWER(app_no)=LOWER($1) FOR UPDATE",
        [appNo]
      );
      if (!sr.rows[0]) {
        notFound.push(appNo);
        continue;
      }
      const removed = await deleteOneStudent(client, sr.rows[0].id);
      if (removed) deleted.push(removed);
    }
    await client.query("COMMIT");
    return { deleted, notFound };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Delete every student record (uploads, slots, verification links). */
async function deleteAllStudents(pool) {
  const client = await pool.connect();
  const deleted = [];
  try {
    await client.query("BEGIN");
    const sr = await client.query("SELECT id FROM students ORDER BY id FOR UPDATE");
    for (const row of sr.rows) {
      const appNo = await deleteOneStudent(client, row.id);
      if (appNo) deleted.push(appNo);
    }
    await client.query("UPDATE slots SET booked = 0");
    await client.query(
      `UPDATE verify_schedule
          SET student_id = NULL,
              status = CASE WHEN status IN ('booked','pending','verified','absent') THEN 'open' ELSE status END,
              verified_at = NULL,
              verified_by = NULL,
              updated_at = now()
        WHERE student_id IS NOT NULL`
    );
    await client.query("COMMIT");
    return { deleted, count: deleted.length };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { deleteStudentsByAppNos, deleteAllStudents };
