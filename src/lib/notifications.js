/* Transactional email — M365 Graph OAuth2 (preferred) or legacy SMTP. */
const nodemailer = require("nodemailer");
const { pool } = require("../config/db");
const { docMetaFor } = require("../config/checklists");
const { filterForProfile } = require("./docs");
const { isGraphMailConfigured, sendViaGraph } = require("./graphMail");

const DEFAULT_FROM = "MAHE Admissions <admissions.maheblr@manipal.edu>";
const DEFAULT_PORTAL = "https://maheblreduverify.manipal.edu";
const HELPDESK_PHONE = "080 2449 4100 | 080 2449 4141 | 7411747070";
const HELPDESK_EMAIL = "admissions.maheblr@manipal.edu";

let transporter;

function isSmtpPasswordConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function mailProvider() {
  const explicit = (process.env.MAIL_PROVIDER || "auto").trim().toLowerCase();
  if (explicit === "graph") return isGraphMailConfigured() ? "graph" : null;
  if (explicit === "smtp") return isSmtpPasswordConfigured() ? "smtp" : null;
  if (isGraphMailConfigured()) return "graph";
  if (isSmtpPasswordConfigured()) return "smtp";
  return null;
}

function isEmailConfigured() {
  if (process.env.NOTIFY_EMAIL_ENABLED === "false") return false;
  return !!mailProvider();
}

function portalUrl() {
  const u = (process.env.PORTAL_URL || process.env.CORS_ORIGIN || DEFAULT_PORTAL).trim();
  return u.replace(/\/$/, "") || DEFAULT_PORTAL;
}

function fromAddress() {
  return (process.env.SMTP_FROM || DEFAULT_FROM).trim();
}

function getTransporter() {
  if (mailProvider() !== "smtp") return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.office365.com",
      port: Math.max(1, parseInt(process.env.SMTP_PORT || "587", 10) || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
    });
  }
  return transporter;
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function uniqueRecipients(student) {
  const out = [];
  const seen = new Set();
  const add = (email, role) => {
    const e = String(email || "").trim().toLowerCase();
    if (!isValidEmail(e) || seen.has(e)) return;
    seen.add(e);
    out.push({ email: e, role });
  };
  add(student.email, "student");
  add(student.parent_email, "parent");
  return out;
}

