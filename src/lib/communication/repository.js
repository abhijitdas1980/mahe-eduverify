/* Communication Center — database access. */
const { pool } = require("../../config/db");
const crypto = require("crypto");

function serializeMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    parentBodyHtml: row.parent_body_html,
    fromAddress: row.from_address,
    cc: row.cc,
    bcc: row.bcc,
    audience: row.audience,
    recipientMode: row.recipient_mode,
    recipientFilter: row.recipient_filter || {},
    selectedAppNos: row.selected_app_nos || [],
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    templateId: row.template_id,
    stats: row.stats || {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSettings() {
  const r = await pool.query("SELECT key, value FROM comm_settings");
  const map = {};
  r.rows.forEach((row) => { map[row.key] = row.value; });
  return {
    maxAttachmentMb: Math.max(1, parseInt(map.max_attachment_mb || "10", 10) || 10),
    maxAttachments: Math.max(1, parseInt(map.max_attachments || "5", 10) || 5),
    defaultFrom: map.default_from || "",
  };
}

async function updateSettings(patch) {
  const entries = Object.entries(patch || {});
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO comm_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, String(value)]
    );
  }
  return getSettings();
}

async function listTemplates() {
  const r = await pool.query(
    `SELECT id, name, slug, category, subject, body_html AS "bodyHtml", body_text AS "bodyText",
            audience, is_system AS "isSystem", created_by AS "createdBy", updated_at AS "updatedAt"
       FROM comm_templates ORDER BY is_system DESC, name`
  );
  return r.rows;
}

async function getTemplate(id) {
  const r = await pool.query("SELECT * FROM comm_templates WHERE id=$1", [id]);
  return r.rows[0] || null;
}

async function saveTemplate({ id, name, category, subject, bodyHtml, bodyText, audience, createdBy }) {
  if (id) {
    const r = await pool.query(
      `UPDATE comm_templates SET name=$1, category=$2, subject=$3, body_html=$4, body_text=$5,
              audience=$6, updated_at=now()
        WHERE id=$7 AND is_system=false RETURNING *`,
      [name, category || "general", subject, bodyHtml, bodyText || null, audience || "both", id]
    );
    if (!r.rows[0]) throw new Error("Template not found or system template cannot be edited.");
    return r.rows[0];
  }
  const slug = `custom-${Date.now()}`;
  const r = await pool.query(
    `INSERT INTO comm_templates (name, slug, category, subject, body_html, body_text, audience, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, slug, category || "general", subject, bodyHtml, bodyText || null, audience || "both", createdBy]
  );
  return r.rows[0];
}

async function deleteTemplate(id) {
  const r = await pool.query(
    "DELETE FROM comm_templates WHERE id=$1 AND is_system=false RETURNING id",
    [id]
  );
  if (!r.rows[0]) throw new Error("Template not found or system template cannot be deleted.");
}

async function createMessage(row) {
  const r = await pool.query(
    `INSERT INTO comm_messages
      (status, subject, body_html, body_text, parent_body_html, from_address, cc, bcc,
       audience, recipient_mode, recipient_filter, selected_app_nos, scheduled_at, template_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      row.status || "draft",
      row.subject,
      row.bodyHtml,
      row.bodyText || null,
      row.parentBodyHtml || null,
      row.fromAddress || null,
      row.cc || null,
      row.bcc || null,
      row.audience || "both",
      row.recipientMode || "selected",
      row.recipientFilter ? JSON.stringify(row.recipientFilter) : null,
      row.selectedAppNos?.length ? row.selectedAppNos : null,
      row.scheduledAt || null,
      row.templateId || null,
      row.createdBy,
    ]
  );
  return r.rows[0];
}

