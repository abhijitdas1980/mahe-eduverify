/* Admin routes  ->  /api/admin/*  (v8)
   v8 changes:
   - /meta returns the extended category dropdown (General / NRI / NRI Sponsored
     / Foreign / OCI / AICTE) from a central CATEGORIES constant.
   - Stats + pipeline counts exclude OPTIONAL_DOCS (MIGRATION) and
     LEGACY_DOC_CODES (PAN/BANK/CASTE/MEDICAL), so totals represent mandatory
     docs only.
   - maybeClearPending() considers mandatory docs only.
   - Admin detail + ZIP download exclude legacy codes; optional docs remain
     visible/downloadable when uploaded.
*/
const express = require("express");
const bcrypt = require("bcryptjs");
const archiver = require("archiver");
const { pool } = require("../config/db");
const { requireAdmin, requireSupervisor } = require("../middleware/auth");
const { audit } = require("../lib/audit");
const {
  serializeDocAdmin, ensureDocuments, filterVisible,
  DOC_SELECT_WITH_VERIFIER, DOC_JOIN_VERIFIER,
} = require("../lib/docs");
const {
  CHECKLISTS, DOC_META, CATEGORIES, OPTIONAL_DOCS, LEGACY_DOC_CODES, PROFILES, isValidProfile,
  checklistFor,
} = require("../config/checklists");
const { fetchAssetBuffer } = require("../config/cloudinary");
const { streamDoc } = require("../lib/docStream");
const { normalize } = require("../lib/blacklist");
const { serializeContact } = require("../lib/contact");
const { buildExportBuffer, buildLoginRosterBuffer, queryStudentExportRows } = require("../lib/studentExportExcel");
const {
  PHYSICAL_SUBMISSION_VALUES,
  listFollowupRemarks,
  validateFollowupPayload,
  insertFollowupRemark,
} = require("../lib/followupRemarks");
const { deleteStudentsByAppNos } = require("../lib/deleteStudent");
const { releaseVerifySlotForStudent } = require("../lib/verifyAlloc");

const studentBulkRoutes = require("./studentBulk");

const router = express.Router();
router.use(requireAdmin);
router.use("/students/bulk-upload", studentBulkRoutes);

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
const SLOT_STATUSES = ["open", "hidden", "closed"];

/* v8 — codes excluded from totals/counts (legacy + optional). Used in SQL via
   d.doc_code <> ALL($::text[]) to keep mandatory-only stats. */
const EXCLUDE_FROM_COUNTS = [...LEGACY_DOC_CODES, ...OPTIONAL_DOCS];

function parseTime(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  const ap = m[3] && m[3].toUpperCase();
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + mm;
}

function serializeSlot(s) {
  const fullyBooked = s.booked >= s.capacity;
  const displayStatus = (s.status === "open" && fullyBooked) ? "fully_booked" : s.status;
  return {
    id: s.id, date: s.slot_date, time: s.slot_time,
    capacity: s.capacity, booked: s.booked,
    status: s.status, displayStatus,
    durationMinutes: s.duration_minutes,
    seatsLeft: Math.max(s.capacity - s.booked, 0),
    enabled: s.enabled,
  };
}

/** v8 — clear pending docs/deadline once every MANDATORY doc is verified.
    Optional docs (MIGRATION) don't have to be verified to trigger this. */
async function maybeClearPending(studentId) {
  const r = await pool.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE staff_status='verified') AS verified
       FROM documents
      WHERE student_id=$1 AND doc_code <> ALL($2::text[])`,
    [studentId, EXCLUDE_FROM_COUNTS]
  );
  const total = Number(r.rows[0].total), verified = Number(r.rows[0].verified);
  if (total > 0 && total === verified) {
    await pool.query(
      "UPDATE students SET pending_docs=NULL, submission_deadline=NULL WHERE id=$1",
      [studentId]
    );
  }
}

router.get("/meta", async (_req, res, next) => {
  try {
    const d = await pool.query("SELECT DISTINCT department FROM students WHERE department IS NOT NULL ORDER BY department");
    const s = await pool.query("SELECT DISTINCT section FROM students WHERE section IS NOT NULL ORDER BY section");
    const b = await pool.query("SELECT DISTINCT batch FROM students WHERE batch IS NOT NULL ORDER BY batch");
    res.json({
      departments: d.rows.map((r) => r.department),
      sections: s.rows.map((r) => r.section),
      batches: b.rows.map((r) => r.batch),
      profiles: PROFILES.slice(),
      /* v8 — extended category dropdown. */
      categories: CATEGORIES.slice(),
    });
  } catch (e) { next(e); }
});

router.get("/stats", async (_req, res, next) => {
  try {
    const r = await pool.query(`
      WITH per AS (
        SELECT s.id, s.slot_id, s.slot_confirmed, s.physical_reporting_completed,
               COUNT(d.id) AS total,
               COUNT(d.id) FILTER (WHERE d.student_status='ready')  AS ready,
               COUNT(d.id) FILTER (WHERE d.staff_status='verified') AS verified,
               COUNT(d.id) FILTER (WHERE d.student_status='issue')  AS issues,
               COUNT(d.id) FILTER (WHERE d.flagged)                 AS flagged
          FROM students s
          LEFT JOIN documents d
            ON d.student_id = s.id
           AND d.doc_code <> ALL($1::text[])
         GROUP BY s.id
      )
      SELECT
        COUNT(*)                                                              AS total,
        COUNT(*) FILTER (WHERE total>0 AND ready=total)                        AS docs_ready,
        COUNT(*) FILTER (WHERE issues>0)                                       AS open_issues,
        COUNT(*) FILTER (WHERE slot_id IS NOT NULL)                            AS booked,
        COUNT(*) FILTER (WHERE total>0 AND verified=total AND slot_confirmed)  AS cleared,
        COUNT(*) FILTER (WHERE physical_reporting_completed)                   AS reported,
        COUNT(*) FILTER (WHERE flagged>0)                                      AS flagged
      FROM per`, [EXCLUDE_FROM_COUNTS]);
    const contact = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE contact_completed_at IS NULL) AS contact_incomplete,
        COUNT(*) FILTER (WHERE contact_completed_at IS NOT NULL AND contact_verified_at IS NULL) AS contact_unverified
      FROM students`);
    const s = r.rows[0];
    const c = contact.rows[0];
    res.json({
      total: Number(s.total), docsReady: Number(s.docs_ready), openIssues: Number(s.open_issues),
      booked: Number(s.booked), cleared: Number(s.cleared),
      reported: Number(s.reported), flagged: Number(s.flagged),
      contactIncomplete: Number(c.contact_incomplete),
      contactUnverified: Number(c.contact_unverified),
    });
  } catch (e) { next(e); }
});

