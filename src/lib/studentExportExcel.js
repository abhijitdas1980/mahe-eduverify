/* Admin export — student roster with contact details and verification progress. */
const ExcelJS = require("exceljs");

const EXPORT_COLUMNS = [
  "application_number",
  "full_name",
  "date_of_birth",
  "gender",
  "profile",
  "program",
  "department",
  "section",
  "batch",
  "category",
  "orientation_date",
  "verification_date",
  "verification_batch",
  "student_email",
  "student_phone",
  "parent_name",
  "parent_relation",
  "parent_email",
  "parent_phone",
  "contact_submitted",
  "contact_verified_at_campus",
  "contact_submitted_at",
  "self_declaration_signed",
  "declaration_signed_at",
  "mandatory_docs_total",
  "mandatory_docs_uploaded",
  "mandatory_docs_ready",
  "mandatory_docs_verified",
  "mandatory_docs_issues",
  "mandatory_docs_flagged",
  "pipeline_status",
  "verify_room",
  "verify_slot_no",
  "verify_date",
  "verify_start_time",
  "verify_end_time",
  "verify_status",
  "upload_completed_at",
  "reporting_slot_date",
  "reporting_slot_time",
  "reporting_slot_confirmed",
  "physical_reporting_done",
];

const HEADER_LABELS = {
  application_number: "Application Number",
  full_name: "Full Name",
  date_of_birth: "Date of Birth",
  gender: "Gender",
  profile: "Profile",
  program: "Program",
  department: "Department",
  section: "Section",
  batch: "Batch",
  category: "Category",
  orientation_date: "Orientation Date",
  verification_date: "Verification Date",
  verification_batch: "Verification Batch",
  student_email: "Student Email",
  student_phone: "Student Mobile",
  parent_name: "Parent / Guardian Name",
  parent_relation: "Parent Relation",
  parent_email: "Parent Email",
  parent_phone: "Parent Mobile",
  contact_submitted: "Contact Submitted",
  contact_verified_at_campus: "Contact Verified at Campus",
  contact_submitted_at: "Contact Submitted At",
  self_declaration_signed: "Self-Declaration Signed",
  declaration_signed_at: "Declaration Signed At",
  mandatory_docs_total: "Mandatory Docs Total",
  mandatory_docs_uploaded: "Mandatory Docs Uploaded",
  mandatory_docs_ready: "Mandatory Docs Ready",
  mandatory_docs_verified: "Mandatory Docs Verified",
  mandatory_docs_issues: "Mandatory Docs Issues",
  mandatory_docs_flagged: "Flagged Documents",
  pipeline_status: "Pipeline Status",
  verify_room: "Verify Room",
  verify_slot_no: "Verify Slot No",
  verify_date: "Verify Date",
  verify_start_time: "Verify Start Time",
  verify_end_time: "Verify End Time",
  verify_status: "Verify Status",
  upload_completed_at: "All Mandatory Uploads At",
  reporting_slot_date: "Reporting Slot Date",
  reporting_slot_time: "Reporting Slot Time",
  reporting_slot_confirmed: "Reporting Slot Confirmed",
  physical_reporting_done: "Physical Reporting Done",
};

function fmtDate(d) {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split("-");
  return day && m && y ? `${day}-${m}-${y}` : s;
}

function fmtDateTime(d) {
  if (!d) return "";
  try { return new Date(d).toLocaleString("en-IN", { hour12: true }); }
  catch { return String(d); }
}

function pipelineStatus(r) {
  const flagged = Number(r.flagged || 0);
  const total = Number(r.total || 0);
  const ready = Number(r.ready || 0);
  const verified = Number(r.verified || 0);
  const issues = Number(r.issues || 0);
  if (flagged > 0) return "Flagged";
  if (r.verify_status === "verified") return "Verified";
  if (r.verify_status === "absent") return "Absent";
  if (r.verify_status === "reassigned") return "Reassigned";
  if (r.verify_status === "booked" || r.verify_status === "pending") return "Slot Assigned";
  if (issues > 0) return "Needs Attention";
  if (total > 0 && ready === total) return "Docs Ready";
  return "In Progress";
}

