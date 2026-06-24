const INSECURE_JWT = "dev-only-insecure-secret-change-me";
const DEFAULT_ADMIN_PASS = "ChangeMe@2026";

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

  const cors = process.env.CORS_ORIGIN || "*";
  if (cors === "*") {
    console.warn(
      "[security] CORS_ORIGIN is '*' in production — set it to your exact site URL before go-live."
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
  INSECURE_JWT,
  DEFAULT_ADMIN_PASS,
};
