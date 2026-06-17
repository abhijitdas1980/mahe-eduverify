/* Audit logging — records who did what, when, from where.
   Never throws: a logging failure must not break the request. */
const { pool } = require("../config/db");

async function audit(req, actorType, actorId, action, detail) {
  try {
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      "";
    await pool.query(
      `INSERT INTO audit_log (actor_type, actor_id, action, detail, ip)
       VALUES ($1,$2,$3,$4,$5)`,
      [actorType, String(actorId || ""), action, detail || null, ip]
    );
  } catch (e) {
    console.warn("audit log failed:", e.message);
  }
}

module.exports = { audit };
