/* Transactional bulk insert for validated student rows. */
const { pool } = require("../config/db");
const { fullDocSetFor } = require("../config/checklists");

const BATCH = 50;

async function bulkInsertStudents(rows) {
  if (!rows.length) return { inserted: 0, appNos: [] };

  const client = await pool.connect();
  let inserted = 0;
  const appNos = [];

  try {
    await client.query("BEGIN");

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = [];
      const params = [];

      chunk.forEach((row, idx) => {
        const base = idx * 13;
        params.push(
          row.application_number,
          row.full_name,
          row.date_of_birth,
          row.gender,
          row.profile,
          row.program,
          row.department,
          row.section,
          row.batch,
          row.category,
          row.orientation_date,
          row.email,
          row.phone
        );
        values.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},` +
          `$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13})`
        );
      });

      const sql = `
        INSERT INTO students
          (app_no, name, dob, gender, profile, program, department, section, batch,
           category, orientation_date, email, phone)
        VALUES ${values.join(",")}
        ON CONFLICT (app_no) DO NOTHING
        RETURNING id, app_no, profile`;

      const r = await client.query(sql, params);

      for (const ins of r.rows) {
        appNos.push(ins.app_no);
        for (const code of fullDocSetFor(ins.profile)) {
          await client.query(
            `INSERT INTO documents (student_id, doc_code) VALUES ($1,$2)
             ON CONFLICT (student_id, doc_code) DO NOTHING`,
            [ins.id, code]
          );
        }
      }
      inserted += r.rowCount;
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  return { inserted, appNos };
}

module.exports = { bulkInsertStudents };
