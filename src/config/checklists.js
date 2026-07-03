/* v8 — Document set changes:
   - REMOVED (no longer requested):
       BANK    (Bank Passbook / Cancelled Cheque)
       PAN     (Student PAN Card)
       CASTE   (Caste Certificate)
       MEDICAL (Medical Fitness Certificate)
   - OPTIONAL (student may skip, admin can still view if uploaded):
       MIGRATION (Migration Certificate — from Last Institution Studied)
   - TC is mandatory for all profiles (v33).
   - Category-specific mandatory docs: AICTE → ITR_PARENTS; NRI / NRI Sponsored → NRI_AFFIDAVIT
   - v35: student profile is UG or PG only; category drives international/extra docs.
   - v36: PG — 10th/12th marks cards are not mandatory; 10th marksheet optional (DoB proof only).
   - v37: PG — Parent/Guardian Anti-Ragging Undertaking (ANTI_RAG_P) is mandatory.
   - v38: English Proficiency (ENGLISH) mandatory only when program name includes Dual Degree.
   - v39: NRI Sponsored — Passport Copy and Visa Copy mandatory (with category name normalization).
   Legacy doc rows on existing students remain in the DB but are filtered
   out of all student/admin views (see lib/docs.js + routes).
*/

const DOC_META = {
  AADHAAR:    { name: "Aadhaar Card",                                                  original: false, needsInstitution: false, imageOnly: false, optional: false },
  PAN_PARENT: { name: "PAN Card (Parent / Guardian)",                                  original: false, needsInstitution: false, imageOnly: false, optional: false },
  APAAR:      { name: "APAAR ID (ABC ID)",                                             original: false, needsInstitution: false, imageOnly: false, optional: false },
  SSLC:       { name: "10th (SSLC) Marks Card",                                        original: true,  needsInstitution: true,  imageOnly: false, optional: false },
  PUC:        { name: "12th / PUC / Equivalent Marks Card",                            original: true,  needsInstitution: true,  imageOnly: false, optional: false },
  UG_DEGREE:  { name: "UG Degree / Provisional Certificate",                           original: true,  needsInstitution: true,  imageOnly: false, optional: false },
  UG_MARKS:   { name: "UG Consolidated Marks Card",                                    original: true,  needsInstitution: true,  imageOnly: false, optional: false },
  DIPLOMA:    { name: "Diploma Certificate & Marks Cards",                             original: true,  needsInstitution: true,  imageOnly: false, optional: false },
  MIGRATION:  { name: "Migration Certificate (from the Last Institution Studied)",     original: true,  needsInstitution: true,  imageOnly: false, optional: true  },
  TC:         { name: "Transfer Certificate (mandatory document – issued by last institution studied)", original: true, needsInstitution: true, imageOnly: false, optional: false },
  CHAR_CERT:  { name: "Character / Conduct Certificate (from Last Institution Studied)", original: true, needsInstitution: true, imageOnly: false, optional: false },
  PHOTOS:     { name: "Passport-size Photographs (white background)",                  original: true,  needsInstitution: false, imageOnly: true,  optional: false },
  ANTI_RAG_S: { name: "Anti-Ragging Undertaking (Student)",                            original: true,  needsInstitution: false, imageOnly: false, optional: false },
  ANTI_RAG_P: { name: "Anti-Ragging Undertaking (Parent / Guardian)",                  original: true,  needsInstitution: false, imageOnly: false, optional: false },
  ANTI_SUB:   { name: "Anti-Substance Abuse Declaration",                              original: true,  needsInstitution: false, imageOnly: false, optional: false },
  INCOME:     { name: "ITR – AICTE Fee Waiver",                                        original: true,  needsInstitution: false, imageOnly: false, optional: false },
  ITR_PARENTS:{ name: "ITR of both parents (mandatory document for students admitted under AICTE Category)", original: true, needsInstitution: false, imageOnly: false, optional: false },
  NRI_AFFIDAVIT: { name: "NRI Affidavit (format enclosed; mandatory document for NRI/NRI Sponsored students)", original: true, needsInstitution: false, imageOnly: false, optional: false },
  PASSPORT:   { name: "Passport Copy",                                                 original: true,  needsInstitution: false, imageOnly: false, optional: false },
  VISA:       { name: "Visa Copy",                                                     original: true,  needsInstitution: false, imageOnly: false, optional: false },
  EQUIV:      { name: "AIU / Equivalence Certificate",                                 original: true,  needsInstitution: true,  imageOnly: false, optional: false },
  ENGLISH:    { name: "English Proficiency (IELTS/TOEFL)",                             original: false, needsInstitution: true,  imageOnly: false, optional: false },
};

/** Allowed values for new students (bulk upload, add student). */
const PROFILES = ["UG", "PG"];

/* MANDATORY checklists per profile — these gate declaration + slot booking. */
const CHECKLISTS = {
  UG: ["SSLC", "PUC", "CHAR_CERT", "TC", "AADHAAR", "APAAR", "PAN_PARENT", "PHOTOS", "ANTI_RAG_S", "ANTI_RAG_P", "ANTI_SUB"],
  PG: ["UG_DEGREE", "UG_MARKS", "CHAR_CERT", "TC", "AADHAAR", "APAAR", "PAN_PARENT", "PHOTOS", "ANTI_RAG_S", "ANTI_RAG_P", "ANTI_SUB"],
};

/* Profile-specific optional documents (shown but do not block declaration). */
const PROFILE_OPTIONAL = {
  PG: ["SSLC"],
};

/* Per-profile overrides for doc display / upload rules. */
const PROFILE_DOC_META = {
  PG: {
    SSLC: {
      name: "10th (SSLC) Marksheet (DoB proof only)",
      original: false,
      needsInstitution: false,
    },
  },
};

