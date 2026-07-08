/* Recognised school boards and higher-education institutions for document upload dropdowns. */

const INSTITUTION_OTHER_VALUE = "__OTHER__";

const INSTITUTION_GROUPS = [
  {
    label: "National boards",
    options: [
      "Central Board of Secondary Education (CBSE)",
      "Council for the Indian School Certificate Examinations (CISCE / ICSE)",
      "National Institute of Open Schooling (NIOS)",
    ],
  },
  {
    label: "Karnataka",
    options: [
      "Karnataka School Examination and Assessment Board (KSEAB / SSLC)",
      "Department of Pre-University Education, Karnataka (PU Board)",
      "Karnataka Secondary Education Examination Board (KSEEB)",
    ],
  },
  {
    label: "Other state school boards",
    options: [
      "Andhra Pradesh Board of Secondary Education",
      "Assam Higher Secondary Education Council (AHSEC)",
      "Bihar School Examination Board (BSEB)",
      "Board of Higher Secondary Education, Kerala",
      "Board of Secondary Education, Rajasthan (RBSE)",
      "Chhattisgarh Board of Secondary Education (CGBSE)",
      "Goa Board of Secondary and Higher Secondary Education",
      "Gujarat Secondary and Higher Secondary Education Board (GSEB)",
      "Haryana Board of School Education (HBSE)",
      "Himachal Pradesh Board of School Education (HPBOSE)",
      "Jammu and Kashmir Board of School Education (JKBOSE)",
      "Jharkhand Academic Council (JAC)",
      "Madhya Pradesh Board of Secondary Education (MPBSE)",
      "Maharashtra State Board of Secondary and Higher Secondary Education",
      "Manipur Board of Secondary Education",
      "Meghalaya Board of School Education (MBOSE)",
      "Mizoram Board of School Education (MBSE)",
      "Nagaland Board of School Education (NBSE)",
      "Odisha Board of Secondary Education (BSE Odisha)",
      "Punjab School Education Board (PSEB)",
      "Tamil Nadu State Board",
      "Telangana State Board of Intermediate Education",
      "Tripura Board of Secondary Education (TBSE)",
      "Uttar Pradesh Madhyamik Shiksha Parishad (UP Board)",
      "Uttarakhand Board of School Education (UBSE)",
      "West Bengal Board of Secondary Education (WBBSE)",
      "West Bengal Council of Higher Secondary Education (WBCHSE)",
    ],
  },
  {
    label: "Universities & institutions (Karnataka)",
    options: [
      "Bangalore University",
      "Bengaluru City University",
      "Bengaluru North University",
      "Christ University, Bengaluru",
      "Jain University, Bengaluru",
      "Mangalore University",
      "Manipal Academy of Higher Education (MAHE)",
      "MS Ramaiah University of Applied Sciences",
      "National Law School of India University (NLSIU)",
      "PES University, Bengaluru",
      "RV University, Bengaluru",
      "Visvesvaraya Technological University (VTU)",
      "Xavier Institute of Management and Entrepreneurship (XIME)",
    ],
  },
  {
    label: "Universities & institutions (other states)",
    options: [
      "Aligarh Muslim University (AMU)",
      "Amity University",
      "Anna University, Chennai",
      "Banaras Hindu University (BHU)",
      "Birla Institute of Technology and Science (BITS Pilani)",
      "Delhi University (University of Delhi)",
      "Gujarat University",
      "Indian Institute of Technology (IIT)",
      "Jawaharlal Nehru University (JNU)",
      "Mumbai University (University of Mumbai)",
      "Osmania University, Hyderabad",
      "Pune University (Savitribai Phule Pune University)",
      "SRM Institute of Science and Technology",
      "University of Calcutta",
      "University of Madras",
      "University of Mysore",
      "Vellore Institute of Technology (VIT)",
    ],
  },
  {
    label: "International boards & agencies",
    options: [
      "Cambridge Assessment International Education (IGCSE / A Level)",
      "International Baccalaureate (IB)",
      "Pearson Edexcel",
      "Association of Indian Universities (AIU) — Equivalence",
      "British Council / IELTS",
      "ETS — TOEFL",
    ],
  },
];

function allInstitutionOptions() {
  const seen = new Set();
  const out = [];
  for (const g of INSTITUTION_GROUPS) {
    for (const o of g.options) {
      if (!seen.has(o)) {
        seen.add(o);
        out.push(o);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function institutionOptionsPayload() {
  return {
    otherValue: INSTITUTION_OTHER_VALUE,
    groups: INSTITUTION_GROUPS,
    all: allInstitutionOptions(),
  };
}

module.exports = {
  INSTITUTION_OTHER_VALUE,
  INSTITUTION_GROUPS,
  allInstitutionOptions,
  institutionOptionsPayload,
};
