/* Agent debug session c0bd59 — NDJSON to workspace log + ingest endpoint. */
const fs = require("fs");
const path = require("path");

const SESSION_ID = "c0bd59";
const LOG_PATH = path.join(__dirname, "..", "..", "..", ".cursor", `debug-${SESSION_ID}.log`);
const INGEST = "http://127.0.0.1:7753/ingest/99a42da4-674a-4ab6-96f8-e57e4cc44d6a";

function debugLog(payload) {
  const entry = {
    sessionId: SESSION_ID,
    timestamp: Date.now(),
    ...payload,
  };
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch (_) { /* ignore */ }
  try {
    if (typeof fetch === "function") {
      fetch(INGEST, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": SESSION_ID },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
  } catch (_) { /* ignore */ }
}

module.exports = { debugLog, SESSION_ID, LOG_PATH };
