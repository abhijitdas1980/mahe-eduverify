/* v19 — multer-based upload middleware.
   Default allowed types: PDF, JPG, PNG (≤ 6 MB).
   Photographs (doc code PHOTOS) accept JPG / PNG only — no PDF.
   MIME is normalized from extension when phones send application/octet-stream. */
const multer = require("multer");
const path = require("path");

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB
const ALLOWED = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
const IMAGE_ONLY = { "image/jpeg": "jpg", "image/png": "png" };

const EXT_TO_MIME = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
};

const MIME_ALIASES = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

/** Phones often send empty or application/octet-stream — infer from filename. */
function normalizeMime(file) {
  let mt = String(file?.mimetype || "").toLowerCase().split(";")[0].trim();
  if (MIME_ALIASES[mt]) mt = MIME_ALIASES[mt];
  if (!mt || mt === "application/octet-stream") {
    const ext = path.extname(file?.originalname || "").slice(1).toLowerCase();
    if (EXT_TO_MIME[ext]) mt = EXT_TO_MIME[ext];
  }
  return mt;
}

function formatForMime(mime, code) {
  const map = String(code || "").toUpperCase() === "PHOTOS" ? IMAGE_ONLY : ALLOWED;
  return map[mime] || null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const code = String(req.params?.code || "").toUpperCase();
    const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
    if (code === "PHOTOS" && ["heic", "heif"].includes(ext)) {
      return cb(new Error(
        "iPhone HEIC photos are not supported. Open the photo, save/export as JPG, then upload."
      ));
    }
    const mime = normalizeMime(file);
    const allowed = code === "PHOTOS" ? IMAGE_ONLY : ALLOWED;
    if (allowed[mime]) {
      file.mimetype = mime;
      return cb(null, true);
    }
    const msg = code === "PHOTOS"
      ? "Photographs must be JPG or PNG only — PDFs and HEIC are not accepted."
      : "Unsupported file type. Upload a PDF, JPG or PNG.";
    cb(new Error(msg));
  },
});

function singleFile(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE"
          ? "File too large. The maximum size is 6 MB."
          : err.message || "File upload failed.";
        return res.status(400).json({ error: msg });
      }
      if (req.file) req.file.mimetype = normalizeMime(req.file);
      next();
    });
  };
}

module.exports = {
  singleFile,
  MAX_BYTES,
  ALLOWED,
  IMAGE_ONLY,
  normalizeMime,
  formatForMime,
};
