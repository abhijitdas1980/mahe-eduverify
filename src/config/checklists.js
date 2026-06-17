/* v8 — Document set changes:
   - REMOVED (no longer requested):
       BANK    (Bank Passbook / Cancelled Cheque)
       PAN     (Student PAN Card)
       CASTE   (Caste Certificate)
       MEDICAL (Medical Fitness Certificate)
   - OPTIONAL (student may skip, admin can still view if uploaded):
       MIGRATION (Migration Certificate — from Last Institution Studied)
       TC        (Transfer Certificate — from Last Institution Studied)
   - Category dropdown extended with: NRI Sponsored, Foreign, OCI
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
  /* OPTIONAL */
  TC:         { name: "Transfer Certificate (TC) — from the Last Institution Studied", original: true,  needsInstitution: true,  imageOnly: false, optional: true  },
  MIGRATION:  { name: "Migration Certificate (from the Last Institution Studied)",     original: true,  needsInstitution: true,  imageOnly: false, optional: true  },
  /* /OPTIONAL */
  CHAR_CERT:  { name: "Character / Conduct Certificate (from Last Institution Studied)", original: true, needsInstitution: true, imageOnly: false, optional: false },
  PHOTOS:     { name: "Passport-size Photographs (white background)",                  original: true,  needsInstitution: false, imageOnly: true,  optional: false },
  ANTI_RAG_S: { name: "Anti-Ragging Undertaking (Student)",                            original: true,  needsInstitution: false, imageOnly: false, optional: false },
  ANTI_RAG_P: { name: "Anti-Ragging Undertaking (Parent)",                             original: true,  needsInstitution: false, imageOnly: false, optional: false },
  ANTI_SUB:   { name: "Anti-Substance Abuse Declaration",                              original: true,  needsInstitution: false, imageOnly: false, optional: false },
  INCOME:     { name: "ITR – AICTE Fee Waiver",                                        original: true,  needsInstitution: false, imageOnly: false, optional: false },
  PASSPORT:   { name: "Passport (NRI/Foreign)",                                        original: true,  needsInstitution: false, imageOnly: false, optional: false },
  VISA:       { name: "Valid Student Visa",                                            original: true,  needsInstitution: false, imageOnly: false, optional: false },
  EQUIV:      { name: "AIU / Equivalence Certificate",                                 original: true,  needsInstitution: true,  imageOnly: false, optional: false },
  ENGLISH:    { name: "English Proficiency (IELTS/TOEFL)",                             original: false, needsInstitution: true,  imageOnly: false, optional: false },
};

/* MANDATORY checklists per profile — these gate declaration + slot booking. */
const CHECKLISTS = {
  "UG-Indian":             ["SSLC","PUC","CHAR_CERT","AADHAAR","APAAR","PAN_PARENT","PHOTOS","ANTI_RAG_S","ANTI_RAG_P","ANTI_SUB"],
  "UG-Indian-Scholarship": ["SSLC","PUC","CHAR_CERT","AADHAAR","APAAR","PAN_PARENT","PHOTOS","ANTI_RAG_S","ANTI_RAG_P","ANTI_SUB","INCOME"],
  "UG-NRI":                ["SSLC","PUC","AADHAAR","APAAR","PAN_PARENT","PHOTOS","ANTI_RAG_S","ANTI_RAG_P","ANTI_SUB","PASSPORT","VISA","EQUIV"],
  "UG-Foreign":            ["PUC","PHOTOS","ANTI_RAG_S","ANTI_RAG_P","ANTI_SUB","PASSPORT","VISA","EQUIV","ENGLISH"],
  "UG-Lateral":            ["SSLC","DIPLOMA","CHAR_CERT","AADHAAR","APAAR","PAN_PARENT","PHOTOS","ANTI_RAG_S","ANTI_RAG_P","ANTI_SUB"],
  "PG-Indian":             ["SSLC","PUC","UG_DEGREE","UG_MARKS","CHAR_CERT","AADHAAR","APAAR","PAN_PARENT","PHOTOS","ANTI_RAG_S","ANTI_SUB"],
  "PG-Indian-Scholarship": ["SSLC","PUC","UG_DEGREE","UG_MARKS","CHAR_CERT","AADHAAR","APAAR","PAN_PARENT","PHOTOS","ANTI_RAG_S","ANTI_SUB","INCOME"],
};

/* OPTIONAL documents shown to every student. Student can submit without them.
   Admin can still view + download them if uploaded. */
const OPTIONAL_DOCS = ["MIGRATION", "TC"];

/* Codes removed in v8. Existing student rows for these are filtered out of
   listings, stats and reports — without being deleted. */
const LEGACY_DOC_CODES = ["PAN", "BANK", "CASTE", "MEDICAL"];

/* Canonical category dropdown — v8 adds NRI Sponsored, Foreign, OCI. */
const CATEGORIES = ["General", "NRI", "NRI Sponsored", "Foreign", "OCI", "AICTE"];

function checklistFor(profile) { return CHECKLISTS[profile] || CHECKLISTS["UG-Indian"]; }
function optionalDocsFor(_profile) { return OPTIONAL_DOCS.slice(); }
function fullDocSetFor(profile) { return [...checklistFor(profile), ...OPTIONAL_DOCS]; }
function isLegacyCode(code) { return LEGACY_DOC_CODES.includes(code); }
function isOptionalCode(code) { return OPTIONAL_DOCS.includes(code); }

module.exports = {
  DOC_META, CHECKLISTS, OPTIONAL_DOCS, LEGACY_DOC_CODES, CATEGORIES,
  checklistFor, optionalDocsFor, fullDocSetFor, isLegacyCode, isOptionalCode,
};
