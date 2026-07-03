/* Student routes  ->  /api/student/*  (v9)
   v9 changes:
   - Document review uses a SINGLE confirmation flag (selfVerify.confirmed).
   - Legacy 6-checkbox payloads still accepted (isConfirmed treats all-six-true
     as confirmed).
   - Strict dependency workflow enforced on the backend:
       Mandatory docs all Ready  →  /declare allowed
       Declared + Mandatory Ready →  /slot allowed
*/
const express = require("express");
const { pool } = require("../config/db");
const { requireStudent } = require("../middleware/auth");
const { uploadLimiter } = require("../middleware/security");
const { singleFile, formatForMime } = require("../middleware/upload");
const { uploadBuffer, destroyAsset, isConfigured } = require("../config/storage");
const { streamDoc } = require("../lib/docStream");
const { audit } = require("../lib/audit");
const {
  ensureDocuments, filterForProfile, serializeDoc, isConfirmed, CONFIRM_KEY,
  DOC_SELECT_WITH_VERIFIER, DOC_JOIN_VERIFIER,
} = require("../lib/docs");
const { checkAgainstBlacklist } = require("../lib/blacklist");
const { tryAllocateVerifySlot } = require("../lib/verifyAlloc");
const { DOC_META, checklistFor, isLegacyCode } = require("../config/checklists");
const { validateContactPayload, serializeContact } = require("../lib/contact");
const { portalPayload } = require("../lib/portalAccess");

const router = express.Router();
router.use(requireStudent);

const CONTACT_REQUIRED_MSG = "Complete your contact details before continuing.";

async function requireContactCompleted(studentId) {
  const r = await pool.query("SELECT contact_completed_at FROM students WHERE id=$1", [studentId]);
  return !!r.rows[0]?.contact_completed_at;
}

async function readSetting(key, fallback) {
  try {
    const r = await pool.query("SELECT value FROM system_settings WHERE key=$1", [key]);
    return r.rows[0]?.value ?? fallback;
  } catch { return fallback; }
}

async function studentDocContext(studentId) {
  const r = await pool.query("SELECT profile, category, program FROM students WHERE id=$1", [studentId]);
  const s = r.rows[0];
  return s ? { profile: s.profile, category: s.category, program: s.program } : {};
}

async function loadState(studentId) {
  const sr = await pool.query("SELECT * FROM students WHERE id=$1", [studentId]);
  const s = sr.rows[0]; if (!s) return null;
  await ensureDocuments(s.id, s.profile, s.category, s.program);
  const dr = await pool.query(
    `SELECT ${DOC_SELECT_WITH_VERIFIER} FROM documents d ${DOC_JOIN_VERIFIER} WHERE d.student_id=$1 ORDER BY d.id`,
    [s.id]
  );
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
  let slot = null;
  if (s.slot_id) {
    const slr = await pool.query("SELECT * FROM slots WHERE id=$1", [s.slot_id]);
    if (slr.rows[0]) slot = {
      id: slr.rows[0].id, date: slr.rows[0].slot_date, time: slr.rows[0].slot_time,
      durationMinutes: slr.rows[0].duration_minutes,
    };
  }
  return {
    student: {
      appNo: s.app_no, name: s.name, program: s.program, category: s.category, section: s.section,
      profile: s.profile, orientationDate: s.orientation_date, admissionStatus: s.admission_status,
      declared: s.declared,
      declaredAt: s.declared_at || null,
      slotConfirmed: s.slot_confirmed,
      slotRejected: s.slot_rejected, slotRejectReason: s.slot_reject_reason || null,
      pendingDocs: s.pending_docs || null,
      submissionDeadline: s.submission_deadline || null,
      physicalReportingCompleted: s.physical_reporting_completed,
      assignedVerificationDate: s.assigned_verification_date,
      assignedBatch: s.assigned_batch,
      uploadCompletedAt: s.upload_completed_at,
      ...serializeContact(s),
    },
    documents: filterForProfile(dr.rows, s.profile, s.category, s.program).map((d) => serializeDoc(d, { profile: s.profile, category: s.category, program: s.program })),
    slot,
    verifySlot,
  };
}

