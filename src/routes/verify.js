/* Verification schedule routes (v10)
   -----------------------------------
   Mounted at /api/admin/verify/*.
   Backs the orientation-week document-verification schedule:
       4 days × 15 rooms × 32 ten-minute slots = 1,920 unique slots.

   Status lifecycle per assignment row:
       open        — no student assigned
       booked      — student assigned, not yet verified
       pending     — student arrived / queued, awaiting verifier
       verified    — verification completed (verified_at + verified_by set)
       absent      — student didn't show up
       reassigned  — student was moved away from this slot

   This module is purely additive — it does NOT touch the v7-era `slots`
   table or the existing reporting-slot flow.
*/

const express = require("express");
const { pool } = require("../config/db");
const { requireAdmin, requireSupervisor } = require("../middleware/auth");
const { audit } = require("../lib/audit");

const router = express.Router();
router.use(requireAdmin);

/* ---- Defaults matching the spec ---- */
const DEFAULT_DATES = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"];
const DEFAULT_ROOMS = Array.from({ length: 15 }, (_, i) =>
  "AB4-" + String(101 + i)
);
const DEFAULT_START_MINUTES = 13 * 60;   // 1:00 PM
const DEFAULT_SLOT_MINUTES = 10;
const DEFAULT_SLOTS_PER_ROOM = 32;

const STATUSES = ["open", "booked", "pending", "verified", "absent", "reassigned"];

/* ---- Helpers ---- */
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");

function minsToLabel(m) {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, "0");
  const ap = h24 < 12 ? "AM" : "PM";
  const h12 = ((h24 % 12) === 0) ? 12 : (h24 % 12);
  return `${h12}:${mm} ${ap}`;
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function serializeAssignment(r) {
  return {
    id: r.id,
    date: r.schedule_date,
    room: r.room,
    slotNo: r.slot_no,
    startTime: r.start_time,
    endTime: r.end_time,
    status: r.status,
    verifiedAt: r.verified_at,
    verifiedBy: r.verified_by_staff_id || null,
    remarks: r.remarks || null,
    student: r.student_id ? {
      id: r.student_id,
      appNo: r.app_no || null,
      name: r.student_name || null,
      program: r.program || null,
      department: r.department || null,
      section: r.section || null,
      profile: r.profile || null,
      category: r.category || null,
    } : null,
  };
}

/* SELECT helper to grab joined fields used by the list/export views. */
const ASSIGNMENT_SELECT = `
  vs.*,
  s.app_no, s.name AS student_name, s.program, s.department, s.section, s.profile, s.category,
  a.staff_id AS verified_by_staff_id
`;
const ASSIGNMENT_JOINS = `
  LEFT JOIN students s ON s.id = vs.student_id
  LEFT JOIN admins   a ON a.id = vs.verified_by
`;

/* ============================================================================
   GENERATE — build the empty 4×15×32 schedule (idempotent).
   ============================================================================ */
