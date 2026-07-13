/* Student + parent contact validation (no OTP). */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARENT_RELATIONS = ["Father", "Mother", "Guardian", "Other"];

function normalizePhone(phone) {
  return String(phone || "").replace(/[\s\-().]/g, "");
}

function isValidEmail(email) {
  const e = String(email || "").trim();
  return e.length > 0 && e.length <= 160 && EMAIL_REGEX.test(e);
}

function isValidPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return false;
  return /^(\+?\d{10,15})$/.test(p);
}

function validateContactPayload(body, opts = {}) {
  const errors = [];
  const email = String(body.email || "").trim().toLowerCase();
  const phone = normalizePhone(body.phone);
  const parentName = String(body.parentName || "").trim();
  const parentRelation = String(body.parentRelation || "").trim();
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const parentPhone = normalizePhone(body.parentPhone);
  const declared = !!body.declared;
  const staff = !!opts.staff;

  if (!isValidEmail(email)) errors.push("Enter a valid student email address.");
  if (!isValidPhone(phone)) errors.push("Enter a valid student mobile number (10–15 digits).");
  if (!parentName || parentName.length > 120) errors.push("Enter parent/guardian full name.");
  if (!PARENT_RELATIONS.includes(parentRelation)) errors.push("Select parent/guardian relation.");
  if (!isValidEmail(parentEmail)) errors.push("Enter a valid parent/guardian email address.");
  if (!isValidPhone(parentPhone)) errors.push("Enter a valid parent/guardian mobile number.");
  if (!staff && !declared) errors.push("Please accept the declaration before saving.");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    data: { email, phone, parentName, parentRelation, parentEmail, parentPhone },
  };
}

/** True when a validated bulk-import row has all contact fields (staff-equivalent). */
function hasCompleteContactFromBulkRow(row) {
  if (!row) return false;
  return validateContactPayload(
    {
      email: row.email,
      phone: row.phone,
      parentName: row.parent_name,
      parentRelation: row.parent_relation,
      parentEmail: row.parent_email,
      parentPhone: row.parent_phone,
    },
    { staff: true }
  ).ok;
}

function hasAnyBulkContactField(row) {
  if (!row) return false;
  return !!(
    row.email
    || row.phone
    || row.parent_name
    || row.parent_email
    || row.parent_phone
    || row.parent_relation
  );
}

function serializeContact(row) {
  if (!row) return null;
  return {
    email: row.email || "",
    phone: row.phone || "",
    parentName: row.parent_name || "",
    parentRelation: row.parent_relation || "",
    parentEmail: row.parent_email || "",
    parentPhone: row.parent_phone || "",
    contactCompleted: !!row.contact_completed_at,
    contactCompletedAt: row.contact_completed_at || null,
    contactVerified: !!row.contact_verified_at,
    contactVerifiedAt: row.contact_verified_at || null,
  };
}

module.exports = {
  PARENT_RELATIONS,
  normalizePhone,
  isValidEmail,
  isValidPhone,
  validateContactPayload,
  hasCompleteContactFromBulkRow,
  hasAnyBulkContactField,
  serializeContact,
};
