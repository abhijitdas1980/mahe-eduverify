/* Seed system email templates for Communication Center. */
const { pool } = require("../../config/db");

const SYSTEM_TEMPLATES = [
  {
    slug: "orientation-invitation",
    name: "Orientation Invitation",
    category: "orientation",
    subject: "Welcome to MIT Bengaluru — Orientation details (App {{ApplicationNo}})",
    body_html: `<p>Welcome to <b>MIT Bengaluru</b>, {{StudentName}}.</p>
<p>We are delighted to confirm your admission to <b>{{Program}}</b>.</p>
{{ScheduleBlock}}
<p>Please complete document upload on EduVerify before your verification slot: <a href="{{PortalUrl}}">{{PortalUrl}}</a></p>
<p>We look forward to welcoming you on campus.</p>`,
    audience: "both",
  },
  {
    slug: "verification-reminder",
    name: "Document Verification Reminder",
    category: "verification",
    subject: "Reminder — Document verification on {{VerificationDate}} (App {{ApplicationNo}})",
    body_html: `<p>This is a reminder about your upcoming document verification.</p>
{{ScheduleBlock}}
<p>Ensure all mandatory documents are uploaded on <a href="{{PortalUrl}}">EduVerify</a> and bring originals on verification day.</p>`,
    audience: "both",
  },
  {
    slug: "document-rejected",
    name: "Document Rejected",
    category: "documents",
    subject: "Action required — Document rejected (App {{ApplicationNo}})",
    body_html: `<p>One or more of your uploaded documents require correction. Please log in to EduVerify, review the rejection note, and re-upload.</p>
<p>Portal: <a href="{{PortalUrl}}">{{PortalUrl}}</a></p>`,
    audience: "both",
  },
  {
    slug: "document-approved",
    name: "Document Approved",
    category: "documents",
    subject: "Documents verified — App {{ApplicationNo}}",
    body_html: `<p>Your submitted documents have been reviewed and approved by the Admissions Verification Cell.</p>
{{ScheduleBlock}}
<p>See you on campus. Portal: <a href="{{PortalUrl}}">{{PortalUrl}}</a></p>`,
    audience: "both",
  },
  {
    slug: "welcome-mit",
    name: "Welcome to MIT",
    category: "orientation",
    subject: "Welcome to MIT Bengaluru, {{StudentName}}!",
    body_html: `<p>Welcome to the MIT Bengaluru family!</p>
<p>Programme: <b>{{Program}}</b> · Department: <b>{{Department}}</b></p>
<p>Your orientation is scheduled for <b>{{OrientationDate}}</b>.</p>
<p>Access EduVerify: <a href="{{PortalUrl}}">{{PortalUrl}}</a></p>`,
    audience: "student",
  },
  {
    slug: "reporting-tomorrow",
    name: "Reporting Tomorrow",
    category: "reporting",
    subject: "Reporting tomorrow — {{ReportingDate}} (App {{ApplicationNo}})",
    body_html: `<p>This is a reminder that your reporting is scheduled for <b>tomorrow</b>.</p>
<p><b>Reporting Date:</b> {{ReportingDate}}<br><b>Reporting Time:</b> {{ReportingTime}}<br><b>Venue:</b> {{Venue}}</p>
{{ScheduleBlock}}`,
    audience: "both",
  },
  {
    slug: "orientation-schedule",
    name: "Orientation Schedule",
    category: "orientation",
    subject: "Your orientation schedule — App {{ApplicationNo}}",
    body_html: `<p>Please find your orientation and verification schedule below.</p>
{{ScheduleBlock}}
<p>Batch: {{OrientationBatch}}</p>`,
    audience: "both",
  },
  {
    slug: "thank-you",
    name: "Thank You",
    category: "general",
    subject: "Thank you — MIT Bengaluru Admissions",
    body_html: `<p>Thank you for completing your document verification process with MAHE Admissions.</p>
<p>We wish you a successful academic journey at MIT Bengaluru.</p>`,
    audience: "both",
  },
  {
    slug: "parent-orientation",
    name: "Parent — Orientation Notice",
    category: "parent",
    subject: "Orientation schedule for your ward {{StudentName}} (App {{ApplicationNo}})",
    body_html: `<p>{{WardLine}}</p>
<p><b>Orientation Date:</b> {{OrientationDate}}<br><b>Reporting Time:</b> {{ReportingTime}}<br><b>Venue:</b> {{Venue}}</p>
<p><b>Document Verification:</b> {{VerificationDate}} · {{VerificationSlot}} · Room {{VerificationRoom}}</p>`,
    audience: "parent",
  },
];

async function seedCommunicationTemplates() {
  for (const t of SYSTEM_TEMPLATES) {
    await pool.query(
      `INSERT INTO comm_templates (name, slug, category, subject, body_html, audience, is_system)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         subject = EXCLUDED.subject,
         body_html = EXCLUDED.body_html,
         audience = EXCLUDED.audience,
         updated_at = now()`,
      [t.name, t.slug, t.category, t.subject, t.body_html, t.audience]
    );
  }
}

module.exports = { seedCommunicationTemplates, SYSTEM_TEMPLATES };
