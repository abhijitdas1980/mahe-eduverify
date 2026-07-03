const INSECURE_JWT = "dev-only-insecure-secret-change-me";
const DEFAULT_ADMIN_PASS = "ChangeMe@2026";

function storageProvider() {
  const explicit = (process.env.STORAGE_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return "azure";
  }
  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    return "cloudinary";
  }
  return "azure";
}

function isAzureStorageConfigured() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) return true;
  if (process.env.AZURE_STORAGE_ACCOUNT_NAME && process.env.AZURE_STORAGE_ACCOUNT_KEY) return true;
  if (process.env.AZURE_STORAGE_ACCOUNT_NAME && isProduction()) return true;
  return false;
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/** Refuse to boot in production without strong secrets. */
function assertProductionConfig() {
  if (!isProduction()) return;

  const jwt = process.env.JWT_SECRET || "";
  if (!jwt || jwt.length < 32 || jwt === INSECURE_JWT) {
    throw new Error(
      "JWT_SECRET must be set to a random string of at least 32 characters in production."
    );
  }

  const adminPass = process.env.SEED_ADMIN_PASSWORD || "";
  if (!adminPass || adminPass === DEFAULT_ADMIN_PASS) {
    throw new Error(
      "SEED_ADMIN_PASSWORD must be set to a strong password in production (not the default)."
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set in production.");
  }

  const provider = storageProvider();
  if (provider === "azure" && !isAzureStorageConfigured()) {
    throw new Error(
      "Azure Blob storage is required in production. Set AZURE_STORAGE_ACCOUNT_NAME (with Managed Identity) or AZURE_STORAGE_CONNECTION_STRING."
    );
  }
  if (provider === "cloudinary") {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error("Cloudinary credentials are required when STORAGE_PROVIDER=cloudinary.");
    }
  }

  const cors = process.env.CORS_ORIGIN || "*";
  if (cors === "*") {
    console.warn(
      "[security] CORS_ORIGIN is '*' in production — set it to your exact site URL before go-live."
    );
  }

  /* Rejection emails (student + parent) require MAHE M365 SMTP credentials. */
  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || "").trim();
  if (!smtpUser) {
    throw new Error(
      "SMTP_USER must be set in production (e.g. admissions.maheblr@manipal.edu)."
    );
  }
  if (!smtpPass) {
    throw new Error(
      "SMTP_PASS is mandatory in production. Set the Microsoft 365 mailbox password (or app password) for SMTP_USER."
    );
  }
}

function jwtSecret() {
  if (isProduction()) {
    return process.env.JWT_SECRET;
  }
  return process.env.JWT_SECRET || INSECURE_JWT;
}

module.exports = {
  assertProductionConfig,
  jwtSecret,
  isProduction,
  storageProvider,
  isAzureStorageConfigured,
  INSECURE_JWT,
  DEFAULT_ADMIN_PASS,
};
