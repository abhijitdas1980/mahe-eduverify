/* ===========================================================
   Authentication routes  ->  /api/auth/*
   Students: application number + date of birth OR admission email,
             then a password they set themselves. Forgot password uses
             a 6-digit OTP sent to the admission email on file.
   Admins:   staff ID + password.
   =========================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { sign } = require("../middleware/auth");
const { authLimiter, resetPasswordLimiter } = require("../middleware/security");
const { audit } = require("../lib/audit");
const {
  resolveStudentPortalAccess,
  portalDenyBody,
  getPortalSettings,
} = require("../lib/portalAccess");
const { sendPasswordResetOtp, verifyOtpAndResetPassword } = require("../lib/passwordResetOtp");

const router = express.Router();
router.use(authLimiter); // brute-force protection on every auth route

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function parseStudentIdentity(body) {
  const appNo = String(body.appNo || "").trim();
  const dobRaw = String(body.dob || "").trim();
  const emailRaw = String(body.email || "").trim();
  const hasDob = isDate(dobRaw);
  const hasEmail = isValidEmail(emailRaw);

  if (!appNo) {
    return { error: "Enter your application number." };
  }
  if (!hasDob && !hasEmail) {
    if (dobRaw || emailRaw) {
      return { error: "Enter a valid date of birth or admission email address." };
    }
    return { error: "Enter your date of birth or admission email address." };
  }
  if (dobRaw && !hasDob) {
    return { error: "Enter a valid date of birth (YYYY-MM-DD) or use your admission email instead." };
  }
  if (emailRaw && !hasEmail && !hasDob) {
    return { error: "Enter a valid admission email address or use your date of birth instead." };
  }
  return {
    appNo,
    dob: hasDob ? dobRaw : null,
    email: hasEmail ? emailRaw.toLowerCase() : null,
  };
}

const STUDENT_NOT_FOUND_MSG =
  "No admitted student found for that application number and details.";

async function findStudentByAppNoAndCredential(appNo, { dob, email }) {
  let query;
  let params;
  if (dob && email) {
    query = `SELECT * FROM students
              WHERE LOWER(app_no)=LOWER($1) AND (dob=$2 OR LOWER(TRIM(email))=$3)`;
    params = [appNo, dob, email];
  } else if (dob) {
    query = "SELECT * FROM students WHERE LOWER(app_no)=LOWER($1) AND dob=$2";
    params = [appNo, dob];
  } else {
    query = `SELECT * FROM students
              WHERE LOWER(app_no)=LOWER($1) AND LOWER(TRIM(email))=$2`;
    params = [appNo, email];
  }
  const r = await pool.query(query, params);
  if (r.rows.length > 1) {
    const err = new Error("Multiple students share this email. Contact the verification cell for help.");
    err.status = 409;
    throw err;
  }
  return r.rows[0] || null;
}

async function assertStudentPortalOpen(student) {
  const access = await resolveStudentPortalAccess({
    studentId: student.id,
    portalAccess: student.portal_access,
  });
  if (!access.allowed) {
    const err = new Error(access.message);
    err.status = 403;
    err.body = portalDenyBody(access);
    throw err;
  }
  return access;
}

function sendPortalError(res, err) {
  if (err.body) return res.status(err.status || 403).json(err.body);
  return res.status(err.status || 500).json({ error: err.message });
}

/** Public — portal deadline banner on login screen (no student identity). */
router.get("/student/portal-status", async (_req, res, next) => {
  try {
    const settings = await getPortalSettings();
    res.json({
      mode: settings.mode,
      deadline: settings.deadline || null,
      deadlineTime: settings.deadlineTime,
      globallyOpen: settings.globallyOpen,
      daysRemaining: settings.daysRemaining,
      closedMessage: settings.closedMessage,
    });
  } catch (e) { next(e); }
});

function studentSummary(s) {
  return { appNo: s.app_no, name: s.name, program: s.program, profile: s.profile };
}

