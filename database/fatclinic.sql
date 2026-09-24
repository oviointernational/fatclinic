-- ============================================================================
-- FatClinic EHR — Complete Database Schema (PostgreSQL 14+)
-- ============================================================================
-- Single-file schema for EVERYTHING in the FatClinic workstation:
--   staff accounts (DB-controlled, no self-registration) + granular custom
--   roles & permissions tree, patients, visits/encounters (with ward
--   admission), vitals, consultations, lab (5 departments, orders, results,
--   stock), pharmacy (formulary, prescriptions, dispensing, drug reorder
--   requests), radiology, physiotherapy, clinical consumables (all sections
--   incl. Laboratory & Pharmacy) with requests + usage logs, unified billing
--   (invoices, items, payments/receipts), online bookings, audit log, system
--   settings, receipt settings, wards.
--
-- Apply with:  psql -U <user> -d <db> -f database/fatclinic.sql
--
-- SECURITY NOTE: passwords below are demo seeds. In production, store only
-- salted hashes (e.g. bcrypt via pgcrypto crypt()) and force rotation.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- Lookup: wards (admission requires a ward)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wards (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  capacity    INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Nested access-control tree (explicit hierarchy IN the database).
-- A grant on a parent key (e.g. 'LABORATORY') implies everything beneath it;
-- revoking one leaf (e.g. 'LABORATORY.HISTOPATHOLOGY.ENTER_RESULT') keeps
-- every sibling granted. Mirrors src/services/permissions.ts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_nodes (
  key         TEXT PRIMARY KEY,                        -- e.g. 'LABORATORY.HEMATOLOGY.PROCESS'
  parent_key  TEXT REFERENCES permission_nodes(key) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  depth       INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 4),
  CONSTRAINT valid_permission_key CHECK (key ~ '^[A-Z][A-Z0-9]*(\.[A-Z][A-Z0-9]*)*$')
);
CREATE INDEX IF NOT EXISTS idx_perm_parent ON permission_nodes(parent_key);

