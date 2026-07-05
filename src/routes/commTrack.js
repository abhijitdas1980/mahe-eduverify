/* Public email open-tracking pixel (no auth). */
const express = require("express");
const repo = require("../lib/communication/repository");

const router = express.Router();

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

router.get("/track/:token.gif", async (req, res) => {
  try {
    const token = String(req.params.token || "").replace(/\.gif$/i, "");
    if (token) await repo.markDeliveryOpened(token);
  } catch (_) { /* ignore */ }
  res.set("Content-Type", "image/gif");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.send(PIXEL);
});

module.exports = router;