async function updateMessage(id, patch) {
  const fields = [];
  const vals = [];
  let i = 1;
  const map = {
    status: "status", subject: "subject", bodyHtml: "body_html", bodyText: "body_text",
    parentBodyHtml: "parent_body_html", fromAddress: "from_address", cc: "cc", bcc: "bcc",
    audience: "audience", recipientMode: "recipient_mode", scheduledAt: "scheduled_at",
    sentAt: "sent_at", stats: "stats", templateId: "template_id",
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) {
      fields.push(`${col}=$${i++}`);
      vals.push(k === "stats" ? JSON.stringify(patch[k]) : patch[k]);
    }
  }
  if (patch.recipientFilter !== undefined) {
    fields.push(`recipient_filter=$${i++}`);
    vals.push(JSON.stringify(patch.recipientFilter || {}));
  }
  if (patch.selectedAppNos !== undefined) {
    fields.push(`selected_app_nos=$${i++}`);
    vals.push(patch.selectedAppNos?.length ? patch.selectedAppNos : null);
  }
  if (!fields.length) return getMessage(id);
  fields.push("updated_at=now()");
  vals.push(id);
  const r = await pool.query(
    `UPDATE comm_messages SET ${fields.join(", ")} WHERE id=$${i} RETURNING *`,
    vals
  );
  return r.rows[0];
}

async function getMessage(id) {
  const r = await pool.query("SELECT * FROM comm_messages WHERE id=$1", [id]);
  return r.rows[0] || null;
}

