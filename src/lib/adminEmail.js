/* Admin-composed personalized emails to students and parents. */
const { pool } = require("../config/db");
const {
  isEmailConfigured,
  sendEmail,
  logNotification,
  uniqueRecipients,
  greeting,
  greetingHtml,
} = require("./notifications");

const HELPDESK_PHONE = "080 2449 4100 | 080 2449 4141 | 7411747070";
const HELPDESK_EMAIL = "admissions.maheblr@manipal.edu";

const PLACEHOLDERS = [
  "{{StudentName}}", "{{AppNo}}", "{{Program}}", "{{Department}}", "{{Batch}}", "{{Section}}",
  "{{OrientationDate}}", "{{VerificationDate}}", "{{VerificationTime}}", "{{VerificationRoom}}",
  "{{ReportingSlotDate}}", "{{ReportingSlotTime}}", "{{PortalUrl}}", "{{HelpDeskPhone}}", "{{HelpDeskEmail}}",
  "{{ParentName}}",
];

const TEMPLATES = {
  schedule: {
    id: "schedule",
    name: "Orientation & verification schedule",
    description: "Sends orientation date and document verification slot details.",
    subject: "MAHE EduVerify — Your orientation & document verification schedule (App {{AppNo}})",
    body: [
      "We are pleased to share your orientation and document verification details for MAHE Bengaluru.",
      "",
      "{{ScheduleBlock}}",
      "",
      "Please log in to EduVerify to complete your document uploads before your verification slot:",
      "{{PortalUrl}}",
      "",
      "Bring all original documents on your verification day.",
      "",
      "Helpdesk: {{HelpDeskPhone}}",
      "Email: {{HelpDeskEmail}}",
      "",
      "— MAHE Admissions Verification Cell",
    ].join("\n"),
  },
  upload_reminder: {
    id: "upload_reminder",
    name: "Document upload reminder",
    description: "Reminds the student to complete EduVerify document uploads.",
    subject: "MAHE EduVerify — Complete your document upload (App {{AppNo}})",
    body: [
      "This is a reminder to complete your document upload on the EduVerify portal before your assigned verification slot.",
      "",
      "{{ScheduleBlock}}",
      "",
      "Log in here: {{PortalUrl}}",
      "",
      "If you have already uploaded all documents, you can ignore this message.",
      "",
      "Helpdesk: {{HelpDeskPhone}}",
      "Email: {{HelpDeskEmail}}",
      "",
      "— MAHE Admissions Verification Cell",
    ].join("\n"),
  },
  custom: {
    id: "custom",
    name: "Custom message",
    description: "Write your own subject and body. Use placeholders like {{StudentName}}.",
    subject: "MAHE EduVerify — Message for {{StudentName}} (App {{AppNo}})",
    body: [
      "Dear {{StudentName}},",
      "",
      "Please find your schedule details below:",
      "",
      "{{ScheduleBlock}}",
      "",
      "Portal: {{PortalUrl}}",
      "",
      "— MAHE Admissions Verification Cell",
    ].join("\n"),
  },
};

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
  const lines = [];
  lines.push("Your details:");
  lines.push(`  Application No.: ${ctx.AppNo}`);
  lines.push(`  Program: ${ctx.Program}`);
  if (ctx.Department && ctx.Department !== "—") lines.push(`  Department: ${ctx.Department}`);
  if (ctx.Batch && ctx.Batch !== "—") lines.push(`  Batch: ${ctx.Batch}`);
  lines.push(`  Orientation date: ${ctx.OrientationDate}`);
  lines.push("");
  lines.push("Document verification:");
  lines.push(`  Date: ${ctx.VerificationDate}`);
  if (ctx.VerificationRoom && ctx.VerificationRoom !== "—") lines.push(`  Room: ${ctx.VerificationRoom}`);
  if (ctx.VerificationTime && ctx.VerificationTime !== "To be announced") {
    lines.push(`  Slot time: ${ctx.VerificationTime}`);
    lines.push(`  Report by: ${ctx.ReportingTime || ctx.VerificationTime}`);
  }
  if (ctx.ReportingSlotDate && ctx.ReportingSlotDate !== "—") {
    lines.push("");
    lines.push("Campus reporting slot:");
    lines.push(`  Date: ${ctx.ReportingSlotDate}`);
    lines.push(`  Time: ${ctx.ReportingSlotTime}`);
  }
  return lines.join("\n");
}

