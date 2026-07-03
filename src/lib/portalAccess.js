/* Portal deadline + per-student login access control (v39). */
const { pool } = require("../config/db");

const SETTING_KEYS = {
  deadline: "student_portal_deadline",
  deadlineTime: "student_portal_deadline_time",
  mode: "student_portal_mode",
  closedMessage: "student_portal_closed_message",
};

const DEFAULT_CLOSED_MESSAGE =
  "The document upload window has closed. Please contact the Admissions Cell for assistance.";

const PORTAL_ACCESS = ["default", "allowed", "blocked"];

function normalizePortalAccess(value) {
  const v = String(value || "default").trim().toLowerCase();
  return PORTAL_ACCESS.includes(v) ? v : "default";
}

function isDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}

function isTime(v) {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || "").trim());
}

/** Parse deadline as end-of-minute instant in IST (+05:30). */
function deadlineInstant(deadline, deadlineTime) {
  if (!isDate(deadline)) return null;
  const time = isTime(deadlineTime) ? String(deadlineTime).trim() : "23:59";
  const [hh, mm] = time.split(":").map((x) => parseInt(x, 10));
  const pad = (n) => String(n).padStart(2, "0");
  return new Date(`${deadline}T${pad(hh)}:${pad(mm)}:59+05:30`);
}

function daysUntil(deadlineAt) {
  if (!deadlineAt) return null;
  const ms = deadlineAt.getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

async function readSettingsMap() {
  const keys = Object.values(SETTING_KEYS);
  const r = await pool.query(
    "SELECT key, value FROM system_settings WHERE key = ANY($1::text[])",
    [keys]
  );
  const map = {};
  r.rows.forEach((row) => { map[row.key] = row.value; });
  return map;
}

async function getPortalSettings() {
  const map = await readSettingsMap();
  const deadline = isDate(map[SETTING_KEYS.deadline]) ? map[SETTING_KEYS.deadline].trim() : "";
  const deadlineTime = isTime(map[SETTING_KEYS.deadlineTime])
    ? map[SETTING_KEYS.deadlineTime].trim()
    : "23:59";
  const mode = String(map[SETTING_KEYS.mode] || "open").trim().toLowerCase() === "closed"
    ? "closed"
    : "open";
  const closedMessage = String(map[SETTING_KEYS.closedMessage] || DEFAULT_CLOSED_MESSAGE).trim()
    || DEFAULT_CLOSED_MESSAGE;
  const deadlineAt = deadline ? deadlineInstant(deadline, deadlineTime) : null;
  const globallyOpen = mode === "open" && (!deadlineAt || Date.now() <= deadlineAt.getTime());
  return {
    deadline,
    deadlineTime,
    mode,
    closedMessage,
    deadlineAt,
    globallyOpen,
    daysRemaining: globallyOpen && deadlineAt ? daysUntil(deadlineAt) : null,
  };
}

async function savePortalSettings(patch) {
  const current = await getPortalSettings();
  const next = {
    deadline: patch.deadline !== undefined
      ? (patch.deadline ? String(patch.deadline).trim() : "")
      : current.deadline,
    deadlineTime: patch.deadlineTime !== undefined
      ? String(patch.deadlineTime || "23:59").trim()
      : current.deadlineTime,
    mode: patch.mode !== undefined
      ? (String(patch.mode).trim().toLowerCase() === "closed" ? "closed" : "open")
      : current.mode,
    closedMessage: patch.closedMessage !== undefined
      ? String(patch.closedMessage || DEFAULT_CLOSED_MESSAGE).trim() || DEFAULT_CLOSED_MESSAGE
      : current.closedMessage,
  };
  if (next.deadline && !isDate(next.deadline)) {
    const err = new Error("Deadline must be a valid date (YYYY-MM-DD).");
    err.status = 400;
    throw err;
  }
  if (next.deadlineTime && !isTime(next.deadlineTime)) {
    const err = new Error("Deadline time must be HH:MM (24-hour, IST).");
    err.status = 400;
    throw err;
  }
  const pairs = [
    [SETTING_KEYS.deadline, next.deadline],
    [SETTING_KEYS.deadlineTime, next.deadlineTime],
    [SETTING_KEYS.mode, next.mode],
    [SETTING_KEYS.closedMessage, next.closedMessage],
  ];
  for (const [key, value] of pairs) {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [key, value]
    );
  }
  return getPortalSettings();
}

async function fetchStudentPortalAccess({ studentId, appNo }) {
  if (studentId) {
    const r = await pool.query("SELECT portal_access FROM students WHERE id=$1", [studentId]);
    return normalizePortalAccess(r.rows[0]?.portal_access);
  }
  if (appNo) {
    const r = await pool.query(
      "SELECT portal_access FROM students WHERE LOWER(app_no)=LOWER($1)",
      [appNo]
    );
    return normalizePortalAccess(r.rows[0]?.portal_access);
  }
  return "default";
}

async function resolveStudentPortalAccess({ studentId, appNo, portalAccess }) {
  const settings = await getPortalSettings();
  const access = portalAccess != null
    ? normalizePortalAccess(portalAccess)
    : await fetchStudentPortalAccess({ studentId, appNo });

  if (access === "blocked") {
    return {
      allowed: false,
      reason: "admin_blocked",
      portalAccess: access,
      message: settings.closedMessage,
      settings,
    };
  }
  if (access === "allowed") {
    return {
      allowed: true,
      reason: "admin_allowed",
      portalAccess: access,
      message: "",
      settings,
    };
  }
  if (settings.mode === "closed") {
    return {
      allowed: false,
      reason: "portal_closed",
      portalAccess: access,
      message: settings.closedMessage,
      settings,
    };
  }
  if (settings.deadlineAt && Date.now() > settings.deadlineAt.getTime()) {
    return {
      allowed: false,
      reason: "deadline_passed",
      portalAccess: access,
      message: settings.closedMessage,
      settings,
    };
  }
  return {
    allowed: true,
    reason: "open",
    portalAccess: access,
    message: "",
    settings,
  };
}

function portalPayload(access) {
  const s = access.settings;
  return {
    allowed: access.allowed,
    reason: access.reason,
    portalAccess: access.portalAccess,
    message: access.message,
    mode: s.mode,
    deadline: s.deadline || null,
    deadlineTime: s.deadlineTime,
    daysRemaining: s.daysRemaining,
    globallyOpen: s.globallyOpen,
  };
}

function portalDenyBody(access) {
  return {
    error: access.message,
    portalClosed: true,
    reason: access.reason,
    portal: portalPayload(access),
  };
}

module.exports = {
  PORTAL_ACCESS,
  normalizePortalAccess,
  getPortalSettings,
  savePortalSettings,
  resolveStudentPortalAccess,
  portalPayload,
  portalDenyBody,
  deadlineInstant,
};
