/* Verification slip PDF — uploaded documents only, bring in same order. */
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

  /** Uploaded docs only, keeping the same order as the student checklist. */
  function uploadedDocsInOrder(documents) {
    return [...(documents || [])].filter((d) => d && d.hasFile);
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
    const margin = 48;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const contentW = pageW - margin * 2;
    const crimson = [123, 30, 21];
    const slate = [71, 85, 105];
    const uploaded = uploadedDocsInOrder(documents);

    let y = margin;

    pdf.setFillColor(...crimson);
    pdf.rect(margin, y, contentW, 3, "F");
    y += 18;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(...crimson);
    pdf.text("Manipal Academy of Higher Education", margin, y);
    y += 16;
    pdf.setFontSize(11);
    pdf.text("EduVerify — Documents to bring for verification", margin, y);
    y += 22;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...slate);
    pdf.text(`Application No.: ${student.appNo || "—"}`, margin, y);
    y += 13;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(30, 41, 59);
    pdf.text(student.name || "—", margin, y);
    y += 14;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...slate);
    const meta = [
      student.program || "—",
      student.section ? `Sec ${student.section}` : null,
      student.category || null,
    ].filter(Boolean).join(" · ");
    pdf.text(meta, margin, y);
    y += 18;

    if (verifySlot) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(5, 150, 105);
      pdf.text("Verification slot", margin, y);
      y += 12;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(30, 41, 59);
      const slotLine = [
        `Date: ${fmtDate(verifySlot.date)}`,
        `Room: ${verifySlot.room || "—"}`,
        `Slot #${verifySlot.slotNo || "—"}`,
        `Time: ${verifySlot.startTime || "—"}${verifySlot.endTime ? " – " + verifySlot.endTime : ""}`,
        `Report by: ${reportingTime(verifySlot.startTime)}`,
      ].join("   ·   ");
      const slotLines = pdf.splitTextToSize(slotLine, contentW);
      pdf.text(slotLines, margin, y);
      y += slotLines.length * 12 + 10;
    } else if (useReportingSlots && slot) {
      pdf.setFontSize(9);
      pdf.setTextColor(...slate);
      pdf.text(`Reporting appointment: ${fmtDate(slot.date)} at ${slot.time || "—"}`, margin, y);
      y += 16;
    }

    /* Instruction box */
    pdf.setFillColor(239, 246, 255);
    pdf.setDrawColor(191, 219, 254);
    pdf.roundedRect(margin, y, contentW, 42, 4, 4, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(30, 64, 175);
    pdf.text("Bring originals in the same order listed below for faster verification.", margin + 10, y + 16);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(51, 65, 85);
    pdf.text("Arrange physical documents in this sequence and present them at the verification counter.", margin + 10, y + 30);
    y += 56;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(30, 41, 59);
    pdf.text(`Uploaded documents (${uploaded.length})`, margin, y);
    y += 8;

    if (!uploaded.length) {
      y += 14;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...slate);
      pdf.text("No documents have been uploaded yet.", margin, y);
    } else {
      uploaded.forEach((d, idx) => {
        const label = `${idx + 1}.  ${d.name || d.docCode || "Document"}`;
        const lines = pdf.splitTextToSize(label, contentW - 8);
        const blockH = Math.max(18, lines.length * 11 + 6);
        if (y + blockH > pageH - 60) {
          pdf.addPage();
          y = margin;
        }
        y += 6;
        pdf.setDrawColor(226, 232, 240);
        pdf.setLineWidth(0.4);
        pdf.line(margin, y, margin + contentW, y);
        y += 14;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.setTextColor(30, 41, 59);
        pdf.text(lines, margin + 4, y);
        y += (lines.length - 1) * 11 + 4;
      });
      y += 8;
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, y, margin + contentW, y);
      y += 18;
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...crimson);
    const reminder = pdf.splitTextToSize(
      "Please bring the documents listed above in the same order for faster verification.",
      contentW
    );
    pdf.text(reminder, margin, y);
    y += reminder.length * 12 + 16;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...slate);
    pdf.text(`Helpdesk: ${support.phone} · ${support.email}`, margin, y);

    pdf.save(`Verification-${student.appNo}.pdf`);
  }

  global.downloadVerificationPdf = downloadVerificationPdf;
  global.uploadedDocsInOrder = uploadedDocsInOrder;
})(typeof window !== "undefined" ? window : global);
