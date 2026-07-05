/* Communication Center API — /api/admin/communication/* */
const express = require("express");
const { requireAdmin, requireActiveAdmin, requireSupervisor } = require("../middleware/auth");
const { emailAttachments } = require("../middleware/emailAttachmentUpload");
const { audit } = require("../lib/audit");
const repo = require("../lib/communication/repository");
const comm = require("../lib/communication/service");
const { PLACEHOLDER_LIST } = require("../lib/communication/placeholders");

const router = express.Router();
router.use(requireAdmin);
router.use(requireActiveAdmin);
router.use(requireSupervisor);

router.get("/meta", async (_req, res, next) => {
  try {
    const [settings, filters, analytics] = await Promise.all([
      repo.getSettings(),
      comm.filterOptions(),
      repo.analyticsSummary(),
    ]);
    res.json({
      settings,
      filters,
      analytics,
      placeholders: PLACEHOLDER_LIST,
      fromDefault: comm.fromAddress(settings),
    });
  } catch (e) { next(e); }
});

router.patch("/settings", async (req, res, next) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.maxAttachmentMb != null) patch.max_attachment_mb = b.maxAttachmentMb;
    if (b.maxAttachments != null) patch.max_attachments = b.maxAttachments;
    if (b.defaultFrom != null) patch.default_from = b.defaultFrom;
    const settings = await repo.updateSettings(patch);
    await audit(req, "admin", req.admin.staffId, "COMM_SETTINGS", JSON.stringify(settings));
    res.json({ settings });
  } catch (e) { next(e); }
});

router.get("/templates", async (_req, res, next) => {
  try {
    res.json({ templates: await repo.listTemplates() });
  } catch (e) { next(e); }
});

router.post("/templates", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.subject || !b.bodyHtml) {
      return res.status(400).json({ error: "Name, subject, and body are required." });
    }
    const t = await repo.saveTemplate({
      name: b.name,
      category: b.category,
      subject: b.subject,
      bodyHtml: b.bodyHtml,
      bodyText: b.bodyText,
      audience: b.audience,
      createdBy: req.admin.staffId,
    });
    await audit(req, "admin", req.admin.staffId, "COMM_TEMPLATE_CREATE", b.name);
    res.json({ template: t });
  } catch (e) { next(e); }
});

router.patch("/templates/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const t = await repo.saveTemplate({
      id: parseInt(req.params.id, 10),
      name: b.name,
      category: b.category,
      subject: b.subject,
      bodyHtml: b.bodyHtml,
      bodyText: b.bodyText,
      audience: b.audience,
      createdBy: req.admin.staffId,
    });
    res.json({ template: t });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/templates/:id", async (req, res, next) => {
  try {
    await repo.deleteTemplate(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/recipients/count", async (req, res, next) => {
  try {
    const b = req.body || {};
    const preview = await comm.countRecipients({
      mode: b.recipientMode || "selected",
      filter: b.recipientFilter || {},
      appNos: b.selectedAppNos || [],
    });
    res.json(preview);
  } catch (e) { next(e); }
});

router.post("/preview", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.appNo) return res.status(400).json({ error: "appNo is required for preview." });
    const preview = await comm.previewMessage(b);
    res.json(preview);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/messages", async (req, res, next) => {
  try {
    const messages = await repo.listMessages({
      status: req.query.status || null,
      q: req.query.q || "",
      limit: parseInt(req.query.limit || "50", 10),
      offset: parseInt(req.query.offset || "0", 10),
    });
    res.json({ messages });
  } catch (e) { next(e); }
});

router.get("/messages/:id", async (req, res, next) => {
  try {
    const message = await comm.getMessageDetail(parseInt(req.params.id, 10));
    if (!message) return res.status(404).json({ error: "Message not found." });
    res.json({ message });
  } catch (e) { next(e); }
});

router.post("/messages/draft", emailAttachments("attachments"), async (req, res, next) => {
  try {
    const b = req.body || {};
    const message = await comm.saveDraft(parseBody(b), req.admin.staffId, req.files || []);
    await audit(req, "admin", req.admin.staffId, "COMM_DRAFT", `#${message.id}`);
    res.json({ message });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/messages/:id", emailAttachments("attachments"), async (req, res, next) => {
  try {
    const message = await comm.updateDraft(parseInt(req.params.id, 10), parseBody(req.body || {}), req.files);
    res.json({ message });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/messages/:id/schedule", async (req, res, next) => {
  try {
    const scheduledAt = req.body?.scheduledAt;
    const message = await comm.scheduleMessage(parseInt(req.params.id, 10), scheduledAt, req.admin.staffId);
    await audit(req, "admin", req.admin.staffId, "COMM_SCHEDULE", `#${message.id} ${scheduledAt}`);
    res.json({ message });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/messages/:id/send", async (req, res, next) => {
  try {
    const result = await comm.sendMessage(parseInt(req.params.id, 10), req.admin.staffId);
    await audit(req, "admin", req.admin.staffId, "COMM_SEND", `#${req.params.id} sent=${result.sent}`);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/messages/send", emailAttachments("attachments"), async (req, res, next) => {
  try {
    const body = parseBody(req.body || {});
    const result = await comm.createAndSend(body, req.admin.staffId, req.files || []);
    await audit(req, "admin", req.admin.staffId, "COMM_SEND", result.scheduled ? "scheduled" : `sent=${result.sent}`);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/deliveries", async (req, res, next) => {
  try {
    const deliveries = await repo.listDeliveries({
      messageId: req.query.messageId ? parseInt(req.query.messageId, 10) : null,
      status: req.query.status || null,
      q: req.query.q || "",
      limit: parseInt(req.query.limit || "100", 10),
    });
    res.json({ deliveries: deliveries.map(serializeDelivery) });
  } catch (e) { next(e); }
});

router.get("/analytics", async (_req, res, next) => {
  try {
    res.json({ analytics: await repo.analyticsSummary() });
  } catch (e) { next(e); }
});

function parseBody(b) {
  let recipientFilter = b.recipientFilter;
  let selectedAppNos = b.selectedAppNos;
  if (typeof recipientFilter === "string") {
    try { recipientFilter = JSON.parse(recipientFilter); } catch (_) { recipientFilter = {}; }
  }
  if (typeof selectedAppNos === "string") {
    try { selectedAppNos = JSON.parse(selectedAppNos); } catch (_) { selectedAppNos = selectedAppNos.split(",").map((s) => s.trim()).filter(Boolean); }
  }
  return {
    subject: b.subject,
    bodyHtml: b.bodyHtml,
    bodyText: b.bodyText,
    parentBodyHtml: b.parentBodyHtml,
    fromAddress: b.fromAddress,
    cc: b.cc,
    bcc: b.bcc,
    audience: b.audience || "both",
    recipientMode: b.recipientMode || "selected",
    recipientFilter: recipientFilter || {},
    selectedAppNos: selectedAppNos || [],
    scheduledAt: b.scheduledAt || null,
    templateId: b.templateId ? parseInt(b.templateId, 10) : null,
  };
}

function serializeDelivery(d) {
  return {
    id: d.id,
    messageId: d.message_id,
    appNo: d.app_no,
    recipientEmail: d.recipient_email,
    recipientRole: d.recipient_role,
    recipientName: d.recipient_name,
    subject: d.subject,
    status: d.status,
    error: d.error,
    sentAt: d.sent_at,
    openedAt: d.opened_at,
    sentBy: d.sent_by,
    messageSubject: d.message_subject,
    createdAt: d.created_at,
  };
}

module.exports = router;