async function applyBlacklistCheck(docId, institutionName) {
  if (!institutionName || !institutionName.trim()) {
    await pool.query("UPDATE documents SET institution_name=NULL, flagged=false, flag_match=NULL, flag_remarks=NULL, flagged_at=NULL WHERE id=$1", [docId]);
    return null;
  }
  const match = await checkAgainstBlacklist(institutionName);
  if (match) {
    await pool.query(
      `UPDATE documents SET institution_name=$1, flagged=true, flag_match=$2, flag_remarks=$3, flagged_at=now() WHERE id=$4`,
      [institutionName, match.name,
       `Auto-flagged: matches "${match.name}" (${match.region || "blacklist"}). Verification required.`,
       docId]
    );
    const doc = await pool.query("SELECT student_id FROM documents WHERE id=$1", [docId]);
    if (doc.rows[0]) {
      await pool.query(
        `INSERT INTO flagged_cases (student_id, document_id, institution, matched_name, reason) VALUES ($1,$2,$3,$4,$5)`,
        [doc.rows[0].student_id, docId, institutionName, match.name, "Blacklist match (auto)"]
      );
    }
    return match;
  } else {
    await pool.query(
      `UPDATE documents SET institution_name=$1, flagged=false, flag_match=NULL, flag_remarks=NULL, flagged_at=NULL WHERE id=$2`,
      [institutionName, docId]
    );
    return null;
  }
}

router.get("/me", async (req, res, next) => {
  try {
    const state = await loadState(req.student.id);
    if (!state) return res.status(404).json({ error: "Student record not found." });
    res.json({
      ...state,
      portal: portalPayload(req.portalAccess),
    });
  } catch (e) { next(e); }
});

router.get("/documents/:code/preview", async (req, res, next) => {
  try {
    const code = String(req.params.code || "").toUpperCase();
    if (isLegacyCode(code)) return res.status(404).json({ error: "Document not found." });
    const dr = await pool.query("SELECT * FROM documents WHERE student_id=$1 AND doc_code=$2", [req.student.id, code]);
    const doc = dr.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found in your checklist." });
    await streamDoc(res, doc, { attachment: false });
  } catch (e) { next(e); }
});

router.get("/documents/:code/download", async (req, res, next) => {
  try {
    const code = String(req.params.code || "").toUpperCase();
    if (isLegacyCode(code)) return res.status(404).json({ error: "Document not found." });
    const dr = await pool.query("SELECT * FROM documents WHERE student_id=$1 AND doc_code=$2", [req.student.id, code]);
    const doc = dr.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found in your checklist." });
    await streamDoc(res, doc, { attachment: true });
  } catch (e) { next(e); }
});

