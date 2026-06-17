/* Student bulk-upload routes — mounted at /api/admin/students/bulk-upload */
const express = require("express");
const { pool } = require("../config/db");
const { requireAdmin, requireSupervisor } = require("../middleware/auth");
const { singleExcel } = require("../middleware/excelUpload");
const { audit } = require("../lib/audit");
const { TEMPLATE_FILENAME } = require("../constants/studentBulkUpload");
const { buildTemplateBuffer, parseWorkbookBuffer } = require("../lib/studentBulkExcel");
const { validateRows, loadExistingAppNos } = require("../lib/studentBulkValidator");
const { bulkInsertStudents } = require("../lib/studentBulkImport");
const { createSession, getSession, deleteSession } = require("../lib/studentBulkSession");

const router = express.Router();
router.use(requireAdmin);

/** GET /api/admin/students/bulk-upload/template */
router.get("/template", requireSupervisor, async (_req, res, next) => {
  try {
    const buf = await buildTemplateBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${TEMPLATE_FILENAME}"`);
    res.send(buf);
  } catch (e) { next(e); }
});

/** POST /api/admin/students/bulk-upload/validate */
router.post("/validate", requireSupervisor, singleExcel("file"), async (req, res, next) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: "Upload an .xlsx file." });
    }

    const parsedRows = await parseWorkbookBuffer(req.file.buffer);
    const appNos = parsedRows
      .map((r) => String(r.data.application_number || "").trim())
      .filter(Boolean);
    const existingAppNos = await loadExistingAppNos(pool, appNos);
    const validation = validateRows(parsedRows, existingAppNos);

    const sessionId = validation.validRows.length
      ? createSession(validation.validRows)
      : null;

    res.json({
      ok: true,
      sessionId,
      summary: validation.summary,
      rows: validation.results.map((r) => ({
        rowNumber: r.rowNumber,
        status: r.status,
        errors: r.errors,
        warnings: r.warnings,
        data: r.data,
      })),
    });
  } catch (e) {
    if (e.message && !e.status) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/** POST /api/admin/students/bulk-upload/confirm */
router.post("/confirm", requireSupervisor, async (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ error: "sessionId is required. Validate the file first." });

    const session = getSession(sessionId);
    if (!session?.validRows?.length) {
      return res.status(400).json({ error: "Upload session expired or has no valid rows. Please validate again." });
    }

    const appNos = session.validRows.map((r) => r.application_number);
    const existingAppNos = await loadExistingAppNos(pool, appNos);
    const stillValid = session.validRows.filter(
      (r) => !existingAppNos.has(r.application_number.toLowerCase())
    );

    if (!stillValid.length) {
      deleteSession(sessionId);
      return res.status(409).json({ error: "All valid rows already exist in the database. Nothing to import." });
    }

    const { inserted, appNos: insertedAppNos } = await bulkInsertStudents(stillValid);
    deleteSession(sessionId);

    await audit(
      req, "admin", req.admin.staffId, "STUDENTS_BULK_UPLOAD",
      `inserted=${inserted} attempted=${stillValid.length}`
    );

    res.json({
      ok: true,
      inserted,
      skipped: stillValid.length - inserted,
      appNos: insertedAppNos,
      message: inserted
        ? `Successfully imported ${inserted} student(s).`
        : "No students were imported (possible duplicates).",
    });
  } catch (e) { next(e); }
});

module.exports = router;
