/* Blacklist matching helpers.
   - normalise(): lowercase, strip punctuation, collapse whitespace
   - matchInstitution(): substring + token-overlap fuzzy match
   The blacklist is read from the DB (table: blacklist_institutions). */

const { pool } = require("../config/db");

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Return the matching blacklist row, or null. */
function matchInstitution(name, blacklist) {
  const norm = normalize(name);
  if (!norm || norm.length < 4) return null;
  const aTokens = new Set(norm.split(" ").filter((w) => w.length >= 4));

  for (const b of blacklist) {
    const bn = b.name_normalized || normalize(b.name);
    if (!bn) continue;
    if (norm === bn) return b;
    if (norm.includes(bn) || bn.includes(norm)) return b;

    // Token-overlap (handles spelling variations + reorderings)
    const bTokens = bn.split(" ").filter((w) => w.length >= 4);
    if (bTokens.length >= 3) {
      let overlap = 0;
      for (const w of bTokens) if (aTokens.has(w)) overlap++;
      const need = Math.max(3, Math.ceil(bTokens.length * 0.6));
      if (overlap >= need) return b;
    }
  }
  return null;
}

/** Load the blacklist from the DB. */
async function loadBlacklist() {
  const r = await pool.query(
    "SELECT id,name,name_normalized,region,reason FROM blacklist_institutions"
  );
  return r.rows;
}

/** Convenience: take a name, fetch the blacklist, return the match (or null). */
async function checkAgainstBlacklist(name) {
  if (!name) return null;
  const bl = await loadBlacklist();
  return matchInstitution(name, bl);
}

/** Initial seed (used by setup). Each entry: [name, region]. */
const SEED_BLACKLIST = [
  ["Board Of School Education Hubli", "Karnataka"],
  ["The All India Council of Open Schooling", "Bihar"],
  ["Delhi State Open Schooling", "Delhi"],
  ["Northwest Accreditation Commission (NWAC)", "USA"],
  ["Christ New Testament Deemed University", "Andhra Pradesh"],
  ["Bible Open University of India", "Andhra Pradesh"],
  ["Indian Institute of Alternative Medicine", "Arunachal Pradesh"],
  ["World Peace of United Nations University (WPUNU)", "Delhi"],
  ["Institute of Management and Engineering", "Delhi"],
  ["All India Institute of Public & Physical Health Sciences (AIIPHS)", "Delhi"],
  ["Commercial University Ltd", "Delhi"],
  ["United Nations University", "Delhi"],
  ["Vocational University", "Delhi"],
  ["ADR-Centric Juridical University", "Delhi"],
  ["Indian Institute of Science and Engineering", "Delhi"],
  ["Viswakarma Open University for Self-Employment", "Delhi"],
  ["Adhyatmik Vishwavidyalaya (Spiritual University)", "Delhi"],
  ["Magic & Art University", "Haryana"],
  ["Sarva Bharatiya Shiksha Peeth", "Karnataka"],
  ["Global Human Peace University", "Karnataka"],
  ["International Islamic University of Prophetic Medicine (IIUPM)", "Kerala"],
  ["St. John's University", "Kerala"],
  ["Raja Arabic University", "Maharashtra"],
  ["National Backward Krushi Vidyapeeth", "Maharashtra"],
  ["National Institute of Management Solution", "New Delhi"],
  ["Mountain Institute of Management & Technology", "New Delhi"],
  ["Usha Latchumanan College of Education", "Puducherry"],
  ["Sree Bodhi Academy of Higher Education", "Puducherry"],
  ["Gandhi Hindi Vidyapith", "Uttar Pradesh"],
  ["Netaji Subhash Chandra Bose University (Open University)", "Uttar Pradesh"],
  ["Bhartiya Shiksha Parishad", "Uttar Pradesh"],
  ["Mahamaya Technical University", "Uttar Pradesh"],
  ["Indian Institute of Alternative Medicine", "West Bengal"],
  ["Institute of Alternative Medicine and Research", "West Bengal"],
];

module.exports = { normalize, matchInstitution, loadBlacklist, checkAgainstBlacklist, SEED_BLACKLIST };