function buildScheduleBlockHtml(ctx) {
  const rows = [
    ["Application No.", ctx.AppNo],
    ["Program", ctx.Program],
    ["Orientation date", ctx.OrientationDate],
    ["Verification date", ctx.VerificationDate],
    ["Verification room", ctx.VerificationRoom],
    ["Slot time", ctx.VerificationTime],
    ["Report by", ctx.ReportingTime || ctx.VerificationTime],
  ].filter(([, v]) => v && v !== "—" && v !== "To be announced");

  const trs = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(v)}</td></tr>`
  ).join("");

  let reporting = "";
  if (ctx.ReportingSlotDate && ctx.ReportingSlotDate !== "—") {
    reporting = `<p style="margin:16px 0 8px;font-weight:600">Campus reporting slot</p>
<table style="font-size:14px;line-height:1.5"><tr><td style="padding:6px 12px 6px 0;color:#64748b">Date</td><td style="font-weight:600">${escapeHtml(ctx.ReportingSlotDate)}</td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#64748b">Time</td><td style="font-weight:600">${escapeHtml(ctx.ReportingSlotTime)}</td></tr></table>`;
  }

  return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:12px 0">
<p style="margin:0 0 8px;font-weight:600;color:#0f172a">Your schedule</p>
<table style="font-size:14px;line-height:1.5;border-collapse:collapse">${trs}</table>
${reporting}
</div>`;
}

function buildContext(student, { verifySlot, slot } = {}) {
  const verifyDate = verifySlot?.date || student.assigned_verification_date || student.orientation_date;
  return {
    StudentName: student.name || "Student",
    AppNo: student.app_no || "—",
    Program: student.program || "—",
    Department: student.department || "—",
    Batch: student.batch || "—",
    Section: student.section || "—",
    OrientationDate: fmtDate(student.orientation_date),
    VerificationDate: fmtDate(verifyDate),
    VerificationTime: verifySlot ? fmtTimeRange(verifySlot.start_time, verifySlot.end_time) : "To be announced",
    VerificationRoom: verifySlot?.room || "—",
    ReportingTime: verifySlot?.start_time ? reportingTime(verifySlot.start_time) : "To be announced",
    ReportingSlotDate: slot?.slot_date ? fmtDate(slot.slot_date) : "—",
    ReportingSlotTime: slot?.slot_time || "—",
    PortalUrl: portalUrl(),
    HelpDeskPhone: HELPDESK_PHONE,
    HelpDeskEmail: HELPDESK_EMAIL,
    ParentName: student.parent_name || "Parent/Guardian",
    ScheduleBlock: "",
    ScheduleBlockHtml: "",
  };
}

function renderTemplate(text, ctx) {
  let out = String(text || "");
  for (const [key, val] of Object.entries(ctx)) {
    out = out.split(`{{${key}}}`).join(String(val ?? ""));
  }
  return out;
}

function resolveTemplate(templateId, customSubject, customBody) {
  const base = TEMPLATES[templateId] || TEMPLATES.schedule;
  return {
    subject: customSubject?.trim() || base.subject,
    body: customBody?.trim() || base.body,
    templateId: base.id,
  };
}

function buildEmailContent({ student, verifySlot, slot, templateId, customSubject, customBody, recipientRole }) {
  const ctx = buildContext(student, { verifySlot, slot });
  ctx.ScheduleBlock = buildScheduleBlockText(ctx);
  ctx.ScheduleBlockHtml = buildScheduleBlockHtml(ctx);

  const tpl = resolveTemplate(templateId, customSubject, customBody);
  const subject = renderTemplate(tpl.subject, ctx);
  let bodyText = renderTemplate(tpl.body, ctx);

  const greet = greeting(student, recipientRole);
  if (!bodyText.trim().toLowerCase().startsWith("dear")) {
    bodyText = `${greet}\n\n${bodyText}`;
  }

  const greetH = greetingHtml(student, recipientRole);
  const renderedBody = renderTemplate(tpl.body, ctx);
  const htmlBody = renderedBody
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (trimmed === ctx.ScheduleBlock) return ctx.ScheduleBlockHtml;
      return `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.5;max-width:640px">
