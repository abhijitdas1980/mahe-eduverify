/* PostgreSQL connection pool. */
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set. The server cannot reach the database.");
}

// Render's managed Postgres requires SSL. Local Postgres usually does not.
const useSSL =
  process.env.NODE_ENV === "production" ||
  /render\.com|amazonaws|neon\.tech|supabase/.test(process.env.DATABASE_URL || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

// Small helper so route code stays short.
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
