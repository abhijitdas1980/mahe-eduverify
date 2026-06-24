/* Stream a stored document through our API (inline preview or download).
   Cloudinary authenticated URLs often fail inside iframes; same-origin blob
   preview via these routes works reliably in all browsers. */
const { fetchAssetBuffer } = require("../config/cloudinary");

function contentTypeForDoc(doc) {
  const fmt = String(doc.file_format || "").toLowerCase();
  const name = String(doc.file_name || "").toLowerCase();
  if (fmt === "pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (fmt === "png" || name.endsWith(".png")) return "image/png";
  if (["jpg", "jpeg", "jfif"].includes(fmt) || /\.jpe?g$/.test(name)) return "image/jpeg";
  return "application/octet-stream";
}

function safeFileName(doc) {
  const raw = doc.file_name || `${doc.doc_code || "document"}.${doc.file_format || "bin"}`;
  return String(raw).replace(/[^\w.\- ()]/g, "_");
}

async function streamDoc(res, doc, { attachment = false } = {}) {
  if (!doc?.file_public_id) {
    return res.status(404).json({ error: "No file uploaded for this document." });
  }
  let buf;
  try {
    buf = await fetchAssetBuffer(doc);
  } catch (e) {
    console.error("streamDoc fetch failed:", doc.doc_code, e.message);
    return res.status(503).json({
      error: "Could not load this file from storage. Please try again or contact the verification cell.",
    });
  }
  if (!buf) {
    return res.status(404).json({ error: "File not found in storage." });
  }
  const ct = contentTypeForDoc(doc);
  res.setHeader("Content-Type", ct);
  res.setHeader("Content-Length", buf.length);
  res.setHeader(
    "Content-Disposition",
    `${attachment ? "attachment" : "inline"}; filename="${safeFileName(doc)}"`
  );
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(buf);
}

module.exports = { streamDoc, contentTypeForDoc, safeFileName };