/* STEP 1 - check application number + DOB or admission email. */
router.post("/student/check", async (req, res, next) => {
  try {
    const id = parseStudentIdentity(req.body || {});
    if (id.error) return res.status(400).json({ error: id.error });
    const s = await findStudentByAppNoAndCredential(id.appNo, id);
    if (!s) {
      return res.status(404).json({ error: STUDENT_NOT_FOUND_MSG });
    }
    try {
      await assertStudentPortalOpen(s);
    } catch (e) {
      return sendPortalError(res, e);
    }
    res.json({ firstLogin: !s.password_hash, name: s.name });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

/* STEP 2a - first login: set a password. */
router.post("/student/register", async (req, res, next) => {
  try {
    const id = parseStudentIdentity(req.body || {});
    if (id.error) return res.status(400).json({ error: id.error });
    const password = String(req.body.password || "");
    if (password.length < 8) {
      return res.status(400).json({ error: "Choose a password of at least 8 characters." });
    }
    const s = await findStudentByAppNoAndCredential(id.appNo, id);
    if (!s) return res.status(404).json({ error: "Student record not found." });
    if (s.password_hash) {
      return res.status(409).json({ error: "A password is already set. Please log in instead." });
    }
    try {
      await assertStudentPortalOpen(s);
    } catch (e) {
      return sendPortalError(res, e);
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query("UPDATE students SET password_hash=$1 WHERE id=$2", [hash, s.id]);
    await audit(req, "student", s.app_no, "PASSWORD_SET", "First-login password created");
    res.json({ token: sign({ type: "student", id: s.id, appNo: s.app_no }), student: studentSummary(s) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
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
    try {
      await assertStudentPortalOpen(s);
    } catch (e) {
      return sendPortalError(res, e);
    }
    await audit(req, "student", s.app_no, "LOGIN", "Student logged in");
    res.json({ token: sign({ type: "student", id: s.id, appNo: s.app_no }), student: studentSummary(s) });
  } catch (e) { next(e); }
});

/* FORGOT PASSWORD — send 6-digit OTP to admission email on file. */
router.post("/student/forgot-password/send-otp", resetPasswordLimiter, async (req, res, next) => {
  try {
    const id = parseStudentIdentity(req.body || {});
    if (id.error) return res.status(400).json({ error: id.error });
    const s = await findStudentByAppNoAndCredential(id.appNo, id);
    if (!s) {
      return res.status(404).json({ error: STUDENT_NOT_FOUND_MSG });
    }
    if (!s.password_hash) {
      return res.status(400).json({
        error: "You have not set a password yet. Use your application number with your date of birth or admission email on the login screen to create one.",
      });
    }
    try {
      await assertStudentPortalOpen(s);
    } catch (e) {
      return sendPortalError(res, e);
    }
    const { maskedEmail } = await sendPasswordResetOtp(s);
    await audit(req, "student", s.app_no, "PASSWORD_OTP_SENT", maskedEmail);
    res.json({ ok: true, maskedEmail, name: s.name });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.message && !e.status) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/* FORGOT PASSWORD — verify OTP and set new password. */
router.post("/student/forgot-password/reset", resetPasswordLimiter, async (req, res, next) => {
  try {
    const id = parseStudentIdentity(req.body || {});
    if (id.error) return res.status(400).json({ error: id.error });
    const otp = String(req.body.otp || "").trim();
    const password = String(req.body.password || "");
    if (!otp) return res.status(400).json({ error: "Enter the verification code from your email." });
    if (password.length < 8) {
      return res.status(400).json({ error: "Choose a new password of at least 8 characters." });
    }
    const s = await findStudentByAppNoAndCredential(id.appNo, id);
    if (!s) {
      return res.status(404).json({ error: STUDENT_NOT_FOUND_MSG });
    }
    try {
      await assertStudentPortalOpen(s);
    } catch (e) {
      return sendPortalError(res, e);
    }
    await verifyOtpAndResetPassword(s, otp, password);
    await audit(req, "student", s.app_no, "PASSWORD_RESET", "Password reset via email OTP");
    res.json({
      token: sign({ type: "student", id: s.id, appNo: s.app_no }),
      student: studentSummary(s),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.message && !e.status) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/* Legacy DOB-only reset — disabled; use email OTP flow. */
router.post("/student/reset-password", resetPasswordLimiter, async (req, res) => {
  return res.status(410).json({
    error: "Password reset now uses a verification code sent to your admission email. Click “Forgot password?” on the login screen.",
  });
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
    if ("enabled" in a && a.enabled === false) {
      await audit(req, "admin", staffId, "LOGIN_FAIL", "Account disabled");
      return res.status(403).json({ error: "This staff account has been disabled. Contact a supervisor." });
    }
    await audit(req, "admin", a.staff_id, "LOGIN", "Admin logged in");
    res.json({
      token: sign({ type: "admin", id: a.id, staffId: a.staff_id, role: a.role }),
      admin: { staffId: a.staff_id, name: a.name, role: a.role },
    });
  } catch (e) { next(e); }
});

module.exports = router;
