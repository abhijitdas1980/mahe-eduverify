/* Row-level validation for student bulk Excel uploads. */
const { CATEGORIES, PROFILES, isValidProfile } = require("../config/checklists");
const {
  REQUIRED_FIELDS,
  GENDERS,
  DATE_REGEX,
  DATE_DISPLAY_FORMAT,
  FIELD_LIMITS,
  DEFAULT_VERIFICATION_DATES,
} = require("../constants/studentBulkUpload");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cellStr(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return formatDateDdMmYyyy(v);
  if (typeof v === "object" && v.text !== undefined) return String(v.text).trim();
  return String(v).trim();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateDdMmYyyy(d) {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Parse dd-mm-yyyy (or Excel Date) to ISO YYYY-MM-DD. */
function parseDateToIso(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
  }
  const s = cellStr(raw);
  if (!s) return null;
  const m = s.match(DATE_REGEX);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function normalizeRow(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    out[k] = cellStr(v);
  }
  return out;
}

function validateRow(row, ctx) {
  const errors = [];
  const warnings = [];
  const normalized = {
    application_number: "",
    full_name: "",
    date_of_birth: null,
    gender: "",
    profile: "",
    program: "",
    department: null,
    section: null,
    batch: null,
    category: null,
    orientation_date: null,
    verification_date: null,
    verification_batch: null,
    email: null,
    phone: null,
  };

  const r = normalizeRow(row);

  for (const field of REQUIRED_FIELDS) {
    if (!r[field]) errors.push(`${field} is required.`);
  }

  const appNo = r.application_number;
  if (appNo) {
    if (appNo.length > FIELD_LIMITS.application_number) {
      errors.push(`application_number must be at most ${FIELD_LIMITS.application_number} characters.`);
    }
    const key = appNo.toLowerCase();
    if (ctx.seenAppNos.has(key)) {
      errors.push("Duplicate application_number within this file.");
    } else {
      ctx.seenAppNos.add(key);
    }
    if (ctx.existingAppNos.has(key)) {
      errors.push("A student with this application_number already exists in the database.");
    }
    normalized.application_number = appNo;
  }

  const name = r.full_name;
  if (name) {
    if (name.length > FIELD_LIMITS.full_name) {
      errors.push(`full_name must be at most ${FIELD_LIMITS.full_name} characters.`);
    }
    normalized.full_name = name;
  }

  if (r.date_of_birth) {
    const iso = parseDateToIso(r.date_of_birth);
    if (!iso) errors.push(`date_of_birth must be in ${DATE_DISPLAY_FORMAT} format.`);
    else normalized.date_of_birth = iso;
  }

  const gender = r.gender;
  if (gender) {
    const match = GENDERS.find((g) => g.toLowerCase() === gender.toLowerCase());
    if (!match) errors.push(`gender must be one of: ${GENDERS.join(", ")}.`);
    else normalized.gender = match;
  }

  const profile = r.profile;
  if (profile) {
    const profileKey = profile.toUpperCase();
    if (!isValidProfile(profileKey)) {
      errors.push(`profile must be one of: ${PROFILES.join(", ")}.`);
    } else {
      normalized.profile = profileKey;
    }
  }

  const program = r.program;
  if (program) {
    if (program.length > FIELD_LIMITS.program) {
      errors.push(`program must be at most ${FIELD_LIMITS.program} characters.`);
    }
    normalized.program = program;
  }

  if (r.department) {
    if (r.department.length > FIELD_LIMITS.department) {
      errors.push(`department must be at most ${FIELD_LIMITS.department} characters.`);
    } else normalized.department = r.department;
  }
  if (r.section) {
    if (r.section.length > FIELD_LIMITS.section) {
      errors.push(`section must be at most ${FIELD_LIMITS.section} characters.`);
    } else normalized.section = r.section;
  }
  if (r.batch) {
    if (r.batch.length > FIELD_LIMITS.batch) {
      errors.push(`batch must be at most ${FIELD_LIMITS.batch} characters.`);
    } else normalized.batch = r.batch;
  }
  if (r.category) {
    if (r.category.length > FIELD_LIMITS.category) {
      errors.push(`category must be at most ${FIELD_LIMITS.category} characters.`);
    } else {
      normalized.category = r.category;
      if (!CATEGORIES.includes(r.category)) {
        warnings.push(`category "${r.category}" is not in the standard list (${CATEGORIES.join(", ")}).`);
      }
    }
  }
  if (r.orientation_date) {
    const iso = parseDateToIso(r.orientation_date);
    if (!iso) errors.push("orientation_date must be in dd-mm-yyyy format.");
    else normalized.orientation_date = iso;
  }
  if (r.verification_date) {
    const iso = parseDateToIso(r.verification_date);
    if (!iso) errors.push("verification_date must be in dd-mm-yyyy format.");
    else {
      normalized.verification_date = iso;
      if (r.verification_batch) {
        const batch = parseInt(r.verification_batch, 10);
        if (!Number.isInteger(batch) || batch < 1) {
          errors.push("verification_batch must be a positive integer (e.g. 1 for day 1).");
        } else normalized.verification_batch = batch;
      } else {
        const idx = DEFAULT_VERIFICATION_DATES.indexOf(iso);
        if (idx >= 0) normalized.verification_batch = idx + 1;
      }
    }
  } else if (r.verification_batch) {
    errors.push("verification_batch requires verification_date.");
  }
  if (r.email) {
    if (r.email.length > FIELD_LIMITS.email) {
      errors.push(`email must be at most ${FIELD_LIMITS.email} characters.`);
    } else if (!EMAIL_REGEX.test(r.email)) {
      errors.push("email is not valid.");
    } else normalized.email = r.email;
  }
  if (r.phone) {
    if (r.phone.length > FIELD_LIMITS.phone) {
      errors.push(`phone must be at most ${FIELD_LIMITS.phone} characters.`);
    } else normalized.phone = r.phone;
  }

  const valid = errors.length === 0;
  return { valid, errors, warnings, normalized };
}

async function loadExistingAppNos(pool, appNos) {
  const existing = new Set();
  if (!appNos.length) return existing;
  const unique = [...new Set(appNos.map((a) => a.toLowerCase()))];
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const r = await pool.query(
      "SELECT LOWER(app_no) AS app_no FROM students WHERE LOWER(app_no) = ANY($1::text[])",
      [slice]
    );
    for (const row of r.rows) existing.add(row.app_no);
  }
  return existing;
}

function validateRows(rows, existingAppNos) {
  const seenAppNos = new Set();
  const ctx = { seenAppNos, existingAppNos };
  const results = [];

  for (const item of rows) {
    const result = validateRow(item.data, ctx);
    results.push({
      rowNumber: item.rowNumber,
      status: result.valid ? "valid" : "invalid",
      errors: result.errors,
      warnings: result.warnings,
      data: result.valid ? result.normalized : item.data,
    });
  }

  const validRows = results.filter((r) => r.status === "valid").map((r) => r.data);
  const invalidRows = results.filter((r) => r.status === "invalid");

  return {
    results,
    validRows,
    invalidRows,
    summary: {
      total: results.length,
      valid: validRows.length,
      invalid: invalidRows.length,
      duplicateInFile: results.filter((r) => r.errors.some((e) => e.includes("within this file"))).length,
      duplicateInDb: results.filter((r) => r.errors.some((e) => e.includes("already exists in the database"))).length,
    },
  };
}

module.exports = {
  cellStr,
  parseDateToIso,
  normalizeRow,
  validateRow,
  validateRows,
  loadExistingAppNos,
};
