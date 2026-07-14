/* Personalised placeholders for Communication Center emails. */
const { pool } = require("../../config/db");

const HELPDESK_PHONE = "080 2449 4100 | 080 2449 4141 | 7411747070";
const HELPDESK_EMAIL = "admissions.maheblr@manipal.edu";
const VENUE_DEFAULT = "MIT Bengaluru Auditorium";

const PLACEHOLDER_LIST = [
  "{{StudentName}}", "{{ApplicationNo}}", "{{AppNo}}", "{{Program}}", "{{Department}}",
  "{{Batch}}", "{{Section}}", "{{DateOfBirth}}", "{{DOB}}", "{{StudentEmail}}", "{{Email}}",
  "{{OrientationDate}}", "{{OrientationBatch}}",
  "{{ReportingDate}}", "{{ReportingTime}}", "{{VerificationDate}}", "{{VerificationSlot}}",
  "{{VerificationTime}}", "{{VerificationRoom}}", "{{Venue}}", "{{StudentId}}",
  "{{ParentName}}", "{{ParentRelation}}", "{{PortalUrl}}", "{{HelpDeskPhone}}",
  "{{HelpDeskEmail}}", "{{ScheduleBlock}}",
];

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function portalUrl() {
  const u = (process.env.PORTAL_URL || process.env.CORS_ORIGIN || "https://maheblreduverify.manipal.edu").trim();
  return u.replace(/\/$/, "") || "https://maheblreduverify.manipal.edu";
}

function fmtDate(v) {
  if (!v) return "To be announced";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function fmtTimeRange(start, end) {
  if (!start) return "To be announced";
  return end ? `${start} – ${end}` : start;
}

function reportingTime(start) {
  if (!start) return "To be announced";
  const m = String(start).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return start;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  const ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${mm} ${ap}`;
}

function buildScheduleBlockText(ctx) {
  const lines = [
    "Your details:",
    `  Application No.: ${ctx.ApplicationNo}`,
    `  Program: ${ctx.Program}`,
  ];
  if (ctx.Department && ctx.Department !== "—") lines.push(`  Department: ${ctx.Department}`);
  if (ctx.Batch && ctx.Batch !== "—") lines.push(`  Batch: ${ctx.Batch}`);
  lines.push(`  Orientation date: ${ctx.OrientationDate}`);
  lines.push("");
  lines.push("Document verification:");
  lines.push(`  Date: ${ctx.VerificationDate}`);
  if (ctx.VerificationRoom && ctx.VerificationRoom !== "—") lines.push(`  Room: ${ctx.VerificationRoom}`);
  if (ctx.VerificationSlot && ctx.VerificationSlot !== "To be announced") {
    lines.push(`  Slot: ${ctx.VerificationSlot}`);
    lines.push(`  Report by: ${ctx.ReportingTime}`);
  }
  if (ctx.ReportingDate && ctx.ReportingDate !== "To be announced") {
    lines.push("");
    lines.push("Reporting:");
    lines.push(`  Date: ${ctx.ReportingDate}`);
    lines.push(`  Time: ${ctx.ReportingTime}`);
    lines.push(`  Venue: ${ctx.Venue}`);
  }
  return lines.join("\n");
}

function buildScheduleBlockHtml(ctx) {
  const rows = [
    ["Application No.", ctx.ApplicationNo],
    ["Program", ctx.Program],
    ["Orientation date", ctx.OrientationDate],
    ["Verification date", ctx.VerificationDate],
    ["Verification room", ctx.VerificationRoom],
    ["Verification slot", ctx.VerificationSlot],
    ["Report by", ctx.ReportingTime],
    ["Venue", ctx.Venue],
  ].filter(([, v]) => v && v !== "—" && v !== "To be announced");

  const trs = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(v)}</td></tr>`
  ).join("");

  return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:12px 0">
<p style="margin:0 0 8px;font-weight:600">Your schedule</p>
<table style="font-size:14px;border-collapse:collapse">${trs}</table>
</div>`;
}

function buildContext(student, { verifySlot, slot } = {}, role = "student") {
  const verifyDate = verifySlot?.schedule_date || student.assigned_verification_date || student.orientation_date;
  const verificationSlot = verifySlot
    ? fmtTimeRange(verifySlot.start_time, verifySlot.end_time)
    : "To be announced";
  const reportingDate = slot?.slot_date || verifyDate;
  const reportingTimeVal = slot?.slot_time || (verifySlot?.start_time ? reportingTime(verifySlot.start_time) : "To be announced");

  const dobLabel = student.dob ? fmtDate(student.dob) : "—";
  const studentEmail = String(student.email || "").trim() || "—";
  const ctx = {
    StudentName: student.name || "Student",
    ApplicationNo: student.app_no || "—",
    AppNo: student.app_no || "—",
    StudentId: student.app_no || "—",
    Program: student.program || "—",
    Department: student.department || "—",
    Batch: student.batch || "—",
    Section: student.section || "—",
    DateOfBirth: dobLabel,
    DOB: dobLabel,
    StudentEmail: studentEmail,
    Email: studentEmail,
    OrientationDate: fmtDate(student.orientation_date),
    OrientationBatch: student.assigned_batch || student.batch || "—",
    ReportingDate: fmtDate(reportingDate),
    ReportingTime: reportingTimeVal,
    VerificationDate: fmtDate(verifyDate),
    VerificationSlot: verificationSlot,
    VerificationTime: verificationSlot,
    VerificationRoom: verifySlot?.room || "—",
    Venue: VENUE_DEFAULT,
    ParentName: student.parent_name || "Parent/Guardian",
    ParentRelation: student.parent_relation || "Parent/Guardian",
    PortalUrl: portalUrl(),
    HelpDeskPhone: HELPDESK_PHONE,
    HelpDeskEmail: HELPDESK_EMAIL,
    ScheduleBlock: "",
    ScheduleBlockHtml: "",
  };

  ctx.ScheduleBlock = buildScheduleBlockText(ctx);
  ctx.ScheduleBlockHtml = buildScheduleBlockHtml(ctx);

  if (role === "parent") {
    ctx.Greeting = student.parent_name
      ? `Dear ${student.parent_name},`
      : `Dear Parent/Guardian of ${student.name},`;
    ctx.WardLine = `This is to inform you that your ward ${student.name} (Application No. ${student.app_no}) has been allotted the following schedule:`;
  } else {
    ctx.Greeting = `Dear ${student.name},`;
    ctx.WardLine = "";
  }

  return ctx;
}

function renderTemplate(text, ctx) {
  let out = String(text || "");
  for (const [key, val] of Object.entries(ctx)) {
    out = out.split(`{{${key}}}`).join(String(val ?? ""));
  }
  return out;
}

function htmlToPlain(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function wrapHtmlBody(innerHtml, ctx, role) {
  const greet = role === "parent"
    ? (ctx.Greeting || `Dear ${ctx.ParentName},`)
    : (ctx.Greeting || `Dear ${ctx.StudentName},`);
  const ward = role === "parent" && ctx.WardLine
    ? `<p style="margin:0 0 12px">${escapeHtml(ctx.WardLine)}</p>`
    : "";

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.6;max-width:640px">
<p style="margin:0 0 12px">${escapeHtml(greet)}</p>
${ward}
${innerHtml}
<p style="font-size:13px;color:#64748b;margin-top:24px">Helpdesk: ${escapeHtml(HELPDESK_PHONE)}<br>Email: <a href="mailto:${HELPDESK_EMAIL}">${HELPDESK_EMAIL}</a></p>
<p style="font-size:12px;color:#94a3b8">— MAHE Admissions · MIT Bengaluru</p>
</body></html>`;
}

