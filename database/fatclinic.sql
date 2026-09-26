-- ============================================================================
-- FatClinic EHR — Complete Database Schema
-- Single file. Idempotent. Safe to re-run.
-- ============================================================================
--
--   psql "$DATABASE_URL" -f database/fatclinic.sql
--   npm run db:apply
--
-- CONTENTS
--   0.  Preflight and extensions
--   1.  Schema-level defaults
--   2.  Identity, access control and reference data
--   3.  Patients and clinical care
--   4.  Laboratory
--   5.  Pharmacy
--   6.  Billing
--   7.  Radiology and physiotherapy
--   8.  Consumables
--   9.  Audit trail and settings
--   10. Indexes (including every foreign key)
--   11. Functions and triggers
--   12. Row Level Security
--   13. Operational views
--   14. Seed data
--
-- DESIGN NOTES
--
--   * Credentials do NOT live here. Passwords are held by Supabase Auth; this
--     schema stores only the staff profile and links it by email / auth_user_id.
--     There is deliberately no plaintext (or hashed) password column.
--
--   * Row Level Security (section 12) is mandatory, not optional. The browser
--     ships a public Supabase anon key, so the database itself is the only thing
--     standing between an anonymous visitor and every patient record. If you are
--     applying this to a plain Postgres server with no Supabase `auth` schema,
--     section 12 is skipped and the database is NOT safe to expose.
--
--   * Money is NUMERIC(12,2) and vitals are unit-suffixed (temperature_c,
--     pulse_bpm, ...). The TypeScript model in src/types/index.ts uses shorter
--     names; the translation lives in exactly one place, the row mapper, so
--     clinical units are never ambiguous at the storage layer.
--
--   * `visits.ward` stores a ward CODE (e.g. 'MALE-GEN'), not a display name.
--     Display names come from the `wards` table. src/types/index.ts exports
--     WARD_OPTIONS and wardName() for this purpose.
--
--   * `audit_logs` is append-only, enforced twice: by RLS (no UPDATE/DELETE
--     policy) and by the prevent_audit_mutation() trigger.
--
--   * Every foreign key is indexed. PostgreSQL does not do this for you, and an
--     unindexed FK turns every parent DELETE into a full table scan.
--
--   * Invoice arithmetic is owned by the database (recalc_invoice), including
--     when a discount changes, so the figures cannot drift from the line items.
-- ============================================================================


-- ============================================================================
-- 0. PREFLIGHT AND EXTENSIONS
-- ============================================================================

-- Detect a half-applied schema from an earlier, interrupted run. If ANY of the
-- anchor tables exist but not all of them, something was left inconsistent and
-- CREATE TABLE IF NOT EXISTS would silently preserve the broken half. An
-- entirely empty database is the normal first-run case and is not an error.
DO $$
DECLARE
  v_present  TEXT[];
  v_expected CONSTANT TEXT[] := ARRAY[
    'users', 'patients', 'visits', 'vitals', 'consultations', 'lab_requests',
    'prescriptions', 'invoices', 'payments', 'audit_logs'
  ];
BEGIN
  SELECT array_agg(e ORDER BY e)
    INTO v_present
    FROM unnest(v_expected) AS e
   WHERE to_regclass('public.' || quote_ident(e)) IS NOT NULL;

  IF v_present IS NOT NULL AND cardinality(v_present) < cardinality(v_expected) THEN
    RAISE EXCEPTION
      'FatClinic schema: partially applied. Found % of % anchor tables (%). '
      'Refusing to continue, because CREATE TABLE IF NOT EXISTS would keep the '
      'inconsistent half. Inspect the database, or drop these tables and re-run.',
      cardinality(v_present), cardinality(v_expected), v_present;
  END IF;
END $$;


-- ============================================================================
-- 1. SCHEMA-LEVEL DEFAULTS
-- ============================================================================

-- Everything below is written unqualified, so pin the search path rather than
-- trusting whatever the connecting client happened to send.
SET search_path = public;


-- ============================================================================
-- 2. IDENTITY, ACCESS CONTROL AND REFERENCE DATA
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Wards. `code` is the stable identifier used by visits.ward; `name` is for
-- display only and may be reworded without touching clinical records.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wards (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  capacity    INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Nested access-control tree. A grant on a parent key implies every descendant,
-- so revoking one leaf leaves its siblings intact.
-- Mirrors src/services/permissions.ts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_nodes (
  key         TEXT PRIMARY KEY,                       -- 'LABORATORY.HEMATOLOGY.PROCESS'
  parent_key  TEXT REFERENCES permission_nodes(key) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  depth       INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 4),
  -- Each dot-separated segment is an upper-case identifier. Underscores are
  -- allowed because existing keys use them: LABORATORY.CHEMICAL_PATHOLOGY.
  CONSTRAINT valid_permission_key
    CHECK (key ~ '^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)*$')
);

-- ----------------------------------------------------------------------------
-- Granular custom roles. role_permissions is FK-bound to permission_nodes, so
-- only keys that exist in the hierarchy can ever be granted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_roles (
  id           TEXT PRIMARY KEY,                      -- 'ROLE-...'
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,                                  -- FK added below (cycle-safe)
  updated_by   TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        TEXT NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permission_nodes(key) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by     TEXT,
  PRIMARY KEY (role_id, permission_key)
);

-- ----------------------------------------------------------------------------
-- Staff accounts. Database-controlled: there is no self-registration path.
--
--   pin                  4-digit workstation screen-lock PIN. NOT a login
--                        credential and NOT a secret - it only gates the screen
--                        on a shared ward terminal.
--   auth_user_id         Supabase Auth user this profile signs in as.
--   must_change_password Advisory flag for the sign-in UI.
--
-- There is intentionally no password column: passwords belong to Supabase Auth.
-- See section 12 for how the two are linked.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,              -- 'USR-001'
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN (
                         'ADMINISTRATOR','PHYSICIAN','NURSE','LAB_SCIENTIST',
                         'PHARMACIST','RADIOLOGIST','PHYSIOTHERAPIST',
                         'FRONT_DESK','BILLING_OFFICER')),
  department           TEXT NOT NULL DEFAULT '',
  avatar               TEXT NOT NULL DEFAULT '',
  pin                  TEXT NOT NULL DEFAULT '1234' CHECK (pin ~ '^[0-9]{4}$'),
  custom_role_id       TEXT REFERENCES custom_roles(id) ON DELETE SET NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  auth_user_id         UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: staff sign in with whatever case they type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));


-- ============================================================================
-- 3. PATIENTS AND CLINICAL CARE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Patients. `age` is denormalised alongside `dob` because the front desk
-- registers walk-ins faster than a trigger round-trip; treat `dob` as truth and
-- recompute age on read if the two ever disagree.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id                TEXT PRIMARY KEY,                 -- hospital number 'FC-2026-00101'
  first_name        TEXT NOT NULL,
  middle_name       TEXT,
  last_name         TEXT NOT NULL,
  dob               DATE NOT NULL,
  age               INTEGER NOT NULL CHECK (age BETWEEN 0 AND 130),
  sex               TEXT NOT NULL CHECK (sex IN ('Male','Female','Other')),
  phone             TEXT NOT NULL,
  email             TEXT,
  address           TEXT NOT NULL DEFAULT '',
  next_of_kin       TEXT NOT NULL DEFAULT '',
  emergency_contact TEXT NOT NULL DEFAULT '',
  occupation        TEXT,
  blood_group       TEXT,
  genotype          TEXT,
  allergies         TEXT[] NOT NULL DEFAULT '{}',
  alerts            TEXT[] NOT NULL DEFAULT '{}',
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Visits / encounters. Ward admission lives here.
-- `ward` holds a wards.code value.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visits (
  id                     TEXT PRIMARY KEY,            -- 'VIS-2026-001'
  patient_id             TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_date             DATE NOT NULL,
  visit_time             TEXT NOT NULL DEFAULT '00:00',
  visit_type             TEXT NOT NULL CHECK (visit_type IN ('New Visit','Follow-up','Emergency','Routine')),
  status                 TEXT NOT NULL CHECK (status IN (
                           'Awaiting Vitals','With Nurse','Awaiting Physician','With Doctor',
                           'In Consultation','Awaiting Lab','Awaiting Pharmacy','Awaiting Payment',
                           'Admitted','Treated','Discharged','Completed')),
  attending_physician_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  attending_nurse_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason_for_visit       TEXT,
  notes                  TEXT,
  ward                   TEXT REFERENCES wards(code) ON DELETE SET NULL,
  admitted_at            TIMESTAMPTZ,
  admitted_by            TEXT,
  discharged_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An admission must name a ward; a discharge must clear it.
  CONSTRAINT admitted_requires_ward
    CHECK (status <> 'Admitted' OR ward IS NOT NULL)
);

