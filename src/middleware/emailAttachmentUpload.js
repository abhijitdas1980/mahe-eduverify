/* Multer middleware for admin email attachments (PDF, images, Office docs). */
const multer = require("multer");
const path = require("path");

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 5;

const ALLOWED_EXT = new Set([
  "pdf", "jpg", "jpeg", "png", "gif", "webp",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt",
]);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "application/octet-stream",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
    const mime = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
    if (ALLOWED_EXT.has(ext) || ALLOWED_MIME.has(mime)) return cb(null, true);
    cb(new Error("Unsupported attachment type. Use PDF, images, or Office documents."));
  },
});

function emailAttachments(field = "attachments") {
  return (req, res, next) => {
    upload.array(field, MAX_FILES)(req, res, (err) => {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE"
          ? `Each attachment must be ${MAX_BYTES / (1024 * 1024)} MB or smaller.`
          : err.code === "LIMIT_FILE_COUNT"
            ? `Maximum ${MAX_FILES} attachments allowed.`
            : err.message || "Attachment upload failed.";
        return res.status(400).json({ error: msg });
      }
      next();
    });
  };
}

module.exports = { emailAttachments, MAX_BYTES, MAX_FILES };
