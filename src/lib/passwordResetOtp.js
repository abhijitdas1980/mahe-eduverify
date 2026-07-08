/* Email OTP for student password reset (admission email on file). */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { sendEmail, isEmailConfigured } = require("./notifications");

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 3;

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function maskEmail(email) {
  const e = String(email || "").trim();
  const at = e.indexOf("@");
  if (at < 1) return "***@***";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const maskedLocal = local.length <= 2
    ? `${local[0] || "*"}*`
    : `${local[0]}${"*".repeat(Math.min(local.length - 2, 4))}${local.slice(-1)}`;
  return `${maskedLocal}@${domain}`;
}

function portalUrl() {
  const u = (process.env.PORTAL_URL || process.env.CORS_ORIGIN || "https://maheblreduverify.manipal.edu").trim();
  return u.replace(/\/$/, "") || "https://maheblreduverify.manipal.edu";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function countRecentSends(studentId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM student_password_otps
      WHERE student_id=$1 AND created_at > now() - interval '1 hour'`,
    [studentId]
  );
  return r.rows[0]?.c || 0;
}

async function invalidatePendingOtps(studentId) {
  await pool.query(
    `UPDATE student_password_otps SET used_at=now()
      WHERE student_id=$1 AND used_at IS NULL`,
    [studentId]
  );
}

async function sendPasswordResetOtp(student) {
  if (!isEmailConfigured()) {
    throw new Error("Email is not configured on the server. Please contact the verification cell.");
  }
  const email = String(student.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error(
      "No admission email is on file for this application. Contact the verification cell to update your email."
    );
  }

  const sends = await countRecentSends(student.id);
  if (sends >= MAX_SENDS_PER_HOUR) {
    throw new Error("Too many verification codes requested. Please wait an hour and try again.");
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await invalidatePendingOtps(student.id);
  await pool.query(
    `INSERT INTO student_password_otps (student_id, otp_hash, expires_at) VALUES ($1,$2,$3)`,
    [student.id, otpHash, expiresAt]
  );

  const portal = portalUrl();
  const subject = `MAHE EduVerify — Password reset code (App ${student.app_no})`;
  const text = [
    `Dear ${student.name},`,
    "",
    `Your EduVerify password reset verification code is: ${otp}`,
    "",
    "This code expires in 10 minutes. If you did not request a password reset, you can ignore this email.",
    "",
    `Portal: ${portal}`,
    "",
    "— MAHE Admissions Verification Cell",
  ].join("\n");

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.6;max-width:560px">
<p>Dear <b>${escapeHtml(student.name)}</b>,</p>
<p>Your EduVerify password reset verification code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#9f1239">${escapeHtml(otp)}</p>
<p style="font-size:13px;color:#64748b">This code expires in <b>10 minutes</b>. If you did not request this, ignore this email.</p>
<p><a href="${escapeHtml(portal)}">Open EduVerify</a></p>
<p style="font-size:12px;color:#94a3b8">— MAHE Admissions Verification Cell</p>
</body></html>`;

  await sendEmail({ to: email, subject, text, html });
  return { maskedEmail: maskEmail(email) };
}

async function verifyOtpAndResetPassword(student, otp, newPassword) {
  const code = String(otp || "").trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    throw new Error("Enter the 6-digit verification code from your email.");
  }

  const r = await pool.query(
    `SELECT id, otp_hash, expires_at, attempts, used_at
       FROM student_password_otps
      WHERE student_id=$1 AND used_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [student.id]
  );
  const row = r.rows[0];
  if (!row) {
    throw new Error("No active verification code. Click “Send code” to get a new one.");
  }
  if (new Date(row.expires_at) < new Date()) {
    throw new Error("Verification code expired. Request a new code.");
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    throw new Error("Too many wrong attempts. Request a new verification code.");
  }

  const ok = await bcrypt.compare(code, row.otp_hash);
  if (!ok) {
    await pool.query("UPDATE student_password_otps SET attempts=attempts+1 WHERE id=$1", [row.id]);
    const left = Math.max(0, MAX_OTP_ATTEMPTS - row.attempts - 1);
    throw new Error(`Incorrect verification code.${left ? ` ${left} attempt(s) left.` : ""}`);
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query("UPDATE students SET password_hash=$1 WHERE id=$2", [hash, student.id]);
  await pool.query("UPDATE student_password_otps SET used_at=now() WHERE id=$1", [row.id]);
  return true;
}

module.exports = {
  maskEmail,
  sendPasswordResetOtp,
  verifyOtpAndResetPassword,
};