async function listMessages({ status, q, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const vals = [];
  let i = 1;
  if (status) { clauses.push(`status=$${i++}`); vals.push(status); }
  if (q) {
    clauses.push(`(subject ILIKE $${i} OR created_by ILIKE $${i})`);
    vals.push(`%${q}%`);
    i++;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  vals.push(Math.min(limit, 200), offset);
  const r = await pool.query(
    `SELECT * FROM comm_messages ${where} ORDER BY updated_at DESC LIMIT $${i++} OFFSET $${i}`,
    vals
  );
  return r.rows.map(serializeMessage);
}

async function saveAttachments(messageId, files) {
  await pool.query("DELETE FROM comm_message_attachments WHERE message_id=$1", [messageId]);
  for (const f of files || []) {
    await pool.query(
      `INSERT INTO comm_message_attachments (message_id, filename, mime_type, size_bytes, data)
       VALUES ($1,$2,$3,$4,$5)`,
      [messageId, f.filename, f.mimeType || null, f.sizeBytes || 0, f.data]
    );
  }
}

async function listAttachments(messageId) {
  const r = await pool.query(
    `SELECT id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt"
       FROM comm_message_attachments WHERE message_id=$1 ORDER BY id`,
    [messageId]
  );
  return r.rows;
}

async function loadAttachmentData(messageId) {
  const r = await pool.query(
    "SELECT filename, mime_type, data FROM comm_message_attachments WHERE message_id=$1 ORDER BY id",
    [messageId]
  );
  return r.rows.map((row) => ({
    filename: row.filename,
    contentType: row.mime_type,
    content: row.data,
  }));
}

async function createDelivery(row) {
  const token = crypto.randomBytes(24).toString("hex");
  const r = await pool.query(
    `INSERT INTO comm_deliveries
      (message_id, student_id, recipient_email, recipient_role, recipient_name, subject, status, tracking_token, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      row.messageId, row.studentId, row.recipientEmail, row.recipientRole,
      row.recipientName || null, row.subject, row.status || "pending", token,
      row.metadata ? JSON.stringify(row.metadata) : null,
    ]
  );
  return r.rows[0];
}

async function markDeliverySent(id) {
  await pool.query(
    "UPDATE comm_deliveries SET status='sent', sent_at=now() WHERE id=$1",
    [id]
  );
}

async function markDeliveryFailed(id, error) {
  await pool.query(
    "UPDATE comm_deliveries SET status='failed', error=$2 WHERE id=$1",
    [id, error]
  );
}

async function markDeliveryOpened(token) {
  const r = await pool.query(
    `UPDATE comm_deliveries SET status=CASE WHEN status='sent' THEN 'opened' ELSE status END,
            opened_at=COALESCE(opened_at, now())
      WHERE tracking_token=$1 RETURNING id, message_id`,
    [token]
  );
  return r.rows[0] || null;
}

async function listDeliveries({ messageId, status, q, limit = 100, offset = 0 } = {}) {
  const clauses = [];
  const vals = [];
  let i = 1;
  if (messageId) { clauses.push(`d.message_id=$${i++}`); vals.push(messageId); }
  if (status) { clauses.push(`d.status=$${i++}`); vals.push(status); }
  if (q) {
    clauses.push(`(d.recipient_email ILIKE $${i} OR d.recipient_name ILIKE $${i} OR d.subject ILIKE $${i})`);
    vals.push(`%${q}%`);
    i++;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  vals.push(Math.min(limit, 500), offset);
  const r = await pool.query(
    `SELECT d.*, s.app_no, m.subject AS message_subject, m.created_by AS sent_by
       FROM comm_deliveries d
       LEFT JOIN students s ON s.id = d.student_id
       LEFT JOIN comm_messages m ON m.id = d.message_id
       ${where}
       ORDER BY d.created_at DESC LIMIT $${i++} OFFSET $${i}`,
    vals
  );
  return r.rows;
}

async function analyticsSummary() {
  const r = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','opened')) AS sent,
      COUNT(*) FILTER (WHERE status='opened') AS opened,
      COUNT(*) FILTER (WHERE status='failed') AS failed,
      COUNT(*) FILTER (WHERE status='pending') AS pending
    FROM comm_deliveries
  `);
  const m = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status='draft') AS drafts,
      COUNT(*) FILTER (WHERE status='scheduled') AS scheduled,
      COUNT(*) FILTER (WHERE status='sent') AS campaigns_sent,
      COUNT(*) FILTER (WHERE status='failed') AS campaigns_failed
    FROM comm_messages
  `);
  const sent = Number(r.rows[0]?.sent || 0);
  const opened = Number(r.rows[0]?.opened || 0);
  return {
    totalSent: sent,
    delivered: sent,
    opened,
    failed: Number(r.rows[0]?.failed || 0),
    pending: Number(r.rows[0]?.pending || 0),
    openRate: sent ? Math.round((opened / sent) * 1000) / 10 : 0,
    drafts: Number(m.rows[0]?.drafts || 0),
    scheduled: Number(m.rows[0]?.scheduled || 0),
    campaignsSent: Number(m.rows[0]?.campaigns_sent || 0),
    campaignsFailed: Number(m.rows[0]?.campaigns_failed || 0),
  };
}

async function listDueScheduled() {
  const r = await pool.query(
    `SELECT * FROM comm_messages
      WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= now()
      ORDER BY scheduled_at LIMIT 5`
  );
  return r.rows;
}

async function listQueuedMessages(limit = 3) {
  const r = await pool.query(
    `SELECT * FROM comm_messages
      WHERE status='queued'
      ORDER BY created_at LIMIT $1`,
    [limit]
  );
  return r.rows;
}

async function claimMessageForSending(id) {
  const r = await pool.query(
    `UPDATE comm_messages SET status='sending', updated_at=now()
      WHERE id=$1 AND status IN ('queued','scheduled')
      RETURNING *`,
    [id]
  );
  return r.rows[0] || null;
}

async function resetStuckSending(maxAgeMinutes = 15) {
  await pool.query(
    `UPDATE comm_messages SET status='queued', updated_at=now()
      WHERE status='sending' AND updated_at < now() - ($1::text || ' minutes')::interval`,
    [String(maxAgeMinutes)]
  );
}

module.exports = {
  serializeMessage,
  getSettings,
  updateSettings,
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  createMessage,
  updateMessage,
  getMessage,
  listMessages,
  saveAttachments,
  listAttachments,
  loadAttachmentData,
  createDelivery,
  markDeliverySent,
  markDeliveryFailed,
  markDeliveryOpened,
  listDeliveries,
  analyticsSummary,
  listDueScheduled,
  listQueuedMessages,
  claimMessageForSending,
  resetStuckSending,
};