/* ---- STAFF (Supervisor) ---- */
router.get("/staff", requireSupervisor, async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT staff_id,name,role,created_at FROM admins ORDER BY id");
    res.json({ staff: r.rows.map((a) => ({ staffId: a.staff_id, name: a.name, role: a.role, createdAt: a.created_at })) });
  } catch (e) { next(e); }
});
router.post("/staff", requireSupervisor, async (req, res, next) => {
  try {
    const staffId = String(req.body.staffId || "").trim();
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
    const role = req.body.role === "supervisor" ? "supervisor" : "verifier";
    if (!staffId || !name || password.length < 8) return res.status(400).json({ error: "Staff ID, name, and a password of at least 8 characters are required." });
    const ex = await pool.query("SELECT 1 FROM admins WHERE LOWER(staff_id)=LOWER($1)", [staffId]);
    if (ex.rows.length) return res.status(409).json({ error: "That staff ID already exists." });
    const hash = await bcrypt.hash(password, 12);
    await pool.query("INSERT INTO admins (staff_id,name,password_hash,role) VALUES ($1,$2,$3,$4)", [staffId, name, hash, role]);
    await audit(req, "admin", req.admin.staffId, "STAFF_ADDED", `${staffId} (${role})`);
    res.json({ ok: true, staff: { staffId, name, role } });
  } catch (e) { next(e); }
});
router.get("/audit", requireSupervisor, async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT actor_type, actor_id, action, detail, ip, created_at FROM audit_log ORDER BY id DESC LIMIT 100");
    res.json({ events: r.rows });
  } catch (e) { next(e); }
});

/* ---- SYSTEM SETTINGS (v7) ---- */
router.get("/settings", async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT key, value FROM system_settings");
    const map = {};
    r.rows.forEach((row) => { map[row.key] = row.value; });
    if (!map.blacklist_policy) map.blacklist_policy = "warn";
    res.json({ settings: map });
  } catch (e) { next(e); }
});
router.patch("/settings/:key", requireSupervisor, async (req, res, next) => {
  try {
    const key = String(req.params.key || "");
    const value = String(req.body.value == null ? "" : req.body.value);
    if (key === "blacklist_policy" && !["warn", "block"].includes(value)) {
      return res.status(400).json({ error: "Policy must be 'warn' or 'block'." });
    }
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [key, value]
    );
    await audit(req, "admin", req.admin.staffId, "SETTING_CHANGED", `${key}=${value}`);
    res.json({ ok: true, key, value });
  } catch (e) { next(e); }
});