async function logNotification(row) {
  try {
    await pool.query(
      `INSERT INTO notification_log
        (student_id, document_id, channel, event_type, recipient, recipient_role,
         subject, status, error, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.studentId,
        row.documentId || null,
        row.channel || "email",
        row.eventType || "doc_rejected",
        row.recipient || null,
        row.recipientRole || null,
        row.subject || null,
        row.status,
        row.error || null,
        row.metadata ? JSON.stringify(row.metadata) : null,
      ]
    );
  } catch (e) {
    console.warn("[notify] log failed:", e.message);
  }
}

function greeting(student, role) {
  if (role === "parent") {
    const pn = String(student.parent_name || "").trim();
    if (pn) return `Dear ${pn},`;
    return `Dear Parent/Guardian of ${student.name},`;
  }
  return `Dear ${student.name},`;
}

function greetingHtml(student, role) {
  if (role === "parent") {
    const pn = String(student.parent_name || "").trim();
    if (pn) return `Dear <b>${escapeHtml(pn)}</b>,`;
    return `Dear Parent/Guardian of <b>${escapeHtml(student.name)}</b>,`;
  }
  return `Dear <b>${escapeHtml(student.name)}</b>,`;
}

function buildRejectionContent({ student, documentName, staffNote, verifierLabel, recipientRole }) {
  const portal = portalUrl();
  const subject = `MAHE EduVerify — Action required: ${documentName} rejected (App ${student.app_no})`;
  const reason = staffNote || "Please review the document and upload a corrected copy.";
  const greet = greeting(student, recipientRole);
  const text = [
    greet,
    "",
    `Your document "${documentName}" (Application No. ${student.app_no}) was reviewed by the MAHE Admissions Verification Cell and has been rejected.`,
    "",
    `Reason: ${reason}`,
    "",
    "Next steps:",
    `1. Log in to EduVerify: ${portal}`,
    "2. Open your Document Checklist",
    "3. Re-upload the corrected document",
    "",
    "If this was a mandatory document, your self-declaration has been unlocked until you fix it.",
    "",
    `Helpdesk: ${HELPDESK_PHONE}`,
    `Email: ${HELPDESK_EMAIL}`,
    "",
    "— MAHE Admissions Verification Cell",
  ].join("\n");

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.5;max-width:600px">
<p>${greetingHtml(student, recipientRole)}</p>
<p>Your document <b>${escapeHtml(documentName)}</b> (Application No. <b>${escapeHtml(student.app_no)}</b>) was reviewed${verifierLabel ? ` by <b>${escapeHtml(verifierLabel)}</b>` : ""} and <span style="color:#b91c1c"><b>rejected</b></span>.</p>
<p style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px"><b>Reason:</b><br>${escapeHtml(reason)}</p>
<p><b>Next steps:</b></p>
<ol>
  <li>Log in to <a href="${escapeHtml(portal)}">EduVerify</a></li>
  <li>Open your <b>Document Checklist</b></li>
  <li>Re-upload the corrected document</li>
</ol>
<p style="font-size:13px;color:#64748b">If this was a mandatory document, your self-declaration has been unlocked until you upload and confirm the corrected file.</p>
<p style="font-size:13px">Helpdesk: ${escapeHtml(HELPDESK_PHONE)}<br>Email: <a href="mailto:${HELPDESK_EMAIL}">${HELPDESK_EMAIL}</a></p>
<p style="font-size:12px;color:#94a3b8">— MAHE Admissions Verification Cell</p>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmail({ to, subject, text, html, attachments, from, cc, bcc }) {
  const provider = mailProvider();
  if (!provider) throw new Error("Email not configured (set Graph OAuth2 or SMTP_USER + SMTP_PASS).");

  if (provider === "graph") {
    await sendViaGraph({ to, subject, text, html, attachments, from: from || fromAddress(), cc, bcc });
    return;
  }

  const tx = getTransporter();
  if (!tx) throw new Error("SMTP not configured.");
  const mail = {
    from: from || fromAddress(),
    to,
    subject,
    text,
    html,
  };
  if (attachments?.length) mail.attachments = attachments;
  if (cc) mail.cc = cc;
  if (bcc) mail.bcc = bcc;
  await tx.sendMail(mail);
}

/**
 * Notify student and parent/guardian when staff reject a document.
 * Fire-and-forget — errors are logged, never thrown to the API caller.
 */
async function notifyDocumentRejected({
  student,
  documentId,
  docCode,
  staffNote,
  verifierStaffId,
  verifierName,
}) {
  if (!student?.id) return { sent: 0, skipped: true, reason: "no-student" };

  const documentName = docMetaFor(docCode, student.profile, student.category).name || docCode;
  const verifierLabel = verifierStaffId
    ? `${verifierStaffId}${verifierName ? ` (${verifierName})` : ""}`
    : null;
  const recipients = uniqueRecipients(student);

  if (!recipients.length) {
    await logNotification({
      studentId: student.id,
      documentId,
      eventType: "doc_rejected",
      recipient: null,
      status: "skipped",
      error: "No valid student or parent email on file.",
      metadata: { docCode, documentName },
    });
    return { sent: 0, skipped: true, reason: "no-email" };
  }

  if (!isEmailConfigured()) {
    await logNotification({
      studentId: student.id,
      documentId,
      eventType: "doc_rejected",
      recipient: recipients.map((r) => r.email).join(", "),
      status: "skipped",
      error: "Email not configured (Graph OAuth2 or SMTP_USER + SMTP_PASS).",
      metadata: { docCode, documentName },
    });
    return { sent: 0, skipped: true, reason: "smtp-not-configured" };
  }

  let sent = 0;
  for (const { email, role } of recipients) {
    const content = buildRejectionContent({
      student,
      documentName,
      staffNote,
      verifierLabel,
      recipientRole: role,
    });
    try {
      await sendEmail({ to: email, ...content });
      await logNotification({
        studentId: student.id,
        documentId,
        eventType: "doc_rejected",
        recipient: email,
        recipientRole: role,
        subject: content.subject,
        status: "sent",
        metadata: { docCode, documentName, verifierStaffId },
      });
      sent += 1;
    } catch (e) {
      console.warn(`[notify] email to ${email} failed:`, e.message);
      await logNotification({
        studentId: student.id,
        documentId,
        eventType: "doc_rejected",
        recipient: email,
        recipientRole: role,
        subject: content.subject,
        status: "failed",
        error: e.message,
        metadata: { docCode, documentName, verifierStaffId },
      });
    }
  }
  return { sent, skipped: false };
}

function getEmailStatus() {
  const enabled = process.env.NOTIFY_EMAIL_ENABLED !== "false";
  const hasUser = !!String(process.env.SMTP_USER || "").trim();
  const provider = mailProvider();
  let reason = "ready";
  if (!enabled) reason = "disabled";
  else if (!provider) reason = "missing_credentials";
  return {
    enabled,
    configured: enabled && !!provider,
    mailProvider: provider,
    smtpUser: hasUser ? String(process.env.SMTP_USER).trim() : null,
    reason,
  };
}

async function getEmailHealth() {
  const status = getEmailStatus();
  let logTable = false;
  try {
    await pool.query("SELECT 1 FROM notification_log LIMIT 0");
    logTable = true;
  } catch (_) {
    logTable = false;
  }
  return { ...status, logTable };
}

async function listNotificationsForStudent(studentId, limit = 15) {
  try {
    const r = await pool.query(
      `SELECT id, document_id AS "documentId", event_type AS "eventType",
              recipient, recipient_role AS "recipientRole", subject,
              status, error, metadata, created_at AS "createdAt"
         FROM notification_log
        WHERE student_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [studentId, Math.min(Math.max(limit, 1), 50)]
    );
    return r.rows;
  } catch (e) {
    if (e.code === "42P01") return [];
    throw e;
  }
}