-- ----------------------------------------------------------------------------
-- Granular custom roles + nested permission tree grants.
-- role_permissions.permission_key is FK-bound to permission_nodes, so only
-- keys that exist in the hierarchy can ever be granted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_roles (
  id          TEXT PRIMARY KEY,                        -- e.g. 'ROLE-...'
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,                                    -- FK to users() added below (cycle-safe)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        TEXT NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permission_nodes(key) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by     TEXT,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_key ON role_permissions(permission_key);

-- ----------------------------------------------------------------------------
-- Staff accounts — entirely database controlled.
-- No self-registration: rows are inserted by direct SQL or by Administration.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,               -- e.g. 'USR-001'
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  role                 TEXT NOT NULL CHECK (role IN (
                         'ADMINISTRATOR','PHYSICIAN','NURSE','LAB_SCIENTIST',
                         'PHARMACIST','RADIOLOGIST','PHYSIOTHERAPIST',
                         'FRONT_DESK','BILLING_OFFICER')),
  department           TEXT NOT NULL DEFAULT '',
  avatar               TEXT NOT NULL DEFAULT '',
  pin                  CHAR(4) NOT NULL DEFAULT '1234' CHECK (pin ~ '^[0-9]{4}$'),
  password             TEXT NOT NULL,                  -- demo seed; hash in prod
  custom_role_id       TEXT REFERENCES custom_roles(id) ON DELETE SET NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

-- ----------------------------------------------------------------------------
-- Patients
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id                TEXT PRIMARY KEY,                  -- hospital number e.g. 'FC-2026-00101'
  first_name        TEXT NOT NULL,
  middle_name       TEXT,
  last_name         TEXT NOT NULL,
  dob               DATE NOT NULL,
  age               INTEGER NOT NULL CHECK (age >= 0),
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
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patients_name  ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

-- ----------------------------------------------------------------------------
-- Visits / encounter tabs (ward admission lives here)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visits (
  id                     TEXT PRIMARY KEY,             -- e.g. 'VIS-2026-001'
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
  CONSTRAINT admitted_requires_ward CHECK (
    status <> 'Admitted' OR ward IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_visits_status  ON visits(status, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_visits_ward    ON visits(ward) WHERE status = 'Admitted';

-- ----------------------------------------------------------------------------
-- Vitals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vitals (
  id                TEXT PRIMARY KEY,
  visit_id          TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id        TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  nurse_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  nurse_name        TEXT NOT NULL DEFAULT '',
  temperature_c     NUMERIC(4,1) NOT NULL,
  systolic_bp       INTEGER NOT NULL,
  diastolic_bp      INTEGER NOT NULL,
  pulse_bpm         INTEGER NOT NULL,
  respiratory_rate  INTEGER NOT NULL,
  spo2_pct          INTEGER NOT NULL CHECK (spo2_pct BETWEEN 0 AND 100),
  weight_kg         NUMERIC(5,1) NOT NULL,
  height_m          NUMERIC(4,2) NOT NULL,
  bmi               NUMERIC(4,1) NOT NULL,
  bmi_category      TEXT NOT NULL,
  pain_score        INTEGER CHECK (pain_score BETWEEN 0 AND 10),
  nursing_notes     TEXT,
  nursing_care_plan TEXT,
  nursing_procedures TEXT[] NOT NULL DEFAULT '{}',
  alerts            TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_vitals_visit ON vitals(visit_id);

-- ----------------------------------------------------------------------------
-- Consultations + ICD-10 diagnoses
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultations (
  id                          TEXT PRIMARY KEY,
  visit_id                    TEXT NOT NULL UNIQUE REFERENCES visits(id) ON DELETE CASCADE,
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
  clinical_notes              TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clinical_diagnoses (
  id             TEXT PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,                             -- ICD-10 e.g. 'B50.9'
  description    TEXT NOT NULL,
  diag_type      TEXT NOT NULL CHECK (diag_type IN ('Primary','Secondary'))
);
CREATE INDEX IF NOT EXISTS idx_diagnoses_consult ON clinical_diagnoses(consultation_id);

-- ----------------------------------------------------------------------------
-- Laboratory catalogue (5 departments), parameters, orders, results
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_investigations (
  id              TEXT PRIMARY KEY,                        -- e.g. 'LAB-HEM-01'
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
                    'HEMATOLOGY','MICROBIOLOGY','CHEMICAL_PATHOLOGY',
                    'HISTOPATHOLOGY','MOLECULAR')),
  price           NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  sample_type     TEXT NOT NULL DEFAULT '',
  turnaround_time TEXT NOT NULL DEFAULT '',
  description     TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_lab_inv_category ON lab_investigations(category);

CREATE TABLE IF NOT EXISTS lab_parameters (
  id               TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES lab_investigations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL DEFAULT '',
  reference_range  TEXT NOT NULL DEFAULT '',
  result_type      TEXT NOT NULL CHECK (result_type IN ('numeric','text','select','reactive')),
  options          TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS lab_requests (
  id                 TEXT PRIMARY KEY,
  visit_id           TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id         TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  physician_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  physician_name     TEXT NOT NULL DEFAULT '',
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  priority           TEXT NOT NULL CHECK (priority IN ('Routine','Urgent','STAT')),
  clinical_indication TEXT,
  payment_status     TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid','Paid')),
  total_price        NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lab_req_patient ON lab_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_req_visit   ON lab_requests(visit_id);

CREATE TABLE IF NOT EXISTS lab_test_orders (
  id               TEXT PRIMARY KEY,
  request_id       TEXT NOT NULL REFERENCES lab_requests(id) ON DELETE CASCADE,
  test_definition_id TEXT REFERENCES lab_investigations(id) ON DELETE SET NULL,
  test_name        TEXT NOT NULL,
  category         TEXT NOT NULL,
  price            NUMERIC(12,2) NOT NULL,
  sample_type      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL CHECK (status IN (
                     'Requested','Paid','Sample Collected','Processing',
                     'Result Entered','Verified','Released')),
  collected_at     TIMESTAMPTZ,
  scientist_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  scientist_name   TEXT,
  verified_by      TEXT,
  released_at      TIMESTAMPTZ,
  comments         TEXT,
  critical_alert   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_test_orders(status, category);

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

-- ----------------------------------------------------------------------------
-- Pharmacy: formulary + prescriptions + dispensing
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medications (
  id              TEXT PRIMARY KEY,                        -- e.g. 'MED-001'
  name            TEXT NOT NULL,
  generic_name    TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT '',
  dosage_form     TEXT NOT NULL DEFAULT '',
  strength        TEXT NOT NULL DEFAULT '',
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  current_stock   INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  min_stock_alert INTEGER NOT NULL DEFAULT 0,
  dispensing_unit TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_meds_name ON medications(name);

CREATE TABLE IF NOT EXISTS prescriptions (
  id             TEXT PRIMARY KEY,
  visit_id       TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id     TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  physician_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  physician_name TEXT NOT NULL DEFAULT '',
  prescribed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL CHECK (status IN ('Pending','Partially Dispensed','Completed','Cancelled')),
  total_price    NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id);

CREATE TABLE IF NOT EXISTS prescription_items (
  id                   TEXT PRIMARY KEY,
  prescription_id      TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medication_id        TEXT REFERENCES medications(id) ON DELETE SET NULL,
  medication_name      TEXT NOT NULL,
  dosage               TEXT NOT NULL DEFAULT '',
  route                TEXT NOT NULL DEFAULT '',
  frequency            TEXT NOT NULL DEFAULT '',
  duration             TEXT NOT NULL DEFAULT '',
  quantity_prescribed  INTEGER NOT NULL CHECK (quantity_prescribed > 0),
  quantity_dispensed   INTEGER NOT NULL DEFAULT 0,
  unit_price           NUMERIC(12,2) NOT NULL,
  total_price          NUMERIC(12,2) NOT NULL,
  instructions         TEXT NOT NULL DEFAULT '',
  dispense_status      TEXT NOT NULL CHECK (dispense_status IN ('Pending','Dispensed','Partially Dispensed','Out of Stock')),
  pharmacist_notes     TEXT
);

-- ----------------------------------------------------------------------------
-- Service price list (Master Pricing Matrix — Administration only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_prices (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL CHECK (category IN (
                   'Consultation','Laboratory','Pharmacy','Nursing','Procedure','Other')),
  price          NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ----------------------------------------------------------------------------
-- Unified billing: one invoice per visit, part payments, receipts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,                        -- e.g. 'FC-INV-2026-001'
  visit_id        TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id      TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance         NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status  TEXT NOT NULL CHECK (payment_status IN ('Unpaid','Partially Paid','Paid','Refunded')),
  require_prepayment BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (visit_id)
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status  ON invoices(payment_status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id               TEXT PRIMARY KEY,
  invoice_id       TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  service_category TEXT NOT NULL,
  description      TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price       NUMERIC(12,2) NOT NULL,
  total_price      NUMERIC(12,2) NOT NULL,
  reference_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id                    TEXT PRIMARY KEY,                  -- e.g. 'PMT-...'
  invoice_id            TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  receipt_number        TEXT NOT NULL UNIQUE,              -- e.g. 'RCP-2026-1001'
  paid_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method        TEXT NOT NULL CHECK (payment_method IN ('Cash','Transfer','POS','Card','Insurance')),
  received_by           TEXT NOT NULL DEFAULT '',
  bank_name             TEXT,
  transaction_reference TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- ----------------------------------------------------------------------------
-- Online bookings / pre-registration codes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS online_bookings (
  id                    TEXT PRIMARY KEY,
  patient_code          TEXT NOT NULL UNIQUE,              -- e.g. 'REG-7821'
  first_name            TEXT NOT NULL,
  middle_name           TEXT,
  last_name             TEXT NOT NULL,
  dob                   DATE NOT NULL,
  age                   INTEGER NOT NULL,
  sex                   TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  email                 TEXT,
  address               TEXT NOT NULL DEFAULT '',
  reason_for_appointment TEXT NOT NULL DEFAULT '',
  preferred_date        DATE NOT NULL,
  preferred_time        TEXT NOT NULL DEFAULT '',
  booked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                TEXT NOT NULL CHECK (status IN ('Pending Arrival','Completed','Cancelled'))
);

-- ----------------------------------------------------------------------------
-- Laboratory bench stock (reagents, tubes, kits, stains)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_stock_items (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('Reagents','Consumables','Tubes','Kits','Stains')),
  current_stock   INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  unit            TEXT NOT NULL DEFAULT '',
  unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_alert_level INTEGER NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS lab_stock_requests (
  id                 TEXT PRIMARY KEY,
  item_id            TEXT REFERENCES lab_stock_items(id) ON DELETE SET NULL,
  item_name          TEXT NOT NULL,
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  requested_by       TEXT NOT NULL DEFAULT '',
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL CHECK (status IN ('Pending','Approved','Dispatched')),
  urgency            TEXT NOT NULL CHECK (urgency IN ('Routine','Urgent'))
);

-- ----------------------------------------------------------------------------
-- Radiology + Physiotherapy orders
-- ----------------------------------------------------------------------------
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
  price              NUMERIC(12,2) NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('Requested','Completed','Report Ready')),
  invoice_id         TEXT REFERENCES invoices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_radio_patient ON radiology_orders(patient_id);

CREATE TABLE IF NOT EXISTS physiotherapy_orders (
  id                 TEXT PRIMARY KEY,
  visit_id           TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id         TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  ordered_by         TEXT NOT NULL DEFAULT '',
  ordered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  service_name       TEXT NOT NULL,
  category           TEXT CHECK (category IN ('Musculoskeletal','Neurological','Sports','Pediatric','General')),
  sessions           INTEGER NOT NULL CHECK (sessions > 0),
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  progress_notes     TEXT,
  treated_by         TEXT,
  last_session_date  DATE,
  price              NUMERIC(12,2) NOT NULL,
  clinical_indication TEXT,
  status             TEXT NOT NULL CHECK (status IN ('Requested','In Progress','Completed')),
  invoice_id         TEXT REFERENCES invoices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_physio_patient ON physiotherapy_orders(patient_id);

-- ----------------------------------------------------------------------------
-- Clinical consumables — every section incl. Laboratory & Pharmacy.
-- Sections request / log usage; usage subtracts stock and may bill a visit.
-- Only Administration changes prices (app-level rule).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinical_consumables (
  id              TEXT PRIMARY KEY,                        -- e.g. 'CSM-001'
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
                    'Nursing','Consultation','Surgical','Emergency','Radiology',
                    'Physiotherapy','Laboratory','Pharmacy','General')),
  unit            TEXT NOT NULL DEFAULT '',
  current_stock   INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  min_alert_level INTEGER NOT NULL DEFAULT 0,
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consumables_category ON clinical_consumables(category);

CREATE TABLE IF NOT EXISTS consumable_requests (
  id                 TEXT PRIMARY KEY,
  consumable_id      TEXT REFERENCES clinical_consumables(id) ON DELETE SET NULL,
  consumable_name    TEXT NOT NULL,
  section            TEXT NOT NULL DEFAULT 'General',
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  requested_by       TEXT NOT NULL DEFAULT '',
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL CHECK (status IN ('Pending','Approved','Dispatched')),
  urgency            TEXT NOT NULL CHECK (urgency IN ('Routine','Urgent'))
);
CREATE INDEX IF NOT EXISTS idx_consumable_req_status ON consumable_requests(status);

CREATE TABLE IF NOT EXISTS consumable_usage (
  id            TEXT PRIMARY KEY,
  consumable_id TEXT REFERENCES clinical_consumables(id) ON DELETE SET NULL,
  consumable_name TEXT NOT NULL,
  section       TEXT NOT NULL DEFAULT 'General',
  quantity_used INTEGER NOT NULL CHECK (quantity_used > 0),
  unit_price    NUMERIC(12,2) NOT NULL,
  total_charge  NUMERIC(12,2) NOT NULL,
  used_by       TEXT NOT NULL DEFAULT '',
  used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  patient_id    TEXT REFERENCES patients(id) ON DELETE SET NULL,
  visit_id      TEXT REFERENCES visits(id) ON DELETE SET NULL,
  invoice_id    TEXT REFERENCES invoices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_consumable_usage_section ON consumable_usage(section, used_at DESC);

-- ----------------------------------------------------------------------------
-- Pharmacy drug reorder requests (unique Stock Requests page).
-- Dispatching adds the quantity back into formulary stock.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medication_requests (
  id                 TEXT PRIMARY KEY,
  medication_id      TEXT REFERENCES medications(id) ON DELETE SET NULL,
  medication_name    TEXT NOT NULL,
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  requested_by       TEXT NOT NULL DEFAULT '',
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL CHECK (status IN ('Pending','Approved','Dispatched')),
  urgency            TEXT NOT NULL CHECK (urgency IN ('Routine','Urgent'))
);
CREATE INDEX IF NOT EXISTS idx_medication_req_status ON medication_requests(status);

-- ----------------------------------------------------------------------------
-- Immutable audit log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT NOT NULL DEFAULT '',
  user_role   TEXT NOT NULL DEFAULT '',
  patient_id  TEXT REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT,
  action      TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('PATIENT','CLINICAL','LABORATORY','PHARMACY','BILLING','ADMIN')),
  details     TEXT NOT NULL DEFAULT '',
  metadata    JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_patient ON audit_logs(patient_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs(action, logged_at DESC);

-- ----------------------------------------------------------------------------
-- System settings (single row)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  hospital_name            TEXT NOT NULL DEFAULT 'FatClinic & Medical Specialties',
  tagline                  TEXT NOT NULL DEFAULT '',
  address                  TEXT NOT NULL DEFAULT '',
  phone                    TEXT NOT NULL DEFAULT '',
  email                    TEXT NOT NULL DEFAULT '',
  currency                 TEXT NOT NULL DEFAULT '₦',
  currency_code            TEXT NOT NULL DEFAULT 'NGN',
  invoice_prefix           TEXT NOT NULL DEFAULT 'FC-INV',
  patient_prefix           TEXT NOT NULL DEFAULT 'FC',
  inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 5
);

-- ----------------------------------------------------------------------------
-- Receipt settings (single row) — every printed receipt/invoice detail.
-- Edited in Administration → Receipt Settings; consumed by all print outputs.
-- ----------------------------------------------------------------------------
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

-- ============================================================================
-- DATABASE AUTOMATION — timestamps, immutability, integrity, invoice maths.
-- Guarantees that anything entered (app or direct SQL) is stored cleanly.
-- ============================================================================

-- updated_at columns (idempotent for existing installs)
ALTER TABLE patients            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE visits              ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE consultations       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE medications         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE lab_investigations  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE service_prices      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE invoices            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE clinical_consumables ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE lab_stock_items     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE prescriptions       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE lab_requests        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE receipt_settings    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Auto-touch updated_at on every change
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['users','patients','visits','consultations','medications',
    'lab_investigations','service_prices','invoices','clinical_consumables',
    'lab_stock_items','prescriptions','lab_requests','custom_roles','receipt_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%s ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_touch_%s BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;

-- Audit log is immutable: no UPDATE or DELETE, ever
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable: rows can only be INSERTed (attempted % on id=%)', TG_OP, COALESCE(OLD.id, NEW.id);
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_logs;
CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- Invoice maths in the database (mirrors the app formula exactly):
-- subtotal = SUM(items), total = subtotal - discount,
-- paid = SUM(payments), balance = total - paid, status derived.
CREATE OR REPLACE FUNCTION recalc_invoice(p_invoice_id TEXT) RETURNS void AS $$
DECLARE
  v_sub    NUMERIC(12,2);
  v_disc   NUMERIC(12,2);
  v_paid   NUMERIC(12,2);
  v_total  NUMERIC(12,2);
  v_bal    NUMERIC(12,2);
  v_status TEXT;
BEGIN
  SELECT COALESCE(SUM(total_price), 0) INTO v_sub  FROM invoice_items WHERE invoice_id = p_invoice_id;
  SELECT COALESCE(discount, 0)          INTO v_disc FROM invoices      WHERE id = p_invoice_id;
  SELECT COALESCE(SUM(amount), 0)       INTO v_paid FROM payments       WHERE invoice_id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_total  := GREATEST(0, v_sub - v_disc);
  v_bal    := GREATEST(0, v_total - v_paid);
  v_status := CASE
                WHEN v_paid >= v_total AND v_total > 0 THEN 'Paid'
                WHEN v_paid > 0 THEN 'Partially Paid'
                ELSE 'Unpaid'
              END;
  UPDATE invoices
     SET subtotal = v_sub, total = v_total, paid_amount = v_paid,
         balance = v_bal, payment_status = v_status
   WHERE id = p_invoice_id;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_invoice_child_changed() RETURNS trigger AS $$
BEGIN
  PERFORM recalc_invoice(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_items_math ON invoice_items;
CREATE TRIGGER trg_invoice_items_math
  AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_child_changed();

DROP TRIGGER IF EXISTS trg_payments_math ON payments;
CREATE TRIGGER trg_payments_math
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_child_changed();

-- Extra domain CHECKs (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_items_category') THEN
    ALTER TABLE invoice_items ADD CONSTRAINT chk_invoice_items_category
      CHECK (service_category IN ('Consultation','Laboratory','Pharmacy','Nursing','Procedure','Other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lab_orders_category') THEN
    ALTER TABLE lab_test_orders ADD CONSTRAINT chk_lab_orders_category
      CHECK (category IN ('HEMATOLOGY','MICROBIOLOGY','CHEMICAL_PATHOLOGY','HISTOPATHOLOGY','MOLECULAR'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rx_item_qty') THEN
    ALTER TABLE prescription_items ADD CONSTRAINT chk_rx_item_qty
      CHECK (quantity_dispensed >= 0 AND quantity_dispensed <= quantity_prescribed);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_booking_sex') THEN
    ALTER TABLE online_bookings ADD CONSTRAINT chk_booking_sex
      CHECK (sex IN ('Male','Female','Other'));
  END IF;
  -- Cycle-safe FK: custom_roles.created_by -> users(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_custom_roles_created_by') THEN
    ALTER TABLE custom_roles ADD CONSTRAINT fk_custom_roles_created_by
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Extra covering indexes
CREATE INDEX IF NOT EXISTS idx_lab_results_order   ON lab_results(test_order_id);
CREATE INDEX IF NOT EXISTS idx_rx_items_rx         ON prescription_items(prescription_id);
CREATE INDEX IF NOT EXISTS idx_consumable_use_pt   ON consumable_usage(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_stock_req_status ON lab_stock_requests(status);
CREATE INDEX IF NOT EXISTS idx_visits_created      ON visits(created_at DESC);

-- ----------------------------------------------------------------------------
-- Operational views
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_currently_admitted AS
SELECT v.id AS visit_id, v.patient_id,
       p.first_name || ' ' || p.last_name AS patient_name,
       v.ward, v.admitted_at, v.admitted_by, v.visit_date
FROM visits v JOIN patients p ON p.id = v.patient_id
WHERE v.status = 'Admitted';

CREATE OR REPLACE VIEW v_low_stock_alerts AS
SELECT 'medication' AS kind, id, name, current_stock, min_stock_alert AS min_level, unit_price
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
FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
GROUP BY i.id;

CREATE OR REPLACE VIEW v_ward_census AS
SELECT COALESCE(v.ward, 'Unspecified ward') AS ward,
       COUNT(*) AS inpatients,
       MAX(w.capacity) AS capacity
FROM visits v LEFT JOIN wards w ON w.code = v.ward
WHERE v.status = 'Admitted'
GROUP BY COALESCE(v.ward, 'Unspecified ward')
ORDER BY inpatients DESC;

CREATE OR REPLACE VIEW v_revenue_by_department AS
SELECT service_category AS department,
       COUNT(*) AS lines,
       COALESCE(SUM(total_price), 0) AS billed
FROM invoice_items
GROUP BY service_category
ORDER BY billed DESC;

-- Department workload snapshot (doctor / nursing / lab / pharmacy / imaging)
CREATE OR REPLACE VIEW v_department_workload AS
SELECT 'doctor_awaiting' AS bucket, COUNT(*) AS n FROM visits
 WHERE visit_date = CURRENT_DATE AND status IN ('With Doctor','Awaiting Physician')
UNION ALL
SELECT 'doctor_consulting', COUNT(*) FROM visits
 WHERE visit_date = CURRENT_DATE AND status = 'In Consultation'
UNION ALL
SELECT 'nursing_awaiting', COUNT(*) FROM visits
 WHERE visit_date = CURRENT_DATE AND status IN ('Awaiting Vitals','With Nurse')
UNION ALL
SELECT 'lab_pending', COUNT(*) FROM lab_test_orders WHERE status NOT IN ('Released','Verified')
UNION ALL
SELECT 'pharmacy_pending', COUNT(*) FROM prescription_items WHERE dispense_status <> 'Dispensed'
UNION ALL
SELECT 'radiology_pending', COUNT(*) FROM radiology_orders WHERE status = 'Requested'
UNION ALL
SELECT 'physio_active', COUNT(*) FROM physiotherapy_orders WHERE status = 'In Progress'
UNION ALL
SELECT 'admitted', COUNT(*) FROM visits WHERE status = 'Admitted';

-- ============================================================================
-- SEED DATA (demo credentials — rotate immediately in production)
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

-- Staff accounts (DB-controlled; default password 'FatClinic123')
INSERT INTO users (id, name, email, role, department, avatar, pin, password, active) VALUES
  ('USR-001','Dr. Johnathan Adeleke','adeleke@fatclinic.health','PHYSICIAN','Internal Medicine & Clinical Care','👨‍⚕️','1234','FatClinic123',TRUE),
  ('USR-002','Dr. Sarah Alabi','alabi@fatclinic.health','ADMINISTRATOR','Executive Administration & Quality Assurance','👩‍💼','1234','FatClinic123',TRUE),
  ('USR-003','Nurse Ngozi Eze','ngozi@fatclinic.health','NURSE','Triage & Inpatient Nursing','👩‍⚕️','1234','FatClinic123',TRUE),
  ('USR-004','Scientist Ibrahim Bello, MLS','ibrahim@fatclinic.health','LAB_SCIENTIST','Diagnostic Laboratory Services','🔬','1234','FatClinic123',TRUE),
  ('USR-005','Pharm. Kemi Ojo, BPharm','kemi@fatclinic.health','PHARMACIST','Clinical Pharmacy & Therapeutics','💊','1234','FatClinic123',TRUE),
  ('USR-006','Tayo Ogundipe','tayo@fatclinic.health','FRONT_DESK','Patient Services & Admissions','📋','1234','FatClinic123',TRUE),
  ('USR-007','Emeka Nwosu','emeka@fatclinic.health','BILLING_OFFICER','Accounts & Revenue Cycle','💳','1234','FatClinic123',TRUE),
  ('USR-008','Dr. Chinedu Okafor','chinedu.rad@fatclinic.health','RADIOLOGIST','Radiology & Imaging','🩻','1234','FatClinic123',TRUE),
  ('USR-009','PT. Amina Yusuf, BPT','amina.pt@fatclinic.health','PHYSIOTHERAPIST','Physiotherapy & Rehabilitation','🏃‍♀️','1234','FatClinic123',TRUE)
ON CONFLICT (id) DO NOTHING;

-- Permission hierarchy seed (parents before children for the self-FK).
-- Mirrors src/services/permissions.ts exactly.
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
  ('LABORATORY.HEMATOLOGY', 'LABORATORY', 'Hematology', 2),
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

-- Example granular role: Histopathology scientist who may do everything in
-- Histopathology EXCEPT entering results.
INSERT INTO custom_roles (id, name, description, created_by) VALUES
  ('ROLE-HISTO-VIEWER','Histopathology (No Result Entry)',
   'Everything in Histopathology except entering results.', 'USR-002')
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

-- Sample price schedule / catalogue rows
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

-- End of FatClinic schema.
