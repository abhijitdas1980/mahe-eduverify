/* Empty orientation-week verification schedule — idempotent grid generation. */
const { pool } = require("../config/db");

const DEFAULT_DATES = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"];
const DEFAULT_ROOMS = Array.from({ length: 15 }, (_, i) => "AB4-" + String(101 + i));
const DEFAULT_START_MINUTES = 13 * 60;
const DEFAULT_SLOT_MINUTES = 10;
const DEFAULT_SLOTS_PER_ROOM = 32;

function minsToLabel(m) {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, "0");
  const ap = h24 < 12 ? "AM" : "PM";
  const h12 = ((h24 % 12) === 0) ? 12 : (h24 % 12);
  return `${h12}:${mm} ${ap}`;
}

async function generateEmptySchedule(client, opts = {}) {
  const dates = opts.dates || DEFAULT_DATES;
  const rooms = opts.rooms || DEFAULT_ROOMS;
  const startMinutes = opts.startMinutes ?? DEFAULT_START_MINUTES;
  const slotMinutes = opts.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  const slotsPerRoom = opts.slotsPerRoom ?? DEFAULT_SLOTS_PER_ROOM;

  let inserted = 0;
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
  return {
    inserted,
    capacity: dates.length * rooms.length * slotsPerRoom,
    dates,
    rooms,
    slotMinutes,
    slotsPerRoom,
  };
}

/** Remove legacy demo/seed student rows — bulk upload is the only intake. */
async function purgeLegacyDemoStudents(client) {
  const legacyDemo = [
    "CSE2026001", "CSE2026002", "ECE2026003", "MEC2026004", "CSE2026005",
    "CSE2026006", "CSE2026007", "MCA2026008", "MBA2026009", "MTC2026010",
  ];
  const r1 = await client.query(
    "DELETE FROM students WHERE app_no = ANY($1::text[]) RETURNING app_no",
    [legacyDemo]
  );
  const r2 = await client.query(
    `DELETE FROM students
      WHERE app_no ~ '^APP[0-9]{4}$'
        AND CAST(SUBSTRING(app_no FROM 4) AS INT) BETWEEN 1 AND 1920
      RETURNING app_no`
  );
  return { demoRemoved: r1.rowCount, seedRemoved: r2.rowCount };
}

/** Remove prefilled reporting-slot grid from early demos. */
async function purgeLegacyReportingSlots(client) {
  const r = await client.query(
    `DELETE FROM slots
      WHERE slot_date IN ('2026-06-05','2026-06-06','2026-06-07','2026-06-08','2026-06-09')
        AND booked = 0
      RETURNING id`
  );
  return r.rowCount;
}

module.exports = {
  DEFAULT_DATES,
  DEFAULT_ROOMS,
  DEFAULT_START_MINUTES,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_SLOTS_PER_ROOM,
  minsToLabel,
  generateEmptySchedule,
  purgeLegacyDemoStudents,
  purgeLegacyReportingSlots,
};