function renderForRecipient({ subject, bodyHtml, bodyText, parentBodyHtml }, student, { verifySlot, slot }, role) {
  const ctx = buildContext(student, { verifySlot, slot }, role);
  const subj = renderTemplate(subject, ctx);
  let htmlInner = renderTemplate(bodyHtml, ctx);
  if (htmlInner.includes(ctx.ScheduleBlock)) {
    htmlInner = htmlInner.replace(ctx.ScheduleBlock, ctx.ScheduleBlockHtml);
  }
  if (role === "parent" && parentBodyHtml) {
    htmlInner = renderTemplate(parentBodyHtml, ctx);
    if (htmlInner.includes(ctx.ScheduleBlock)) {
      htmlInner = htmlInner.replace(ctx.ScheduleBlock, ctx.ScheduleBlockHtml);
    }
  }
  const html = wrapHtmlBody(htmlInner, ctx, role);
  const text = bodyText
    ? renderTemplate(bodyText, ctx)
    : htmlToPlain(html);
  return { subject: subj, html, text, context: ctx };
}

async function loadStudentContext(studentId) {
  const sr = await pool.query("SELECT * FROM students WHERE id=$1", [studentId]);
  const student = sr.rows[0];
  if (!student) return null;
  let verifySlot = null;
  if (student.verify_schedule_id) {
    const vr = await pool.query("SELECT * FROM verify_schedule WHERE id=$1", [student.verify_schedule_id]);
    verifySlot = vr.rows[0] || null;
  }
  let slot = null;
  if (student.slot_id) {
    const sl = await pool.query("SELECT * FROM slots WHERE id=$1", [student.slot_id]);
    slot = sl.rows[0] || null;
  }
  return { student, verifySlot, slot };
}

module.exports = {
  PLACEHOLDER_LIST,
  escapeHtml,
  portalUrl,
  buildContext,
  renderTemplate,
  renderForRecipient,
  htmlToPlain,
  wrapHtmlBody,
  loadStudentContext,
  HELPDESK_PHONE,
  HELPDESK_EMAIL,
  VENUE_DEFAULT,
};
