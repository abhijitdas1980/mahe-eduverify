/* Admin follow-up remarks — audit trail per student during document verification. */
const { pool } = require("../config/db");

const PHYSICAL_SUBMISSION_VALUES = ["not_received", "photocopy", "original"];

function physicalSubmissionLabel(v) {
  if (v === "photocopy") return "Photocopy submitted";
  if (v === "original") return "Original submitted";
  if (v === "not_received") return "Not received physically";
  return null;
}

function serializeFollowupRemark(row) {
  return {
    id: row.id,
    physicalSubmissionNote: row.physical_submission_note || null,
    discrepancies: row.discrepancies || null,
    discussionNotes: row.discussion_notes || null,
    expectedSubmissionDate: row.expected_submission_date || null,
    remarks: row.remarks || null,
    createdAt: row.created_at,
    adminStaffId: row.admin_staff_id || null,
    adminName: row.admin_name || null,
  };
}

async function listFollowupRemarks(studentId) {
  const r = await pool.query(
    `SELECT r.*, a.staff_id AS admin_staff_id, a.name AS admin_name
       FROM student_followup_remarks r
       LEFT JOIN admins a ON a.id = r.admin_id
      WHERE r.student_id = $1
      ORDER BY r.created_at DESC, r.id DESC`,
    [studentId]
  );
  return r.rows.map(serializeFollowupRemark);
}

function validateFollowupPayload(body) {
  const physicalSubmissionNote = body.physicalSubmissionNote == null
    ? null
    : String(body.physicalSubmissionNote).trim() || null;
  const discrepancies = body.discrepancies == null
    ? null
    : String(body.discrepancies).trim() || null;
  const discussionNotes = body.discussionNotes == null
    ? null
    : String(body.discussionNotes).trim() || null;
  const remarks = body.remarks == null ? null : String(body.remarks).trim() || null;
  const expectedSubmissionDate = body.expectedSubmissionDate || null;
  if (
  !physicalSubmissionNote
    && !discrepancies
    && !discussionNotes
    && !remarks
    && !expectedSubmissionDate
  ) {
    return { error: "Enter at least one follow-up note or an expected submission date." };
  }
  if (expectedSubmissionDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedSubmissionDate)) {
    return { error: "Expected submission date must be YYYY-MM-DD." };
  }
  return {
    physicalSubmissionNote,
    discrepancies,
    discussionNotes,
    remarks,
    expectedSubmissionDate: expectedSubmissionDate || null,
  };
}

async function insertFollowupRemark(studentId, adminId, payload) {
  const r = await pool.query(
    `INSERT INTO student_followup_remarks
       (student_id, admin_id, physical_submission_note, discrepancies,
        discussion_notes, expected_submission_date, remarks)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      studentId,
      adminId,
      payload.physicalSubmissionNote,
      payload.discrepancies,
      payload.discussionNotes,
      payload.expectedSubmissionDate,
      payload.remarks,
    ]
  );
  const rows = await pool.query(
    `SELECT r.*, a.staff_id AS admin_staff_id, a.name AS admin_name
       FROM student_followup_remarks r
       LEFT JOIN admins a ON a.id = r.admin_id
      WHERE r.id = $1`,
    [r.rows[0].id]
  );
  return serializeFollowupRemark(rows.rows[0]);
}

module.exports = {
  PHYSICAL_SUBMISSION_VALUES,
  physicalSubmissionLabel,
  serializeFollowupRemark,
  listFollowupRemarks,
  validateFollowupPayload,
  insertFollowupRemark,
};
