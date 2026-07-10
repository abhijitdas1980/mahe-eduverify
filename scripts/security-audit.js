#!/usr/bin/env node
/* Security + error smoke tests — writes NDJSON via debugLog (session c0bd59). */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const http = require("http");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { pool } = require("../src/config/db");
const { debugLog, LOG_PATH } = require("../src/lib/debugLog");
const { sign } = require("../src/middleware/auth");
const { SHEET_NAME, COLUMNS } = require("../src/constants/studentBulkUpload");

const BASE = `http://127.0.0.1:${process.env.PORT || 8080}`;
const ADMIN_PASS = process.env.SEED_ADMIN_PASSWORD || "admin123";

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

function jsonBody(res) {
  try { return JSON.parse(res.body); } catch { return {}; }
}

async function adminToken() {
  const login = await request("POST", "/api/auth/admin/login", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ staffId: process.env.SEED_ADMIN_ID || "ADM-001", password: ADMIN_PASS }),
  });
  return jsonBody(login).token || null;
}

async function buildOneRowUploadBuffer(appNo) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAME);
  ws.addRow(COLUMNS);
  ws.addRow([
    appNo, "Audit Bulk", "01-01-2010", "Male", "UG", "BSc CS", "CS", "A", "2026", "General",
    "", "20-07-2026", "1", "audit-bulk@test.local", "9000000099", "", "", "",
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function validateBulkUpload(token, appNo) {
  const buf = await buildOneRowUploadBuffer(appNo);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), "audit-upload.xlsx");
  const res = await fetch(`${BASE}/api/admin/students/bulk-upload/validate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function run() {
  const tests = [];

  const noAuth = await request("GET", "/api/admin/students");
  tests.push({ name: "admin_no_auth", hypothesisId: "H1", status: noAuth.status, pass: noAuth.status === 401 });

  const studentNoAuth = await request("GET", "/api/student/me");
  tests.push({ name: "student_no_auth", hypothesisId: "H1", status: studentNoAuth.status, pass: studentNoAuth.status === 401 });

  const forged = await request("GET", "/api/admin/students", {
    headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid" },
  });
  tests.push({ name: "forged_jwt_rejected", hypothesisId: "H1", status: forged.status, pass: forged.status === 401 });

  const authCheck = await request("POST", "/api/auth/student/check", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appNo: "9999999999", dob: "2000-01-01" }),
  });
  const authJson = jsonBody(authCheck);
  tests.push({
    name: "auth_check_no_stack_leak",
    hypothesisId: "H2",
    status: authCheck.status,
    pass: authCheck.status === 404 && !String(authJson.error || "").includes("stack") && !String(authCheck.body).includes("ECONNREFUSED"),
    body: authCheck.body.slice(0, 160),
  });

  const cors = await request("GET", "/api/health", { headers: { Origin: "https://evil.example" } });
  const acao = cors.headers["access-control-allow-origin"];
  const acac = cors.headers["access-control-allow-credentials"];
  tests.push({
    name: "cors_reflect_without_credentials",
    hypothesisId: "H3",
    status: cors.status,
    acao,
    acac,
    pass: acao !== "https://evil.example" || acac !== "true",
  });

  const token = await adminToken();
  tests.push({
    name: "admin_login",
    hypothesisId: "H4",
    status: token ? 200 : 401,
    pass: Boolean(token),
  });

  if (token) {
    const badStudent = await request("POST", "/api/admin/students", {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ appNo: "abc", name: "Test", dob: "2010-05-01", gender: "Male", profile: "UG", program: "BSc", verificationDate: "2026-07-20" }),
    });
    const badJson = jsonBody(badStudent);
    tests.push({
      name: "add_student_rejects_invalid_app_no",
      hypothesisId: "H4",
      status: badStudent.status,
      pass: badStudent.status === 400 && Array.isArray(badJson.errors),
      errors: badJson.errors,
    });

    const goodStudent = await request("POST", "/api/admin/students", {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        appNo: "2026101999", name: "Audit Test", dob: "2010-05-01", gender: "Male", profile: "UG",
        program: "BSc CS", verificationDate: "2026-07-20", email: "audit@test.local",
      }),
    });
    const goodJson = jsonBody(goodStudent);
    tests.push({
      name: "add_student_accepts_valid_payload",
      hypothesisId: "H4",
      status: goodStudent.status,
      pass: goodStudent.status === 200 && goodJson.ok === true,
      appNo: goodJson.appNo,
    });

    const bulkNoSession = await request("POST", "/api/admin/students/bulk-upload/confirm", {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId: "00000000-0000-4000-8000-000000000000" }),
    });
    tests.push({
      name: "bulk_confirm_invalid_session",
      hypothesisId: "H5",
      status: bulkNoSession.status,
      pass: bulkNoSession.status === 400,
    });

    const zipNoStudent = await request("GET", "/api/admin/students/NONEXIST999/documents.zip", {
      headers: { Authorization: `Bearer ${token}` },
    });
    tests.push({
      name: "documents_zip_requires_auth_and_student",
      hypothesisId: "H1",
      status: zipNoStudent.status,
      pass: zipNoStudent.status === 404,
    });

    await pool.query("DELETE FROM students WHERE app_no=$1", ["2026101999"]).catch(() => {});

    const bulkAppNo = `202610${String(Date.now()).slice(-4)}`;
    await pool.query("DELETE FROM students WHERE app_no=$1", [bulkAppNo]).catch(() => {});
    const validated = await validateBulkUpload(token, bulkAppNo);
    const sessionId = validated.json?.sessionId;
    const decoded = jwt.decode(token);
    const hijackToken = sign({
      type: "admin",
      id: decoded?.id || 1,
      staffId: "OTHER-STAFF",
      role: "supervisor",
    });
    const hijack = sessionId
      ? await request("POST", "/api/admin/students/bulk-upload/confirm", {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${hijackToken}` },
        body: JSON.stringify({ sessionId }),
      })
      : { status: 0, body: "" };
    tests.push({
      name: "bulk_confirm_rejects_other_staff_session",
      hypothesisId: "H5",
      status: hijack.status,
      pass: Boolean(sessionId) && hijack.status === 403,
      sessionCreated: Boolean(sessionId),
      validateStatus: validated.status,
    });
  }

  const studentToken = sign({ type: "student", id: 999999, appNo: "FAKE" });
  const studentHitsAdmin = await request("GET", "/api/admin/students", {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  tests.push({
    name: "student_token_cannot_access_admin",
    hypothesisId: "H1",
    status: studentHitsAdmin.status,
    pass: studentHitsAdmin.status === 401,
  });

  for (const t of tests) {
    debugLog({ ...t, location: "scripts/security-audit.js", message: "security_test", runId: "post-fix" });
  }

  const failed = tests.filter((t) => !t.pass);
  console.log(JSON.stringify({ logPath: LOG_PATH, total: tests.length, failed: failed.length, tests }, null, 2));
  await pool.end().catch(() => {});
  process.exit(failed.length ? 1 : 0);
}

run().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
