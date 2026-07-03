/* Shared helpers for working with the documents table (v9).
   v9 — single confirmation per document replaces v7's six-checkbox flow.
   Backward compatible: a record with all six legacy keys true still counts.
*/
const { pool } = require("../config/db");
const {
  checklistFor, fullDocSetFor, DOC_META, docMetaFor,
  isLegacyCode, isOptionalCode, isMandatoryForStudent,
} = require("../config/checklists");
const { signedUrl } = require("../config/storage");
const { storageProvider } = require("../config/env");
const { physicalSubmissionLabel } = require("./followupRemarks");

/* v9 — the new single confirmation key. */
const CONFIRM_KEY = "confirmed";
/* Legacy six-key flow from v7 — still honoured for old self_verify payloads. */
const LEGACY_VERIFY_KEYS = ["clarity", "complete", "name", "signature", "date", "authentic"];

async function ensureDocuments(studentId, profile, category, program) {
  for (const code of fullDocSetFor(profile, category, program)) {
    await pool.query(
      `INSERT INTO documents (student_id, doc_code) VALUES ($1,$2)
       ON CONFLICT (student_id, doc_code) DO NOTHING`,
      [studentId, code]
    );
  }
}

/* Hide v8-removed doc codes from listings (backward compat: rows are kept). */
function filterVisible(docRows) {
  return (docRows || []).filter((d) => !isLegacyCode(d.doc_code));
}

/** Keep only documents in the student's current profile checklist (+ optional). */
function filterForProfile(docRows, profile, category, program) {
  const allowed = new Set(fullDocSetFor(profile, category, program));
  return filterVisible(docRows).filter((d) => allowed.has(d.doc_code));
}

/* v9 — true if the student has confirmed the document via the new single
   checkbox, OR via the legacy six checkboxes. */
function isConfirmed(selfVerify) {
  if (!selfVerify || typeof selfVerify !== "object") return false;
  if (selfVerify[CONFIRM_KEY] === true) return true;
  return LEGACY_VERIFY_KEYS.every((k) => selfVerify[k] === true);
}

function docOptionalFlag(d, ctx) {
  if (ctx?.profile) {
    return !isMandatoryForStudent(d.doc_code, ctx.profile, ctx.category, ctx.program);
  }
  return !!DOC_META[d.doc_code]?.optional || isOptionalCode(d.doc_code);
}

function docUrls(d, role) {
  if (!d.file_public_id) {
    return { fileUrl: null, viewUrl: null, downloadUrl: null };
  }
  if (storageProvider() === "azure") {
    if (role === "admin") {
      const base = `/api/admin/documents/${d.id}`;
      return { fileUrl: `${base}/preview`, viewUrl: `${base}/preview`, downloadUrl: `${base}/download` };
    }
    const base = `/api/student/documents/${d.doc_code}`;
    return { fileUrl: `${base}/preview`, viewUrl: `${base}/preview`, downloadUrl: `${base}/download` };
  }
  return {
    fileUrl: signedUrl(d, false),
    viewUrl: signedUrl(d, false),
    downloadUrl: signedUrl(d, true),
  };
}

function serializeDoc(d, ctx) {
  const sv = d.self_verify || {};
  const urls = docUrls(d, "student");
  const meta = docMetaFor(d.doc_code, ctx?.profile, ctx?.category);
  return {
    docCode: d.doc_code,
    name: meta.name || d.doc_code,
    original: !!meta.original,
    needsInstitution: !!meta.needsInstitution,
    optional: docOptionalFlag(d, ctx),
    hasFile: !!d.file_public_id,
    fileName: d.file_name || null,
    fileUrl: urls.fileUrl,
    downloadUrl: urls.downloadUrl,
    institutionName: d.institution_name || "",
    flagged: !!d.flagged,
    flagMatch: d.flag_match || null,
    flagRemarks: d.flag_remarks || null,
    selfVerify: sv,
    /* v9 — expose the boolean directly so the frontend doesn't have to know
       the legacy keys. */
    confirmed: isConfirmed(sv),
    studentStatus: d.student_status,
    issueNote: d.issue_note || null,
    staffStatus: d.staff_status,
    staffNote: d.staff_note || null,
    physicalSubmission: d.physical_submission || null,
    physicalSubmissionLabel: physicalSubmissionLabel(d.physical_submission),
    verifiedByStaffId: d.verifier_staff_id || null,
    verifiedByName: d.verifier_name || null,
    verifiedAt: d.verified_at || null,
  };
}

function serializeDocAdmin(d, ctx) {
  const sv = d.self_verify || {};
  const urls = docUrls(d, "admin");
  const meta = docMetaFor(d.doc_code, ctx?.profile, ctx?.category);
  return {
    id: d.id,
    docCode: d.doc_code,
    name: meta.name || d.doc_code,
    original: !!meta.original,
    needsInstitution: !!meta.needsInstitution,
    optional: docOptionalFlag(d, ctx),
    hasFile: !!d.file_public_id,
    fileName: d.file_name || null,
    fileSize: d.file_size || null,
    viewUrl: urls.viewUrl,
    downloadUrl: urls.downloadUrl,
    institutionName: d.institution_name || "",
    flagged: !!d.flagged,
    flagMatch: d.flag_match || null,
    flagRemarks: d.flag_remarks || null,
    flaggedAt: d.flagged_at || null,
    selfVerify: sv,
    confirmed: isConfirmed(sv),
    studentStatus: d.student_status,
    issueNote: d.issue_note || null,
    staffStatus: d.staff_status,
    staffNote: d.staff_note || null,
    physicalSubmission: d.physical_submission || null,
    physicalSubmissionLabel: physicalSubmissionLabel(d.physical_submission),
    verifiedByStaffId: d.verifier_staff_id || null,
    verifiedByName: d.verifier_name || null,
    verifiedAt: d.verified_at || null,
  };
}

/** SELECT clause + JOIN that includes the verifier's name + staff ID. */
const DOC_SELECT_WITH_VERIFIER =
  "d.*, a.name AS verifier_name, a.staff_id AS verifier_staff_id";
const DOC_JOIN_VERIFIER = "LEFT JOIN admins a ON a.id = d.verified_by";

module.exports = {
  /* v9 names */
  CONFIRM_KEY, LEGACY_VERIFY_KEYS, isConfirmed,
  /* legacy alias so older callers don't break — same semantics now */
  allChecksTrue: isConfirmed,
  VERIFY_KEYS: LEGACY_VERIFY_KEYS,
  ensureDocuments, filterVisible, filterForProfile,
  serializeDoc, serializeDocAdmin,
  DOC_SELECT_WITH_VERIFIER, DOC_JOIN_VERIFIER,
};