/* ---- BLACKLIST ---- */
router.get("/blacklist", async (_req, res, next) => {
  try { const r = await pool.query("SELECT id,name,region,reason,created_at FROM blacklist_institutions ORDER BY name"); res.json({ entries: r.rows }); }
  catch (e) { next(e); }
});
router.post("/blacklist", requireSupervisor, async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const region = req.body.region ? String(req.body.region).trim() : null;
    const reason = req.body.reason ? String(req.body.reason).trim() : null;
    if (!name) return res.status(400).json({ error: "Institution name is required." });
    const norm = normalize(name);
    if (!norm) return res.status(400).json({ error: "Institution name is too short." });
    try {
      const r = await pool.query(
        `INSERT INTO blacklist_institutions (name,name_normalized,region,reason,created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,name,region,reason`,
        [name, norm, region, reason, req.admin.id]);
      await audit(req, "admin", req.admin.staffId, "BLACKLIST_ADD", name);
      res.json({ entry: r.rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "That institution is already on the blacklist." });
      throw err;
    }
  } catch (e) { next(e); }
});
router.delete("/blacklist/:id", requireSupervisor, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await pool.query("DELETE FROM blacklist_institutions WHERE id=$1 RETURNING name", [id]);
    if (!r.rows.length) return res.status(404).json({ error: "Entry not found." });
    await audit(req, "admin", req.admin.staffId, "BLACKLIST_REMOVE", r.rows[0].name);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.get("/flagged-cases", async (_req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT f.id, f.institution, f.matched_name, f.reason, f.created_at,
             s.app_no, s.name, s.program, s.department, s.section, d.doc_code
        FROM flagged_cases f
        JOIN students s ON s.id = f.student_id
        LEFT JOIN documents d ON d.id = f.document_id
       ORDER BY f.id DESC LIMIT 200`);
    res.json({ cases: r.rows });
  } catch (e) { next(e); }
});

/* ---- SLOT MANAGEMENT (carry-over from v6/v7) ---- */
router.get("/slots", async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT id, slot_date, slot_time, capacity, booked, enabled, status, duration_minutes FROM slots ORDER BY slot_date, slot_time");
    res.json({ slots: r.rows.map(serializeSlot) });
  } catch (e) { next(e); }
});
router.get("/slots/stats", async (_req, res, next) => {
  try {
    const overall = await pool.query(`
      SELECT COUNT(*) AS total_slots, COALESCE(SUM(capacity),0) AS total_capacity, COALESCE(SUM(booked),0) AS total_booked,
        COUNT(*) FILTER (WHERE status='open' AND booked < capacity) AS slots_open,
        COUNT(*) FILTER (WHERE status='open' AND booked >= capacity) AS slots_full,
        COUNT(*) FILTER (WHERE status='hidden') AS slots_hidden,
        COUNT(*) FILTER (WHERE status='closed') AS slots_closed
      FROM slots`);
    const perDate = await pool.query(`
      SELECT slot_date, COUNT(*) AS slots, COALESCE(SUM(capacity),0) AS capacity, COALESCE(SUM(booked),0) AS booked,
        COUNT(*) FILTER (WHERE status='open') AS open_slots,
        COUNT(*) FILTER (WHERE status='hidden') AS hidden_slots,
        COUNT(*) FILTER (WHERE status='closed') AS closed_slots
      FROM slots GROUP BY slot_date ORDER BY slot_date`);
    const o = overall.rows[0];
    const totalCap = Number(o.total_capacity), totalBkd = Number(o.total_booked);
    res.json({
      overall: { totalSlots: Number(o.total_slots), totalCapacity: totalCap, totalBooked: totalBkd,
        utilizationPct: totalCap ? Math.round((totalBkd / totalCap) * 100) : 0,
        slotsOpen: Number(o.slots_open), slotsFull: Number(o.slots_full),
        slotsHidden: Number(o.slots_hidden), slotsClosed: Number(o.slots_closed) },
      byDate: perDate.rows.map((d) => { const cap = Number(d.capacity), bkd = Number(d.booked); return { date: d.slot_date, slots: Number(d.slots), capacity: cap, booked: bkd, utilizationPct: cap ? Math.round((bkd / cap) * 100) : 0, open: Number(d.open_slots), hidden: Number(d.hidden_slots), closed: Number(d.closed_slots) }; }),
    });
  } catch (e) { next(e); }
});
router.post("/slots", requireSupervisor, async (req, res, next) => {
  try {
    const date = String(req.body.date || "").trim();
    const time = String(req.body.time || "").trim();
    const capacity = parseInt(req.body.capacity, 10);
    const duration = req.body.durationMinutes != null ? parseInt(req.body.durationMinutes, 10) : 30;
    const status = SLOT_STATUSES.includes(req.body.status) ? req.body.status : "open";
    if (!isDate(date)) return res.status(400).json({ error: "A valid date (YYYY-MM-DD) is required." });
    const newMin = parseTime(time);
    if (newMin === null) return res.status(400).json({ error: "Time must look like '09:30 AM' or '14:00'." });
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 1000) return res.status(400).json({ error: "Capacity must be between 1 and 1000." });
    if (!Number.isFinite(duration) || duration < 5 || duration > 480) return res.status(400).json({ error: "Duration must be between 5 and 480 minutes." });
    const ex = await pool.query("SELECT slot_time FROM slots WHERE slot_date=$1", [date]);
    for (const row of ex.rows) {
      const m = parseTime(row.slot_time);
      if (m !== null && Math.abs(m - newMin) < 30) return res.status(409).json({ error: "Slots on the same day must be at least 30 minutes apart." });
    }
    try {
      const r = await pool.query(
        `INSERT INTO slots (slot_date, slot_time, capacity, booked, enabled, status, duration_minutes)
         VALUES ($1,$2,$3,0,$4,$5,$6) RETURNING id`,
        [date, time, capacity, status === "open", status, duration]
      );
      await audit(req, "admin", req.admin.staffId, "SLOT_ADDED", `${date} ${time} (cap ${capacity}, ${duration}min, ${status})`);
      res.json({ ok: true, id: r.rows[0].id });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "A slot with that date and time already exists." });
      throw err;
    }
  } catch (e) { next(e); }
});
router.patch("/slots/:id", requireSupervisor, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sr = await pool.query("SELECT * FROM slots WHERE id=$1", [id]);
    const slot = sr.rows[0];
    if (!slot) return res.status(404).json({ error: "Slot not found." });
    const b = req.body || {};
    const newCapacity = (b.capacity != null) ? parseInt(b.capacity, 10) : null;
    const newDuration = (b.durationMinutes != null) ? parseInt(b.durationMinutes, 10) : null;
    let newStatus = null;
    if (b.status != null) {
      if (!SLOT_STATUSES.includes(b.status)) return res.status(400).json({ error: "Status must be 'open', 'hidden' or 'closed'." });
      newStatus = b.status;
    } else if (b.enabled != null) { newStatus = b.enabled === false ? "hidden" : "open"; }
    if (newCapacity !== null && (!Number.isFinite(newCapacity) || newCapacity < 1 || newCapacity > 1000)) return res.status(400).json({ error: "Capacity must be between 1 and 1000." });
    if (newCapacity !== null && newCapacity < slot.booked) return res.status(409).json({ error: `${slot.booked} students are already booked — capacity cannot drop below that.` });
    if (newDuration !== null && (!Number.isFinite(newDuration) || newDuration < 5 || newDuration > 480)) return res.status(400).json({ error: "Duration must be between 5 and 480 minutes." });
    await pool.query(
      `UPDATE slots SET capacity = COALESCE($1, capacity), status = COALESCE($2, status),
         enabled = COALESCE($3, enabled), duration_minutes = COALESCE($4, duration_minutes) WHERE id=$5`,
      [newCapacity, newStatus, newStatus === null ? null : (newStatus === "open"), newDuration, id]
    );
    await audit(req, "admin", req.admin.staffId, "SLOT_EDITED", `#${id} cap=${newCapacity ?? slot.capacity} status=${newStatus ?? slot.status}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.delete("/slots/:id", requireSupervisor, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sr = await pool.query("SELECT * FROM slots WHERE id=$1", [id]);
    const slot = sr.rows[0];
    if (!slot) return res.status(404).json({ error: "Slot not found." });
    if (slot.booked > 0) return res.status(409).json({ error: "Cannot delete a slot with students already booked into it." });
    await pool.query("DELETE FROM slots WHERE id=$1", [id]);
    await audit(req, "admin", req.admin.staffId, "SLOT_DELETED", `${slot.slot_date} ${slot.slot_time}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.post("/slots/bulk-status", requireSupervisor, async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!SLOT_STATUSES.includes(status)) return res.status(400).json({ error: "Status must be 'open', 'hidden' or 'closed'." });
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite) : null;
    const dates = Array.isArray(req.body.dates) ? req.body.dates.filter(isDate) : null;
    if ((!ids || !ids.length) && (!dates || !dates.length)) return res.status(400).json({ error: "Provide either an 'ids' or 'dates' array." });
    let changed = 0;
    if (ids && ids.length) {
      const r = await pool.query(`UPDATE slots SET status=$1, enabled=$2 WHERE id = ANY($3::int[]) RETURNING id`, [status, status === "open", ids]);
      changed += r.rowCount;
    }
    if (dates && dates.length) {
      const r = await pool.query(`UPDATE slots SET status=$1, enabled=$2 WHERE slot_date = ANY($3::date[]) RETURNING id`, [status, status === "open", dates]);
      changed += r.rowCount;
    }
    await audit(req, "admin", req.admin.staffId, "SLOT_BULK_STATUS", `set ${changed} slot(s) to ${status}`);
    res.json({ ok: true, changed });
  } catch (e) { next(e); }
});

/* ---- STUDENT PIPELINE (v8 — mandatory-only counts) ---- */
router.get("/students", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const r = await pool.query(
      `SELECT s.app_no, s.name, s.dob, s.program, s.department, s.section, s.batch,
              s.profile, s.declared, s.slot_confirmed, s.slot_rejected, s.physical_reporting_completed,
              s.assigned_verification_date, s.assigned_batch, s.upload_completed_at,
              s.contact_completed_at, s.contact_verified_at,
              vs.status AS verify_status, vs.verified_at AS verify_verified_at,
              sl.slot_date, sl.slot_time,
              COUNT(d.id)                                          AS total,
              COUNT(d.id) FILTER (WHERE d.file_public_id IS NOT NULL) AS uploaded,
              COUNT(d.id) FILTER (WHERE d.student_status='ready')  AS ready,
              COUNT(d.id) FILTER (WHERE d.staff_status='verified') AS verified,
              COUNT(d.id) FILTER (WHERE d.staff_status='rejected') AS rejected,
              COUNT(d.id) FILTER (WHERE d.student_status='issue')  AS issues,
              COUNT(d.id) FILTER (WHERE d.flagged)                 AS flagged
         FROM students s
         LEFT JOIN documents d
           ON d.student_id = s.id
          AND d.doc_code <> ALL($1::text[])
         LEFT JOIN slots sl ON sl.id = s.slot_id
         LEFT JOIN verify_schedule vs ON vs.id = s.verify_schedule_id
        GROUP BY s.id, sl.slot_date, sl.slot_time, vs.status, vs.verified_at,
                 s.contact_completed_at, s.contact_verified_at
        ORDER BY s.app_no`, [EXCLUDE_FROM_COUNTS]
    );
    let rows = r.rows.map((x) => {
      const total = Number(x.total), verified = Number(x.verified), flagged = Number(x.flagged);
      return {
        appNo: x.app_no, name: x.name, dob: x.dob, program: x.program,
        department: x.department, section: x.section, batch: x.batch, profile: x.profile,
        declared: x.declared, slotConfirmed: x.slot_confirmed, slotRejected: x.slot_rejected,
        physicalReportingCompleted: x.physical_reporting_completed,
        slot: x.slot_date ? { date: x.slot_date, time: x.slot_time } : null,
        assignedVerificationDate: x.assigned_verification_date,
        assignedBatch: x.assigned_batch,
        uploadCompletedAt: x.upload_completed_at,
        verifyStatus: x.verify_status,
        verifyVerifiedAt: x.verify_verified_at,
        contactCompleted: !!x.contact_completed_at,
        contactVerified: !!x.contact_verified_at,
        total, uploaded: Number(x.uploaded), ready: Number(x.ready),
        verified, rejected: Number(x.rejected), issues: Number(x.issues),
        flagged, cleared: total > 0 && verified === total && x.slot_confirmed,
      };
    });
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.appNo.toLowerCase().includes(q) || (r.program || "").toLowerCase().includes(q));
    res.json({ students: rows });
  } catch (e) { next(e); }
});

/** GET /api/admin/students/export.xlsx — roster with contact details + progress (respects filters). */
router.get("/students/export.xlsx", async (req, res, next) => {
  try {
    const filters = {
      department: String(req.query.department || "").trim(),
      section: String(req.query.section || "").trim(),
      batch: String(req.query.batch || "").trim(),
      status: String(req.query.status || "").trim(),
      contact: String(req.query.contact || "").trim(),
      q: String(req.query.q || "").trim(),
    };
    const rows = await queryStudentExportRows(pool, filters, EXCLUDE_FROM_COUNTS);
    const buf = await buildExportBuffer(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="students-export-${stamp}.xlsx"`);
    await audit(req, "admin", req.admin.staffId, "STUDENTS_EXPORT", `rows=${rows.length}`);
    res.send(buf);
  } catch (e) { next(e); }
});