function mapRow(r) {
  return {
    application_number: r.app_no || "",
    full_name: r.name || "",
    date_of_birth: fmtDate(r.dob),
    gender: r.gender || "",
    profile: r.profile || "",
    program: r.program || "",
    department: r.department || "",
    section: r.section || "",
    batch: r.batch || "",
    category: r.category || "",
    orientation_date: fmtDate(r.orientation_date),
    verification_date: fmtDate(r.assigned_verification_date),
    verification_batch: r.assigned_batch != null ? String(r.assigned_batch) : "",
    student_email: r.email || "",
    student_phone: r.phone || "",
    parent_name: r.parent_name || "",
    parent_relation: r.parent_relation || "",
    parent_email: r.parent_email || "",
    parent_phone: r.parent_phone || "",
    contact_submitted: r.contact_completed_at ? "Yes" : "No",
    contact_verified_at_campus: r.contact_verified_at ? "Yes" : "No",
    contact_submitted_at: fmtDateTime(r.contact_completed_at),
    self_declaration_signed: r.declared ? "Yes" : "No",
    declaration_signed_at: fmtDateTime(r.declared_at),
    mandatory_docs_total: Number(r.total || 0),
    mandatory_docs_uploaded: Number(r.uploaded || 0),
    mandatory_docs_ready: Number(r.ready || 0),
    mandatory_docs_verified: Number(r.verified || 0),
    mandatory_docs_issues: Number(r.issues || 0),
    mandatory_docs_flagged: Number(r.flagged || 0),
    pipeline_status: pipelineStatus(r),
    verify_room: r.verify_room || "",
    verify_slot_no: r.verify_slot_no != null ? String(r.verify_slot_no) : "",
    verify_date: fmtDate(r.verify_date),
    verify_start_time: r.verify_start || "",
    verify_end_time: r.verify_end || "",
    verify_status: r.verify_status || "",
    upload_completed_at: fmtDateTime(r.upload_completed_at),
    reporting_slot_date: fmtDate(r.slot_date),
    reporting_slot_time: r.slot_time || "",
    reporting_slot_confirmed: r.slot_confirmed ? "Yes" : "No",
    physical_reporting_done: r.physical_reporting_completed ? "Yes" : "No",
  };
}

async function buildExportBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "EduVerify";
  const ws = wb.addWorksheet("Students");
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const headerRow = ws.addRow(EXPORT_COLUMNS.map((c) => HEADER_LABELS[c] || c));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 28;

  EXPORT_COLUMNS.forEach((key, i) => {
    const w = ["full_name", "program", "parent_name", "student_email", "parent_email"].includes(key) ? 28
      : ["pipeline_status", "contact_submitted_at"].includes(key) ? 22
      : 16;
    ws.getColumn(i + 1).width = w;
  });

  for (const r of rows) {
    const mapped = mapRow(r);
    ws.addRow(EXPORT_COLUMNS.map((c) => mapped[c] ?? ""));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = {
  EXPORT_COLUMNS,
  pipelineStatus,
  mapRow,
  buildExportBuffer,
  queryStudentExportRows,
};

async function queryStudentExportRows(pool, filters, excludeDocCodes) {
  const where = [];
  const params = [excludeDocCodes];
  let pi = 2;

  const addEq = (col, val) => {
    if (!val) return;
    params.push(val);
    where.push(`${col} = $${pi++}`);
  };

  addEq("s.department", filters.department || "");
  addEq("s.section", filters.section || "");
  addEq("s.batch", filters.batch || "");

  if (filters.contact === "incomplete") {
    where.push("s.contact_completed_at IS NULL");
  } else if (filters.contact === "unverified") {
    where.push("s.contact_completed_at IS NOT NULL AND s.contact_verified_at IS NULL");
  } else if (filters.contact === "completed") {
    where.push("s.contact_completed_at IS NOT NULL");
  }

  const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const r = await pool.query(
    `SELECT s.app_no, s.name, s.dob, s.gender, s.profile, s.program, s.department, s.section, s.batch,
            s.category, s.orientation_date, s.assigned_verification_date, s.assigned_batch,
            s.email, s.phone, s.parent_name, s.parent_relation, s.parent_email, s.parent_phone,
            s.contact_completed_at, s.contact_verified_at,
            s.declared, s.declared_at, s.slot_confirmed, s.physical_reporting_completed,
            s.upload_completed_at,
            sl.slot_date, sl.slot_time,
            vs.room AS verify_room, vs.slot_no AS verify_slot_no,
            vs.schedule_date AS verify_date, vs.start_time AS verify_start,
            vs.end_time AS verify_end, vs.status AS verify_status,
            COUNT(d.id) AS total,
            COUNT(d.id) FILTER (WHERE d.file_public_id IS NOT NULL) AS uploaded,
            COUNT(d.id) FILTER (WHERE d.student_status='ready') AS ready,
            COUNT(d.id) FILTER (WHERE d.staff_status='verified') AS verified,
            COUNT(d.id) FILTER (WHERE d.student_status='issue') AS issues,
            COUNT(d.id) FILTER (WHERE d.flagged) AS flagged
       FROM students s
       LEFT JOIN documents d
         ON d.student_id = s.id
        AND d.doc_code <> ALL($1::text[])
       LEFT JOIN slots sl ON sl.id = s.slot_id
       LEFT JOIN verify_schedule vs ON vs.id = s.verify_schedule_id
       ${sqlWhere}
       GROUP BY s.id, sl.slot_date, sl.slot_time,
                vs.room, vs.slot_no, vs.schedule_date, vs.start_time, vs.end_time,
                vs.status, vs.verified_at
       ORDER BY s.app_no`,
    params
  );

  let rows = r.rows;
  const q = String(filters.q || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((row) =>
      (row.name || "").toLowerCase().includes(q)
      || (row.app_no || "").toLowerCase().includes(q)
      || (row.program || "").toLowerCase().includes(q)
      || (row.email || "").toLowerCase().includes(q)
      || (row.parent_email || "").toLowerCase().includes(q)
    );
  }
  if (filters.status) {
    rows = rows.filter((row) => pipelineStatus(row) === filters.status);
  }
  return rows;
}