<p>${greetH}</p>
${htmlBody.replace(/<p style="margin:0 0 10px"><\/p>/g, "")}
<p style="font-size:13px;color:#64748b;margin-top:20px">Helpdesk: ${escapeHtml(HELPDESK_PHONE)}<br>Email: <a href="mailto:${HELPDESK_EMAIL}">${HELPDESK_EMAIL}</a></p>
<p style="font-size:12px;color:#94a3b8">— MAHE Admissions Verification Cell</p>
</body></html>`;

  return { subject, text: bodyText, html, context: ctx, templateId: tpl.templateId };
}

async function loadStudentEmailContext(appNo) {
  const sr = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [appNo]);
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

function normalizeAttachments(files) {
  if (!files?.length) return [];
  return files.map((f) => ({
    filename: f.originalname || "attachment",
    content: f.buffer,
    contentType: f.mimetype,
  }));
}

function parseRecipients(sendToStudent, sendToParent, student) {
  const all = uniqueRecipients(student);
  const wantStudent = sendToStudent !== false;
  const wantParent = sendToParent !== false;
  return all.filter((r) =>
    (r.role === "student" && wantStudent) || (r.role === "parent" && wantParent)
  );
}

async function previewAdminEmail({ appNo, templateId, customSubject, customBody, recipientRole = "student" }) {
  const ctx = await loadStudentEmailContext(appNo);
  if (!ctx) throw new Error("Student not found.");
  const content = buildEmailContent({
    student: ctx.student,
    verifySlot: ctx.verifySlot,
    slot: ctx.slot,
    templateId,
    customSubject,
    customBody,
    recipientRole,
  });
  return {
    templateId: content.templateId,
    subject: content.subject,
    text: content.text,
    html: content.html,
    context: content.context,
    recipients: uniqueRecipients(ctx.student),
  };
}

async function sendAdminEmail({
  appNo,
  templateId,
  customSubject,
  customBody,
  sendToStudent = true,
  sendToParent = true,
  attachments = [],
  staffId,
}) {
  const ctx = await loadStudentEmailContext(appNo);
  if (!ctx) throw new Error("Student not found.");

  const { student, verifySlot, slot } = ctx;
  const recipients = parseRecipients(sendToStudent, sendToParent, student);

  if (!recipients.length) {
    throw new Error("No valid recipient email on file for the selected audience.");
  }

  if (!isEmailConfigured()) {
    throw new Error("SMTP not configured — set SMTP_USER and SMTP_PASS on the server.");
  }

  const mailAttachments = normalizeAttachments(attachments);
  const attachmentNames = mailAttachments.map((a) => a.filename);
  const results = [];

  for (const { email, role } of recipients) {
    const content = buildEmailContent({
      student,
      verifySlot,
      slot,
      templateId,
      customSubject,
      customBody,
      recipientRole: role,
    });
    try {
      await sendEmail({
        to: email,
        subject: content.subject,
        text: content.text,
        html: content.html,
        attachments: mailAttachments,
      });
      await logNotification({
        studentId: student.id,
        eventType: "admin_email",
        recipient: email,
        recipientRole: role,
        subject: content.subject,
        status: "sent",
        metadata: {
          templateId: content.templateId,
          staffId,
          attachments: attachmentNames,
        },
      });
      results.push({ email, role, status: "sent" });
    } catch (e) {
      await logNotification({
        studentId: student.id,
        eventType: "admin_email",
        recipient: email,
        recipientRole: role,
        subject: content.subject,
        status: "failed",
        error: e.message,
        metadata: {
          templateId: content.templateId,
          staffId,
          attachments: attachmentNames,
        },
      });
      results.push({ email, role, status: "failed", error: e.message });
    }
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  return { sent, failed, results, appNo: student.app_no };
}

async function sendAdminEmailBulk({
  appNos,
  templateId,
  customSubject,
  customBody,
  sendToStudent = true,
  sendToParent = true,
  attachments = [],
  staffId,
}) {
  const list = Array.isArray(appNos) ? appNos : [];
  if (!list.length) throw new Error("Select at least one student.");

  const summary = { sent: 0, failed: 0, students: [] };
  for (const appNo of list) {
    try {
      const r = await sendAdminEmail({
        appNo,
        templateId,
        customSubject,
        customBody,
        sendToStudent,
        sendToParent,
        attachments,
        staffId,
      });
      summary.sent += r.sent;
      summary.failed += r.failed;
      summary.students.push(r);
    } catch (e) {
      summary.students.push({ appNo, sent: 0, failed: 0, error: e.message });
    }
  }
  return summary;
}

function listEmailTemplates() {
  return Object.values(TEMPLATES).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    defaultSubject: t.subject,
    defaultBody: t.body,
    placeholders: PLACEHOLDERS,
  }));
}

module.exports = {
  listEmailTemplates,
  previewAdminEmail,
  sendAdminEmail,
  sendAdminEmailBulk,
  PLACEHOLDERS,
};