/** GET /api/admin/students/login-roster.xlsx — application number + DOB (+ name) for all students. */
router.get("/students/login-roster.xlsx", async (req, res, next) => {
  try {
    const filters = {
      department: String(req.query.department || "").trim(),
      section: String(req.query.section || "").trim(),
      batch: String(req.query.batch || "").trim(),
      status: String(req.query.status || "").trim(),
      contact: String(req.query.contact || "").trim(),
      q: String(req.query.q || "").trim(),
    };
    const rows = await queryStudentExportRows(pool, filters, EXCLUDE_FROM_COUNTS);
    const buf = await buildLoginRosterBuffer(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="student-login-roster-${stamp}.xlsx"`);
    await audit(req, "admin", req.admin.staffId, "LOGIN_ROSTER_EXPORT", `rows=${rows.length}`);
    res.send(buf);
  } catch (e) { next(e); }
});

router.post("/students", requireSupervisor, async (req, res, next) => {
  try {
    const b = req.body || {};
    const appNo = String(b.appNo || "").trim();
    const name = String(b.name || "").trim();
    const dob = String(b.dob || "").trim();
    const program = String(b.program || "").trim();
    const profile = String(b.profile || "").trim().toUpperCase();
    if (!appNo || !name || !isDate(dob) || !program) return res.status(400).json({ error: "Application number, name, a valid date of birth, and program are required." });
    if (!isValidProfile(profile)) return res.status(400).json({ error: "Profile must be UG or PG." });
    /* v8 — soft-validate category if provided (free text still accepted for legacy data) */
    const category = b.category ? String(b.category).trim() : null;
    const verificationDate = isDate(b.verificationDate) ? b.verificationDate
      : (isDate(b.orientationDate) ? b.orientationDate : null);
    const ex = await pool.query("SELECT 1 FROM students WHERE LOWER(app_no)=LOWER($1)", [appNo]);
    if (ex.rows.length) return res.status(409).json({ error: "A student with that application number already exists." });
    const ins = await pool.query(
      `INSERT INTO students (app_no,name,dob,email,phone,program,department,batch,category,section,profile,orientation_date,assigned_verification_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [appNo, name, dob, b.email ? String(b.email).trim() : null, b.phone ? String(b.phone).trim() : null,
        program, b.department ? String(b.department).trim() : null, b.batch ? String(b.batch).trim() : null,
        category, b.section ? String(b.section).trim() : null,
        profile, isDate(b.orientationDate) ? b.orientationDate : null, verificationDate]
    );
    await ensureDocuments(ins.rows[0].id, profile, category);
    await audit(req, "admin", req.admin.staffId, "STUDENT_ADDED", `${appNo} (${profile})`);
    res.json({ ok: true, appNo });
  } catch (e) { next(e); }
});

router.get("/students/:appNo/documents.zip", async (req, res, next) => {
  try {
    const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: "Student not found." });
    /* v8 — include uploaded files EXCEPT legacy/removed codes. Optional docs
       (MIGRATION, TC) are included when present. */
    const dr = await pool.query(
      `SELECT * FROM documents
        WHERE student_id=$1 AND file_public_id IS NOT NULL
          AND doc_code <> ALL($2::text[])
        ORDER BY id`,
      [s.id, LEGACY_DOC_CODES]
    );
    if (!dr.rows.length) return res.status(404).json({ error: "This student has not uploaded any documents yet." });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${s.app_no}-documents.zip"`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("ZIP archive error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "Could not build the ZIP file." });
      else res.destroy(err);
    });
    archive.pipe(res);
    for (const d of dr.rows) {
      try {
        const buf = await fetchAssetBuffer(d);
        if (buf) {
          const label = (DOC_META[d.doc_code]?.name || d.doc_code).replace(/[^a-z0-9]+/gi, "_");
          archive.append(buf, { name: `${d.doc_code}_${label}.${d.file_format || "pdf"}` });
        }
      } catch (err) { console.warn("ZIP: skipped", d.doc_code, err.message); }
    }
    await audit(req, "admin", req.admin.staffId, "BULK_DOWNLOAD", s.app_no);
    await archive.finalize();
  } catch (e) { next(e); }
});

