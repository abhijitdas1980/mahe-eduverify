-- ===========================================================
-- EduVerify - PostgreSQL schema (v7)
-- Safe to run repeatedly: CREATE TABLE IF NOT EXISTS + ALTER ... IF NOT EXISTS.
-- ===========================================================

CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  staff_id      VARCHAR(50)  UNIQUE NOT NULL,
  name          VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'verifier',
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (
  id         SERIAL PRIMARY KEY,
  slot_date  DATE        NOT NULL,
  slot_time  VARCHAR(20) NOT NULL,
  capacity   INT         NOT NULL DEFAULT 20,
  booked     INT         NOT NULL DEFAULT 0,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  status     VARCHAR(20) NOT NULL DEFAULT 'open',
  duration_minutes INT   NOT NULL DEFAULT 30,
  UNIQUE (slot_date, slot_time)
);

CREATE TABLE IF NOT EXISTS students (
  id               SERIAL PRIMARY KEY,
  app_no           VARCHAR(40)  UNIQUE NOT NULL,
  name             VARCHAR(120) NOT NULL,
  dob              DATE         NOT NULL,
  email            VARCHAR(160),
  phone            VARCHAR(20),
  program          VARCHAR(120) NOT NULL,
  department       VARCHAR(80),
  batch            VARCHAR(20),
  category         VARCHAR(20),
  section          VARCHAR(10),
  profile          VARCHAR(40)  NOT NULL,
  orientation_date DATE,
  admission_status VARCHAR(20)  NOT NULL DEFAULT 'Admitted',
  password_hash    VARCHAR(255),
  declared         BOOLEAN      NOT NULL DEFAULT false,
  declared_at      TIMESTAMPTZ,
  slot_id          INT REFERENCES slots(id) ON DELETE SET NULL,
  slot_confirmed   BOOLEAN      NOT NULL DEFAULT false,
  slot_rejected    BOOLEAN      NOT NULL DEFAULT false,
  slot_reject_reason TEXT,
  physical_reporting_completed BOOLEAN NOT NULL DEFAULT false,
  physical_reporting_at        TIMESTAMPTZ,
  pending_docs     TEXT,
  submission_deadline DATE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id                 SERIAL PRIMARY KEY,
  student_id         INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  doc_code           VARCHAR(30)  NOT NULL,
  file_public_id     TEXT,
  file_resource_type VARCHAR(20),
  file_format        VARCHAR(10),
  file_name          VARCHAR(255),
  file_size          INT,
  self_verify        JSONB NOT NULL DEFAULT '{}'::jsonb,
  student_status     VARCHAR(20)  NOT NULL DEFAULT 'none',
  issue_note         TEXT,
  staff_status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
  staff_note         TEXT,
  verified_by        INT REFERENCES admins(id) ON DELETE SET NULL,
  verified_at        TIMESTAMPTZ,
  institution_name   VARCHAR(250),
  flagged            BOOLEAN      NOT NULL DEFAULT false,
  flag_match         VARCHAR(250),
  flag_remarks       TEXT,
  flagged_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (student_id, doc_code)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  actor_type VARCHAR(20),
  actor_id   VARCHAR(60),
  action     VARCHAR(80)  NOT NULL,
  detail     TEXT,
  ip         VARCHAR(60),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blacklist_institutions (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(250) NOT NULL,
  name_normalized VARCHAR(250) UNIQUE NOT NULL,
  region          VARCHAR(100),
  reason          TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by      INT REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS flagged_cases (
  id              SERIAL PRIMARY KEY,
  student_id      INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  document_id     INT REFERENCES documents(id) ON DELETE CASCADE,
  institution     VARCHAR(250),
  matched_name    VARCHAR(250),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v7: simple key/value settings store (e.g. blacklist policy)
CREATE TABLE IF NOT EXISTS system_settings (
  key   VARCHAR(60) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the blacklist policy ("warn" by default; admin can switch to "block")
INSERT INTO system_settings (key, value)
VALUES ('blacklist_policy', 'warn')
ON CONFLICT (key) DO NOTHING;

-- Upgrade-safe additions
ALTER TABLE students  ADD COLUMN IF NOT EXISTS department VARCHAR(80);
ALTER TABLE students  ADD COLUMN IF NOT EXISTS batch VARCHAR(20);
ALTER TABLE students  ADD COLUMN IF NOT EXISTS physical_reporting_completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE students  ADD COLUMN IF NOT EXISTS physical_reporting_at TIMESTAMPTZ;
ALTER TABLE students  ADD COLUMN IF NOT EXISTS pending_docs TEXT;
ALTER TABLE students  ADD COLUMN IF NOT EXISTS submission_deadline DATE;
ALTER TABLE students  ADD COLUMN IF NOT EXISTS slot_rejected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE students  ADD COLUMN IF NOT EXISTS slot_reject_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS institution_name VARCHAR(250);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS flag_match VARCHAR(250);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS flag_remarks TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE slots     ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE slots     ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';
ALTER TABLE slots     ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 30;
UPDATE slots SET status='hidden' WHERE enabled=false AND status='open';

CREATE INDEX IF NOT EXISTS idx_documents_student ON documents(student_id);
CREATE INDEX IF NOT EXISTS idx_documents_flagged ON documents(flagged) WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_students_appno   ON students(app_no);
CREATE INDEX IF NOT EXISTS idx_students_dept    ON students(department);
CREATE INDEX IF NOT EXISTS idx_students_section ON students(section);
CREATE INDEX IF NOT EXISTS idx_slots_date_status ON slots(slot_date, status);


-- ====== v10: orientation-week document-verification schedule ======
CREATE TABLE IF NOT EXISTS verify_schedule (
  id            SERIAL PRIMARY KEY,
  schedule_date DATE        NOT NULL,
  room          VARCHAR(40) NOT NULL,
  slot_no       INT         NOT NULL,
  start_time    VARCHAR(20) NOT NULL,
  end_time      VARCHAR(20) NOT NULL,
  student_id    INT REFERENCES students(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'open',
  verified_at   TIMESTAMPTZ,
  verified_by   INT REFERENCES admins(id) ON DELETE SET NULL,
  remarks       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_date, room, slot_no)
);
CREATE INDEX IF NOT EXISTS idx_verify_schedule_student ON verify_schedule(student_id);
CREATE INDEX IF NOT EXISTS idx_verify_schedule_date    ON verify_schedule(schedule_date);
CREATE INDEX IF NOT EXISTS idx_verify_schedule_status  ON verify_schedule(status);
CREATE INDEX IF NOT EXISTS idx_verify_schedule_date_room ON verify_schedule(schedule_date, room);

-- ====== v14: pre-assigned date + auto-allocation linkage ======
ALTER TABLE students ADD COLUMN IF NOT EXISTS assigned_verification_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS assigned_batch INT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS upload_completed_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS verify_schedule_id INT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR(10);

-- ====== v34: student + parent contact (collected on first login, verified at campus) ======
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_name VARCHAR(120);
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_relation VARCHAR(30);
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email VARCHAR(160);
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20);
ALTER TABLE students ADD COLUMN IF NOT EXISTS contact_completed_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS contact_verified_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS contact_verified_by INT REFERENCES admins(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_students_contact_completed ON students(contact_completed_at);
CREATE INDEX IF NOT EXISTS idx_students_contact_verified ON students(contact_verified_at);

CREATE INDEX IF NOT EXISTS idx_students_assigned_date    ON students(assigned_verification_date);
CREATE INDEX IF NOT EXISTS idx_students_upload_completed ON students(upload_completed_at);

-- ====== v35: per-document physical submission + admin follow-up remark audit trail ======
ALTER TABLE documents ADD COLUMN IF NOT EXISTS physical_submission VARCHAR(20);

CREATE TABLE IF NOT EXISTS student_followup_remarks (
  id                       SERIAL PRIMARY KEY,
  student_id               INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  admin_id                 INT REFERENCES admins(id) ON DELETE SET NULL,
  physical_submission_note TEXT,
  discrepancies            TEXT,
  discussion_notes         TEXT,
  expected_submission_date DATE,
  remarks                  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followup_student ON student_followup_remarks(student_id);
CREATE INDEX IF NOT EXISTS idx_followup_created ON student_followup_remarks(created_at);

-- ====== v39: student portal deadline + per-student login access ======
ALTER TABLE students ADD COLUMN IF NOT EXISTS portal_access VARCHAR(20) NOT NULL DEFAULT 'default';

INSERT INTO system_settings (key, value) VALUES
  ('student_portal_deadline', ''),
  ('student_portal_deadline_time', '23:59'),
  ('student_portal_mode', 'open'),
  ('student_portal_closed_message', 'The document upload window has closed. Please contact the Admissions Cell for assistance.')
ON CONFLICT (key) DO NOTHING;

-- ====== v40: transactional email notification log ======
CREATE TABLE IF NOT EXISTS notification_log (
  id             SERIAL PRIMARY KEY,
  student_id     INT REFERENCES students(id) ON DELETE SET NULL,
  document_id    INT REFERENCES documents(id) ON DELETE SET NULL,
  channel        VARCHAR(20) NOT NULL DEFAULT 'email',
  event_type     VARCHAR(40) NOT NULL,
  recipient      VARCHAR(160),
  recipient_role VARCHAR(20),
  subject        TEXT,
  status         VARCHAR(20) NOT NULL,
  error          TEXT,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_student ON notification_log(student_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);

-- ====== v37: allow deleting admins referenced from verify_schedule ======
ALTER TABLE verify_schedule DROP CONSTRAINT IF EXISTS verify_schedule_verified_by_fkey;
ALTER TABLE verify_schedule
  ADD CONSTRAINT verify_schedule_verified_by_fkey
  FOREIGN KEY (verified_by) REFERENCES admins(id) ON DELETE SET NULL;

-- ====== v27: heal stale students.verify_schedule_id references ======
-- A pre-v26 reassign would leave students.verify_schedule_id pointing at the
-- old (now-reassigned) verify_schedule row, while the new target row carried
-- the student_id. The two queries below restore consistency:
--   1) Repoint each student to whichever row currently bears their student_id
--      (preferring non-reassigned rows).
--   2) Drop dangling verify_schedule_id values that don't match any row.
UPDATE students s
   SET verify_schedule_id = vs.id
  FROM verify_schedule vs
 WHERE vs.student_id = s.id
   AND vs.status <> 'reassigned'
   AND (s.verify_schedule_id IS NULL OR s.verify_schedule_id <> vs.id);
UPDATE students s
   SET verify_schedule_id = NULL
 WHERE verify_schedule_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM verify_schedule vs
     WHERE vs.id = s.verify_schedule_id AND vs.student_id = s.id
   );

-- ====== v41: Communication Center (email management) ======
CREATE TABLE IF NOT EXISTS comm_settings (
  key        VARCHAR(80) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO comm_settings (key, value) VALUES
  ('max_attachment_mb', '10'),
  ('max_attachments', '5'),
  ('default_from', '')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS comm_templates (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(80) UNIQUE,
  category    VARCHAR(40) NOT NULL DEFAULT 'general',
  subject     TEXT NOT NULL,
  body_html   TEXT NOT NULL,
  body_text   TEXT,
  audience    VARCHAR(20) NOT NULL DEFAULT 'both',
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_by  VARCHAR(40),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comm_messages (
  id               SERIAL PRIMARY KEY,
  status           VARCHAR(20) NOT NULL DEFAULT 'draft',
  subject          TEXT NOT NULL,
  body_html        TEXT NOT NULL,
  body_text        TEXT,
  parent_body_html TEXT,
  from_address     VARCHAR(160),
  cc               TEXT,
  bcc              TEXT,
  audience         VARCHAR(20) NOT NULL DEFAULT 'both',
  recipient_mode   VARCHAR(30) NOT NULL DEFAULT 'selected',
  recipient_filter JSONB,
  selected_app_nos TEXT[],
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  template_id      INT REFERENCES comm_templates(id) ON DELETE SET NULL,
  stats            JSONB NOT NULL DEFAULT '{}',
  created_by       VARCHAR(40) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_messages_status ON comm_messages(status);
CREATE INDEX IF NOT EXISTS idx_comm_messages_scheduled ON comm_messages(scheduled_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS comm_message_attachments (
  id          SERIAL PRIMARY KEY,
  message_id  INT NOT NULL REFERENCES comm_messages(id) ON DELETE CASCADE,
  filename    VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(80),
  size_bytes  INT NOT NULL DEFAULT 0,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_attachments_message ON comm_message_attachments(message_id);

CREATE TABLE IF NOT EXISTS comm_deliveries (
  id              SERIAL PRIMARY KEY,
  message_id      INT NOT NULL REFERENCES comm_messages(id) ON DELETE CASCADE,
  student_id      INT REFERENCES students(id) ON DELETE SET NULL,
  recipient_email VARCHAR(160) NOT NULL,
  recipient_role  VARCHAR(20) NOT NULL,
  recipient_name  VARCHAR(160),
  subject         TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  tracking_token  VARCHAR(64) UNIQUE,
  error           TEXT,
  sent_at         TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_deliveries_message ON comm_deliveries(message_id);
CREATE INDEX IF NOT EXISTS idx_comm_deliveries_status ON comm_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_comm_deliveries_created ON comm_deliveries(created_at);
CREATE INDEX IF NOT EXISTS idx_comm_deliveries_token ON comm_deliveries(tracking_token);

-- ====== v42: student password reset email OTP ======
CREATE TABLE IF NOT EXISTS student_password_otps (
  id          SERIAL PRIMARY KEY,
  student_id  INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  otp_hash    VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_student_password_otps_student ON student_password_otps(student_id);
CREATE INDEX IF NOT EXISTS idx_student_password_otps_created ON student_password_otps(created_at);
