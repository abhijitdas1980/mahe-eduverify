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
  "email",
  "phone",
];

const REQUIRED_FIELDS = [
  "application_number",
  "full_name",
  "date_of_birth",
  "gender",
  "profile",
  "program",
];

const GENDERS = ["Male", "Female", "Other"];
const DATE_DISPLAY_FORMAT = "dd-mm-yyyy";
const DATE_REGEX = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;

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
};

const SESSION_TTL_MS = 30 * 60 * 1000;

module.exports = {
  SHEET_NAME,
  TEMPLATE_FILENAME,
  COLUMNS,
  REQUIRED_FIELDS,
  GENDERS,
  DATE_DISPLAY_FORMAT,
  DATE_REGEX,
  FIELD_LIMITS,
  SESSION_TTL_MS,
};