router.get("/students/:appNo", async (req, res, next) => {
  try {
    const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: "Student not found." });
    /* v8 — backfill docs in case checklist evolved while student was active. */
    await ensureDocuments(s.id, s.profile, s.category);
    const docCtx = { profile: s.profile, category: s.category };
    const dr = await pool.query(
      `SELECT ${DOC_SELECT_WITH_VERIFIER} FROM documents d ${DOC_JOIN_VERIFIER} WHERE d.student_id=$1 ORDER BY d.id`,
      [s.id]);
    let slot = null;
    if (s.slot_id) {
      const slr = await pool.query("SELECT * FROM slots WHERE id=$1", [s.slot_id]);
      if (slr.rows[0]) slot = { id: slr.rows[0].id, date: slr.rows[0].slot_date, time: slr.rows[0].slot_time, durationMinutes: slr.rows[0].duration_minutes };
    }
    /* v22 — include verification slot info (auto-allocated) */
    let verifySlot = null;
    if (s.verify_schedule_id) {
      const vr = await pool.query("SELECT * FROM verify_schedule WHERE id=$1", [s.verify_schedule_id]);
      if (vr.rows[0]) {
        verifySlot = {
          id: vr.rows[0].id,
          date: vr.rows[0].schedule_date,
          room: vr.rows[0].room,
          slotNo: vr.rows[0].slot_no,
          startTime: vr.rows[0].start_time,
          endTime: vr.rows[0].end_time,
          status: vr.rows[0].status,
          verifiedAt: vr.rows[0].verified_at,
          remarks: vr.rows[0].remarks || null,
        };
      }
    }
    res.json({
      student: {
        appNo: s.app_no, name: s.name, dob: s.dob, email: s.email, phone: s.phone,
        program: s.program, department: s.department, batch: s.batch,
        category: s.category, section: s.section, profile: s.profile,
        orientationDate: s.orientation_date, admissionStatus: s.admission_status,
        declared: s.declared, slotConfirmed: s.slot_confirmed,
        slotRejected: s.slot_rejected, slotRejectReason: s.slot_reject_reason || null,
        physicalReportingCompleted: s.physical_reporting_completed,
        physicalReportingAt: s.physical_reporting_at,
        pendingDocs: s.pending_docs || "",
        submissionDeadline: s.submission_deadline || null,
        assignedVerificationDate: s.assigned_verification_date,
        assignedBatch: s.assigned_batch,
        uploadCompletedAt: s.upload_completed_at,
        ...serializeContact(s),
      },
      /* v8 — hide legacy doc codes from admin view (PAN/BANK/CASTE/MEDICAL). */
      documents: filterVisible(dr.rows).map((d) => serializeDocAdmin(d, docCtx)),
      slot,
      verifySlot,
      followupRemarks: await listFollowupRemarks(s.id),
    });
  } catch (e) { next(e); }
});

