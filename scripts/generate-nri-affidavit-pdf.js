/* One-off generator — produces public/templates/nri-affidavit.pdf */
const fs = require("fs");
const path = require("path");

let PDFDocument;
try {
  PDFDocument = require("pdfkit");
} catch {
  console.error("Run: npm install pdfkit --no-save");
  process.exit(1);
}

const outDir = path.join(__dirname, "..", "public", "templates");
const outFile = path.join(outDir, "nri-affidavit.pdf");

fs.mkdirSync(outDir, { recursive: true });

const doc = new PDFDocument({ size: "A4", margin: 56 });
const stream = fs.createWriteStream(outFile);
doc.pipe(stream);

const W = doc.page.width - 112;
const line = (y) => doc.moveTo(56, y).lineTo(doc.page.width - 56, y).strokeColor("#cccccc").stroke();

doc.font("Helvetica-Bold").fontSize(13).text("NRI AFFIDAVIT", { align: "center" });
doc.moveDown(0.4);
doc.font("Helvetica").fontSize(9).fillColor("#444444").text(
  "(To be submitted on non-judicial stamp paper of appropriate value, as applicable in the state of execution.\nNotarisation / attestation by Notary Public or Indian Embassy may be required.)",
  { align: "center", width: W }
);
doc.moveDown(1);
doc.fillColor("#000000");

const para = (text, opts = {}) => {
  doc.font("Helvetica").fontSize(11).text(text, { width: W, lineGap: 4, ...opts });
  doc.moveDown(0.6);
};

para(
  "I, ________________________________________________________________ , aged about ________ years, son / daughter / spouse of ________________________________________________________________ , residing at ________________________________________________________________________________________________ , holder of Passport No. ________________________________ , do hereby solemnly affirm and declare as under:"
);

const items = [
  "That I am a Non-Resident Indian (NRI) / Foreign National / Person of Indian Origin (PIO) / Overseas Citizen of India (OCI), as applicable, and hold valid proof of NRI / foreign status.",
  "That I am the sponsor / guardian of Mr. / Ms. / Master / Miss ________________________________________________________________ , holding Application No. ________________________________ , who has been provisionally admitted to the programme ________________________________________________________________ at this institution.",
  "That I undertake to bear the entire course fee, hostel charges, and other dues payable by the candidate for the duration of the programme, as and when demanded by the institution.",
  "That the information furnished in this affidavit and in the candidate's application is true and correct to the best of my knowledge and belief.",
  "That I shall abide by the rules, regulations, and policies of the institution in respect of the candidate's admission and continuation in the programme.",
];

items.forEach((t, i) => {
  doc.font("Helvetica").fontSize(11).text(`${i + 1}. ${t}`, { width: W, lineGap: 4 });
  doc.moveDown(0.5);
});

doc.moveDown(0.5);
para("Place: ________________________________          Date: ____ / ____ / __________");

doc.moveDown(0.3);
line(doc.y);
doc.moveDown(0.8);

doc.font("Helvetica-Bold").fontSize(11).text("DEPONENT (Sponsor / NRI / Parent / Guardian)");
doc.moveDown(1.2);
doc.font("Helvetica").fontSize(11);
doc.text("Signature: ________________________________________________");
doc.moveDown(0.5);
doc.text("Name (block letters): ________________________________________________");
doc.moveDown(0.5);
doc.text("Address: ________________________________________________________________");
doc.moveDown(0.5);
doc.text("Contact (phone / email): ________________________________________________");

doc.moveDown(1.5);
line(doc.y);
doc.moveDown(0.8);

doc.font("Helvetica-Bold").fontSize(11).text("ATTESTATION / NOTARISATION");
doc.moveDown(0.6);
doc.font("Helvetica").fontSize(10).fillColor("#333333");
doc.text(
  "Solemnly affirmed / sworn and signed before me on this ________ day of ________________________________ 20______ at ________________________________ .",
  { width: W, lineGap: 3 }
);
doc.moveDown(1.2);
doc.fillColor("#000000");
doc.text("Signature & seal of Notary Public / Consulate Officer: ________________________________");
doc.moveDown(0.5);
doc.text("Name: ________________________________________________");
doc.moveDown(0.5);
doc.text("Registration / seal no.: ________________________________________________");

doc.end();

stream.on("finish", () => {
  console.log("Wrote", outFile);
});
