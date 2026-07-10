/* Excel template generation and workbook parsing for student bulk upload. */
const ExcelJS = require("exceljs");
const {
  SHEET_NAME,
  COLUMNS,
  REQUIRED_HEADERS,
  GENDERS,
  PARENT_RELATIONS,
  DATE_DISPLAY_FORMAT,
  DEFAULT_VERIFICATION_DATES,
} = require("../constants/studentBulkUpload");
const { PROFILES, CATEGORIES } = require("../config/checklists");
const { cellStr } = require("./studentBulkValidator");

const SAMPLE_ROWS = [
  {
    application_number: "2026101001",
    full_name: "Aarav Sharma",
    date_of_birth: "15-03-2007",
    gender: "Male",
    profile: "UG",
    program: "B.E. Computer Science",
    department: "Computer Science",
    section: "A",
    batch: "2026",
    category: "General",
    orientation_date: "10-06-2026",
    verification_date: "20-07-2026",
    verification_batch: "1",
    email: "aarav@example.com",
    phone: "9000000001",
    parent_name: "Rajesh Sharma",
    parent_mail: "parent.sharma@example.com",
    parent_phone: "9000000011",
    relationship: "Father",
  },
  {
    application_number: "2026101003",
    full_name: "Rahul Menon",
    date_of_birth: "22-08-1999",
    gender: "Male",
    profile: "PG",
    program: "MBA",
    department: "Management",
    section: "A",
    batch: "2026",
    category: "General",
    orientation_date: "10-06-2026",
    verification_date: "21-07-2026",
    verification_batch: "2",
    email: "priya@example.com",
    phone: "9000000002",
    parent_name: "Lakshmi Menon",
    parent_mail: "parent.menon@example.com",
    parent_phone: "9000000022",
    relationship: "Mother",
  },
];

async function buildTemplateBuffer() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "EduVerify";
  const ws = wb.addWorksheet(SHEET_NAME);

  ws.views = [{ state: "frozen", ySplit: 1 }];

  const headerRow = ws.addRow(COLUMNS);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4338CA" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;

  COLUMNS.forEach((_, i) => {
    ws.getColumn(i + 1).width = i === 1 ? 28 : i === 5 ? 22 : 18;
  });

  const appNoCol = COLUMNS.indexOf("application_number") + 1;
  const genderCol = COLUMNS.indexOf("gender") + 1;
  const profileCol = COLUMNS.indexOf("profile") + 1;
  const categoryCol = COLUMNS.indexOf("category") + 1;
  const relationshipCol = COLUMNS.indexOf("relationship") + 1;

  const verificationDateCol = COLUMNS.indexOf("verification_date") + 1;

  for (let r = 2; r <= 5002; r++) {
    const appNoCell = ws.getCell(r, appNoCol).address;
    ws.getCell(r, appNoCol).dataValidation = {
      type: "custom",
      allowBlank: true,
      formulae: [`AND(LEN(${appNoCell})>0,COUNTIF(${appNoCell},"*[!0-9]*")=0)`],
      showErrorMessage: true,
      errorTitle: "Invalid application number",
      error: "Application number must contain digits only (no letters or symbols).",
    };
    ws.getCell(r, genderCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${GENDERS.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid gender",
      error: `Choose one of: ${GENDERS.join(", ")}`,
    };
    ws.getCell(r, profileCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${PROFILES.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid profile",
      error: `Choose one of: ${PROFILES.join(", ")}.`,
    };
    ws.getCell(r, categoryCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${CATEGORIES.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid category",
      error: "Choose a category from the list (optional).",
    };
    ws.getCell(r, relationshipCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${PARENT_RELATIONS.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid relationship",
      error: `Choose one of: ${PARENT_RELATIONS.join(", ")} (optional).`,
    };
    ws.getCell(r, verificationDateCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${DEFAULT_VERIFICATION_DATES.map((d) => {
        const [y, m, day] = d.split("-");
        return `${day}-${m}-${y}`;
      }).join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid verification date",
      error: "Choose an orientation-week verification day (optional).",
    };
  }

  for (const sample of SAMPLE_ROWS) {
    ws.addRow(COLUMNS.map((c) => sample[c] ?? ""));
  }

  const noteRow = ws.addRow([]);
  noteRow.getCell(1).value = `Required: application_number (digits only, e.g. 2026101001), full_name, date_of_birth, gender, profile (UG or PG), program, verification_date (dd-mm-yyyy, e.g. 20-07-2026). Optional: verification_batch (1–4), email, phone, parent_name, parent_mail, parent_phone, relationship (Father/Mother/Guardian/Other). Date format: ${DATE_DISPLAY_FORMAT}. File type: .xlsx only.`;
  noteRow.getCell(1).font = { italic: true, color: { argb: "FF64748B" } };
  ws.mergeCells(noteRow.number, 1, noteRow.number, COLUMNS.length);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function normalizeHeader(h) {
  return cellStr(h).toLowerCase().replace(/\s+/g, "_");
}

function isRowEmpty(values) {
  return values.every((v) => !cellStr(v));
}

async function parseWorkbookBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet(SHEET_NAME) || wb.worksheets[0];
  if (!ws) throw new Error(`Worksheet "${SHEET_NAME}" not found.`);

  const headerRow = ws.getRow(1);
  const headerMap = {};
  headerRow.eachCell((cell, col) => {
    const key = normalizeHeader(cell.value);
    if (key) headerMap[col] = key;
  });

  const missing = REQUIRED_HEADERS.filter((c) => !Object.values(headerMap).includes(c));
  if (missing.length) {
    throw new Error(`Missing required column(s): ${missing.join(", ")}. Download the template and use those headers.`);
  }

  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col] = cell.value;
    });
    if (isRowEmpty(values)) return;

    const data = {};
    for (const [col, key] of Object.entries(headerMap)) {
      data[key] = values[Number(col)];
    }

    const noteText = cellStr(data.application_number);
    if (noteText.toLowerCase().startsWith("required:")) return;

    rows.push({ rowNumber, data });
  });

  if (!rows.length) throw new Error("No student rows found in the uploaded file.");
  return rows;
}

module.exports = { buildTemplateBuffer, parseWorkbookBuffer, SAMPLE_ROWS };
