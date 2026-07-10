/* Student bulk-upload Excel template — column definitions and validation constants. */

const SHEET_NAME = "Students";
const TEMPLATE_FILENAME = "student-upload-template.xlsx";

const COLUMNS = [
  "application_number",
  "full_name",
  "date_of_birth",
  "gender",
  "profile",
  "program",
  "department",
  "section",
  "batch",
  "category",
  "orientation_date",
  "verification_date",
  "verification_batch",
  "email",
  "phone",
  "parent_mail",
  "parent_phone",
  "relationship",
];

/** Headers that may be omitted in older templates. */
const OPTIONAL_COLUMNS = [
  "verification_batch",
  "parent_mail",
  "parent_phone",
  "relationship",
];

const REQUIRED_HEADERS = COLUMNS.filter((c) => !OPTIONAL_COLUMNS.includes(c));

const REQUIRED_FIELDS = [
  "application_number",
  "full_name",
  "date_of_birth",
  "gender",
  "profile",
  "program",
  "verification_date",
];

const GENDERS = ["Male", "Female", "Other"];
const PARENT_RELATIONS = ["Father", "Mother", "Guardian", "Other"];
const DATE_DISPLAY_FORMAT = "dd-mm-yyyy";
const DATE_REGEX = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
/** Application numbers must be digits only (no letters or symbols). */
const APPLICATION_NUMBER_REGEX = /^\d+$/;

const FIELD_LIMITS = {
  application_number: 40,
  full_name: 120,
  program: 120,
  department: 80,
  section: 10,
  batch: 20,
  category: 20,
  email: 160,
  phone: 20,
  parent_mail: 160,
  parent_phone: 20,
  relationship: 30,
};

const SESSION_TTL_MS = 30 * 60 * 1000;

/** Default orientation-week verification days (batch 1–4). */
const DEFAULT_VERIFICATION_DATES = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"];

module.exports = {
  SHEET_NAME,
  TEMPLATE_FILENAME,
  COLUMNS,
  REQUIRED_HEADERS,
  OPTIONAL_COLUMNS,
  REQUIRED_FIELDS,
  GENDERS,
  PARENT_RELATIONS,
  DATE_DISPLAY_FORMAT,
  DATE_REGEX,
  APPLICATION_NUMBER_REGEX,
  FIELD_LIMITS,
  SESSION_TTL_MS,
  DEFAULT_VERIFICATION_DATES,
};
