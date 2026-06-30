/* Agent debug session e101d5 — append NDJSON to workspace log. */
const fs = require("fs");
const path = require("path");

const LOG_PATH = path.join(__dirname, "..", "..", "..", "debug-e101d5.log");

function debugLog(payload) {
  try {
    const line = JSON.stringify({
      sessionId: "e101d5",
      timestamp: Date.now(),
      ...payload,
    });
    fs.appendFileSync(LOG_PATH, `${line}\n`);
  } catch (_) { /* ignore */ }
}

module.exports = { debugLog };
