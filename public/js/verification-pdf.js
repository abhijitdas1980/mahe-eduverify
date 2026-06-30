/* Shared verification slip PDF — student copy + university verifier copy. */
(function (global) {
  const DEFAULT_SUPPORT = { phone: "+91-80-4567-8900", email: "admissions@eduverify.ac.in" };

  function fmtDate(d) {
    return d ? String(d).slice(0, 10) : "—";
  }

  function parseTimeLabel(label) {
    const s = String(label || "").trim();
    const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m12) {
      let h = parseInt(m12[1], 10);
      const mm = parseInt(m12[2], 10);
      const ap = m12[3].toUpperCase();
      if (ap === "PM" && h !== 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
      return h * 60 + mm;
    }
    const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
    return null;
  }

  function minsToTimeLabel(totalMins) {
    const m = ((totalMins % (24 * 60)) + (24 * 60)) % (24 * 60);
    const h24 = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, "0");
    const ap = h24 < 12 ? "AM" : "PM";
    const h12 = (h24 % 12) === 0 ? 12 : (h24 % 12);
    return `${h12}:${mm} ${ap}`;
  }

  function reportingTime(startTime, minutesBefore = 30) {
    const mins = parseTimeLabel(startTime);
    if (mins == null) return startTime || "—";
    return minsToTimeLabel(mins - minutesBefore);
  }

  function downloadVerificationPdf({
    student,
    documents,
    slot,
    verifySlot,
    useReportingSlots = false,
    support = DEFAULT_SUPPORT,
    onError,
  }) {
    if (!window.jspdf) {
      const msg = "PDF library not loaded. Please refresh the page and try again.";
      if (onError) onError(msg);
      return;
    }
    if (!student?.appNo) {
      if (onError) onError("Student record is missing.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const margin = 40;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const contentW = pageW - margin * 2;
    const crimson = [123, 30, 21];
    const slate = [71, 85, 105];
    const sortedDocs = [...(documents || [])].sort((a, b) => {
      if (!!a.optional !== !!b.optional) return a.optional ? 1 : -1;
      return String(a.name).localeCompare(String(b.name));
    });

    const drawCheckboxPair = (x, y, w) => {
      const box = 11;
      const mid = x + w / 2;
      pdf.setDrawColor(100, 116, 139);
      pdf.setLineWidth(0.6);
      pdf.rect(mid - box - 14, y - 9, box, box);
      pdf.setFontSize(7);
      pdf.setTextColor(...slate);
      pdf.text("Yes", mid - box - 14, y + 6);
      pdf.rect(mid + 6, y - 9, box, box);
      pdf.text("No", mid + 6, y + 6);
    };

    const drawCopy = (copyLabel, copyNote, copyIdx) => {
      if (copyIdx > 0) pdf.addPage();
      let y = margin;

      pdf.setFillColor(...crimson);
      pdf.rect(margin, y, contentW, 3, "F");
      y += 10;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.setTextColor(...crimson);
      pdf.text("Manipal Academy of Higher Education", margin, y);
      y += 14;
      pdf.setFontSize(11);
      pdf.text("EduVerify — Original Document Verification", margin, y);
      y += 16;
      pdf.setFontSize(9);
      pdf.setTextColor(...slate);
      pdf.text(copyLabel, margin, y);
      pdf.setFont("helvetica", "normal");
      pdf.text(copyNote, margin, y + 12);
      y += 28;

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.5);
      pdf.roundedRect(margin, y, contentW, 88, 4, 4);
      pdf.setFontSize(8.5);
      pdf.setTextColor(30, 41, 59);
      const infoColW = contentW / 2 - 12;
      const info = [
        ["Application No.", student.appNo || "—"],
        ["Student Name", student.name || "—"],
        ["Program", student.program || "—"],
        ["Section / Category", `${student.section || "—"} · ${student.category || "—"}`],
        ["Profile", (student.profile || "—").replace(/-/g, " / ")],
        ["Orientation Date", fmtDate(student.orientationDate)],
      ];
      info.forEach(([label, value], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = margin + 10 + col * (infoColW + 8);
        const iy = y + 14 + row * 26;
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...slate);
        pdf.text(label, x, iy);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(30, 41, 59);
        const lines = pdf.splitTextToSize(String(value), infoColW);
        pdf.text(lines, x, iy + 11);
      });
      y += 98;

      if (verifySlot) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9);
        pdf.setTextColor(5, 150, 105);
        pdf.text("Assigned Verification Slot", margin, y);
        y += 12;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(30, 41, 59);
        const slotLine = [
          `Date: ${fmtDate(verifySlot.date)}`,
          `Room: ${verifySlot.room || "—"}`,
          `Slot #${verifySlot.slotNo || "—"}`,
          `Time: ${verifySlot.startTime || "—"}${verifySlot.endTime ? " – " + verifySlot.endTime : ""}`,
          `Report by: ${reportingTime(verifySlot.startTime)} (30 min before)`,
        ].join("   ·   ");
        const slotLines = pdf.splitTextToSize(slotLine, contentW);
        pdf.text(slotLines, margin, y);
        y += slotLines.length * 11 + 6;
        pdf.setFontSize(8);
        pdf.setTextColor(...slate);
        pdf.text("Bring all original documents listed below. Present this printout at the verification counter.", margin, y);
        y += 16;
      } else {
        pdf.setFontSize(8.5);
        pdf.setTextColor(...slate);
        pdf.text("Verification slot will be assigned after mandatory document uploads and self-declaration.", margin, y);
        y += 16;
      }

      if (useReportingSlots && slot) {
        pdf.setFontSize(8);
        pdf.text(`Reporting appointment: ${fmtDate(slot.date)} at ${slot.time || "—"}`, margin, y);
        y += 14;
      }

      const cols = [
        { label: "#", w: 22 },
        { label: "Document", w: 198 },
        { label: "Type", w: 42 },
        { label: "Campus", w: 58 },
        { label: "Online", w: 48 },
        { label: "Original submitted?", w: contentW - 22 - 198 - 42 - 58 - 48 },
      ];
      const rowH = 20;
      const headerH = 22;
      let x = margin;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y, contentW, headerH, "F");
      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.5);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(51, 65, 85);
      cols.forEach((c) => {
        pdf.rect(x, y, c.w, headerH);
        const labelLines = pdf.splitTextToSize(c.label, c.w - 6);
        pdf.text(labelLines, x + 4, y + 10);
        x += c.w;
      });
      y += headerH;

      sortedDocs.forEach((d, idx) => {
        if (y + rowH > pageH - 90) {
          pdf.addPage();
          y = margin;
          pdf.setFontSize(8);
          pdf.setTextColor(...slate);
          pdf.text(`${copyLabel} (continued)`, margin, y);
          y += 16;
        }
        x = margin;
        const uploaded = d.hasFile ? "Yes" : "No";
        const campusReq = d.original ? "Original" : "Photocopy";
        const cells = [
          String(idx + 1),
          d.name + (d.flagged ? " *" : ""),
          d.optional ? "Optional" : "Mandatory",
          campusReq,
          uploaded,
          "",
        ];
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        pdf.setTextColor(30, 41, 59);
        cols.forEach((c, ci) => {
          pdf.rect(x, y, c.w, rowH);
          if (ci === cols.length - 1) {
            drawCheckboxPair(x, y + 13, c.w);
          } else {
            const lines = pdf.splitTextToSize(cells[ci], c.w - 6);
            pdf.text(lines.slice(0, 2), x + 4, y + 12);
          }
          x += c.w;
        });
        y += rowH;
      });

      if (sortedDocs.some((d) => d.flagged)) {
        y += 6;
        pdf.setFontSize(7);
        pdf.setTextColor(190, 18, 60);
        pdf.text("* Flagged for additional review by the verification cell.", margin, y);
        y += 12;
      }

      y += 10;
      pdf.setDrawColor(203, 213, 225);
      pdf.setLineDashPattern([3, 2], 0);
      pdf.line(margin, y, margin + contentW, y);
      pdf.setLineDashPattern([], 0);
      y += 16;

      pdf.setFontSize(8);
      pdf.setTextColor(30, 41, 59);
      if (copyLabel.includes("STUDENT")) {
        pdf.text("I confirm that I will produce the originals listed above at the verification counter on my assigned slot.", margin, y);
        y += 22;
        pdf.text("Student signature:", margin, y);
        pdf.line(margin + 88, y + 1, margin + 260, y + 1);
        pdf.text("Date:", margin + 280, y);
        pdf.line(margin + 305, y + 1, margin + contentW, y + 1);
      } else {
        pdf.text("Verifier: tick Original submitted (Yes/No) for each document after physical checking.", margin, y);
        y += 22;
        pdf.text("Verifier signature:", margin, y);
        pdf.line(margin + 92, y + 1, margin + 240, y + 1);
        pdf.text("Staff ID:", margin + 255, y);
        pdf.line(margin + 295, y + 1, margin + 360, y + 1);
        pdf.text("Date:", margin + 375, y);
        pdf.line(margin + 400, y + 1, margin + contentW, y + 1);
      }

      y += 18;
      pdf.setFontSize(7);
      pdf.setTextColor(...slate);
      pdf.text(`Helpdesk: ${support.phone} · ${support.email}`, margin, y);
    };

    drawCopy("STUDENT COPY", "Print, sign, and bring to campus on your verification day.", 0);
    drawCopy("UNIVERSITY VERIFIER COPY", "For verification cell — retain after checking originals.", 1);

    pdf.save(`Verification-${student.appNo}.pdf`);
  }

  global.downloadVerificationPdf = downloadVerificationPdf;
})(typeof window !== "undefined" ? window : global);
