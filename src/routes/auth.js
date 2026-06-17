/* ===========================================================
   Authentication routes  ->  /api/auth/*
   Students: application number + date of birth, then a password
             they set themselves. "Forgot password" re-verifies
             the application number + date of birth.
   Admins:   staff ID + password.
   =========================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { sign } = require("../middleware/auth");
const { authLimiter } = require("../middleware/security");
const { audit } = require("../lib/audit");

const router = express.Router();
router.use(authLimiter); // brute-force protection on every auth route

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");

function studentSummary(s) {
  return { appNo: s.app_no, name: s.name, program: s.program, profile: s.profile };
}

/* STEP 1 - check application number + DOB. */
router.post("/student/check", async (req, res, next) => {
  try {
    const appNo = String(req.body.appNo || "").trim();
    const dob = String(req.body.dob || "").trim();
    if (!appNo || !isDate(dob)) {
      return res.status(400).json({ error: "Enter your application number and date of birth." });
    }
    const r = await pool.query(
      "SELECT app_no,name,password_hash FROM students WHERE LOWER(app_no)=LOWER($1) AND dob=$2",
      [appNo, dob]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "No admitted student found for that application number and date of birth." });
    }
    res.json({ firstLogin: !r.rows[0].password_hash, name: r.rows[0].name });
  } catch (e) { next(e); }
});

/* STEP 2a - first login: set a password. */
router.post("/student/register", async (req, res, next) => {
  try {
    const appNo = String(req.body.appNo || "").trim();
    const dob = String(req.body.dob || "").trim();
    const password = String(req.body.password || "");
    if (!appNo || !isDate(dob)) {
      return res.status(400).json({ error: "Missing application number or date of birth." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Choose a password of at least 6 characters." });
    }
    const r = await pool.query(
      "SELECT * FROM students WHERE LOWER(app_no)=LOWER($1) AND dob=$2",
      [appNo, dob]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Student record not found." });
    const s = r.rows[0];
    if (s.password_hash) {
      return res.status(409).json({ error: "A password is already set. Please log in instead." });
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query("UPDATE students SET password_hash=$1 WHERE id=$2", [hash, s.id]);
    await audit(req, "student", s.app_no, "PASSWORD_SET", "First-login password created");
    res.json({ token: sign({ type: "student", id: s.id, appNo: s.app_no }), student: studentSummary(s) });
  } catch (e) { next(e); }
});

/* STEP 2b - returning login. */
router.post("/student/login", async (req, res, next) => {
  try {
    const appNo = String(req.body.appNo || "").trim();
    const password = String(req.body.password || "");
    if (!appNo || !password) {
      return res.status(400).json({ error: "Enter your application number and password." });
    }
    const r = await pool.query("SELECT * FROM students WHERE LOWER(app_no)=LOWER($1)", [appNo]);
    const s = r.rows[0];
    if (!s || !s.password_hash || !(await bcrypt.compare(password, s.password_hash))) {
      await audit(req, "student", appNo, "LOGIN_FAIL", "Bad credentials");
      return res.status(401).json({ error: "Incorrect application number or password." });
    }
    await audit(req, "student", s.app_no, "LOGIN", "Student logged in");
    res.json({ token: sign({ type: "student", id: s.id, appNo: s.app_no }), student: studentSummary(s) });
  } catch (e) { next(e); }
});

/* FORGOT PASSWORD - re-verify application number + DOB, then set a new password. */
router.post("/student/reset-password", async (req, res, next) => {
  try {
    const appNo = String(req.body.appNo || "").trim();
    const dob = String(req.body.dob || "").trim();
    const password = String(req.body.password || "");
    if (!appNo || !isDate(dob)) {
      return res.status(400).json({ error: "Enter your application number and date of birth." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Choose a new password of at least 6 characters." });
    }
    const r = await pool.query(
      "SELECT * FROM students WHERE LOWER(app_no)=LOWER($1) AND dob=$2",
      [appNo, dob]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "Application number and date of birth do not match our records." });
    }
    const s = r.rows[0];
    const hash = await bcrypt.hash(password, 12);
    await pool.query("UPDATE students SET password_hash=$1 WHERE id=$2", [hash, s.id]);
    await audit(req, "student", s.app_no, "PASSWORD_RESET", "Password reset via app no + DOB");
    res.json({ token: sign({ type: "student", id: s.id, appNo: s.app_no }), student: studentSummary(s) });
  } catch (e) { next(e); }
});

/* ADMIN login. */
router.post("/admin/login", async (req, res, next) => {
  try {
    const staffId = String(req.body.staffId || "").trim();
    const password = String(req.body.password || "");
    if (!staffId || !password) {
      return res.status(400).json({ error: "Enter your staff ID and password." });
    }
    const r = await pool.query("SELECT * FROM admins WHERE LOWER(staff_id)=LOWER($1)", [staffId]);
    const a = r.rows[0];
    if (!a || !(await bcrypt.compare(password, a.password_hash))) {
      await audit(req, "admin", staffId, "LOGIN_FAIL", "Bad credentials");
      return res.status(401).json({ error: "Incorrect staff ID or password." });
    }
    await audit(req, "admin", a.staff_id, "LOGIN", "Admin logged in");
    res.json({
      token: sign({ type: "admin", id: a.id, staffId: a.staff_id, role: a.role }),
      admin: { staffId: a.staff_id, name: a.name, role: a.role },
    });
  } catch (e) { next(e); }
});

module.exports = router;