router.patch("/students/:appNo", requireSupervisor, async (req, res, next) => {
  try {
    const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: "Student not found." });
    const b = req.body || {};
    await pool.query(
      `UPDATE students SET name=COALESCE($1,name), email=COALESCE($2,email), phone=COALESCE($3,phone),
         program=COALESCE($4,program), department=COALESCE($5,department), batch=COALESCE($6,batch),
         category=COALESCE($7,category), section=COALESCE($8,section),
         orientation_date=COALESCE($9,orientation_date) WHERE id=$10`,
      [b.name || null, b.email || null, b.phone || null, b.program || null,
       b.department || null, b.batch || null, b.category || null, b.section || null,
       isDate(b.orientationDate) ? b.orientationDate : null, s.id]
    );
    const fresh = await pool.query("SELECT profile, category FROM students WHERE id=$1", [s.id]);
    await ensureDocuments(s.id, fresh.rows[0].profile, fresh.rows[0].category);
    await audit(req, "admin", req.admin.staffId, "STUDENT_EDITED", s.app_no);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/students/delete", requireSupervisor, async (req, res, next) => {
  try {
    const appNos = Array.isArray(req.body?.appNos) ? req.body.appNos : [];
    if (!appNos.length) return res.status(400).json({ error: "Select at least one student to delete." });
    if (appNos.length > 200) return res.status(400).json({ error: "Maximum 200 students per delete request." });
    const { deleted, notFound } = await deleteStudentsByAppNos(pool, appNos);
    if (!deleted.length) {
      return res.status(404).json({ error: "No matching students found.", notFound });
    }
    await audit(req, "admin", req.admin.staffId, "STUDENT_DELETED", `bulk (${deleted.length}): ${deleted.join(", ")}`);
    res.json({ ok: true, deleted: deleted.length, appNos: deleted, notFound });
  } catch (e) { next(e); }
});

