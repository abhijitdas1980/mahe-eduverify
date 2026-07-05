/* Transactional email via MAHE Microsoft 365 SMTP (Office 365). */
const nodemailer = require("nodemailer");
const { pool } = require("../config/db");
const { docMetaFor } = require("../config/checklists");

const DEFAULT_FROM = "MAHE Admissions <admissions.maheblr@manipal.edu>";
const DEFAULT_PORTAL = "https://maheblreduverify.manipal.edu";
const HELPDESK_PHONE = "080 2449 4100 | 080 2449 4141 | 7411747070";
const HELPDESK_EMAIL = "admissions.maheblr@manipal.edu";

let transporter;

function isEmailConfigured() {
  if (process.env.NOTIFY_EMAIL_ENABLED === "false") return false;
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function portalUrl() {
  const u = (process.env.PORTAL_URL || process.env.CORS_ORIGIN || DEFAULT_PORTAL).trim();
  return u.replace(/\/$/, "") || DEFAULT_PORTAL;
}

function fromAddress() {
  return (process.env.SMTP_FROM || DEFAULT_FROM).trim();
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
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

async function sendEmail({ to, subject, text, html, attachments }) {
  const tx = getTransporter();
  if (!tx) throw new Error("SMTP not configured.");
  const mail = {
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  };
  if (attachments?.length) mail.attachments = attachments;
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
      error: "SMTP not configured (set SMTP_USER and SMTP_PASS).",
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
  const hasPass = !!String(process.env.SMTP_PASS || "").trim();
  let reason = "ready";
  if (!enabled) reason = "disabled";
  else if (!hasUser || !hasPass) reason = "missing_credentials";
  return {
    enabled,
    configured: enabled && hasUser && hasPass,
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

async function sendTestEmail(to) {
  if (!isValidEmail(to)) throw new Error("Invalid recipient email.");
  if (!isEmailConfigured()) throw new Error("SMTP not configured — set SMTP_USER and SMTP_PASS on the server.");
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
  listNotificationsForStudent,
  sendTestEmail,
  sendEmail,
  logNotification,
  uniqueRecipients,
  greeting,
  greetingHtml,
};
