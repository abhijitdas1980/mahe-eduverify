/* Authentication - JSON Web Tokens.
   A token proves who the caller is (a specific student, or an admin).
   It is signed with JWT_SECRET so it cannot be forged. */
const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");

const SECRET = jwtSecret();
const EXPIRES = process.env.JWT_EXPIRES_IN || "12h";

/** Create a signed token. payload e.g. { type:'student', id, appNo } */
function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

/** Pull and verify the token from the Authorization header. */
function readToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    return jwt.verify(m[1], SECRET);
  } catch {
    return null;
  }
}

/** Gate a route to logged-in students only. */
function requireStudent(req, res, next) {
  const t = readToken(req);
  if (!t || t.type !== "student") {
    return res.status(401).json({ error: "Please log in as a student to continue." });
  }
  req.student = t;
  next();
}

/** Gate a route to any verification-cell staff (verifier or supervisor). */
function requireAdmin(req, res, next) {
  const t = readToken(req);
  if (!t || t.type !== "admin") {
    return res.status(401).json({ error: "Please log in as verification-cell staff to continue." });
  }
  req.admin = t; // { type, id, staffId, role }
  next();
}

/** Gate a route to Supervisor-role staff only. Use AFTER requireAdmin. */
function requireSupervisor(req, res, next) {
  if (!req.admin || req.admin.role !== "supervisor") {
    return res.status(403).json({ error: "This action requires a Supervisor account." });
  }
  next();
}

module.exports = { sign, requireStudent, requireAdmin, requireSupervisor };