router.delete("/students/:appNo", requireSupervisor, async (req, res, next) => {
  try {
    const { deleted, notFound } = await deleteStudentsByAppNos(pool, [req.params.appNo]);
    if (!deleted.length) return res.status(404).json({ error: notFound.length ? "Student not found." : "Student not found." });
    await audit(req, "admin", req.admin.staffId, "STUDENT_DELETED", deleted[0]);
    res.json({ ok: true, deleted: deleted.length, appNos: deleted });
  } catch (e) { next(e); }
});

/* ---- DOCUMENT VERIFY / REJECT ---- */
router.get("/documents/:id/preview", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid document id." });
    const dr = await pool.query("SELECT * FROM documents WHERE id=$1", [id]);
    const doc = dr.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found." });
    await streamDoc(res, doc, { attachment: false });
  } catch (e) { next(e); }
});

router.patch("/documents/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String(req.body.staffStatus || "");
    const note = req.body.staffNote == null ? null : String(req.body.staffNote).trim() || null;
    const physicalSubmission = req.body.physicalSubmission == null
      ? null
      : String(req.body.physicalSubmission).trim() || null;
    if (!["verified", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid verification status." });
    }
    if (physicalSubmission && !PHYSICAL_SUBMISSION_VALUES.includes(physicalSubmission)) {
      return res.status(400).json({ error: "Invalid physical submission value." });
    }
    const dr = await pool.query("SELECT * FROM documents WHERE id=$1", [id]);
    const doc = dr.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found." });
    if (!doc.file_public_id) return res.status(400).json({ error: "The student has not uploaded this document yet." });
    if (status === "rejected") {
      await pool.query(
        `UPDATE documents SET staff_status='rejected', staff_note=$1, verified_by=$2, verified_at=now(),
            physical_submission=COALESCE($5, physical_submission),
            student_status='issue', issue_note=$3, updated_at=now() WHERE id=$4`,
        [note || "Rejected by verification staff.", req.admin.id,
         note || "Rejected by verification staff. Please re-upload a correct copy.", id, physicalSubmission]
      );
      const sr = await pool.query("SELECT profile, category FROM students WHERE id=$1", [doc.student_id]);
      const mandatory = checklistFor(sr.rows[0]?.profile, sr.rows[0]?.category);
      if (mandatory.includes(doc.doc_code)) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE students SET declared=false, declared_at=NULL WHERE id=$1",
            [doc.student_id]
          );
          await releaseVerifySlotForStudent(client, doc.student_id);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      }
    } else if (status === "verified") {
      await pool.query(
        `UPDATE documents SET staff_status='verified', staff_note=$1, verified_by=$2, verified_at=now(),
            physical_submission=COALESCE($3, physical_submission),
            student_status='ready', issue_note=NULL, updated_at=now() WHERE id=$4`,
        [note, req.admin.id, physicalSubmission, id]
      );
      await maybeClearPending(doc.student_id);
    } else {
      await pool.query(
        `UPDATE documents SET staff_status='pending', staff_note=NULL, verified_by=NULL, verified_at=NULL,
            physical_submission=COALESCE($2, physical_submission),
            updated_at=now() WHERE id=$1`,
        [id, physicalSubmission]
      );
    }
    const fresh = await pool.query(`SELECT ${DOC_SELECT_WITH_VERIFIER} FROM documents d ${DOC_JOIN_VERIFIER} WHERE d.id=$1`, [id]);
    const sr = await pool.query("SELECT profile, category FROM students WHERE id=$1", [doc.student_id]);
    const docCtx = sr.rows[0] ? { profile: sr.rows[0].profile, category: sr.rows[0].category } : {};
    await audit(req, "admin", req.admin.staffId, "DOC_" + status.toUpperCase(), `doc#${id} (${doc.doc_code})`);
    res.json({ document: serializeDocAdmin(fresh.rows[0], docCtx) });
  } catch (e) { next(e); }
});

/* v7 — Undo verification (or undo a previous reject). Supervisor only, requires a reason. */
router.post("/documents/:id/undo", requireSupervisor, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Type a brief reason for the undo (any text)." });
    const dr = await pool.query("SELECT * FROM documents WHERE id=$1", [id]);
    const doc = dr.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found." });
    if (doc.staff_status !== "verified" && doc.staff_status !== "rejected") {
      return res.status(400).json({ error: "This document is not in a verified or rejected state." });
    }
    const prev = doc.staff_status;
    await pool.query(
      `UPDATE documents SET staff_status='pending', staff_note=NULL,
              verified_by=NULL, verified_at=NULL, physical_submission=NULL,
              student_status='pending', issue_note=NULL,
              updated_at=now() WHERE id=$1`,
      [id]
    );
    const sr0 = await pool.query("SELECT profile, category FROM students WHERE id=$1", [doc.student_id]);
    const mandatory = checklistFor(sr0.rows[0]?.profile, sr0.rows[0]?.category);
    if (mandatory.includes(doc.doc_code)) {
      await pool.query(
        "UPDATE students SET declared=false, declared_at=NULL WHERE id=$1",
        [doc.student_id]
      );
    }
    await audit(req, "admin", req.admin.staffId, "DOC_UNDO_" + prev.toUpperCase(),
      `doc#${id} (${doc.doc_code}): ${reason}`);
    const fresh = await pool.query(
      `SELECT ${DOC_SELECT_WITH_VERIFIER} FROM documents d ${DOC_JOIN_VERIFIER} WHERE d.id=$1`,
      [id]
    );
    const sr = await pool.query("SELECT profile, category FROM students WHERE id=$1", [doc.student_id]);
    const docCtx = sr.rows[0] ? { profile: sr.rows[0].profile, category: sr.rows[0].category } : {};
    res.json({ document: serializeDocAdmin(fresh.rows[0], docCtx) });
  } catch (e) { next(e); }
});