router.post("/contact", async (req, res, next) => {
  try {
    const sr = await pool.query(
      `SELECT s.contact_verified_at, s.physical_reporting_completed, vs.status AS verify_status
         FROM students s
         LEFT JOIN verify_schedule vs ON vs.id = s.verify_schedule_id
         WHERE s.id=$1`,
      [req.student.id]
    );
    const row = sr.rows[0];
    if (row?.contact_verified_at) {
      return res.status(400).json({ error: "Contact details were verified by staff and cannot be changed online. Contact the verification cell." });
    }
    if (row?.verify_status === "verified" || row?.verify_status === "absent" || row?.physical_reporting_completed) {
      return res.status(400).json({ error: "Contact details are locked after campus verification. Contact the verification cell to request changes." });
    }
    const v = validateContactPayload(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
    const { email, phone, parentName, parentRelation, parentEmail, parentPhone } = v.data;
    await pool.query(
      `UPDATE students SET
         email=$1, phone=$2,
         parent_name=$3, parent_relation=$4, parent_email=$5, parent_phone=$6,
         contact_completed_at=now()
       WHERE id=$7`,
      [email, phone, parentName, parentRelation, parentEmail, parentPhone, req.student.id]
    );
    await audit(req, "student", req.student.appNo, "CONTACT_SAVED", `${email} / parent: ${parentEmail}`);
    const state = await loadState(req.student.id);
    res.json(state);
  } catch (e) { next(e); }
});

router.post("/documents/:code/upload", uploadLimiter, singleFile("file"), async (req, res, next) => {
  try {
    if (!await requireContactCompleted(req.student.id)) {
      return res.status(403).json({ error: CONTACT_REQUIRED_MSG });
    }
    if (!isConfigured()) return res.status(503).json({ error: "Document storage is not configured. Contact the admin office." });
    if (!req.file) return res.status(400).json({ error: "No file received." });
    const code = String(req.params.code || "").toUpperCase();
    if (isLegacyCode(code)) return res.status(400).json({ error: "This document is no longer required." });
    const dr = await pool.query("SELECT * FROM documents WHERE student_id=$1 AND doc_code=$2", [req.student.id, code]);
    const doc = dr.rows[0];
    if (!doc) return res.status(404).json({ error: "This document is not part of your checklist." });
    if (doc.file_public_id && doc.staff_status === "verified") {
      return res.status(400).json({ error: "This document was accepted by staff and cannot be replaced. Contact the verification cell." });
    }
    if (doc.file_public_id && doc.student_status === "ready" && doc.staff_status !== "rejected") {
      return res.status(400).json({ error: "This document has been self-verified and cannot be replaced. Contact the verification cell if you need to change it." });
    }
    if (doc.file_public_id) await destroyAsset(doc.file_public_id, doc.file_resource_type);
    const result = await uploadBuffer(req.file.buffer, req.student.appNo, code);
    const ext = formatForMime(req.file.mimetype, code) || result.format;
    await pool.query(
      `UPDATE documents SET file_public_id=$1, file_resource_type=$2, file_format=$3,
                file_name=$4, file_size=$5, student_status='pending', staff_status='pending',
                staff_note=NULL, issue_note=NULL, verified_by=NULL, verified_at=NULL,
                physical_submission=NULL,
                self_verify='{}'::jsonb, updated_at=now() WHERE id=$6`,
      [result.public_id, result.resource_type, ext, req.file.originalname, req.file.size, doc.id]
    );
    const fresh = await pool.query(`SELECT ${DOC_SELECT_WITH_VERIFIER} FROM documents d ${DOC_JOIN_VERIFIER} WHERE d.id=$1`, [doc.id]);
    await audit(req, "student", req.student.appNo, "DOC_UPLOAD", `${code} (${req.file.originalname})`);
    const ctx = await studentDocContext(req.student.id);
    res.json({ document: serializeDoc(fresh.rows[0], ctx) });
  } catch (e) {
    const msg = String(e.message || "");
    if (/cloudinary|cloud name|invalid api|unknown api|azure|blob storage|storage account/i.test(msg)) {
      return res.status(503).json({
        error: "Upload failed on the server (storage not ready). Please try again shortly or contact the verification cell.",
      });
    }
    next(e);
  }
});

router.patch("/documents/:code", async (req, res, next) => {
  try {
    if (!await requireContactCompleted(req.student.id)) {
      return res.status(403).json({ error: CONTACT_REQUIRED_MSG });
    }
    const code = String(req.params.code || "").toUpperCase();
    if (isLegacyCode(code)) return res.status(400).json({ error: "This document is no longer required." });
    const { selfVerify, confirmed, status, issueNote, institutionName } = req.body;
    const dr = await pool.query("SELECT * FROM documents WHERE student_id=$1 AND doc_code=$2", [req.student.id, code]);
    const doc = dr.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found in your checklist." });
    if (doc.staff_status === "verified" && (status === "issue" || status === "ready")) {
      return res.status(400).json({ error: "This document was accepted by staff and cannot be changed online." });
    }

    /* v9 — accept either a `confirmed:boolean` shorthand OR a full selfVerify
       object. Preserve any prior keys so legacy data isn't clobbered. */
    const prev = doc.self_verify || {};
    let nextSV = (typeof selfVerify === "object" && selfVerify) ? { ...prev, ...selfVerify } : { ...prev };
    if (typeof confirmed === "boolean") nextSV[CONFIRM_KEY] = confirmed;

    const meta = DOC_META[code] || {};
    if (institutionName !== undefined) await applyBlacklistCheck(doc.id, institutionName);

    if (status === "ready") {
      if (!doc.file_public_id) return res.status(400).json({ error: "Upload the file before confirming." });
      if (!isConfirmed(nextSV)) {
        return res.status(400).json({ error: "Please tick the confirmation before saving the document." });
      }
      const inst = institutionName !== undefined ? institutionName : doc.institution_name;
      if (meta.needsInstitution && (!inst || !String(inst).trim())) {
        return res.status(400).json({ error: "Enter the issuing institution / board before confirming." });
      }
      const fresh = await pool.query("SELECT flagged FROM documents WHERE id=$1", [doc.id]);
      if (fresh.rows[0]?.flagged) {
        const policy = await readSetting("blacklist_policy", "warn");
        if (policy === "block") {
          return res.status(400).json({
            error: "The institution you entered is non-recognised by the college policy. Please correct it before continuing — or contact the verification cell."
          });
        }
      }
      await pool.query(
        `UPDATE documents SET self_verify=$1, student_status='ready', issue_note=NULL, updated_at=now() WHERE id=$2`,
        [JSON.stringify(nextSV), doc.id]
      );
      await audit(req, "student", req.student.appNo, "DOC_CONFIRMED", code);
    } else if (status === "issue") {
      await pool.query(
        `UPDATE documents SET self_verify=$1, student_status='issue', issue_note=$2, updated_at=now() WHERE id=$3`,
        [JSON.stringify(nextSV), String(issueNote || "Issue reported by student"), doc.id]
      );
      await audit(req, "student", req.student.appNo, "DOC_ISSUE", `${code}: ${issueNote || ""}`);
    } else {
      await pool.query(`UPDATE documents SET self_verify=$1, updated_at=now() WHERE id=$2`, [JSON.stringify(nextSV), doc.id]);
    }
    const fresh = await pool.query(`SELECT ${DOC_SELECT_WITH_VERIFIER} FROM documents d ${DOC_JOIN_VERIFIER} WHERE d.id=$1`, [doc.id]);
    const ctx = await studentDocContext(req.student.id);
    res.json({ document: serializeDoc(fresh.rows[0], ctx) });
  } catch (e) { next(e); }
});

/* v9 — strict mandatory-only gate for declaration. Returns the list of
   missing doc codes so the frontend can render a precise message. */
router.post("/declare", async (req, res, next) => {
  try {
    if (!await requireContactCompleted(req.student.id)) {
      return res.status(403).json({ error: CONTACT_REQUIRED_MSG });
    }
    const existing = await pool.query("SELECT declared FROM students WHERE id=$1", [req.student.id]);
    if (existing.rows[0]?.declared) {
      return res.status(400).json({ error: "You have already signed the self-declaration. It is locked unless staff reject a document." });
    }
    const sr = await pool.query("SELECT profile, category, program FROM students WHERE id=$1", [req.student.id]);
    const profile = sr.rows[0]?.profile;
    const category = sr.rows[0]?.category;
    const program = sr.rows[0]?.program;
    const mandatory = checklistFor(profile, category, program);
    if (!mandatory.length) {
      return res.status(400).json({ error: "Checklist not found for your profile." });
    }
    const dr = await pool.query(
      `SELECT doc_code, student_status FROM documents
        WHERE student_id=$1 AND doc_code = ANY($2::text[])`,
      [req.student.id, mandatory]
    );
    const ready = new Set(dr.rows.filter(d => d.student_status === "ready").map(d => d.doc_code));
    const missing = mandatory.filter(c => !ready.has(c));
    if (missing.length) {
      return res.status(400).json({
        error: "All mandatory documents must be uploaded and confirmed before signing the declaration.",
        missing,
      });
    }
    await pool.query("UPDATE students SET declared=true, declared_at=now() WHERE id=$1", [req.student.id]);
    await audit(req, "student", req.student.appNo, "DECLARED", "Self-declaration signed");
    let allocation = { allocated: false, reason: "not-attempted" };
    try {
      allocation = await tryAllocateVerifySlot(req.student.id);
      if (allocation.allocated) {
        await audit(req, "student", req.student.appNo, "VERIFY_SLOT_AUTO_ALLOCATED", `slot#${allocation.slotId}`);
      }
    } catch (e) {
      console.warn("[verify] auto-allocate failed for student", req.student.id, e.message);
      allocation = { allocated: false, reason: "error" };
    }
    res.json({ ok: true, allocation });
  } catch (e) { next(e); }
});

router.get("/slots", async (req, res, next) => {
  try {
    const sr = await pool.query("SELECT slot_id, declared FROM students WHERE id=$1", [req.student.id]);
    const mySlot = sr.rows[0]?.slot_id;
    /* v9 — students that haven't declared yet shouldn't see the slot grid. */
    if (!sr.rows[0]?.declared && !mySlot) {
      return res.status(400).json({ error: "Complete the self-declaration before viewing reporting slots." });
    }
    const r = await pool.query(
      `SELECT id, slot_date, slot_time, capacity, booked, status, duration_minutes FROM slots
        WHERE (status='open' AND booked < capacity) OR id=$1
        ORDER BY slot_date, slot_time`,
      [mySlot || 0]
    );
    res.json({
      slots: r.rows.map((s) => ({
        id: s.id, date: s.slot_date, time: s.slot_time,
        seatsLeft: Math.max(s.capacity - s.booked, 0),
        capacity: s.capacity, booked: s.booked,
        durationMinutes: s.duration_minutes,
        mine: s.id === mySlot,
      })),
    });
  } catch (e) { next(e); }
});

router.post("/slot", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const slotId = parseInt(req.body.slotId, 10);
    if (!slotId) return res.status(400).json({ error: "Choose a slot." });
    await client.query("BEGIN");
    const sr = await client.query("SELECT * FROM students WHERE id=$1 FOR UPDATE", [req.student.id]);
    const s = sr.rows[0];
    if (!s.declared) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Sign the self-declaration before booking a slot." });
    }
    const mandatory = checklistFor(s.profile, s.category, s.program);
    const dr = await client.query(
      `SELECT doc_code, student_status FROM documents
        WHERE student_id=$1 AND doc_code = ANY($2::text[])`,
      [s.id, mandatory]
    );
    const ready = new Set(dr.rows.filter(d => d.student_status === "ready").map(d => d.doc_code));
    const missing = mandatory.filter(c => !ready.has(c));
    if (missing.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Some mandatory documents are no longer in a Ready state. Please re-confirm them before booking.",
        missing,
      });
    }
    if (s.slot_id && !s.slot_rejected) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Your reporting slot is already booked. The verification cell must reject it before you can change it." });
    }
    const slr = await client.query("SELECT * FROM slots WHERE id=$1 FOR UPDATE", [slotId]);
    const slot = slr.rows[0];
    if (!slot) { await client.query("ROLLBACK"); return res.status(404).json({ error: "That slot no longer exists." }); }
    if (slot.status !== "open") { await client.query("ROLLBACK"); return res.status(400).json({ error: `That slot is currently ${slot.status} and cannot be booked.` }); }
    if (slot.id !== s.slot_id && slot.booked >= slot.capacity) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "That slot is now full. Please pick another." });
    }
    if (s.slot_id && s.slot_id !== slot.id) await client.query("UPDATE slots SET booked=GREATEST(booked-1,0) WHERE id=$1", [s.slot_id]);
    if (s.slot_id !== slot.id || s.slot_rejected) await client.query("UPDATE slots SET booked=booked+1 WHERE id=$1", [slot.id]);
    await client.query(
      "UPDATE students SET slot_id=$1, slot_confirmed=true, slot_rejected=false, slot_reject_reason=NULL WHERE id=$2",
      [slot.id, s.id]
    );
    await client.query("COMMIT");
    await audit(req, "student", s.app_no, "SLOT_BOOKED", `${slot.slot_date} ${slot.slot_time}`);
    res.json({ slot: { id: slot.id, date: slot.slot_date, time: slot.slot_time, durationMinutes: slot.duration_minutes } });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

