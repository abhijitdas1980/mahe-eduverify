/* Multer middleware for .xlsx student bulk-upload files. */
const multer = require("multer");

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const XLSX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const extOk = /\.xlsx$/i.test(file.originalname || "");
    if (XLSX_MIMES.has(file.mimetype) && extOk) return cb(null, true);
    if (extOk) return cb(null, true);
    cb(new Error("Only .xlsx Excel files are accepted."));
  },
});

function singleExcel(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE"
          ? "File too large. Maximum size is 2 MB."
          : err.message || "File upload failed.";
        return res.status(400).json({ error: msg });
      }
      next();
    });
  };
}

module.exports = { singleExcel, MAX_BYTES };