router.post("/students/:appNo/reject-slot", async (req, res, next) => {
  try {
    const reason = req.body.reason ? String(req.body.reason).trim() : null;
    const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: "Student not found." });
    if (!s.slot_id) return res.status(400).json({ error: "The student has not booked a slot to reject." });
    await pool.query("UPDATE slots SET booked=GREATEST(booked-1,0) WHERE id=$1", [s.slot_id]);
    await pool.query(
      `UPDATE students SET slot_id=NULL, slot_confirmed=false, slot_rejected=true, slot_reject_reason=$1 WHERE id=$2`,
      [reason || "Slot booking rejected by the verification cell. Please choose another.", s.id]
    );
    await audit(req, "admin", req.admin.staffId, "SLOT_REJECTED", `${s.app_no}: ${reason || ""}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/students/:appNo/verify-contact", async (req, res, next) => {
  try {
    const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: "Student not found." });
    if (!s.contact_completed_at) {
      return res.status(400).json({ error: "Student has not submitted contact details yet." });
    }
    const verified = req.body?.verified !== false;
    if (verified) {
      await pool.query(
        `UPDATE students SET contact_verified_at=now(), contact_verified_by=$1 WHERE id=$2`,
        [req.admin.id, s.id]
      );
      await audit(req, "admin", req.admin.staffId, "CONTACT_VERIFIED", s.app_no);
    } else {
      await pool.query(
        `UPDATE students SET contact_verified_at=NULL, contact_verified_by=NULL WHERE id=$1`,
        [s.id]
      );
      await audit(req, "admin", req.admin.staffId, "CONTACT_VERIFY_UNDONE", s.app_no);
    }
    res.json({ ok: true, contactVerified: verified });
  } catch (e) { next(e); }
});

router.post("/students/:appNo/physical-reporting", async (req, res, next) => {
  try {
    const completed = req.body.completed !== false;
    const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: "Student not found." });
    if (completed && !s.slot_confirmed) return res.status(400).json({ error: "The student does not have a confirmed slot yet." });
    await pool.query(
      `UPDATE students SET physical_reporting_completed=$1,
         physical_reporting_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$2`,
      [completed, s.id]);
    await audit(req, "admin", req.admin.staffId, completed ? "PHYSICAL_REPORTING_DONE" : "PHYSICAL_REPORTING_UNDONE", s.app_no);
    res.json({ ok: true, physicalReportingCompleted: completed });
  } catch (e) { next(e); }
});

router.post("/students/:appNo/pending-docs", async (req, res, next) => {
  try {
    const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: "Student not found." });
    const pendingDocs = req.body.pendingDocs == null ? null : String(req.body.pendingDocs).trim() || null;
    const deadline = req.body.deadline && isDate(req.body.deadline) ? req.body.deadline : null;
    await pool.query(`UPDATE students SET pending_docs=$1, submission_deadline=$2 WHERE id=$3`, [pendingDocs, deadline, s.id]);
    await audit(req, "admin", req.admin.staffId, "PENDING_DOCS_UPDATED", `${s.app_no}: ${pendingDocs || "cleared"}${deadline ? " (by " + deadline + ")" : ""}`);
    res.json({ ok: true, pendingDocs, submissionDeadline: deadline });
  } catch (e) { next(e); }
});

router.get("/students/:appNo/remarks", async (req, res, next) => {
  try {
    const sr = await pool.query("SELECT id FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    if (!sr.rows[0]) return res.status(404).json({ error: "Student not found." });
    res.json({ remarks: await listFollowupRemarks(sr.rows[0].id) });
  } catch (e) { next(e); }
});

router.post("/students/:appNo/remarks", async (req, res, next) => {
  try {
    const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [req.params.appNo]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: "Student not found." });
    const payload = validateFollowupPayload(req.body || {});
    if (payload.error) return res.status(400).json({ error: payload.error });
    const remark = await insertFollowupRemark(s.id, req.admin.id, payload);
    if (payload.expectedSubmissionDate) {
      await pool.query(
        "UPDATE students SET submission_deadline=$1 WHERE id=$2",
        [payload.expectedSubmissionDate, s.id]
      );
    }
    await audit(req, "admin", req.admin.staffId, "FOLLOWUP_REMARK_ADDED", `${s.app_no} remark#${remark.id}`);
    res.json({ ok: true, remark });
  } catch (e) { next(e); }
});

module.exports = router;