router.post("/generate", requireSupervisor, async (req, res, next) => {
  try {
    const b = req.body || {};
    const dates = Array.isArray(b.dates) && b.dates.length ? b.dates.filter(isDate) : DEFAULT_DATES;
    const rooms = Array.isArray(b.rooms) && b.rooms.length ? b.rooms : DEFAULT_ROOMS;
    const startMinutes = Number.isFinite(b.startMinutes) ? Number(b.startMinutes) : DEFAULT_START_MINUTES;
    const slotMinutes = Number.isFinite(b.slotMinutes) ? Number(b.slotMinutes) : DEFAULT_SLOT_MINUTES;
    const slotsPerRoom = Number.isFinite(b.slotsPerRoom) ? Number(b.slotsPerRoom) : DEFAULT_SLOTS_PER_ROOM;
    if (!dates.length) return res.status(400).json({ error: "At least one valid date is required." });
    if (slotMinutes < 1 || slotMinutes > 240) return res.status(400).json({ error: "Slot duration must be 1–240 minutes." });
    if (slotsPerRoom < 1 || slotsPerRoom > 500) return res.status(400).json({ error: "Slots per room must be 1–500." });

    let inserted = 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const date of dates) {
        for (const room of rooms) {
          for (let n = 1; n <= slotsPerRoom; n++) {
            const st = startMinutes + (n - 1) * slotMinutes;
            const et = st + slotMinutes;
            const r = await client.query(
              `INSERT INTO verify_schedule (schedule_date, room, slot_no, start_time, end_time, status)
               VALUES ($1,$2,$3,$4,$5,'open')
               ON CONFLICT (schedule_date, room, slot_no) DO NOTHING
               RETURNING id`,
              [date, room, n, minsToLabel(st), minsToLabel(et)]
            );
            inserted += r.rowCount;
          }
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    await audit(req, "admin", req.admin.staffId, "VERIFY_SCHEDULE_GENERATED",
      `dates=${dates.length} rooms=${rooms.length} slots/room=${slotsPerRoom} inserted=${inserted}`);
    res.json({
      ok: true, inserted,
      capacity: dates.length * rooms.length * slotsPerRoom,
      dates, rooms, slotMinutes, slotsPerRoom,
    });
  } catch (e) { next(e); }
});

/* ============================================================================
   v14 ALLOCATE — batch FCFS allocation respecting assigned_verification_date.
   Order: students with upload_completed_at NOT NULL come first, ordered by
   that timestamp ascending. Students without a completion timestamp are
   considered after, ordered by app_no. Each student is allocated to the
   earliest open slot ON THEIR ASSIGNED VERIFICATION DATE ONLY.
   ============================================================================ */
router.post("/allocate", requireSupervisor, async (req, res, next) => {
  try {
    const studentRows = await pool.query(
      `SELECT s.id, s.assigned_verification_date
         FROM students s
         WHERE s.assigned_verification_date IS NOT NULL
           AND s.verify_schedule_id IS NULL
         ORDER BY s.upload_completed_at NULLS LAST, s.app_no`
    );
    const students = studentRows.rows;

    let assigned = 0;
    const noSlot = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const stu of students) {
        const lockR = await client.query(
          "SELECT id, verify_schedule_id FROM students WHERE id=$1 FOR UPDATE",
          [stu.id]
        );
        const locked = lockR.rows[0];
        if (!locked || locked.verify_schedule_id) continue;
        const slotR = await client.query(
          `SELECT id FROM verify_schedule
            WHERE schedule_date=$1 AND status='open' AND student_id IS NULL
            ORDER BY slot_no ASC, room ASC
            LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [stu.assigned_verification_date]
        );
        if (!slotR.rows.length) { noSlot.push(stu.id); continue; }
        const slotId = slotR.rows[0].id;
        await client.query(
          `UPDATE verify_schedule SET student_id=$1, status='booked', updated_at=now() WHERE id=$2`,
          [stu.id, slotId]
        );
        await client.query(
          `UPDATE students SET verify_schedule_id=$1 WHERE id=$2`,
          [slotId, stu.id]
        );
        assigned++;
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    await audit(req, "admin", req.admin.staffId, "VERIFY_ALLOCATED",
      `assigned=${assigned} noSlot=${noSlot.length} skipped=${students.length - assigned - noSlot.length}`);
    res.json({ ok: true, assigned, noSlot: noSlot.length, totalConsidered: students.length });
  } catch (e) { next(e); }
});

/* ============================================================================
   STATS — overall + per-day + per-room.
   ============================================================================ */
router.get("/stats", async (_req, res, next) => {
  try {
    const overallRow = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='booked')      AS booked,
        COUNT(*) FILTER (WHERE status='pending')     AS pending,
        COUNT(*) FILTER (WHERE status='verified')    AS verified,
        COUNT(*) FILTER (WHERE status='absent')      AS absent,
        COUNT(*) FILTER (WHERE status='reassigned')  AS reassigned,
        COUNT(*) FILTER (WHERE status='open')        AS open_slots,
        COUNT(*) FILTER (WHERE student_id IS NOT NULL AND status<>'reassigned') AS scheduled
      FROM verify_schedule`);
    const o = overallRow.rows[0];

    const byDateRows = await pool.query(`
      SELECT schedule_date,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status='booked')     AS booked,
             COUNT(*) FILTER (WHERE status='pending')    AS pending,
             COUNT(*) FILTER (WHERE status='verified')   AS verified,
             COUNT(*) FILTER (WHERE status='absent')     AS absent,
             COUNT(*) FILTER (WHERE status='reassigned') AS reassigned,
             COUNT(*) FILTER (WHERE status='open')       AS open_slots,
             COUNT(*) FILTER (WHERE student_id IS NOT NULL AND status<>'reassigned') AS scheduled
        FROM verify_schedule
       GROUP BY schedule_date
       ORDER BY schedule_date`);

    const byRoomDateRows = await pool.query(`
      SELECT schedule_date, room,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status='verified') AS verified,
             COUNT(*) FILTER (WHERE status='booked')   AS booked,
             COUNT(*) FILTER (WHERE status='pending')  AS pending,
             COUNT(*) FILTER (WHERE status='absent')   AS absent,
             COUNT(*) FILTER (WHERE student_id IS NOT NULL AND status<>'reassigned') AS scheduled
        FROM verify_schedule
       GROUP BY schedule_date, room
       ORDER BY schedule_date, room`);

    const roomTotals = await pool.query(`
      SELECT room,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status='verified') AS verified,
             COUNT(*) FILTER (WHERE student_id IS NOT NULL AND status<>'reassigned') AS scheduled
        FROM verify_schedule
       GROUP BY room
       ORDER BY room`);

    const pct = (num, den) => den > 0 ? Math.round((num / den) * 100) : 0;

    const byDate = byDateRows.rows.map((r) => ({
      date: r.schedule_date,
      total: Number(r.total),
      scheduled: Number(r.scheduled),
      booked: Number(r.booked),
      pending: Number(r.pending),
      verified: Number(r.verified),
      absent: Number(r.absent),
      reassigned: Number(r.reassigned),
      openSlots: Number(r.open_slots),
      completionPct: pct(Number(r.verified), Number(r.scheduled)),
    }));

    const byDateRoom = {};
    byRoomDateRows.rows.forEach((r) => {
      const d = String(r.schedule_date);
      (byDateRoom[d] = byDateRoom[d] || []).push({
        room: r.room,
        total: Number(r.total),
        scheduled: Number(r.scheduled),
        verified: Number(r.verified),
        booked: Number(r.booked),
        pending: Number(r.pending),
        absent: Number(r.absent),
        completionPct: pct(Number(r.verified), Number(r.scheduled)),
      });
    });

    res.json({
      overall: {
        total: Number(o.total),
        scheduled: Number(o.scheduled),
        booked: Number(o.booked),
        pending: Number(o.pending),
        verified: Number(o.verified),
        absent: Number(o.absent),
        reassigned: Number(o.reassigned),
        openSlots: Number(o.open_slots),
        completionPct: pct(Number(o.verified), Number(o.scheduled)),
      },
      byDate,
      byDateRoom,
      byRoomTotal: roomTotals.rows.map((r) => ({
        room: r.room,
        total: Number(r.total),
        scheduled: Number(r.scheduled),
        verified: Number(r.verified),
        completionPct: pct(Number(r.verified), Number(r.scheduled)),
      })),
    });
  } catch (e) { next(e); }
});

/* ============================================================================
   LIST — students with filters.
   Query: date, room, status, q (app_no/name substring), limit, offset
   ============================================================================ */
router.get("/students", async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const push = (sql, val) => { params.push(val); where.push(sql + "$" + params.length); };

    if (req.query.date && isDate(req.query.date))           push("vs.schedule_date=", req.query.date);
    if (req.query.dateFrom && isDate(req.query.dateFrom))   push("vs.schedule_date>=", req.query.dateFrom);
    if (req.query.dateTo && isDate(req.query.dateTo))       push("vs.schedule_date<=", req.query.dateTo);
    if (req.query.room)                                     push("vs.room=", String(req.query.room));
    if (req.query.status && STATUSES.includes(req.query.status))
                                                            push("vs.status=", req.query.status);
    const q = String(req.query.q || "").trim();
    if (q) {
      params.push("%" + q.toLowerCase() + "%");
      where.push(`(LOWER(s.app_no) LIKE $${params.length} OR LOWER(s.name) LIKE $${params.length})`);
    }
    /* Hide pure-open rows by default unless explicitly asked for. */
    if (!req.query.includeOpen) where.push(`vs.status <> 'open'`);

    const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 2000);
    const off = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sqlWhere = where.length ? "WHERE " + where.join(" AND ") : "";
    const rows = await pool.query(
      `SELECT ${ASSIGNMENT_SELECT}
         FROM verify_schedule vs ${ASSIGNMENT_JOINS}
         ${sqlWhere}
         ORDER BY vs.schedule_date, vs.room, vs.slot_no
         LIMIT ${lim} OFFSET ${off}`,
      params
    );
    const countR = await pool.query(
      `SELECT COUNT(*) AS n FROM verify_schedule vs ${ASSIGNMENT_JOINS} ${sqlWhere}`,
      params
    );

    res.json({
      total: Number(countR.rows[0].n),
      limit: lim, offset: off,
      rows: rows.rows.map(serializeAssignment),
    });
  } catch (e) { next(e); }
});

