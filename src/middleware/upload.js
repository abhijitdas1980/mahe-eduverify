/* v19 — multer-based upload middleware.
   Default allowed types: PDF, JPG, PNG (≤ 6 MB).
   Photographs (doc code PHOTOS) accept JPG / PNG only — no PDF.
   No dimension/orientation enforcement (relaxed in v17/v18). */
const multer = require("multer");

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB
const ALLOWED = {
  "application/pdf": "pdf",
  "image/jpeg":      "jpg",
  "image/png":       "png",
};
const IMAGE_ONLY = { "image/jpeg": "jpg", "image/png": "png" };

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const code = String(req.params?.code || "").toUpperCase();
    const allowed = code === "PHOTOS" ? IMAGE_ONLY : ALLOWED;
    if (allowed[file.mimetype]) return cb(null, true);
    const msg = code === "PHOTOS"
      ? "Photographs must be JPG or PNG only — PDFs are not accepted."
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
      next();
    });
  };
}

module.exports = { singleFile, MAX_BYTES, ALLOWED };