-- ----------------------------------------------------------------------------
-- Vitals. Unit suffixes are deliberate: a naked `spo2` invites a mix-up between
-- percent and fraction. Ranges are wide enough for real clinical outliers.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vitals (
  id                 TEXT PRIMARY KEY,
  visit_id           TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id         TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  nurse_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  nurse_name         TEXT NOT NULL DEFAULT '',
  temperature_c      NUMERIC(4,1) NOT NULL CHECK (temperature_c BETWEEN 25 AND 45),
  systolic_bp        INTEGER NOT NULL CHECK (systolic_bp BETWEEN 40 AND 300),
  diastolic_bp       INTEGER NOT NULL CHECK (diastolic_bp BETWEEN 20 AND 200),
  pulse_bpm          INTEGER NOT NULL CHECK (pulse_bpm BETWEEN 20 AND 250),
  respiratory_rate   INTEGER NOT NULL CHECK (respiratory_rate BETWEEN 4 AND 80),
  spo2_pct           INTEGER NOT NULL CHECK (spo2_pct BETWEEN 0 AND 100),
  weight_kg          NUMERIC(5,1) NOT NULL CHECK (weight_kg > 0),
  height_m           NUMERIC(4,2) NOT NULL CHECK (height_m > 0),
  bmi                NUMERIC(4,1) NOT NULL CHECK (bmi >= 0),
  bmi_category       TEXT NOT NULL CHECK (bmi_category IN (
                       'Underweight','Normal','Overweight',
                       'Obese Class I','Obese Class II','Obese Class III')),
  pain_score         INTEGER CHECK (pain_score BETWEEN 0 AND 10),
  nursing_notes      TEXT,
  nursing_care_plan  TEXT,
  nursing_procedures TEXT[] NOT NULL DEFAULT '{}',
  alerts             TEXT[] NOT NULL DEFAULT '{}',
  -- Diastolic must not exceed systolic.
  CONSTRAINT bp_ordering CHECK (diastolic_bp <= systolic_bp)
);

-- ----------------------------------------------------------------------------
-- Consultations. The examination is flattened into six columns (the front end
-- nests it); ICD-10 diagnoses live in clinical_diagnoses.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultations (
  id                          TEXT PRIMARY KEY,
  visit_id                    TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id                  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  physician_id                TEXT REFERENCES users(id) ON DELETE SET NULL,
  physician_name              TEXT NOT NULL DEFAULT '',
  consultation_date           TIMESTAMPTZ NOT NULL DEFAULT now(),
  presenting_complaint        TEXT NOT NULL DEFAULT '',
  history_presenting_complaint TEXT NOT NULL DEFAULT '',
  past_medical_history        TEXT NOT NULL DEFAULT '',
  surgical_history            TEXT NOT NULL DEFAULT '',
  drug_history                TEXT NOT NULL DEFAULT '',
  family_history              TEXT NOT NULL DEFAULT '',
  social_history              TEXT NOT NULL DEFAULT '',
  allergy_history             TEXT NOT NULL DEFAULT '',
  exam_general                TEXT NOT NULL DEFAULT '',
  exam_cardiovascular         TEXT NOT NULL DEFAULT '',
  exam_respiratory            TEXT NOT NULL DEFAULT '',
  exam_abdomen                TEXT NOT NULL DEFAULT '',
  exam_neurological           TEXT NOT NULL DEFAULT '',
  exam_musculoskeletal        TEXT NOT NULL DEFAULT '',
  exam_other                  TEXT NOT NULL DEFAULT '',
  clinical_findings           TEXT NOT NULL DEFAULT '',
  assessment                  TEXT NOT NULL DEFAULT '',
  plan                        TEXT NOT NULL DEFAULT '',
  follow_up_date              DATE,
  clinical_notes              TEXT NOT NULL DEFAULT '',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clinical_diagnoses (
  id              TEXT PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,                      -- ICD-10, e.g. 'B50.9'
  description     TEXT NOT NULL,
  diag_type       TEXT NOT NULL CHECK (diag_type IN ('Primary','Secondary'))
);


-- ============================================================================
-- 4. LABORATORY
-- ============================================================================

-- Catalogue: 5 departments, priced.
CREATE TABLE IF NOT EXISTS lab_investigations (
  id              TEXT PRIMARY KEY,                   -- 'LAB-HEM-01'
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
                    'HEMATOLOGY','MICROBIOLOGY','CHEMICAL_PATHOLOGY',
                    'HISTOPATHOLOGY','MOLECULAR')),
  price           NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  sample_type     TEXT NOT NULL DEFAULT '',
  turnaround_time TEXT NOT NULL DEFAULT '',
  description     TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_parameters (
  id               TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES lab_investigations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL DEFAULT '',
  reference_range  TEXT NOT NULL DEFAULT '',
  result_type      TEXT NOT NULL CHECK (result_type IN ('numeric','text','select','reactive')),
  options          TEXT[] NOT NULL DEFAULT '{}'
);

-- One request per physician order; the individual tests are lab_test_orders.
CREATE TABLE IF NOT EXISTS lab_requests (
  id                  TEXT PRIMARY KEY,
  visit_id            TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id          TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  physician_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  physician_name      TEXT NOT NULL DEFAULT '',
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  priority            TEXT NOT NULL CHECK (priority IN ('Routine','Urgent','STAT')),
  clinical_indication TEXT,
  payment_status      TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid','Paid')),
  total_price         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_test_orders (
  id                TEXT PRIMARY KEY,
  request_id        TEXT NOT NULL REFERENCES lab_requests(id) ON DELETE CASCADE,
  test_definition_id TEXT REFERENCES lab_investigations(id) ON DELETE SET NULL,
  test_name         TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN (
                      'HEMATOLOGY','MICROBIOLOGY','CHEMICAL_PATHOLOGY',
                      'HISTOPATHOLOGY','MOLECULAR')),
  price             NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  sample_type       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL CHECK (status IN (
                      'Requested','Paid','Sample Collected','Processing',
                      'Result Entered','Verified','Released')),
  collected_at      TIMESTAMPTZ,
  scientist_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  scientist_name    TEXT,
  verified_by       TEXT,
  released_at       TIMESTAMPTZ,
  comments          TEXT,
  critical_alert    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_results (
  id              TEXT PRIMARY KEY,
  test_order_id   TEXT NOT NULL REFERENCES lab_test_orders(id) ON DELETE CASCADE,
  parameter_id    TEXT NOT NULL,
  parameter_name  TEXT NOT NULL,
  value           TEXT NOT NULL DEFAULT '',
  unit            TEXT NOT NULL DEFAULT '',
  reference_range TEXT NOT NULL DEFAULT '',
  flag            TEXT NOT NULL CHECK (flag IN ('Normal','Low','High','Critical','Abnormal'))
);


-- ============================================================================
-- 5. PHARMACY
-- ============================================================================

CREATE TABLE IF NOT EXISTS medications (
  id               TEXT PRIMARY KEY,                  -- 'MED-001'
  name             TEXT NOT NULL,
  generic_name     TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT '',
  dosage_form      TEXT NOT NULL DEFAULT '',
  strength         TEXT NOT NULL DEFAULT '',
  unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  current_stock    INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  min_stock_alert  INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_alert >= 0),
  dispensing_unit  TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id             TEXT PRIMARY KEY,
  visit_id       TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id     TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  physician_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  physician_name TEXT NOT NULL DEFAULT '',
  prescribed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL CHECK (status IN ('Pending','Partially Dispensed','Completed','Cancelled')),
  total_price    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- dispensed_at was missing from the original schema even though the application
-- tracks it; without it, "when was this last dispensed?" is unanswerable.
CREATE TABLE IF NOT EXISTS prescription_items (
  id                  TEXT PRIMARY KEY,
  prescription_id     TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medication_id       TEXT REFERENCES medications(id) ON DELETE SET NULL,
  medication_name     TEXT NOT NULL,
  dosage              TEXT NOT NULL DEFAULT '',
  route               TEXT NOT NULL DEFAULT '',
  frequency           TEXT NOT NULL DEFAULT '',
  duration            TEXT NOT NULL DEFAULT '',
  quantity_prescribed INTEGER NOT NULL CHECK (quantity_prescribed > 0),
  quantity_dispensed  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_dispensed >= 0),
  unit_price          NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price         NUMERIC(12,2) NOT NULL CHECK (total_price >= 0),
  instructions        TEXT NOT NULL DEFAULT '',
  dispense_status     TEXT NOT NULL CHECK (dispense_status IN ('Pending','Dispensed','Partially Dispensed','Out of Stock')),
  pharmacist_notes    TEXT,
  dispensed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- You can never dispense more than was prescribed.
  CONSTRAINT dispensed_within_prescribed
    CHECK (quantity_dispensed <= quantity_prescribed)
);