/* ============================================================================
   EXPORT — CSV with the same filters as /students (no pagination).
   ============================================================================ */
router.get("/export.csv", async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const push = (sql, val) => { params.push(val); where.push(sql + "$" + params.length); };

    if (req.query.date && isDate(req.query.date))           push("vs.schedule_date=", req.query.date);
    if (req.query.dateFrom && isDate(req.query.dateFrom))   push("vs.schedule_date>=", req.query.dateFrom);
    if (req.query.dateTo && isDate(req.query.dateTo))       push("vs.schedule_date<=", req.query.dateTo);
    if (req.query.room)                                     push("vs.room=", String(req.query.room));
    if (req.query.status && STATUSES.includes(req.query.status))
                                                            push("vs.status=", req.query.status);
    const q = String(req.query.q || "").trim();
    if (q) {
      params.push("%" + q.toLowerCase() + "%");
      where.push(`(LOWER(s.app_no) LIKE $${params.length} OR LOWER(s.name) LIKE $${params.length})`);
    }
    if (!req.query.includeOpen) where.push(`vs.status <> 'open'`);
    const sqlWhere = where.length ? "WHERE " + where.join(" AND ") : "";

    const rows = await pool.query(
      `SELECT ${ASSIGNMENT_SELECT}
         FROM verify_schedule vs ${ASSIGNMENT_JOINS}
         ${sqlWhere}
         ORDER BY vs.schedule_date, vs.room, vs.slot_no`,
      params
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="verify-schedule${req.query.date ? "-" + req.query.date : ""}.csv"`);
    res.write("Slot ID,Date,Room,Slot No,Start,End,App No,Name,Program,Department,Section,Profile,Category,Status,Verified At,Verified By,Remarks\n");
    for (const r of rows.rows) {
      const line = [
        r.id, r.schedule_date, r.room, r.slot_no, r.start_time, r.end_time,
        r.app_no || "", r.student_name || "", r.program || "", r.department || "",
        r.section || "", r.profile || "", r.category || "",
        r.status, r.verified_at ? new Date(r.verified_at).toISOString() : "",
        r.verified_by_staff_id || "", r.remarks || "",
      ].map(csvEscape).join(",");
      res.write(line + "\n");
    }
    await audit(req, "admin", req.admin.staffId, "VERIFY_EXPORT", `rows=${rows.rows.length}`);
    res.end();
  } catch (e) { next(e); }
});

/* ============================================================================
   PATCH — status / remarks for a single assignment row.
   ============================================================================ */
router.patch("/assignment/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const sr = await pool.query("SELECT * FROM verify_schedule WHERE id=$1", [id]);
    const row = sr.rows[0];
    if (!row) return res.status(404).json({ error: "Slot not found." });

    const sets = [];
    const params = [];
    const push = (sql, val) => { params.push(val); sets.push(sql + "$" + params.length); };

    if (b.status != null) {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: "Invalid status." });
      if ((b.status === "booked" || b.status === "pending" || b.status === "verified" || b.status === "absent") && !row.student_id) {
        /* v27 — auto-heal: a student might point at this slot via verify_schedule_id
           from a pre-v26 reassign where students.verify_schedule_id wasn't updated.
           Re-attach them here before applying the status. */
        const sr2 = await pool.query("SELECT id FROM students WHERE verify_schedule_id=$1 LIMIT 1", [id]);
        if (sr2.rows.length > 0) {
          await pool.query("UPDATE verify_schedule SET student_id=$1 WHERE id=$2", [sr2.rows[0].id, id]);
          row.student_id = sr2.rows[0].id;
        } else {
          return res.status(400).json({ error: "No student is assigned to this slot." });
        }
      }
      push("status=", b.status);
      if (b.status === "verified") {
        sets.push("verified_at=now()");
        push("verified_by=", req.admin.id);
      } else if (b.status === "open") {
        sets.push("student_id=NULL"); sets.push("verified_at=NULL"); sets.push("verified_by=NULL");
      } else if (b.status === "absent" || b.status === "reassigned" || b.status === "pending" || b.status === "booked") {
        if (b.status !== "verified") { sets.push("verified_at=NULL"); sets.push("verified_by=NULL"); }
      }
    }
    if (b.remarks !== undefined) push("remarks=", b.remarks ? String(b.remarks) : null);

    if (!sets.length) return res.status(400).json({ error: "Nothing to update." });
    sets.push("updated_at=now()");
    params.push(id);

    await pool.query(
      `UPDATE verify_schedule SET ${sets.join(", ")} WHERE id=$${params.length}`,
      params
    );

    if (b.status === "open") {
      if (row.student_id) {
        await pool.query(
          `UPDATE students SET verify_schedule_id = NULL,
                               physical_reporting_completed = false,
                               physical_reporting_at = NULL
            WHERE id = $1 OR verify_schedule_id = $2`,
          [row.student_id, id]
        );
      } else {
        await pool.query(
          "UPDATE students SET verify_schedule_id = NULL WHERE verify_schedule_id = $1",
          [id]
        );
      }
    }

    /* v26 — keep students.physical_reporting_* in sync with verify_schedule.status. */
    if (b.status === "verified" && row.student_id) {
      await pool.query(
        `UPDATE students SET physical_reporting_completed=true,
                             physical_reporting_at=now()
          WHERE id=$1`,
        [row.student_id]
      );
    } else if ((b.status === "booked" || b.status === "pending" || b.status === "absent") && row.student_id) {
      await pool.query(
        `UPDATE students SET physical_reporting_completed=false,
                             physical_reporting_at=NULL
          WHERE id=$1`,
        [row.student_id]
      );
    }

    const fresh = await pool.query(
      `SELECT ${ASSIGNMENT_SELECT} FROM verify_schedule vs ${ASSIGNMENT_JOINS} WHERE vs.id=$1`,
      [id]
    );
    await audit(req, "admin", req.admin.staffId, "VERIFY_PATCH",
      `slot#${id} ${b.status ? "status=" + b.status : ""} ${b.remarks !== undefined ? "remarks-updated" : ""}`);
    res.json({ row: serializeAssignment(fresh.rows[0]) });
  } catch (e) { next(e); }
});