/* v14 — dedicated endpoint for the assigned/auto-allocated verification slot. */
router.get("/my-verification-slot", async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT s.id, s.app_no, s.name, s.assigned_verification_date, s.assigned_batch,
              s.upload_completed_at, s.verify_schedule_id,
              v.schedule_date, v.room, v.slot_no, v.start_time, v.end_time,
              v.status AS verify_status, v.verified_at, v.remarks
         FROM students s
         LEFT JOIN verify_schedule v ON v.id = s.verify_schedule_id
        WHERE s.id=$1`,
      [req.student.id]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: "Student not found." });
    res.json({
      appNo: row.app_no,
      name: row.name,
      assignedDate: row.assigned_verification_date,
      assignedBatch: row.assigned_batch,
      uploadCompletedAt: row.upload_completed_at,
      slot: row.verify_schedule_id ? {
        id: row.verify_schedule_id,
        date: row.schedule_date,
        room: row.room,
        slotNo: row.slot_no,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.verify_status,
        verifiedAt: row.verified_at,
        remarks: row.remarks || null,
      } : null,
      message: "Your document-verification slot is automatically generated after successful upload of all mandatory documents. Slots are assigned on FCFS basis within your pre-assigned orientation date.",
    });
  } catch (e) { next(e); }
});

module.exports = router;