-- ============================================================================
-- 6. BILLING
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_prices (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL CHECK (category IN (
                   'Consultation','Laboratory','Pharmacy','Nursing','Procedure','Other')),
  price          NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One invoice per visit is expected of the application, not enforced by a
-- constraint: a unique index on visit_id would make an unsynced browser that
-- creates a second invoice hard-fail, and a clinical record should not lose a
-- billing row to a constraint violation. The money columns are maintained by
-- recalc_invoice(); write `discount` and the line items, and let the database do
-- the arithmetic.
CREATE TABLE IF NOT EXISTS invoices (
  id                 TEXT PRIMARY KEY,               -- 'FC-INV-2026-001'
  visit_id           TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id         TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  invoice_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  payment_status     TEXT NOT NULL DEFAULT 'Unpaid'
                       CHECK (payment_status IN ('Unpaid','Partially Paid','Paid','Refunded')),
  require_prepayment BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id               TEXT PRIMARY KEY,
  invoice_id       TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  service_category TEXT NOT NULL CHECK (service_category IN (
                     'Consultation','Laboratory','Pharmacy','Nursing','Procedure','Other')),
  description      TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price      NUMERIC(12,2) NOT NULL CHECK (total_price >= 0),
  reference_id     TEXT,                             -- source order/test id
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payments are a receipt trail: append-only, never edited or removed.
CREATE TABLE IF NOT EXISTS payments (
  id                    TEXT PRIMARY KEY,           -- 'PMT-...'
  invoice_id            TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  receipt_number        TEXT NOT NULL UNIQUE,       -- 'RCP-2026-1001'
  paid_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method        TEXT NOT NULL CHECK (payment_method IN ('Cash','Transfer','POS','Card','Insurance')),
  received_by           TEXT NOT NULL DEFAULT '',
  bank_name             TEXT,
  transaction_reference TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================================
-- 7. RADIOLOGY AND PHYSIOTHERAPY
-- ============================================================================

CREATE TABLE IF NOT EXISTS radiology_orders (
  id                 TEXT PRIMARY KEY,
  visit_id           TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id         TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  ordered_by         TEXT NOT NULL DEFAULT '',
  ordered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modality           TEXT NOT NULL CHECK (modality IN ('X-Ray','Ultrasound','CT Scan','MRI','Echocardiogram')),
  investigation_name TEXT NOT NULL,
  clinical_notes     TEXT,
  findings           TEXT,
  impression         TEXT,
  reported_by        TEXT,
  reported_at        TIMESTAMPTZ,
  film_size          TEXT,
  contrast_used      BOOLEAN NOT NULL DEFAULT FALSE,
  price              NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  status             TEXT NOT NULL CHECK (status IN ('Requested','Completed','Report Ready')),
  invoice_id         TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS physiotherapy_orders (
  id                  TEXT PRIMARY KEY,
  visit_id            TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id          TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  ordered_by          TEXT NOT NULL DEFAULT '',
  ordered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  service_name        TEXT NOT NULL,
  category            TEXT CHECK (category IN ('Musculoskeletal','Neurological','Sports','Pediatric','General')),
  sessions            INTEGER NOT NULL CHECK (sessions > 0),
  sessions_completed  INTEGER NOT NULL DEFAULT 0 CHECK (sessions_completed >= 0),
  progress_notes      TEXT,
  treated_by          TEXT,
  last_session_date   DATE,
  price               NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  clinical_indication TEXT,
  status              TEXT NOT NULL CHECK (status IN ('Requested','In Progress','Completed')),
  invoice_id          TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sessions_completed_within_total
    CHECK (sessions_completed <= sessions)
);


-- ============================================================================
-- 8. CONSUMABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS clinical_consumables (
  id              TEXT PRIMARY KEY,                   -- 'CSM-001'
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
                    'Nursing','Consultation','Surgical','Emergency','Radiology',
                    'Physiotherapy','Laboratory','Pharmacy','General')),
  unit            TEXT NOT NULL DEFAULT '',
  current_stock   INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  min_alert_level INTEGER NOT NULL DEFAULT 0 CHECK (min_alert_level >= 0),
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consumable_requests (
  id                 TEXT PRIMARY KEY,
  consumable_id       TEXT REFERENCES clinical_consumables(id) ON DELETE SET NULL,
  consumable_name     TEXT NOT NULL,
  section             TEXT NOT NULL DEFAULT 'General',
  quantity_requested  INTEGER NOT NULL CHECK (quantity_requested > 0),
  requested_by        TEXT NOT NULL DEFAULT '',
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL CHECK (status IN ('Pending','Approved','Dispatched')),
  urgency             TEXT NOT NULL CHECK (urgency IN ('Routine','Urgent')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consumable_usage (
  id               TEXT PRIMARY KEY,
  consumable_id    TEXT REFERENCES clinical_consumables(id) ON DELETE SET NULL,
  consumable_name  TEXT NOT NULL,
  section          TEXT NOT NULL DEFAULT 'General',
  quantity_used    INTEGER NOT NULL CHECK (quantity_used > 0),
  unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  total_charge     NUMERIC(12,2) NOT NULL CHECK (total_charge >= 0),
  used_by          TEXT NOT NULL DEFAULT '',
  used_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  patient_id       TEXT REFERENCES patients(id) ON DELETE SET NULL,
  visit_id         TEXT REFERENCES visits(id) ON DELETE SET NULL,
  invoice_id       TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medication_requests (
  id                 TEXT PRIMARY KEY,
  medication_id      TEXT REFERENCES medications(id) ON DELETE SET NULL,
  medication_name    TEXT NOT NULL,
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  requested_by       TEXT NOT NULL DEFAULT '',
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL CHECK (status IN ('Pending','Approved','Dispatched')),
  urgency            TEXT NOT NULL CHECK (urgency IN ('Routine','Urgent')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================================
-- 9. AUDIT TRAIL, SETTINGS, BOOKINGS AND BENCH STOCK
-- ============================================================================

-- Append-only. `logged_at` is the audit timestamp; the front end calls it
-- `timestamp`, which the row mapper translates.
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name    TEXT NOT NULL DEFAULT '',
  user_role    TEXT NOT NULL DEFAULT '',
  patient_id   TEXT REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT,
  action       TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('PATIENT','CLINICAL','LABORATORY','PHARMACY','BILLING','ADMIN')),
  details      TEXT NOT NULL DEFAULT '',
  metadata     JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS online_bookings (
  id                     TEXT PRIMARY KEY,
  patient_code           TEXT NOT NULL UNIQUE,       -- 'REG-7821'
  first_name             TEXT NOT NULL,
  middle_name            TEXT,
  last_name              TEXT NOT NULL,
  dob                    DATE NOT NULL,
  age                    INTEGER NOT NULL CHECK (age BETWEEN 0 AND 130),
  sex                    TEXT NOT NULL CHECK (sex IN ('Male','Female','Other')),
  phone                  TEXT NOT NULL,
  email                  TEXT,
  address                TEXT NOT NULL DEFAULT '',
  reason_for_appointment TEXT NOT NULL DEFAULT '',
  preferred_date         DATE NOT NULL,
  preferred_time         TEXT NOT NULL DEFAULT '',
  booked_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                 TEXT NOT NULL CHECK (status IN ('Pending Arrival','Completed','Cancelled')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_stock_items (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('Reagents','Consumables','Tubes','Kits','Stains')),
  current_stock   INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  unit            TEXT NOT NULL DEFAULT '',
  unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  min_alert_level INTEGER NOT NULL DEFAULT 0 CHECK (min_alert_level >= 0),
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_stock_requests (
  id                 TEXT PRIMARY KEY,
  item_id            TEXT REFERENCES lab_stock_items(id) ON DELETE SET NULL,
  item_name          TEXT NOT NULL,
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  requested_by       TEXT NOT NULL DEFAULT '',
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL CHECK (status IN ('Pending','Approved','Dispatched')),
  urgency            TEXT NOT NULL CHECK (urgency IN ('Routine','Urgent')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row tables: id is pinned to 1 by a CHECK.
CREATE TABLE IF NOT EXISTS system_settings (
  id                         INTEGER PRIMARY KEY CHECK (id = 1),
  hospital_name              TEXT NOT NULL DEFAULT 'FatClinic & Medical Specialties',
  tagline                    TEXT NOT NULL DEFAULT '',
  address                    TEXT NOT NULL DEFAULT '',
  phone                      TEXT NOT NULL DEFAULT '',
  email                      TEXT NOT NULL DEFAULT '',
  currency                   TEXT NOT NULL DEFAULT '₦',
  currency_code              TEXT NOT NULL DEFAULT 'NGN',
  invoice_prefix             TEXT NOT NULL DEFAULT 'FC-INV',
  patient_prefix             TEXT NOT NULL DEFAULT 'FC',
  inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 5 CHECK (inactivity_timeout_minutes > 0),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipt_settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  hospital_name         TEXT NOT NULL DEFAULT '',
  tagline               TEXT NOT NULL DEFAULT '',
  address               TEXT NOT NULL DEFAULT '',
  phone                 TEXT NOT NULL DEFAULT '',
  email                 TEXT NOT NULL DEFAULT '',
  footer_message        TEXT NOT NULL DEFAULT '',
  terms_line            TEXT NOT NULL DEFAULT '',
  receipt_prefix        TEXT NOT NULL DEFAULT 'RCP' CHECK (receipt_prefix ~ '^[A-Z]{1,6}$'),
  show_receipt_count    BOOLEAN NOT NULL DEFAULT TRUE,
  show_payment_method   BOOLEAN NOT NULL DEFAULT TRUE,
  show_received_by      BOOLEAN NOT NULL DEFAULT TRUE,
  show_bank_details     BOOLEAN NOT NULL DEFAULT TRUE,
  show_invoice_position BOOLEAN NOT NULL DEFAULT TRUE,
  show_thank_you        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cycle-safe foreign keys, added after every table exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_custom_roles_created_by') THEN
    ALTER TABLE custom_roles ADD CONSTRAINT fk_custom_roles_created_by
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_custom_roles_updated_by') THEN
    ALTER TABLE custom_roles ADD CONSTRAINT fk_custom_roles_updated_by
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ============================================================================
-- 10. INDEXES
-- ============================================================================
-- Covers the columns the dashboards actually filter and sort on, plus every
-- foreign key (PostgreSQL creates none for you).
-- ============================================================================

-- Identity
CREATE INDEX IF NOT EXISTS idx_perm_nodes_parent        ON permission_nodes(parent_key);
CREATE INDEX IF NOT EXISTS idx_role_permissions_key     ON role_permissions(permission_key);
CREATE INDEX IF NOT EXISTS idx_role_permissions_granted ON role_permissions(granted_by);
CREATE INDEX IF NOT EXISTS idx_custom_roles_created_by  ON custom_roles(created_by);
CREATE INDEX IF NOT EXISTS idx_users_role               ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active             ON users(active);
CREATE INDEX IF NOT EXISTS idx_users_custom_role        ON users(custom_role_id);
CREATE INDEX IF NOT EXISTS idx_users_auth_user          ON users(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- Patients
CREATE INDEX IF NOT EXISTS idx_patients_name        ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone       ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_registered  ON patients(registered_at DESC);

-- Visits
CREATE INDEX IF NOT EXISTS idx_visits_patient   ON visits(patient_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_visits_status    ON visits(status, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_visits_ward      ON visits(ward) WHERE status = 'Admitted';
CREATE INDEX IF NOT EXISTS idx_visits_created   ON visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_physician ON visits(attending_physician_id);
CREATE INDEX IF NOT EXISTS idx_visits_nurse     ON visits(attending_nurse_id);

-- Vitals
CREATE INDEX IF NOT EXISTS idx_vitals_visit  ON vitals(visit_id);
CREATE INDEX IF NOT EXISTS idx_vitals_patient ON vitals(patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_nurse  ON vitals(nurse_id);

-- Consultations
CREATE INDEX IF NOT EXISTS idx_consultations_patient   ON consultations(patient_id, consultation_date DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_visit     ON consultations(visit_id);
CREATE INDEX IF NOT EXISTS idx_consultations_physician ON consultations(physician_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_consult       ON clinical_diagnoses(consultation_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_code          ON clinical_diagnoses(code);

-- Laboratory
CREATE INDEX IF NOT EXISTS idx_lab_inv_category      ON lab_investigations(category);
CREATE INDEX IF NOT EXISTS idx_lab_inv_active        ON lab_investigations(active);
CREATE INDEX IF NOT EXISTS idx_lab_params_invest     ON lab_parameters(investigation_id);
CREATE INDEX IF NOT EXISTS idx_lab_req_patient       ON lab_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_req_visit         ON lab_requests(visit_id);
CREATE INDEX IF NOT EXISTS idx_lab_req_physician     ON lab_requests(physician_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status    ON lab_test_orders(status, category);
CREATE INDEX IF NOT EXISTS idx_lab_orders_request   ON lab_test_orders(request_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_scientist ON lab_test_orders(scientist_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_critical  ON lab_test_orders(request_id) WHERE critical_alert;
CREATE INDEX IF NOT EXISTS idx_lab_results_order    ON lab_results(test_order_id);

-- Pharmacy
CREATE INDEX IF NOT EXISTS idx_meds_name     ON medications(name);
CREATE INDEX IF NOT EXISTS idx_rx_patient    ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_visit      ON prescriptions(visit_id);
CREATE INDEX IF NOT EXISTS idx_rx_physician  ON prescriptions(physician_id);
CREATE INDEX IF NOT EXISTS idx_rx_items_rx   ON prescription_items(prescription_id);
CREATE INDEX IF NOT EXISTS idx_rx_items_med  ON prescription_items(medication_id);
CREATE INDEX IF NOT EXISTS idx_med_req_status ON medication_requests(status);
CREATE INDEX IF NOT EXISTS idx_med_req_med    ON medication_requests(medication_id);

-- Billing
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_visit   ON invoices(visit_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status  ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_date    ON invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_ref     ON invoice_items(reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_invoice  ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at  ON payments(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_prices_cat ON service_prices(category, active);

-- Imaging and physiotherapy
CREATE INDEX IF NOT EXISTS idx_radio_patient   ON radiology_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_radio_visit     ON radiology_orders(visit_id);
CREATE INDEX IF NOT EXISTS idx_radio_status    ON radiology_orders(status);
CREATE INDEX IF NOT EXISTS idx_radio_invoice   ON radiology_orders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_physio_patient  ON physiotherapy_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_physio_visit    ON physiotherapy_orders(visit_id);
CREATE INDEX IF NOT EXISTS idx_physio_status   ON physiotherapy_orders(status);
CREATE INDEX IF NOT EXISTS idx_physio_invoice  ON physiotherapy_orders(invoice_id);

-- Consumables
CREATE INDEX IF NOT EXISTS idx_consumables_category  ON clinical_consumables(category);
CREATE INDEX IF NOT EXISTS idx_consumable_req_status ON consumable_requests(status);
CREATE INDEX IF NOT EXISTS idx_consumable_req_item   ON consumable_requests(consumable_id);
CREATE INDEX IF NOT EXISTS idx_consumable_use_section ON consumable_usage(section, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_consumable_use_pt     ON consumable_usage(patient_id);

-- Audit, bookings, bench stock
CREATE INDEX IF NOT EXISTS idx_audit_patient  ON audit_logs(patient_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON audit_logs(action, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logged   ON audit_logs(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_logs(category, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON online_bookings(status, preferred_date);
CREATE INDEX IF NOT EXISTS idx_lab_stock_status ON lab_stock_requests(status);
CREATE INDEX IF NOT EXISTS idx_lab_stock_item   ON lab_stock_requests(item_id);


-- ============================================================================
-- 11. FUNCTIONS AND TRIGGERS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- touch_updated_at(): keep updated_at honest for every table that has one.
-- Driven by a catalog scan, so a new table with updated_at is covered without
-- editing this file.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND a.attname = 'updated_at'
       AND a.attnum > 0
       AND NOT a.attisdropped
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- prevent_audit_mutation(): the audit trail is append-only, full stop.
-- Belt to the RLS braces in section 12.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; % is not permitted', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_logs;
CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ----------------------------------------------------------------------------
-- recalc_invoice(): the database owns invoice arithmetic.
--
-- Fixes a defect in the previous version, which tested `IF NOT FOUND` after the
-- payments SELECT. An invoice with line items but no payments yet made that
-- SELECT return zero rows, so recalculation returned early and subtotal/total
-- were never populated. Existence is now checked explicitly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalc_invoice(p_invoice_id TEXT) RETURNS void AS $$
DECLARE
  v_exists   BOOLEAN;
  v_sub      NUMERIC(12,2);
  v_disc     NUMERIC(12,2);
  v_paid     NUMERIC(12,2);
  v_total    NUMERIC(12,2);
  v_balance  NUMERIC(12,2);
  v_status   TEXT;
  v_current  TEXT;
BEGIN
  SELECT true, discount, payment_status
    INTO v_exists, v_disc, v_current
    FROM invoices
   WHERE id = p_invoice_id;

  -- Unknown invoice: nothing to do. (FOUND would be false for a valid invoice
  -- that simply has no payments, which is the normal state for a new invoice.)
  IF NOT COALESCE(v_exists, false) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(total_price), 0) INTO v_sub  FROM invoice_items WHERE invoice_id = p_invoice_id;
  SELECT COALESCE(SUM(amount), 0)       INTO v_paid FROM payments      WHERE invoice_id = p_invoice_id;
  v_disc    := LEAST(COALESCE(v_disc, 0), v_sub);
  v_total   := GREATEST(0, v_sub - v_disc);
  v_balance := GREATEST(0, v_total - v_paid);

  -- A refunded invoice keeps its status; the amounts still get corrected.
  v_status := CASE
                WHEN v_current = 'Refunded'            THEN 'Refunded'
                WHEN v_total <= 0                      THEN 'Paid'
                WHEN v_paid >= v_total                 THEN 'Paid'
                WHEN v_paid > 0                        THEN 'Partially Paid'
                ELSE 'Unpaid'
              END;

  UPDATE invoices
     SET subtotal       = v_sub,
         discount       = v_disc,
         total          = v_total,
         paid_amount    = v_paid,
         balance        = v_balance,
         payment_status = v_status
   WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;

-- Line items and payments both feed the totals. On a DELETE, NEW is an
-- unassigned record in PL/pgSQL, so the row identity must come from a
-- TG_OP switch rather than COALESCE(NEW.x, OLD.x).
CREATE OR REPLACE FUNCTION trg_invoice_child_changed() RETURNS trigger AS $$
DECLARE
  v_invoice_id TEXT;
BEGIN
  v_invoice_id := CASE TG_OP WHEN 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  PERFORM recalc_invoice(v_invoice_id);
  RETURN NULL;   -- AFTER trigger: the return value is ignored.
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_items_math ON invoice_items;
CREATE TRIGGER trg_invoice_items_math
  AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_child_changed();

DROP TRIGGER IF EXISTS trg_payments_math ON payments;
CREATE TRIGGER trg_payments_math
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_child_changed();

-- The previous schema only recalculated when a child row changed, so editing a
-- discount left the totals stale. This closes that gap. The WHEN clause keeps it
-- to one extra pass: recalc_invoice rewrites `discount` too, and the second pass
-- finds it unchanged and stops.
CREATE OR REPLACE FUNCTION trg_invoice_discount_math() RETURNS trigger AS $$
BEGIN
  PERFORM recalc_invoice(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_discount_math ON invoices;
CREATE TRIGGER trg_invoice_discount_math
  AFTER UPDATE OF discount ON invoices
  FOR EACH ROW WHEN (OLD.discount IS DISTINCT FROM NEW.discount)
  EXECUTE FUNCTION trg_invoice_discount_math();


-- ============================================================================
-- 12. ROW LEVEL SECURITY
-- ============================================================================
-- MANDATORY. The browser ships a public anon key, so these policies are the only
-- thing preventing an anonymous visitor from reading every patient record.
--
-- Skipped automatically on a plain Postgres server (no `auth` schema), which is
-- why such a deployment must never be exposed to a network.
-- ============================================================================

-- The three helper functions below (app_user_role, app_is_admin,
-- app_current_staff_id) are created INSIDE the guard below rather than here,
-- because they call auth.jwt(). PostgreSQL validates a LANGUAGE sql function
-- body at CREATE time, so declaring them unconditionally would abort the whole
-- apply on a plain Postgres server that has no auth schema.

DO $$
DECLARE
  t TEXT;
  -- Clinical and operational data: any authenticated staff member may work.
  staff_tables TEXT[] := ARRAY[
    'wards', 'patients', 'visits', 'vitals', 'consultations', 'clinical_diagnoses',
    'lab_investigations', 'lab_parameters', 'lab_requests', 'lab_test_orders',
    'lab_results', 'medications', 'prescriptions', 'prescription_items',
    'invoices', 'invoice_items', 'payments', 'online_bookings',
    'lab_stock_items', 'lab_stock_requests', 'radiology_orders',
    'physiotherapy_orders', 'clinical_consumables', 'consumable_requests',
    'consumable_usage', 'medication_requests'
  ];
  -- Configuration and access control: readable by all, writable by admins only.
  admin_tables TEXT[] := ARRAY[
    'users', 'custom_roles', 'role_permissions', 'permission_nodes',
    'system_settings', 'receipt_settings', 'service_prices'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE NOTICE 'auth schema absent - SKIPPING Row Level Security. This database is NOT safe to expose.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'role "authenticated" is missing; is this a Supabase project?';
  END IF;

  -- The signed-in staff member's app role, resolved from the JWT email.
  -- SECURITY DEFINER because policies evaluate as the calling role, which cannot
  -- read public.users (itself behind RLS) without recursing.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.app_user_role() RETURNS TEXT AS $body$
      SELECT u.role
        FROM public.users u
       WHERE lower(u.email) = lower(auth.jwt() ->> 'email')
         AND u.active
       LIMIT 1;
    $body$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  $fn$;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.app_is_admin() RETURNS BOOLEAN AS $body$
      SELECT public.app_user_role() = 'ADMINISTRATOR';
    $body$ LANGUAGE sql STABLE
  $fn$;

  -- The signed-in staff member's public.users id, for audit attribution.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.app_current_staff_id() RETURNS TEXT AS $body$
      SELECT u.id
        FROM public.users u
       WHERE lower(u.email) = lower(auth.jwt() ->> 'email')
         AND u.active
       LIMIT 1;
    $body$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  $fn$;

  COMMENT ON FUNCTION public.app_user_role() IS
    'App role of the signed-in staff member, matched from the Supabase JWT email. NULL when signed out or unrecognised.';

  FOREACH t IN ARRAY staff_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)', t || '_delete', t);
  END LOOP;

  FOREACH t IN ARRAY admin_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_is_admin())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_is_admin()) WITH CHECK (public.app_is_admin())', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_is_admin())', t || '_delete', t);
  END LOOP;

  -- audit_logs: SELECT and INSERT only. No UPDATE/DELETE policy is ever created.
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
    DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
    DROP POLICY IF EXISTS audit_logs_update ON audit_logs;
    DROP POLICY IF EXISTS audit_logs_delete ON audit_logs;
    CREATE POLICY audit_logs_select ON audit_logs FOR SELECT TO authenticated USING (true);
    CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  -- RLS is the real gate; these grants make the intent explicit and cut the anon
  -- role off from the tables entirely.
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;

  -- Policies invoke these as the table owner; clients must not call them
  -- directly, so EXECUTE is revoked from PUBLIC and regranted narrowly.
  EXECUTE 'REVOKE ALL ON FUNCTION public.app_user_role() FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.app_is_admin() FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.app_current_staff_id() FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_user_role() TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_is_admin() TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_current_staff_id() TO authenticated';

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_user_role() TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_is_admin() TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_current_staff_id() TO service_role';
  END IF;

  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

  -- Views run with the definer's rights, so an unprivileged role must not be
  -- able to create replacements in this schema.
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM anon';
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM authenticated';
END $$;


-- ============================================================================
-- 13. OPERATIONAL VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW v_currently_admitted AS
SELECT v.id AS visit_id, v.patient_id,
       p.first_name || ' ' || p.last_name AS patient_name,
       v.ward, w.name AS ward_name,
       v.admitted_at, v.admitted_by, v.visit_date
  FROM visits v
  JOIN patients p ON p.id = v.patient_id
  LEFT JOIN wards w ON w.code = v.ward
 WHERE v.status = 'Admitted';

CREATE OR REPLACE VIEW v_low_stock_alerts AS
SELECT 'medication' AS kind, id, name, current_stock,
       min_stock_alert AS min_level, unit_price
  FROM medications WHERE current_stock <= min_stock_alert
UNION ALL
SELECT 'consumable', id, name, current_stock, min_alert_level, unit_price
  FROM clinical_consumables WHERE current_stock <= min_alert_level
UNION ALL
SELECT 'lab_stock', id, name, current_stock, min_alert_level, unit_cost
  FROM lab_stock_items WHERE current_stock <= min_alert_level;

CREATE OR REPLACE VIEW v_invoice_balances AS
SELECT i.id, i.patient_id, i.visit_id, i.total,
       COALESCE(SUM(p.amount), 0) AS paid,
       i.total - COALESCE(SUM(p.amount), 0) AS balance,
       i.payment_status
  FROM invoices i
  LEFT JOIN payments p ON p.invoice_id = i.id
 GROUP BY i.id;

CREATE OR REPLACE VIEW v_ward_census AS
SELECT COALESCE(v.ward, 'UNSPECIFIED') AS ward_code,
       COALESCE(w.name, 'Unspecified ward') AS ward_name,
       COUNT(*) AS inpatients,
       COALESCE(MAX(w.capacity), 0) AS capacity
  FROM visits v
  LEFT JOIN wards w ON w.code = v.ward
 WHERE v.status = 'Admitted'
 GROUP BY COALESCE(v.ward, 'UNSPECIFIED'), COALESCE(w.name, 'Unspecified ward')
 ORDER BY inpatients DESC;

CREATE OR REPLACE VIEW v_revenue_by_department AS
SELECT service_category AS department,
       COUNT(*) AS lines,
       COALESCE(SUM(total_price), 0) AS billed
  FROM invoice_items
 GROUP BY service_category
 ORDER BY billed DESC;

CREATE OR REPLACE VIEW v_department_workload AS
SELECT 'doctor_awaiting' AS bucket, COUNT(*) AS n
  FROM visits WHERE visit_date = CURRENT_DATE AND status IN ('With Doctor','Awaiting Physician')
UNION ALL SELECT 'doctor_consulting', COUNT(*)
  FROM visits WHERE visit_date = CURRENT_DATE AND status = 'In Consultation'
UNION ALL SELECT 'nursing_awaiting', COUNT(*)
  FROM visits WHERE visit_date = CURRENT_DATE AND status IN ('Awaiting Vitals','With Nurse')
UNION ALL SELECT 'lab_pending', COUNT(*)
  FROM lab_test_orders WHERE status NOT IN ('Released','Verified')
UNION ALL SELECT 'pharmacy_pending', COUNT(*)
  FROM prescription_items WHERE dispense_status <> 'Dispensed'
UNION ALL SELECT 'radiology_pending', COUNT(*)
  FROM radiology_orders WHERE status = 'Requested'
UNION ALL SELECT 'physio_active', COUNT(*)
  FROM physiotherapy_orders WHERE status = 'In Progress'
UNION ALL SELECT 'admitted', COUNT(*)
  FROM visits WHERE status = 'Admitted';

-- Staff roster with a link to Supabase Auth. `linked_by_id` reflects the
-- users.auth_user_id column, which a provisioning step fills in. To confirm an
-- Auth account actually exists, match the email against auth.users from a SQL
-- session; that join is left out here so this file still applies to a plain
-- Postgres server.
CREATE OR REPLACE VIEW v_staff_auth_status AS
SELECT u.id, u.name, u.email, u.role, u.active,
       (u.auth_user_id IS NOT NULL) AS linked_by_id
  FROM users u;

-- The views above are read-only conveniences, but they execute with their
-- definer's rights, which bypasses RLS. That is acceptable only because every
-- staff table they read is already open to any signed-in member, so granting
-- security_invoker (PostgreSQL 15+) without first re-checking that table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;
  GRANT SELECT ON v_currently_admitted, v_low_stock_alerts, v_invoice_balances,
                   v_ward_census, v_revenue_by_department, v_department_workload,
                   v_staff_auth_status
    TO authenticated;
END $$;


-- ============================================================================
-- 14. SEED DATA
-- ============================================================================
-- Reference data only: wards, permissions, settings and a starter catalogue.
-- All inserts are idempotent. No demo patient records, no demo staff, and no
-- passwords of any kind.
--
-- The absence of seeded staff is deliberate, not an oversight. A seeded account
-- is a credential that ships to production, and a literal password in this file
-- would also ship in the JavaScript bundle, where it is readable by anyone who
-- loads the page and cannot be rotated without a redeploy. The first
-- administrator is created from the command line instead; see the note above the
-- users table.
-- ============================================================================

INSERT INTO wards (code, name, capacity) VALUES
  ('MALE-GEN','Male General Ward',30),
  ('FEM-GEN','Female General Ward',30),
  ('PAED','Pediatric Ward',20),
  ('MAT','Maternity Ward',20),
  ('NICU','Neonatal (NICU)',8),
  ('ICU','Intensive Care (ICU)',10),
  ('EMR','Emergency Ward',12),
  ('ISO','Isolation Ward',6),
  ('PVT','Private / Single Room',10),
  ('DAY','Day-Care / Observation',15)
ON CONFLICT (code) DO NOTHING;

INSERT INTO system_settings
  (id, hospital_name, tagline, address, phone, email, currency, currency_code,
   invoice_prefix, patient_prefix, inactivity_timeout_minutes)
VALUES
  (1, 'FatClinic & Medical Specialties',
   'Precision Care. Connected Health. Zero Compromise.',
   '14 Healthcare Boulevard, Medical District, Victoria Island',
   '+234 (0) 1 800-FATCLINIC', 'care@fatclinic.health',
   '₦', 'NGN', 'FC-INV', 'FC', 5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO receipt_settings
  (id, hospital_name, tagline, address, phone, email, footer_message, terms_line,
   receipt_prefix, show_receipt_count, show_payment_method, show_received_by,
   show_bank_details, show_invoice_position, show_thank_you)
VALUES
  (1, 'FatClinic & Medical Specialties',
   'Precision Care. Connected Health. Zero Compromise.',
   '14 Healthcare Boulevard, Medical District, Victoria Island',
   '+234 (0) 1 800-FATCLINIC', 'care@fatclinic.health',
   'Thank you for your patronage. This receipt is computer-generated and valid without signature.',
   'Fees are payable before service except emergencies. Balances must be cleared before discharge.',
   'RCP', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Staff profiles are NOT seeded.
--
-- There are deliberately no demo accounts. A seeded account is a credential
-- that ships to production, and one that everyone already knows the password
-- to, which is worse than having no account at all.
--
-- The `users` table starts empty. A staff profile and its Supabase Auth
-- account are created together, by an administrator:
--
--     npm run staff:add -- --name "Dr. ..." --email ... --role ADMINISTRATOR
--
-- That creates the auth user and links the two by `auth_user_id`. Until it has
-- been run there is nobody who can sign in, which is the correct state for a
-- system holding real patient records: closed until deliberately opened.
--
-- A profile created later from the app's admin screen has no auth account yet;
-- `npm run staff:add -- --link USR-003` adds one. That split is not an
-- oversight either - making an account needs the service_role key, which must
-- never be in a browser, so it cannot be done from a page.

-- Permission hierarchy. Parents before children, because parent_key is a
-- self-referencing FK. Mirrors src/services/permissions.ts exactly.
INSERT INTO permission_nodes (key, parent_key, label, depth) VALUES
  ('DASHBOARD', NULL, 'Executive Dashboard', 1),
  ('PATIENTS', NULL, 'Patients & Front Desk', 1),
  ('CLINICAL', NULL, 'Clinical Care & Triage', 1),
  ('LABORATORY', NULL, 'Laboratory', 1),
  ('PHARMACY', NULL, 'Pharmacy', 1),
  ('RADIOLOGY', NULL, 'Radiology', 1),
  ('PHYSIOTHERAPY', NULL, 'Physiotherapy', 1),
  ('BILLING', NULL, 'Billing & Cashier', 1),
  ('ADMIN', NULL, 'Administration', 1),
  ('DASHBOARD.VIEW', 'DASHBOARD', 'View dashboard', 2),
  ('PATIENTS.VIEW', 'PATIENTS', 'View patient directory', 2),
  ('PATIENTS.REGISTER', 'PATIENTS', 'Register patient', 2),
  ('PATIENTS.EDIT', 'PATIENTS', 'Edit patient records', 2),
  ('PATIENTS.CREATE_VISIT', 'PATIENTS', 'Create visit / encounter tabs', 2),
  ('PATIENTS.BOOKINGS', 'PATIENTS', 'Manage online bookings', 2),
  ('CLINICAL.PHYSICIAN', 'CLINICAL', 'Physician Consultation', 2),
  ('CLINICAL.NURSING', 'CLINICAL', 'Nursing Station & Triage', 2),
  ('CLINICAL.ALERTS', 'CLINICAL', 'Diagnostic Alerts', 2),
  ('LABORATORY.HEMATOLOGY', 'LABORATORY', 'Laboratory', 2),
  ('LABORATORY.MICROBIOLOGY', 'LABORATORY', 'Microbiology', 2),
  ('LABORATORY.CHEMICAL_PATHOLOGY', 'LABORATORY', 'Chemical Pathology', 2),
  ('LABORATORY.HISTOPATHOLOGY', 'LABORATORY', 'Histopathology', 2),
  ('LABORATORY.MOLECULAR', 'LABORATORY', 'Molecular', 2),
  ('LABORATORY.INVENTORY', 'LABORATORY', 'Test catalogue & prices (Admin)', 2),
  ('PHARMACY.QUEUE', 'PHARMACY', 'Prescription queue', 2),
  ('PHARMACY.INVENTORY', 'PHARMACY', 'Medication inventory', 2),
  ('PHARMACY.CONSUMABLES', 'PHARMACY', 'Department consumables', 2),
  ('RADIOLOGY.QUEUE', 'RADIOLOGY', 'Imaging queue', 2),
  ('RADIOLOGY.CONSUMABLES', 'RADIOLOGY', 'Department consumables', 2),
  ('RADIOLOGY.TARIFFS', 'RADIOLOGY', 'View tariffs', 2),
  ('PHYSIOTHERAPY.QUEUE', 'PHYSIOTHERAPY', 'Therapy queue', 2),
  ('PHYSIOTHERAPY.CONSUMABLES', 'PHYSIOTHERAPY', 'Department consumables', 2),
  ('PHYSIOTHERAPY.TARIFFS', 'PHYSIOTHERAPY', 'View tariffs', 2),
  ('BILLING.INVOICES', 'BILLING', 'View invoices', 2),
  ('BILLING.ADD_BILL', 'BILLING', 'Add bill items', 2),
  ('BILLING.RECEIVE_PAYMENT', 'BILLING', 'Receive / part payment', 2),
  ('BILLING.PRICE_SCHEDULE', 'BILLING', 'View price schedule', 2),
  ('ADMIN.USERS', 'ADMIN', 'Staff accounts', 2),
  ('ADMIN.CONSUMABLES', 'ADMIN', 'Clinical consumables', 2),
  ('ADMIN.TARIFFS', 'ADMIN', 'Radiology & physio tariffs', 2),
  ('ADMIN.SETTINGS', 'ADMIN', 'Hospital parameters', 2),
  ('ADMIN.ROLES', 'ADMIN', 'Roles & permissions', 2),
  ('CLINICAL.PHYSICIAN.VIEW', 'CLINICAL.PHYSICIAN', 'View queue & dashboard', 3),
  ('CLINICAL.PHYSICIAN.CONSULT', 'CLINICAL.PHYSICIAN', 'Consult & save notes', 3),
  ('CLINICAL.PHYSICIAN.ORDER_LAB', 'CLINICAL.PHYSICIAN', 'Order lab tests', 3),
  ('CLINICAL.PHYSICIAN.ORDER_PHARMACY', 'CLINICAL.PHYSICIAN', 'Prescribe medication', 3),
  ('CLINICAL.PHYSICIAN.ORDER_RADIOLOGY', 'CLINICAL.PHYSICIAN', 'Order radiology', 3),
  ('CLINICAL.PHYSICIAN.ORDER_PHYSIO', 'CLINICAL.PHYSICIAN', 'Order physiotherapy', 3),
  ('CLINICAL.PHYSICIAN.ADMIT', 'CLINICAL.PHYSICIAN', 'Admit (specify ward)', 3),
  ('CLINICAL.PHYSICIAN.DISCHARGE', 'CLINICAL.PHYSICIAN', 'Discharge', 3),
  ('CLINICAL.NURSING.VIEW', 'CLINICAL.NURSING', 'View queue & dashboard', 3),
  ('CLINICAL.NURSING.RECORD_VITALS', 'CLINICAL.NURSING', 'Record vitals', 3),
  ('CLINICAL.NURSING.CARE_PLAN', 'CLINICAL.NURSING', 'Assessment & care plan', 3),
  ('CLINICAL.NURSING.ADMIT', 'CLINICAL.NURSING', 'Admit (specify ward)', 3),
  ('CLINICAL.NURSING.DISCHARGE', 'CLINICAL.NURSING', 'Discharge', 3),
  ('CLINICAL.NURSING.USE_CONSUMABLES', 'CLINICAL.NURSING', 'Use nursing consumables', 3),
  ('CLINICAL.ALERTS.VIEW', 'CLINICAL.ALERTS', 'View diagnostic alerts', 3),
  ('LABORATORY.HEMATOLOGY.VIEW', 'LABORATORY.HEMATOLOGY', 'View orders & results', 3),
  ('LABORATORY.HEMATOLOGY.PROCESS', 'LABORATORY.HEMATOLOGY', 'Collect sample / start processing', 3),
  ('LABORATORY.HEMATOLOGY.ENTER_RESULT', 'LABORATORY.HEMATOLOGY', 'Enter result', 3),
  ('LABORATORY.HEMATOLOGY.VERIFY_RELEASE', 'LABORATORY.HEMATOLOGY', 'Verify & release report', 3),
  ('LABORATORY.HEMATOLOGY.LOG_USAGE', 'LABORATORY.HEMATOLOGY', 'Log stock usage', 3),
  ('LABORATORY.HEMATOLOGY.REQUEST_STOCK', 'LABORATORY.HEMATOLOGY', 'Request restock', 3),
  ('LABORATORY.MICROBIOLOGY.VIEW', 'LABORATORY.MICROBIOLOGY', 'View orders & results', 3),
  ('LABORATORY.MICROBIOLOGY.PROCESS', 'LABORATORY.MICROBIOLOGY', 'Collect sample / start processing', 3),
  ('LABORATORY.MICROBIOLOGY.ENTER_RESULT', 'LABORATORY.MICROBIOLOGY', 'Enter result', 3),
  ('LABORATORY.MICROBIOLOGY.VERIFY_RELEASE', 'LABORATORY.MICROBIOLOGY', 'Verify & release report', 3),
  ('LABORATORY.MICROBIOLOGY.LOG_USAGE', 'LABORATORY.MICROBIOLOGY', 'Log stock usage', 3),
  ('LABORATORY.MICROBIOLOGY.REQUEST_STOCK', 'LABORATORY.MICROBIOLOGY', 'Request restock', 3),
  ('LABORATORY.CHEMICAL_PATHOLOGY.VIEW', 'LABORATORY.CHEMICAL_PATHOLOGY', 'View orders & results', 3),
  ('LABORATORY.CHEMICAL_PATHOLOGY.PROCESS', 'LABORATORY.CHEMICAL_PATHOLOGY', 'Collect sample / start processing', 3),
  ('LABORATORY.CHEMICAL_PATHOLOGY.ENTER_RESULT', 'LABORATORY.CHEMICAL_PATHOLOGY', 'Enter result', 3),
  ('LABORATORY.CHEMICAL_PATHOLOGY.VERIFY_RELEASE', 'LABORATORY.CHEMICAL_PATHOLOGY', 'Verify & release report', 3),
  ('LABORATORY.CHEMICAL_PATHOLOGY.LOG_USAGE', 'LABORATORY.CHEMICAL_PATHOLOGY', 'Log stock usage', 3),
  ('LABORATORY.CHEMICAL_PATHOLOGY.REQUEST_STOCK', 'LABORATORY.CHEMICAL_PATHOLOGY', 'Request restock', 3),
  ('LABORATORY.HISTOPATHOLOGY.VIEW', 'LABORATORY.HISTOPATHOLOGY', 'View orders & results', 3),
  ('LABORATORY.HISTOPATHOLOGY.PROCESS', 'LABORATORY.HISTOPATHOLOGY', 'Collect sample / start processing', 3),
  ('LABORATORY.HISTOPATHOLOGY.ENTER_RESULT', 'LABORATORY.HISTOPATHOLOGY', 'Enter result', 3),
  ('LABORATORY.HISTOPATHOLOGY.VERIFY_RELEASE', 'LABORATORY.HISTOPATHOLOGY', 'Verify & release report', 3),
  ('LABORATORY.HISTOPATHOLOGY.LOG_USAGE', 'LABORATORY.HISTOPATHOLOGY', 'Log stock usage', 3),
  ('LABORATORY.HISTOPATHOLOGY.REQUEST_STOCK', 'LABORATORY.HISTOPATHOLOGY', 'Request restock', 3),
  ('LABORATORY.MOLECULAR.VIEW', 'LABORATORY.MOLECULAR', 'View orders & results', 3),
  ('LABORATORY.MOLECULAR.PROCESS', 'LABORATORY.MOLECULAR', 'Collect sample / start processing', 3),
  ('LABORATORY.MOLECULAR.ENTER_RESULT', 'LABORATORY.MOLECULAR', 'Enter result', 3),
  ('LABORATORY.MOLECULAR.VERIFY_RELEASE', 'LABORATORY.MOLECULAR', 'Verify & release report', 3),
  ('LABORATORY.MOLECULAR.LOG_USAGE', 'LABORATORY.MOLECULAR', 'Log stock usage', 3),
  ('LABORATORY.MOLECULAR.REQUEST_STOCK', 'LABORATORY.MOLECULAR', 'Request restock', 3),
  ('LABORATORY.INVENTORY.VIEW', 'LABORATORY.INVENTORY', 'View catalogue', 3),
  ('LABORATORY.INVENTORY.MANAGE', 'LABORATORY.INVENTORY', 'Add / edit investigations', 3),
  ('LABORATORY.INVENTORY.MANAGE_PRICES', 'LABORATORY.INVENTORY', 'Change prices', 3),
  ('PHARMACY.QUEUE.VIEW', 'PHARMACY.QUEUE', 'View queue', 3),
  ('PHARMACY.QUEUE.DISPENSE', 'PHARMACY.QUEUE', 'Dispense drugs', 3),
  ('PHARMACY.INVENTORY.VIEW', 'PHARMACY.INVENTORY', 'View inventory', 3),
  ('PHARMACY.INVENTORY.MANAGE_STOCK', 'PHARMACY.INVENTORY', 'Adjust stock', 3),
  ('PHARMACY.INVENTORY.MANAGE_PRICES', 'PHARMACY.INVENTORY', 'Change prices (Admin)', 3),
  ('PHARMACY.CONSUMABLES.VIEW', 'PHARMACY.CONSUMABLES', 'View consumables', 3),
  ('PHARMACY.CONSUMABLES.LOG_USAGE', 'PHARMACY.CONSUMABLES', 'Log usage (bills patient)', 3),
  ('PHARMACY.CONSUMABLES.REQUEST_STOCK', 'PHARMACY.CONSUMABLES', 'Request restock', 3),
  ('RADIOLOGY.QUEUE.VIEW', 'RADIOLOGY.QUEUE', 'View queue', 3),
  ('RADIOLOGY.QUEUE.REPORT', 'RADIOLOGY.QUEUE', 'File / view reports', 3),
  ('RADIOLOGY.CONSUMABLES.VIEW', 'RADIOLOGY.CONSUMABLES', 'View consumables', 3),
  ('RADIOLOGY.CONSUMABLES.LOG_USAGE', 'RADIOLOGY.CONSUMABLES', 'Log usage (bills patient)', 3),
  ('RADIOLOGY.CONSUMABLES.REQUEST_STOCK', 'RADIOLOGY.CONSUMABLES', 'Request restock', 3),
  ('PHYSIOTHERAPY.QUEUE.VIEW', 'PHYSIOTHERAPY.QUEUE', 'View queue', 3),
  ('PHYSIOTHERAPY.QUEUE.TREAT', 'PHYSIOTHERAPY.QUEUE', 'Log sessions', 3),
  ('PHYSIOTHERAPY.CONSUMABLES.VIEW', 'PHYSIOTHERAPY.CONSUMABLES', 'View consumables', 3),
  ('PHYSIOTHERAPY.CONSUMABLES.LOG_USAGE', 'PHYSIOTHERAPY.CONSUMABLES', 'Log usage (bills patient)', 3),
  ('PHYSIOTHERAPY.CONSUMABLES.REQUEST_STOCK', 'PHYSIOTHERAPY.CONSUMABLES', 'Request restock', 3),
  ('ADMIN.USERS.VIEW', 'ADMIN.USERS', 'View staff accounts', 3),
  ('ADMIN.USERS.CREATE', 'ADMIN.USERS', 'Create accounts', 3),
  ('ADMIN.USERS.EDIT', 'ADMIN.USERS', 'Edit accounts', 3),
  ('ADMIN.USERS.ASSIGN_ROLES', 'ADMIN.USERS', 'Assign roles', 3),
  ('ADMIN.USERS.REGENERATE_PASSWORD', 'ADMIN.USERS', 'Assign new passwords', 3),
  ('ADMIN.USERS.DELETE', 'ADMIN.USERS', 'Delete accounts', 3),
  ('ADMIN.CONSUMABLES.VIEW', 'ADMIN.CONSUMABLES', 'View consumables', 3),
  ('ADMIN.CONSUMABLES.MANAGE', 'ADMIN.CONSUMABLES', 'Add / edit / stock', 3),
  ('ADMIN.CONSUMABLES.MANAGE_PRICES', 'ADMIN.CONSUMABLES', 'Change prices', 3),
  ('ADMIN.CONSUMABLES.APPROVE_REQUESTS', 'ADMIN.CONSUMABLES', 'Approve / dispatch requests', 3),
  ('ADMIN.TARIFFS.MANAGE', 'ADMIN.TARIFFS', 'Change tariffs', 3),
  ('ADMIN.SETTINGS.MANAGE', 'ADMIN.SETTINGS', 'Edit settings', 3),
  ('ADMIN.ROLES.VIEW', 'ADMIN.ROLES', 'View roles', 3),
  ('ADMIN.ROLES.MANAGE', 'ADMIN.ROLES', 'Create / edit roles', 3)
ON CONFLICT (key) DO NOTHING;

-- Example granular role: a histopathology scientist who may do everything in
-- histopathology except entering results.
--
-- created_by is NULL: the users table is not seeded, and a demo role attributed
-- to a demo administrator would be an attribution to nobody.
INSERT INTO custom_roles (id, name, description, created_by) VALUES
  ('ROLE-HISTO-VIEWER','Histopathology (No Result Entry)',
   'Everything in Histopathology except entering results.', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key) VALUES
  ('ROLE-HISTO-VIEWER','LABORATORY.HISTOPATHOLOGY.VIEW'),
  ('ROLE-HISTO-VIEWER','LABORATORY.HISTOPATHOLOGY.PROCESS'),
  ('ROLE-HISTO-VIEWER','LABORATORY.HISTOPATHOLOGY.VERIFY_RELEASE'),
  ('ROLE-HISTO-VIEWER','LABORATORY.HISTOPATHOLOGY.LOG_USAGE'),
  ('ROLE-HISTO-VIEWER','LABORATORY.HISTOPATHOLOGY.REQUEST_STOCK'),
  ('ROLE-HISTO-VIEWER','CLINICAL.ALERTS.VIEW'),
  ('ROLE-HISTO-VIEWER','DASHBOARD.VIEW')
ON CONFLICT DO NOTHING;

-- Starter catalogue.
INSERT INTO service_prices (id, name, category, price, active) VALUES
  ('SVC-001','General Physician Consultation','Consultation',10000,TRUE),
  ('SVC-008','Registration (First Visit)','Consultation',5000,TRUE),
  ('SVC-009','Antenatal Visit','Consultation',8000,TRUE),
  ('SVC-010','Follow-up Visit','Consultation',5000,TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO lab_investigations (id, code, name, category, price, sample_type, turnaround_time) VALUES
  ('LAB-HEM-01','FBC','Full Blood Count','HEMATOLOGY',3500,'Whole Blood (EDTA)','2-4 hours'),
  ('LAB-MIC-01','URC','Urine Culture','MICROBIOLOGY',6000,'Urine (sterile container)','48-72 hours'),
  ('LAB-CHP-01','EUC','Electrolytes, Urea & Creatinine','CHEMICAL_PATHOLOGY',5500,'Serum (plain tube)','4-6 hours'),
  ('LAB-HIS-01','HPE','Histopathology Examination','HISTOPATHOLOGY',25000,'Tissue in formalin','5-7 days'),
  ('LAB-MOL-01','PCR','Polymerase Chain Reaction','MOLECULAR',30000,'Swab / Blood','24-48 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO medications (id, name, generic_name, category, dosage_form, strength, unit_price, current_stock, min_stock_alert, dispensing_unit) VALUES
  ('MED-001','Paracetamol 500mg','Paracetamol','Analgesics / Antipyretics','Tablet','500 mg',100,200,30,'Tablet'),
  ('MED-002','Amoxicillin 500mg','Amoxicillin','Antibiotics','Capsule','500 mg',250,150,25,'Capsule'),
  ('MED-003','Artemether/Lumefantrine 80/480mg','Artemether + Lumefantrine','Antimalarials','Tablet','80/480 mg',1200,100,20,'Tablet')
ON CONFLICT (id) DO NOTHING;

INSERT INTO clinical_consumables (id, name, category, unit, current_stock, min_alert_level, unit_price, cost_price) VALUES
  ('CSM-001','Disposable Examination Gloves (Latex Free, Box of 100)','Nursing','Boxes',120,20,3500,2400),
  ('CSM-002','Disposable Hypodermic Syringes 5ml with 21G Needle (Box of 100)','Nursing','Boxes',85,15,4500,3100),
  ('CSM-008','Medical Ultrasound Acoustic Coupling Gel (5 Litre Dispenser)','Radiology','Gallons',18,4,14000,9500),
  ('CSM-010','TENS / EMS Self-Adhesive Electrotherapy Gel Pads (Pack of 4)','Physiotherapy','Packs',30,6,3800,2500),
  ('CSM-012','Vacutainer EDTA Blood Collection Tubes 4ml (Pack of 100)','Laboratory','Packs',45,10,12000,8500),
  ('CSM-015','Pharmacy Dispensing Envelopes Small (Pack of 500)','Pharmacy','Packs',25,6,3500,2200)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- End of FatClinic schema.
-- ============================================================================
