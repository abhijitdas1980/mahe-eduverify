/* Communication Center — compose, send, schedule, preview. */
const crypto = require("crypto");
const { isEmailConfigured, sendEmail } = require("../notifications");
const { renderForRecipient, loadStudentContext, PLACEHOLDER_LIST, htmlToPlain } = require("./placeholders");
const { resolveRecipients, countRecipients, filterOptions } = require("./recipients");
const repo = require("./repository");

function fromAddress(settings) {
  return (settings.defaultFrom || process.env.SMTP_FROM || process.env.SMTP_USER || "").trim()
    || "MAHE Admissions <admissions.maheblr@manipal.edu>";
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function trackingPixelUrl(token) {
  const base = (process.env.APP_URL || process.env.PORTAL_URL || process.env.CORS_ORIGIN || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/api/comm/track/${token}.gif`;
}

function injectTrackingPixel(html, token) {
  const url = trackingPixelUrl(token);
  if (!url) return html;
  const img = `<img src="${url}" width="1" height="1" alt="" style="display:none" />`;
  if (html.includes("</body>")) return html.replace("</body>", `${img}</body>`);
  return html + img;
}

function audienceRecipients(student, audience) {
  const out = [];
  if ((audience === "student" || audience === "both" || audience === "separate") && isValidEmail(student.email)) {
    out.push({ role: "student", email: student.email.trim().toLowerCase(), name: student.name });
  }
  if ((audience === "parent" || audience === "both" || audience === "separate") && isValidEmail(student.parent_email)) {
    out.push({ role: "parent", email: student.parent_email.trim().toLowerCase(), name: student.parent_name || "Parent" });
  }
  return out;
}

async function previewMessage(payload) {
  const { subject, bodyHtml, parentBodyHtml, appNo, recipientRole = "student" } = payload;
  const ctx = await loadStudentContextByAppNo(appNo);
  if (!ctx) throw new Error("Student not found for preview.");
  const rendered = renderForRecipient(
    { subject, bodyHtml, bodyText: htmlToPlain(bodyHtml), parentBodyHtml },
    ctx.student,
    { verifySlot: ctx.verifySlot, slot: ctx.slot },
    recipientRole
  );
  return rendered;
}

async function loadStudentContextByAppNo(appNo) {
  const { pool } = require("../../config/db");
  const sr = await pool.query("SELECT id FROM students WHERE LOWER(app_no)=LOWER($1)", [appNo]);
  if (!sr.rows[0]) return null;
  return loadStudentContext(sr.rows[0].id);
}

async function saveDraft(payload, staffId, files = []) {
  const settings = await repo.getSettings();
  validateAttachments(files, settings);
  const msg = await repo.createMessage({
    status: "draft",
    subject: payload.subject || "(No subject)",
    bodyHtml: payload.bodyHtml || "<p></p>",
    bodyText: payload.bodyText || htmlToPlain(payload.bodyHtml),
    parentBodyHtml: payload.parentBodyHtml || null,
    fromAddress: payload.fromAddress || fromAddress(settings),
    cc: payload.cc || null,
    bcc: payload.bcc || null,
    audience: payload.audience || "both",
    recipientMode: payload.recipientMode || "selected",
    recipientFilter: payload.recipientFilter || {},
    selectedAppNos: payload.selectedAppNos || [],
    templateId: payload.templateId || null,
    createdBy: staffId,
  });
  if (files.length) {
    await repo.saveAttachments(msg.id, files.map(normalizeFile));
  }
  return repo.serializeMessage(msg);
}

async function updateDraft(id, payload, files) {
  const existing = await repo.getMessage(id);
  if (!existing) throw new Error("Message not found.");
  if (!["draft", "scheduled"].includes(existing.status)) {
    throw new Error("Only drafts or scheduled messages can be edited.");
  }
  const settings = await repo.getSettings();
  if (files?.length) validateAttachments(files, settings);
  const msg = await repo.updateMessage(id, {
    subject: payload.subject ?? existing.subject,
    bodyHtml: payload.bodyHtml ?? existing.body_html,
    bodyText: payload.bodyText ?? existing.body_text,
    parentBodyHtml: payload.parentBodyHtml ?? existing.parent_body_html,
    fromAddress: payload.fromAddress ?? existing.from_address,
    cc: payload.cc ?? existing.cc,
    bcc: payload.bcc ?? existing.bcc,
    audience: payload.audience ?? existing.audience,
    recipientMode: payload.recipientMode ?? existing.recipient_mode,
    recipientFilter: payload.recipientFilter ?? existing.recipient_filter,
    selectedAppNos: payload.selectedAppNos ?? existing.selected_app_nos,
    templateId: payload.templateId ?? existing.template_id,
    scheduledAt: payload.scheduledAt ?? existing.scheduled_at,
    status: payload.scheduledAt ? "scheduled" : existing.status,
  });
  if (files?.length) await repo.saveAttachments(id, files.map(normalizeFile));
  return repo.serializeMessage(msg);
}

function normalizeFile(f) {
  return {
    filename: f.originalname || f.filename || "attachment",
    mimeType: f.mimetype || f.mimeType,
    sizeBytes: f.size || f.sizeBytes || (f.buffer ? f.buffer.length : 0),
    data: f.buffer || f.data,
  };
}

function validateAttachments(files, settings) {
  if (!files?.length) return;
  if (files.length > settings.maxAttachments) {
    throw new Error(`Maximum ${settings.maxAttachments} attachments allowed.`);
  }
  const maxBytes = settings.maxAttachmentMb * 1024 * 1024;
  for (const f of files) {
    const size = f.size || f.buffer?.length || 0;
    if (size > maxBytes) {
      throw new Error(`Each attachment must be ${settings.maxAttachmentMb} MB or smaller.`);
    }
  }
}

async function scheduleMessage(id, scheduledAt, staffId) {
  const msg = await repo.getMessage(id);
  if (!msg) throw new Error("Message not found.");
  if (!scheduledAt) throw new Error("Schedule date/time is required.");
  await repo.updateMessage(id, { status: "scheduled", scheduledAt });
  return repo.serializeMessage(await repo.getMessage(id));
}

async function sendMessage(id, staffId) {
  if (!isEmailConfigured()) throw new Error("SMTP not configured.");

  const msg = await repo.getMessage(id);
  if (!msg) throw new Error("Message not found.");
  if (msg.status === "sent") throw new Error("Message already sent.");
  if (msg.status === "sending") throw new Error("Message is already being sent.");

  await repo.updateMessage(id, { status: "sending" });

  const students = await resolveRecipients({
    mode: msg.recipient_mode,
    filter: msg.recipient_filter || {},
    appNos: msg.selected_app_nos || [],
  });

  if (!students.length) {
    await repo.updateMessage(id, { status: "failed", stats: { error: "No recipients matched." } });
    throw new Error("No recipients matched the selection.");
  }

  const attachments = await repo.loadAttachmentData(id);
  const settings = await repo.getSettings();
  const mailFrom = msg.from_address || fromAddress(settings);
  let sent = 0;
  let failed = 0;
  let opened = 0;

  for (const row of students) {
    const ctx = await loadStudentContext(row.id);
    if (!ctx) continue;
    const recipients = audienceRecipients(ctx.student, msg.audience);
    for (const rec of recipients) {
      const rendered = renderForRecipient(
        {
          subject: msg.subject,
          bodyHtml: msg.body_html,
          bodyText: msg.body_text,
          parentBodyHtml: msg.parent_body_html,
        },
        ctx.student,
        { verifySlot: ctx.verifySlot, slot: ctx.slot },
        rec.role
      );

      const delivery = await repo.createDelivery({
        messageId: id,
        studentId: ctx.student.id,
        recipientEmail: rec.email,
        recipientRole: rec.role,
        recipientName: rec.name,
        subject: rendered.subject,
        status: "pending",
      });

      try {
        const html = injectTrackingPixel(rendered.html, delivery.tracking_token);
        await sendEmail({
          to: rec.email,
          subject: rendered.subject,
          text: rendered.text,
          html,
          attachments,
          from: mailFrom,
          cc: msg.cc || undefined,
          bcc: msg.bcc || undefined,
        });
        await repo.markDeliverySent(delivery.id);
        sent += 1;
      } catch (e) {
        await repo.markDeliveryFailed(delivery.id, e.message);
        failed += 1;
      }
    }
  }

  const stats = { sent, failed, opened, recipients: students.length };
  await repo.updateMessage(id, {
    status: failed && !sent ? "failed" : "sent",
    sentAt: new Date(),
    stats,
  });

  return { messageId: id, ...stats };
}

async function createAndSend(payload, staffId, files = []) {
  const draft = await saveDraft(payload, staffId, files);
  if (payload.scheduledAt) {
    await scheduleMessage(draft.id, payload.scheduledAt, staffId);
    return { scheduled: true, message: await repo.serializeMessage(await repo.getMessage(draft.id)) };
  }
  const result = await sendMessage(draft.id, staffId);
  return { scheduled: false, ...result };
}

async function getMessageDetail(id) {
  const msg = await repo.getMessage(id);
  if (!msg) return null;
  const serialized = repo.serializeMessage(msg);
  serialized.attachments = await repo.listAttachments(id);
  const preview = await countRecipients({
    mode: msg.recipient_mode,
    filter: msg.recipient_filter || {},
    appNos: msg.selected_app_nos || [],
  });
  serialized.recipientPreview = preview;
  return serialized;
}

module.exports = {
  PLACEHOLDER_LIST,
  filterOptions,
  countRecipients,
  previewMessage,
  saveDraft,
  updateDraft,
  scheduleMessage,
  sendMessage,
  createAndSend,
  getMessageDetail,
  fromAddress,
};
