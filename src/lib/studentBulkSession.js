/* Short-lived in-memory store for validated bulk-upload sessions. */
const crypto = require("crypto");
const { SESSION_TTL_MS } = require("../constants/studentBulkUpload");

const sessions = new Map();

function purgeExpired() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

/** @param {object[]} validRows @param {string} staffId — supervisor who validated the file */
function createSession(validRows, staffId) {
  purgeExpired();
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    validRows,
    staffId: String(staffId || "").trim(),
    createdAt: Date.now(),
  });
  return sessionId;
}

function getSession(sessionId) {
  purgeExpired();
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return s;
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

module.exports = { createSession, getSession, deleteSession };