/* Per-category overrides for doc display (e.g. clearer labels per admission category). */
const CATEGORY_DOC_META = {
  NRI: {
    PASSPORT: { name: "Passport Copy" },
    VISA: { name: "Visa Copy" },
  },
  "NRI Sponsored": {
    PASSPORT: { name: "Passport Copy" },
    VISA: { name: "Visa Copy" },
  },
  Foreign: {
    PASSPORT: { name: "Passport Copy" },
    VISA: { name: "Visa Copy" },
  },
};

/* Category-specific mandatory documents (added to profile checklist). */
const CATEGORY_MANDATORY = {
  AICTE: ["ITR_PARENTS"],
  NRI: ["NRI_AFFIDAVIT", "PASSPORT", "VISA", "EQUIV"],
  "NRI Sponsored": ["NRI_AFFIDAVIT", "PASSPORT", "VISA", "EQUIV"],
  Foreign: ["PASSPORT", "VISA", "EQUIV"],
};

/* Program-specific mandatory documents (matched against students.program). */
const PROGRAM_MANDATORY = {
  dualDegree: ["ENGLISH"],
};

/* OPTIONAL documents shown to every student. Student can submit without them. */
const OPTIONAL_DOCS = ["MIGRATION"];

/* Codes removed in v8. Existing student rows for these are filtered out of
   listings, stats and reports — without being deleted. */
const LEGACY_DOC_CODES = ["PAN", "BANK", "CASTE", "MEDICAL"];

/* Canonical category dropdown — v8 adds NRI Sponsored, Foreign, OCI. */
const CATEGORIES = ["General", "NRI", "NRI Sponsored", "Foreign", "OCI", "AICTE"];

/** Map legacy profile strings (pre-v35) to UG or PG for checklist lookup. */
function normalizeProfile(profile) {
  if (!profile) return "UG";
  const p = String(profile).trim();
  if (p === "UG" || p === "PG") return p;
  const upper = p.toUpperCase();
  if (upper.startsWith("PG")) return "PG";
  if (upper.startsWith("UG")) return "UG";
  return "UG";
}

function isValidProfile(profile) {
  return PROFILES.includes(String(profile || "").trim().toUpperCase());
}

/** Map bulk-upload / legacy category strings to canonical CATEGORIES keys. */
function normalizeCategory(category) {
  if (!category) return null;
  const c = String(category).trim();
  if (CATEGORIES.includes(c)) return c;
  const key = c.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const aliases = {
    "nri sponsored": "NRI Sponsored",
    nri: "NRI",
    foreign: "Foreign",
    general: "General",
    oci: "OCI",
    aict: "AICTE",
    aicte: "AICTE",
  };
  if (aliases[key]) return aliases[key];
  for (const cat of CATEGORIES) {
    if (cat.toLowerCase().replace(/[\s_-]+/g, " ") === key) return cat;
  }
  return c;
}

function categoryMandatoryFor(category) {
  const key = normalizeCategory(category);
  if (!key) return [];
  return CATEGORY_MANDATORY[key] || [];
}

/** True when program field mentions Dual Degree (any casing/spacing). */
function isDualDegreeProgram(program) {
  return /dual\s*degree/i.test(String(program || "").trim());
}

function programMandatoryFor(program) {
  return isDualDegreeProgram(program) ? PROGRAM_MANDATORY.dualDegree.slice() : [];
}

function checklistFor(profile, category, program) {
  const p = normalizeProfile(profile);
  const base = CHECKLISTS[p] || CHECKLISTS.UG;
  const extra = [...categoryMandatoryFor(category), ...programMandatoryFor(program)];
  const seen = new Set(base);
  const out = [...base];
  for (const code of extra) {
    if (!seen.has(code)) {
      out.push(code);
      seen.add(code);
    }
  }
  return out;
}

function optionalDocsFor(profile) {
  const p = normalizeProfile(profile);
  const seen = new Set(OPTIONAL_DOCS);
  const out = OPTIONAL_DOCS.slice();
  for (const code of PROFILE_OPTIONAL[p] || []) {
    if (!seen.has(code)) {
      out.push(code);
      seen.add(code);
    }
  }
  return out;
}
function fullDocSetFor(profile, category, program) {
  return [...checklistFor(profile, category, program), ...optionalDocsFor(profile)];
}
function docMetaFor(code, profile, category) {
  const base = DOC_META[code] || {};
  const profileOverride = PROFILE_DOC_META[normalizeProfile(profile)]?.[code] || {};
  const categoryOverride = CATEGORY_DOC_META[normalizeCategory(category)]?.[code] || {};
  return { ...base, ...profileOverride, ...categoryOverride };
}
function isLegacyCode(code) { return LEGACY_DOC_CODES.includes(code); }
function isOptionalCode(code) { return OPTIONAL_DOCS.includes(code); }

function isMandatoryForStudent(docCode, profile, category, program) {
  if (isLegacyCode(docCode)) return false;
  return checklistFor(profile, category, program).includes(docCode);
}

module.exports = {
  DOC_META, CHECKLISTS, CATEGORY_MANDATORY, CATEGORY_DOC_META, PROGRAM_MANDATORY, PROFILE_OPTIONAL, PROFILE_DOC_META,
  OPTIONAL_DOCS, LEGACY_DOC_CODES, CATEGORIES, PROFILES,
  normalizeProfile, normalizeCategory, isValidProfile, isDualDegreeProgram,
  checklistFor, categoryMandatoryFor, programMandatoryFor, optionalDocsFor, fullDocSetFor, docMetaFor,
  isLegacyCode, isOptionalCode, isMandatoryForStudent,
};