/* ============================================================================
   REASSIGN — move student from this slot to an open slot.
   Body: { targetId } OR { date, room, slotNo }
   ============================================================================ */
router.post("/assignment/:id/reassign", requireSupervisor, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    await client.query("BEGIN");

    const sr = await client.query("SELECT * FROM verify_schedule WHERE id=$1 FOR UPDATE", [id]);
    const row = sr.rows[0];
    if (!row) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Source slot not found." }); }
    if (!row.student_id) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Source slot has no student to reassign." }); }

    let target;
    if (b.targetId) {
      const tr = await client.query("SELECT * FROM verify_schedule WHERE id=$1 FOR UPDATE", [parseInt(b.targetId, 10)]);
      target = tr.rows[0];
    } else if (isDate(b.date) && b.room && Number.isFinite(Number(b.slotNo))) {
      const tr = await client.query(
        "SELECT * FROM verify_schedule WHERE schedule_date=$1 AND room=$2 AND slot_no=$3 FOR UPDATE",
        [b.date, String(b.room), Number(b.slotNo)]
      );
      target = tr.rows[0];
    } else {
      /* Pick the first open slot. */
      const tr = await client.query(
        `SELECT * FROM verify_schedule WHERE status='open' AND student_id IS NULL
          ORDER BY schedule_date, room, slot_no LIMIT 1 FOR UPDATE`
      );
      target = tr.rows[0];
    }

    if (!target) { await client.query("ROLLBACK"); return res.status(404).json({ error: "No suitable target slot found." }); }
    if (target.id === row.id) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Source and target are the same." }); }
    if (target.student_id) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Target slot is already occupied." }); }

    await client.query(
      `UPDATE verify_schedule
          SET student_id=$1, status='booked', verified_at=NULL, verified_by=NULL,
              remarks=CASE WHEN $3::text IS NULL THEN remarks ELSE $3 END,
              updated_at=now()
        WHERE id=$2`,
      [row.student_id, target.id, b.remarks ? String(b.remarks) : null]
    );
    await client.query(
      `UPDATE verify_schedule
          SET student_id=NULL, status='reassigned', verified_at=NULL, verified_by=NULL,
              remarks=COALESCE(remarks,'') || (CASE WHEN remarks IS NULL OR remarks='' THEN '' ELSE ' | ' END)
                    || 'Reassigned to slot#' || $2::text,
              updated_at=now()
        WHERE id=$1`,
      [row.id, target.id]
    );
    /* v26 — re-point the student record to the NEW slot so the student
       dashboard immediately reflects the new room/time. */
    await client.query(
      `UPDATE students SET verify_schedule_id=$1,
                           physical_reporting_completed=false,
                           physical_reporting_at=NULL
        WHERE id=$2`,
      [target.id, row.student_id]
    );
    await client.query("COMMIT");

    const freshSrc = await pool.query(
      `SELECT ${ASSIGNMENT_SELECT} FROM verify_schedule vs ${ASSIGNMENT_JOINS} WHERE vs.id=$1`, [row.id]);
    const freshTgt = await pool.query(
      `SELECT ${ASSIGNMENT_SELECT} FROM verify_schedule vs ${ASSIGNMENT_JOINS} WHERE vs.id=$1`, [target.id]);
    await audit(req, "admin", req.admin.staffId, "VERIFY_REASSIGN",
      `slot#${row.id} → slot#${target.id} (student_id=${row.student_id})`);
    res.json({ source: serializeAssignment(freshSrc.rows[0]), target: serializeAssignment(freshTgt.rows[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

/* ============================================================================
   RESET — delete all schedule rows. Supervisor only, must pass confirm:"YES".
   ============================================================================ */
router.post("/reset", requireSupervisor, async (req, res, next) => {
  try {
    if (req.body?.confirm !== "YES") {
      return res.status(400).json({ error: "Pass {\"confirm\":\"YES\"} to wipe the verification schedule." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("DELETE FROM verify_schedule RETURNING id");
      await client.query("UPDATE students SET verify_schedule_id = NULL WHERE verify_schedule_id IS NOT NULL");
      await client.query("COMMIT");
      await audit(req, "admin", req.admin.staffId, "VERIFY_RESET", `deleted=${r.rowCount}`);
      res.json({ ok: true, deleted: r.rowCount });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

/* ============================================================================
   ROOMS / DATES META — used by the frontend for dropdowns.
   ============================================================================ */
router.get("/meta", async (_req, res, next) => {
  try {
    const d = await pool.query("SELECT DISTINCT schedule_date FROM verify_schedule ORDER BY schedule_date");
    const r = await pool.query("SELECT DISTINCT room FROM verify_schedule ORDER BY room");
    res.json({
      dates: d.rows.map((x) => x.schedule_date),
      rooms: r.rows.map((x) => x.room),
      statuses: STATUSES,
      defaultDates: DEFAULT_DATES,
      defaultRooms: DEFAULT_ROOMS,
      slotMinutes: DEFAULT_SLOT_MINUTES,
      slotsPerRoom: DEFAULT_SLOTS_PER_ROOM,
      startMinutes: DEFAULT_START_MINUTES,
    });
  } catch (e) { next(e); }
});


/* ============================================================================
   v14 SEED DUMMY STUDENTS — supervisor only.
   Creates exactly 1,920 students with FIXED date/batch mapping:
       APP0001..APP0480  -> 20 July 2026  (batch 1)
       APP0481..APP0960  -> 21 July 2026  (batch 2)
       APP0961..APP1440  -> 22 July 2026  (batch 3)
       APP1441..APP1920  -> 23 July 2026  (batch 4)
   Body: { perDay?: 480, dates?: ["YYYY-MM-DD", ...], profile?: "UG-Indian" }
   Idempotent: ON CONFLICT(app_no) DO NOTHING.
   ============================================================================ */
router.post("/seed-students", requireSupervisor, async (req, res, next) => {
  try {
    const { CHECKLISTS, checklistFor } = require("../config/checklists");
    const b = req.body || {};
    const perDay = Math.min(Math.max(parseInt(b.perDay, 10) || 480, 1), 2000);
    const dates = Array.isArray(b.dates) && b.dates.length
      ? b.dates.filter(isDate)
      : DEFAULT_DATES;
    const profile = b.profile && CHECKLISTS[b.profile] ? b.profile : "UG-Indian";
    if (!dates.length) return res.status(400).json({ error: "Provide at least one valid date." });

    const FIRST = ["Aarav","Vihaan","Aditya","Vivaan","Arjun","Sai","Reyansh","Ayaan","Krishna","Ishaan","Atharv","Rudra","Kabir","Aryan","Veer","Yash","Dhruv","Kartik","Rohan","Ansh","Saanvi","Aanya","Aadhya","Aaradhya","Anaya","Pari","Ananya","Diya","Anvi","Myra","Riya","Ira","Tara","Nisha","Sneha","Priya","Maya","Kiara","Avni","Pihu"];
    const LAST  = ["Sharma","Verma","Gupta","Singh","Kumar","Iyer","Patel","Rao","Reddy","Mehta","Joshi","Pillai","Nair","Kapoor","Bose","Chatterjee","Mukherjee","Roy","Bhat","Kulkarni","Naidu","Choudhary","Sinha","Mishra","Tiwari"];
    const CATS  = ["General","NRI","NRI Sponsored","Foreign","OCI","AICTE"];

    let inserted = 0;
    const BATCH = 50;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let di = 0; di < dates.length; di++) {
        const date = dates[di];
        const batchNo = di + 1;
        for (let i = 0; i < perDay; i += BATCH) {
          const upper = Math.min(i + BATCH, perDay);
          const rows = [];
          const params = [];
          for (let n = i; n < upper; n++) {
            const globalN = di * perDay + n + 1;
            const appNo  = "APP" + String(globalN).padStart(4, "0");
            const fn = FIRST[(n + di * 7) % FIRST.length];
            const ln = LAST[(n * 13 + di * 5) % LAST.length];
            const dobYear  = 2005 + ((n + di) % 4);
            const dobMonth = String(((n + 1) % 12) + 1).padStart(2, "0");
            const dobDay   = String(((n + 1) % 28) + 1).padStart(2, "0");
            const dob   = `${dobYear}-${dobMonth}-${dobDay}`;
            const cat   = CATS[n % CATS.length];
            const program = "B.E. Computer Science";
            const dept    = "Computer Science";
            const section = String.fromCharCode(65 + (n % 4));
            const idx = rows.length * 12;
            params.push(
              appNo, `${fn} ${ln}`, dob, program, dept, "2026",
              cat, section, profile, date,
              date, batchNo
            );
            rows.push(
              `($${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},` +
              `$${idx+7},$${idx+8},$${idx+9},$${idx+10},` +
              `$${idx+11},$${idx+12})`
            );
          }
          const sql = `INSERT INTO students
              (app_no, name, dob, program, department, batch, category, section,
               profile, orientation_date,
               assigned_verification_date, assigned_batch)
            VALUES ${rows.join(",")}
            ON CONFLICT (app_no) DO NOTHING
            RETURNING id, profile`;
          const r = await client.query(sql, params);
          for (const row of r.rows) {
            for (const code of checklistFor(row.profile)) {
              await client.query(
                `INSERT INTO documents (student_id, doc_code) VALUES ($1,$2)
                 ON CONFLICT (student_id, doc_code) DO NOTHING`,
                [row.id, code]
              );
            }
          }
          inserted += r.rowCount;
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    await audit(req, "admin", req.admin.staffId, "VERIFY_SEED_STUDENTS",
      `inserted=${inserted} dates=${dates.length} perDay=${perDay} profile=${profile}`);
    res.json({
      ok: true, inserted,
      perDay, dates, profile,
      total: perDay * dates.length,
      sample: "APP0001..APP" + String(perDay * dates.length).padStart(4, "0"),
      mapping: dates.map((d, i) => ({
        date: d, batch: i + 1,
        appNoFrom: "APP" + String(i * perDay + 1).padStart(4, "0"),
        appNoTo:   "APP" + String((i + 1) * perDay).padStart(4, "0"),
      })),
      note: inserted === 0
        ? "All dummy students already exist."
        : "Seed succeeded. Each student now has a fixed assigned_verification_date.",
    });
  } catch (e) { next(e); }
});


/* v15 — Backfill assigned_verification_date for any student missing one.
   Round-robin assigns NULL-date students across the default 4 days.
   Idempotent. */
router.post("/backfill-dates", requireSupervisor, async (req, res, next) => {
  try {
    const dates = Array.isArray(req.body?.dates) && req.body.dates.length
      ? req.body.dates.filter(isDate)
      : DEFAULT_DATES;
    if (!dates.length) return res.status(400).json({ error: "Provide at least one valid date." });
    const r = await pool.query(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY app_no) AS rn
           FROM students
          WHERE assigned_verification_date IS NULL
       )
       UPDATE students s
          SET assigned_verification_date = ($2::date[])[((ranked.rn - 1) % $1) + 1],
              assigned_batch             = ((ranked.rn - 1) % $1) + 1
         FROM ranked
        WHERE s.id = ranked.id
        RETURNING s.id`,
      [dates.length, dates]
    );
    await audit(req, "admin", req.admin.staffId, "VERIFY_BACKFILL_DATES",
      `updated=${r.rowCount} dates=${dates.length}`);
    res.json({ ok: true, updated: r.rowCount, dates });
  } catch (e) { next(e); }
});


/* ============================================================================
   v16 RESET & RESEED — supervisor only, destructive.
   Body MUST include { "confirm": "RESET" }.
   Sequence in a single transaction:
     1. DELETE FROM verify_schedule
     2. DELETE FROM flagged_cases
     3. DELETE FROM documents
     4. DELETE FROM students
     5. INSERT 1,920 empty verify_schedule slots (4 days × 15 rooms × 32)
     6. INSERT 1,920 students APP0001..APP1920 with fixed date/batch mapping
     7. INSERT their checklist documents (status='pending')
   Returns deleted + inserted counts.
   ============================================================================ */
router.post("/reset-and-reseed", requireSupervisor, async (req, res, next) => {
  if (req.body?.confirm !== "RESET") {
    return res.status(400).json({
      error: "Pass {\"confirm\":\"RESET\"} to wipe the existing students/documents/schedule and reseed 1,920 fresh records.",
    });
  }
  /* v32 — defence in depth: require a typed verification phrase in addition
     to the confirm token, so a copy-pasted curl one-liner can't accidentally
     wipe production. The exact phrase is also shown in the UI modal. */
  if (req.body?.phrase !== "DELETE 1920 STUDENTS") {
    return res.status(400).json({
      error: "Missing or wrong verification phrase. Send {\"confirm\":\"RESET\",\"phrase\":\"DELETE 1920 STUDENTS\"}.",
    });
  }
  const { CHECKLISTS, checklistFor } = require("../config/checklists");
  const profile = (req.body && CHECKLISTS[req.body.profile]) ? req.body.profile : "UG-Indian";
  const PER_DAY = 480;
  const DATES = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"];
  const ROOMS = Array.from({ length: 15 }, (_, i) => "AB4-" + String(101 + i));
  const SLOTS_PER_ROOM = 32;
  const START_MIN = 13 * 60;        // 1:00 PM
  const SLOT_MIN  = 10;

  const FIRST = ["Aarav","Vihaan","Aditya","Vivaan","Arjun","Sai","Reyansh","Ayaan","Krishna","Ishaan","Atharv","Rudra","Kabir","Aryan","Veer","Yash","Dhruv","Kartik","Rohan","Ansh","Saanvi","Aanya","Aadhya","Aaradhya","Anaya","Pari","Ananya","Diya","Anvi","Myra","Riya","Ira","Tara","Nisha","Sneha","Priya","Maya","Kiara","Avni","Pihu"];
  const LAST  = ["Sharma","Verma","Gupta","Singh","Kumar","Iyer","Patel","Rao","Reddy","Mehta","Joshi","Pillai","Nair","Kapoor","Bose","Chatterjee","Mukherjee","Roy","Bhat","Kulkarni","Naidu","Choudhary","Sinha","Mishra","Tiwari"];
  const CATS  = ["General","NRI","NRI Sponsored","Foreign","OCI","AICTE"];

  const client = await pool.connect();
  let wipe = {};
  let slotsCreated = 0;
  let studentsInserted = 0;
  try {
    await client.query("BEGIN");

    /* 1-4: wipe in FK-safe order. */
    const w1 = await client.query("DELETE FROM verify_schedule");
    const w2 = await client.query("DELETE FROM flagged_cases");
    const w3 = await client.query("DELETE FROM documents");
    const w4 = await client.query("DELETE FROM students");
    wipe = {
      verifySchedule: w1.rowCount,
      flaggedCases: w2.rowCount,
      documents: w3.rowCount,
      students: w4.rowCount,
    };

    /* 5: regenerate empty schedule (1,920 slots) using batched VALUES. */
    {
      const BATCH = 100;
      const rows = [];
      const params = [];
      const flush = async () => {
        if (!rows.length) return;
        await client.query(
          `INSERT INTO verify_schedule (schedule_date, room, slot_no, start_time, end_time, status)
           VALUES ${rows.join(",")}`,
          params
        );
        slotsCreated += rows.length;
        rows.length = 0;
        params.length = 0;
      };
      for (const date of DATES) {
        for (const room of ROOMS) {
          for (let n = 1; n <= SLOTS_PER_ROOM; n++) {
            const st = START_MIN + (n - 1) * SLOT_MIN;
            const et = st + SLOT_MIN;
            const idx = rows.length * 6;
            params.push(date, room, n, minsToLabel(st), minsToLabel(et), "open");
            rows.push(`($${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6})`);
            if (rows.length >= BATCH) await flush();
          }
        }
      }
      await flush();
    }

    /* 6-7: 1,920 students + their checklist documents. */
    {
      const BATCH = 50;
      for (let di = 0; di < DATES.length; di++) {
        const date = DATES[di];
        const batchNo = di + 1;
        for (let i = 0; i < PER_DAY; i += BATCH) {
          const upper = Math.min(i + BATCH, PER_DAY);
          const rows = [];
          const params = [];
          for (let n = i; n < upper; n++) {
            const globalN = di * PER_DAY + n + 1;
            const appNo  = "APP" + String(globalN).padStart(4, "0");
            const fn = FIRST[(n + di * 7) % FIRST.length];
            const ln = LAST[(n * 13 + di * 5) % LAST.length];
            const dobYear  = 2005 + ((n + di) % 4);
            const dobMonth = String(((n + 1) % 12) + 1).padStart(2, "0");
            const dobDay   = String(((n + 1) % 28) + 1).padStart(2, "0");
            const dob = `${dobYear}-${dobMonth}-${dobDay}`;
            const cat = CATS[n % CATS.length];
            const section = String.fromCharCode(65 + (n % 4));
            const idx = rows.length * 12;
            params.push(
              appNo, `${fn} ${ln}`, dob, "B.E. Computer Science", "Computer Science", "2026",
              cat, section, profile, date,
              date, batchNo
            );
            rows.push(
              `($${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},` +
              `$${idx+7},$${idx+8},$${idx+9},$${idx+10},` +
              `$${idx+11},$${idx+12})`
            );
          }
          const ins = await client.query(
            `INSERT INTO students
                (app_no, name, dob, program, department, batch, category, section,
                 profile, orientation_date,
                 assigned_verification_date, assigned_batch)
              VALUES ${rows.join(",")}
              RETURNING id, profile`,
            params
          );
          for (const row of ins.rows) {
            for (const code of checklistFor(row.profile)) {
              await client.query(
                `INSERT INTO documents (student_id, doc_code) VALUES ($1,$2)`,
                [row.id, code]
              );
            }
          }
          studentsInserted += ins.rowCount;
        }
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return next(e);
  } finally {
    client.release();
  }

  await audit(req, "admin", req.admin.staffId, "VERIFY_RESET_AND_RESEED",
    `wiped=${JSON.stringify(wipe)} slotsCreated=${slotsCreated} studentsInserted=${studentsInserted}`);

  res.json({
    ok: true,
    deleted: wipe,
    inserted: { students: studentsInserted, slots: slotsCreated },
    profile,
    mapping: DATES.map((d, i) => ({
      date: d, batch: i + 1,
      appNoFrom: "APP" + String(i * PER_DAY + 1).padStart(4, "0"),
      appNoTo:   "APP" + String((i + 1) * PER_DAY).padStart(4, "0"),
      count: PER_DAY,
    })),
    note: "Dataset replaced. Students now appear with PENDING document status. Slots will be allocated dynamically on FCFS basis when each student completes mandatory uploads.",
  });
});

module.exports = router;
