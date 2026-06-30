#!/usr/bin/env node
/* Security smoke tests — writes NDJSON to debug-e101d5.log */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const http = require("http");
const fs = require("fs");
const path = require("path");
const { debugLog } = require("../src/lib/debugLog");

const BASE = `http://127.0.0.1:${process.env.PORT || 8080}`;
const LOG = path.join(__dirname, "..", "..", "debug-e101d5.log");

function request(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  try { fs.unlinkSync(LOG); } catch (_) {}

  const tests = [];

  const noAuth = await request("GET", "/api/admin/students");
  tests.push({ name: "admin_no_auth", hypothesisId: "H1", status: noAuth.status, pass: noAuth.status === 401 });

  const studentNoAuth = await request("GET", "/api/student/me");
  tests.push({ name: "student_no_auth", hypothesisId: "H1", status: studentNoAuth.status, pass: studentNoAuth.status === 401 });

  const authCheck = await request("POST", "/api/auth/student/check", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appNo: "999999", dob: "2000-01-01" }),
  });
  tests.push({
    name: "auth_check_db_error",
    hypothesisId: "H2",
    status: authCheck.status,
    pass: authCheck.status === 503 || authCheck.status === 404,
    body: authCheck.body.slice(0, 120),
  });

  const cors = await request("GET", "/", { headers: { Origin: "https://evil.example" } });
  const acao = cors.headers["access-control-allow-origin"];
  const acac = cors.headers["access-control-allow-credentials"];
  const corsPass = acao === "https://evil.example" && acac !== "true";
  tests.push({
    name: "cors_wildcard_credentials",
    hypothesisId: "H3",
    status: cors.status,
    acao,
    acac,
    pass: corsPass,
  });

  const staticJs = await request("GET", "/js/verification-pdf.js");
  tests.push({
    name: "verification_pdf_static",
    hypothesisId: "H4",
    status: staticJs.status,
    pass: staticJs.status === 200 && staticJs.body.includes("downloadVerificationPdf"),
  });

  for (const t of tests) {
    debugLog({ ...t, location: "scripts/security-audit.js", message: "security_test", runId: "post-fix" });
  }

  const failed = tests.filter((t) => !t.pass);
  console.log(JSON.stringify({ total: tests.length, failed: failed.length, tests }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
