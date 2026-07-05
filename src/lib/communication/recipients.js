/* Resolve Communication Center recipient lists from filters or selections. */
const { pool } = require("../../config/db");

const LEGACY_EXCLUDE = ["PAN", "BANK", "CASTE", "MEDICAL", "MIGRATION"];

function baseStudentQuery() {
  return `
    SELECT s.id, s.app_no, s.name, s.email, s.phone, s.program, s.department, s.batch,
           s.section, s.parent_name, s.parent_email, s.parent_relation,
           s.orientation_date, s.assigned_verification_date, s.assigned_batch,
           s.contact_completed_at, s.upload_completed_at, s.slot_id, s.verify_schedule_id,
           vs.schedule_date AS verify_date, vs.start_time AS verify_start, vs.end_time AS verify_end,
           vs.room AS verify_room, vs.status AS verify_status,
           sl.slot_date, sl.slot_time,
           COUNT(d.id) AS total_docs,
           COUNT(d.id) FILTER (WHERE d.staff_status = 'verified') AS verified_docs,
           COUNT(d.id) FILTER (WHERE d.staff_status = 'rejected') AS rejected_docs
      FROM students s
      LEFT JOIN verify_schedule vs ON vs.id = s.verify_schedule_id
      LEFT JOIN slots sl ON sl.id = s.slot_id
      LEFT JOIN documents d ON d.student_id = s.id AND d.doc_code <> ALL($1::text[])
     GROUP BY s.id, vs.schedule_date, vs.start_time, vs.end_time, vs.room, vs.status,
              sl.slot_date, sl.slot_time
  `;
}

function applyFilters(rows, filter = {}) {
  let out = rows;
  const q = String(filter.q || "").trim().toLowerCase();
  if (q) {
    out = out.filter((r) =>
      (r.name || "").toLowerCase().includes(q)
      || (r.app_no || "").toLowerCase().includes(q)
      || (r.email || "").toLowerCase().includes(q)
    );
  }
  if (filter.program) out = out.filter((r) => r.program === filter.program);
  if (filter.department) out = out.filter((r) => r.department === filter.department);
  if (filter.batch) out = out.filter((r) => r.batch === filter.batch);
  if (filter.orientationBatch) out = out.filter((r) => (r.assigned_batch || r.batch) === filter.orientationBatch);
  if (filter.reportingDate) {
    const d = String(filter.reportingDate).slice(0, 10);
    out = out.filter((r) => {
      const rd = r.slot_date || r.verify_date || r.assigned_verification_date || r.orientation_date;
      return rd && String(rd).slice(0, 10) === d;
    });
  }
  if (filter.verificationDate) {
    const d = String(filter.verificationDate).slice(0, 10);
    out = out.filter((r) => {
      const vd = r.verify_date || r.assigned_verification_date;
      return vd && String(vd).slice(0, 10) === d;
    });
  }
  if (filter.verificationRoom) out = out.filter((r) => (r.verify_room || "") === filter.verificationRoom);
  if (filter.verificationTime) {
    const t = filter.verificationTime;
    out = out.filter((r) => {
      const label = r.verify_end ? `${r.verify_start} – ${r.verify_end}` : r.verify_start;
      return label === t;
    });
  }
  if (filter.pendingDocuments) {
    out = out.filter((r) => Number(r.total_docs) > 0 && Number(r.verified_docs) < Number(r.total_docs));
  }
  if (filter.verifiedStudents) {
    out = out.filter((r) => Number(r.total_docs) > 0 && Number(r.verified_docs) === Number(r.total_docs));
  }
  if (filter.contactIncomplete) out = out.filter((r) => !r.contact_completed_at);
  if (Array.isArray(filter.appNos) && filter.appNos.length) {
    const set = new Set(filter.appNos.map((a) => String(a).toLowerCase()));
    out = out.filter((r) => set.has(String(r.app_no).toLowerCase()));
  }
  return out;
}

async function fetchAllStudents() {
  const r = await pool.query(baseStudentQuery(), [LEGACY_EXCLUDE]);
  return r.rows;
}

async function resolveRecipients({ mode = "selected", filter = {}, appNos = [] } = {}) {
  const all = await fetchAllStudents();
  if (mode === "all") return applyFilters(all, filter);
  if (mode === "filter") return applyFilters(all, filter);
  if (mode === "selected") {
    const list = Array.isArray(appNos) ? appNos : [];
    return applyFilters(all, { ...filter, appNos: list });
  }
  return [];
}

async function countRecipients(opts) {
  const rows = await resolveRecipients(opts);
  return {
    count: rows.length,
    withStudentEmail: rows.filter((r) => r.email).length,
    withParentEmail: rows.filter((r) => r.parent_email).length,
    sample: rows.slice(0, 5).map((r) => ({ appNo: r.app_no, name: r.name, email: r.email, parentEmail: r.parent_email })),
  };
}

async function filterOptions() {
  const all = await fetchAllStudents();
  const uniq = (key) => [...new Set(all.map((r) => r[key]).filter(Boolean))].sort();
  const verifyDates = [...new Set(all.map((r) => {
    const d = r.verify_date || r.assigned_verification_date;
    return d ? String(d).slice(0, 10) : null;
  }).filter(Boolean))].sort();
  const verifyTimes = [...new Set(all.map((r) =>
    r.verify_start ? (r.verify_end ? `${r.verify_start} – ${r.verify_end}` : r.verify_start) : null
  ).filter(Boolean))].sort();
  const verifyRooms = [...new Set(all.map((r) => r.verify_room).filter(Boolean))].sort();
  const reportingDates = [...new Set(all.map((r) => {
    const d = r.slot_date || r.verify_date || r.assigned_verification_date || r.orientation_date;
    return d ? String(d).slice(0, 10) : null;
  }).filter(Boolean))].sort();
  const orientationBatches = [...new Set(all.map((r) => r.assigned_batch || r.batch).filter(Boolean))].sort();

  return {
    programs: uniq("program"),
    departments: uniq("department"),
    batches: uniq("batch"),
    orientationBatches,
    reportingDates,
    verificationDates: verifyDates,
    verificationTimes: verifyTimes,
    verificationRooms: verifyRooms,
    totalStudents: all.length,
  };
}

module.exports = {
  resolveRecipients,
  countRecipients,
  filterOptions,
  applyFilters,
};