function fmtDate(v) {
  if (!v) return "To be announced";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function parseTimeLabel(label) {
  const s = String(label || "").trim();
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const mm = parseInt(m12[2], 10);
    const ap = m12[3].toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + mm;
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
  return null;
}

function minsToTimeLabel(totalMins) {
  const m = ((totalMins % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ap = h24 < 12 ? "AM" : "PM";
  const h12 = (h24 % 12) === 0 ? 12 : (h24 % 12);
  return `${h12}:${mm} ${ap}`;
}

function reportByTime(startTime, minutesBefore = 30) {
  const mins = parseTimeLabel(startTime);
  if (mins == null) return startTime || "To be announced";
  return minsToTimeLabel(mins - minutesBefore);
}

function fmtSlotTimeRange(start, end) {
  if (!start) return "To be announced";
  return end ? `${start} – ${end}` : start;
}

async function submissionEmailAlreadySent(studentId) {
  try {
    const r = await pool.query(
      `SELECT 1 FROM notification_log
        WHERE student_id=$1 AND event_type='submission_confirmed' AND status='sent'
        LIMIT 1`,
      [studentId]
    );
    return r.rows.length > 0;
  } catch (e) {
    if (e.code === "42P01") return false;
    throw e;
  }
}

function buildUploadedDocsList(docRows, student) {
  const visible = filterForProfile(docRows, student.profile, student.category, student.program);
  return visible
    .filter((d) => d.file_public_id)
    .map((d) => docMetaFor(d.doc_code, student.profile, student.category).name || d.doc_code);
}

function buildSubmissionContent({ student, verifySlot, uploadedDocs, recipientRole }) {
  const portal = portalUrl();
  const subject = `MAHE EduVerify — Document upload confirmed (App ${student.app_no})`;
  const greet = greeting(student, recipientRole);
  const hasSlot = !!verifySlot;
  const verificationDate = fmtDate(verifySlot?.schedule_date || student.assigned_verification_date || student.orientation_date);
  const slotTime = hasSlot ? fmtSlotTimeRange(verifySlot.start_time, verifySlot.end_time) : "To be announced";
  const reportAt = hasSlot ? reportByTime(verifySlot.start_time) : "To be announced";
  const room = hasSlot ? (verifySlot.room || "—") : "To be announced";
  const slotNo = hasSlot ? String(verifySlot.slot_no || "—") : "—";

  const docLines = uploadedDocs.length
    ? uploadedDocs.map((name, i) => `${i + 1}. ${name}`).join("\n")
    : "—";

  const slotBlock = hasSlot
    ? [
      "Your document verification slot:",
      `  Date: ${verificationDate}`,
      `  Room: ${room}`,
      `  Slot #: ${slotNo}`,
      `  Slot time: ${slotTime}`,
      `  Report by: ${reportAt} (please be present 30 minutes before your slot)`,
    ].join("\n")
    : [
      "Your document verification slot:",
      `  Assigned verification date: ${verificationDate}`,
      "  Room / slot time: will be communicated shortly. Log in to EduVerify to check for updates.",
    ].join("\n");

  const text = [
    greet,
    "",
    `Thank you for completing your document upload on EduVerify (Application No. ${student.app_no}).`,
    "",
    "We confirm that all mandatory documents have been uploaded and your self-declaration has been signed.",
    "",
    slotBlock,
    "",
    "Documents you uploaded (bring originals in this same order for faster verification):",
    docLines,
    "",
    "On your verification day, bring the physical originals of the documents listed above in the same sequence.",
    "",
    `View your verification summary: ${portal}`,
    "",
    `Helpdesk: ${HELPDESK_PHONE}`,
    `Email: ${HELPDESK_EMAIL}`,
    "",
    "— MAHE Admissions Verification Cell",
  ].join("\n");

  const docListHtml = uploadedDocs.length
    ? `<ol style="margin:8px 0 0 18px;padding:0">${uploadedDocs.map((n) =>
      `<li style="margin:4px 0">${escapeHtml(n)}</li>`
    ).join("")}</ol>`
    : '<p style="margin:8px 0 0">—</p>';

  const slotRows = hasSlot
    ? [
      ["Verification date", verificationDate],
      ["Room", room],
      ["Slot #", slotNo],
      ["Slot time", slotTime],
      ["Report by", `${reportAt} (30 min before slot)`],
    ]
    : [
      ["Assigned verification date", verificationDate],
      ["Room / slot time", "Will be communicated shortly — check EduVerify"],
    ];

  const slotTable = slotRows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(v)}</td></tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.5;max-width:640px">
<p>${greetingHtml(student, recipientRole)}</p>
<p>Thank you for completing your document upload on <b>EduVerify</b> (Application No. <b>${escapeHtml(student.app_no)}</b>).</p>
<p>We confirm that <b>all mandatory documents have been uploaded</b> and your <b>self-declaration has been signed</b>.</p>
<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:14px;margin:16px 0">
<p style="margin:0 0 8px;font-weight:600;color:#065f46">Your document verification slot</p>
<table style="font-size:14px;line-height:1.5;border-collapse:collapse">${slotTable}</table>
</div>
<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin:16px 0">
<p style="margin:0;font-weight:600;color:#92400e">Bring originals in the same order</p>
<p style="margin:8px 0 0;font-size:14px">Documents you uploaded — present physical copies at the verification counter in this sequence:</p>
${docListHtml}
</div>
<p><a href="${escapeHtml(portal)}" style="display:inline-block;background:#7b1e15;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">Open EduVerify</a></p>
<p style="font-size:13px;color:#64748b">Helpdesk: ${escapeHtml(HELPDESK_PHONE)}<br>Email: <a href="mailto:${HELPDESK_EMAIL}">${HELPDESK_EMAIL}</a></p>
<p style="font-size:12px;color:#94a3b8">— MAHE Admissions Verification Cell</p>
</body></html>`;

  return { subject, text, html };
}

/**
 * Confirm document submission to student (and parent) after self-declaration.
 * Includes verification date/slot when allocated. Sent once per student.
 */
async function notifyDocumentsSubmitted(studentId) {
  if (!studentId) return { sent: 0, skipped: true, reason: "no-student" };
  if (await submissionEmailAlreadySent(studentId)) {
    return { sent: 0, skipped: true, reason: "already-sent" };
  }

  const sr = await pool.query("SELECT * FROM students WHERE id=$1", [studentId]);
  const student = sr.rows[0];
  if (!student) return { sent: 0, skipped: true, reason: "student-not-found" };

  let verifySlot = null;
  if (student.verify_schedule_id) {
    const vr = await pool.query("SELECT * FROM verify_schedule WHERE id=$1", [student.verify_schedule_id]);
    verifySlot = vr.rows[0] || null;
  }

  const dr = await pool.query(
    "SELECT doc_code, file_public_id FROM documents WHERE student_id=$1 ORDER BY id",
    [studentId]
  );
  const uploadedDocs = buildUploadedDocsList(dr.rows, student);
  const recipients = uniqueRecipients(student);

  if (!recipients.length) {
    await logNotification({
      studentId,
      eventType: "submission_confirmed",
      recipient: null,
      status: "skipped",
      error: "No valid student or parent email on file.",
      metadata: { uploadedCount: uploadedDocs.length, hasSlot: !!verifySlot },
    });
    return { sent: 0, skipped: true, reason: "no-email" };
  }

  if (!isEmailConfigured()) {
    await logNotification({
      studentId,
      eventType: "submission_confirmed",
      recipient: recipients.map((r) => r.email).join(", "),
      status: "skipped",
      error: "Email not configured (Graph OAuth2 or SMTP_USER + SMTP_PASS).",
      metadata: { uploadedCount: uploadedDocs.length, hasSlot: !!verifySlot },
    });
    return { sent: 0, skipped: true, reason: "email-not-configured" };
  }

  let sent = 0;
  for (const { email, role } of recipients) {
    const content = buildSubmissionContent({ student, verifySlot, uploadedDocs, recipientRole: role });
    try {
      await sendEmail({ to: email, ...content });
      await logNotification({
        studentId,
        eventType: "submission_confirmed",
        recipient: email,
        recipientRole: role,
        subject: content.subject,
        status: "sent",
        metadata: {
          uploadedCount: uploadedDocs.length,
          hasSlot: !!verifySlot,
          slotId: verifySlot?.id || null,
        },
      });
      sent += 1;
    } catch (e) {
      console.warn(`[notify] submission email to ${email} failed:`, e.message);
      await logNotification({
        studentId,
        eventType: "submission_confirmed",
        recipient: email,
        recipientRole: role,
        subject: content.subject,
        status: "failed",
        error: e.message,
        metadata: { uploadedCount: uploadedDocs.length, hasSlot: !!verifySlot },
      });
    }
  }
  return { sent, skipped: false };
}

async function sendTestEmail(to) {
  if (!isValidEmail(to)) throw new Error("Invalid recipient email.");
  if (!isEmailConfigured()) {
    throw new Error("Email not configured — set Azure Graph OAuth2 (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SMTP_USER) or SMTP_PASS.");
  }
  const portal = portalUrl();
  const subject = "MAHE EduVerify — test email";
  const text = [
    "This is a test message from the EduVerify server.",
    "",
    `Portal: ${portal}`,
    `Time: ${new Date().toISOString()}`,
    "",
    "If you received this, SMTP is working.",
  ].join("\n");
  await sendEmail({
    to: String(to).trim(),
    subject,
    text,
    html: `<p>This is a <b>test message</b> from EduVerify.</p><p>Portal: <a href="${escapeHtml(portal)}">${escapeHtml(portal)}</a></p><p>Time: ${escapeHtml(new Date().toISOString())}</p>`,
  });
  return { ok: true, to: String(to).trim() };
}

module.exports = {
  isEmailConfigured,
  getEmailStatus,
  getEmailHealth,
  notifyDocumentRejected,
  notifyDocumentsSubmitted,
  listNotificationsForStudent,
  sendTestEmail,
  sendEmail,
  logNotification,
  uniqueRecipients,
  greeting,
  greetingHtml,
};
