/**
 * Row mapping and diff sync between the camelCase in-memory model and the
 * snake_case Postgres schema.
 *
 * WHY THIS SHAPE
 * --------------
 * `db.ts` exposes 101 synchronous methods that read and write plain arrays, and
 * persists through two functions: `loadStorage(key, fallback)` and
 * `saveStorage(key, value)`. Rewriting every method to be async, or replacing
 * localStorage with a reactive store, would touch every call site in the app and
 * every component that re-renders off `notify()`.
 *
 * So the translation lives here instead, at that seam, and nowhere else:
 *
 *   loadStorage  ->  read the server once, asynchronously, and adopt it
 *   saveStorage  ->  diff the previous value against the new one, push the delta
 *
 * WHY A DIFF AND NOT AN OVERWRITE
 * ------------------------------
 * `saveStorage` receives a whole collection. Sending that verbatim would be a
 * full-table upsert on every keystroke-level change, and a "delete what is not
 * in this array" rule would be actively dangerous: clinical history is
 * append-mostly, `audit_logs` and `payments` are a record that must not be
 * rewritten, and a partially-loaded array would cascade-delete real records.
 * The diff is computed against the previous value of the same collection, so
 * only genuinely new, changed and removed rows are sent.
 *
 * WHO OWNS WHICH COLUMN
 * ---------------------
 * - `created_at` / `updated_at` are server-managed by trigger; the client never
 *   sends them.
 * - Invoice money columns are server-managed by `recalc_invoice()`. The client
 *   writes `discount` and the line items, and reads the totals back. Sending a
 *   client-computed `total` would overwrite the database's arithmetic with
 *   whatever the browser believed, which is the wrong direction of trust for
 *   money.
 * - `users.password` does not exist in the schema. Credentials belong to
 *   Supabase Auth, so the field is dropped on the way out and never hydrated.
 *
 * ORDERING
 * --------
 * Foreign keys mean order matters. `patients` before `visits`, `visits` before
 * `vitals`, and so on. Each map carries an `order`, and the bootstrap push walks
 * them in ascending order. Within one `saveStorage` call the parent is written
 * before its children, so the foreign key it introduces already exists.
 */
import type {
  AuditLog,
  ClinicalConsumable,
  ClinicalDiagnosis,
  ConsumableStockRequest,
  ConsumableUsageLog,
  CustomRole,
  Invoice,
  InvoiceItem,
  LabInvestigationDefinition,
  LabParameterTemplate,
  LabRequest,
  LabResultValue,
  LabStockItem,
  LabStockRequest,
  LabTestOrder,
  Medication,
  MedicationRequest,
  OnlineBooking,
  Patient,
  PaymentRecord,
  PhysiotherapyOrder,
  Prescription,
  PrescriptionItem,
  RadiologyOrder,
  ReceiptSettings,
  ServicePriceItem,
  SystemSettings,
  User,
  Visit,
  Vitals,
} from '../types';
import { getSupabase } from './supabase';

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

/**
 * PostgREST returns every `NUMERIC` as a JSON string, to avoid the precision loss
 * that a float64 round-trip would cause. The TypeScript model uses `number`, so
 * every numeric column is converted on read. Doing it here rather than at 200
 * call sites is the reason a single mapper can be trusted.
 */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nullableNum = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

/** Optional text columns are `TEXT` with no default, so they arrive as null. */
const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const optText = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);

/** `TIMESTAMPTZ` arrives as an ISO-8601 string with a timezone offset. */
const optTime = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

/** `DATE` arrives as 'YYYY-MM-DD'. The model stores the same shape. */
const date = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const optDate = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

/** Postgres arrays arrive as JSON arrays; a null is possible on a loose column. */
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** A model stores `undefined` for "not set"; Postgres wants NULL, not a string. */
const orNull = <T>(v: T | undefined | null): T | null =>
  v === undefined || v === null ? null : (v as T);

/**
 * A foreign key value, or NULL.
 *
 * The model types a nullable reference as `string` and spells "unset" as an empty
 * string, because that is what the UI binds to. Postgres does not accept that
 * translation: '' is a real value, and a foreign key check against it fails. So a
 * consultation recorded without a physician assigned, or a lab request with no
 * physician on it, would fail to save - and would do so as a constraint violation
 * rather than as anything a clinician could understand.
 *
 * Every column that is a foreign key goes through here, never `orNull`, so the
 * distinction is made in one place.
 */
const fk = (v: string | undefined | null): string | null =>
  v === undefined || v === null || v === '' ? null : v;

// ---------------------------------------------------------------------------
// Map shapes
// ---------------------------------------------------------------------------

/** A nested array that lives in its own table, keyed by a single foreign key. */
interface ChildMap {
  /** SQL table. */
  table: string;
  /** Column on the child pointing at the parent row. */
  fk: string;
  /** Upsert conflict target. Defaults to 'id'. */
  conflict?: string;
  /**
   * Name of the model property holding the array, e.g. 'tests' for
   * lab_test_orders. Declared here rather than derived from the table name so a
   * mismatch is a compile error, not a silently empty push.
   */
  property: string;
  /**
   * Identity of one child within its parent, used to diff. This is the
   * *model's* identity and need not match the table's primary key.
   */
  keyOf: (item: any) => string;
  /**
   * The table's primary key value for a child, given its parent's id. Needed
   * because the two can differ: lab_results is keyed by `parameter_id` in the
   * model but its row id is the composite `<test_order_id>::<parameter_id>`,
   * so a delete has to be able to reconstruct the value it did not send.
   */
  dbKeyOf: (item: any, parentId: string) => string;
  rowToModel: (row: Record<string, any>) => unknown;
  /** `parentId` is injected as the foreign key; the model does not carry it. */
  modelToRow: (item: any, parentId: string) => Record<string, unknown>;
  /** Columns the database maintains; never sent by the client. */
  omit?: string[];
  /** Grandchildren, e.g. lab_results hanging off lab_test_orders. */
  children?: ChildMap[];
}

interface TableMap {
  /** The `STORAGE_KEYS` entry this collection is persisted under. */
  key: string;
  table: string;
  /** Ascending dependency order for the bootstrap push. */
  order: number;
  /** Single-row table pinned to id = 1 (system_settings, receipt_settings). */
  single?: boolean;
  /** Insert only: no UPDATE or DELETE policy, and a trigger that raises. */
  appendOnly?: boolean;
  rowToModel: (row: Record<string, any>) => unknown;
  modelToRow: (model: any) => Record<string, unknown>;
  omit?: string[];
  children?: ChildMap[];
  /**
   * Columns the database recomputes. Listed here so a future edit that adds one
   * to `modelToRow` is caught by the check in `assertNoDbOwnedColumns` rather
   * than silently overwriting server arithmetic.
   */
  dbOwned?: string[];
  /**
   * Columns re-sent after children are written, so the last recalculation runs
   * against the final subtotal. Needed for `invoices.discount`: the trigger
   * clamps discount to the subtotal, so a discount written before a line item
   * is removed would be clamped away and never restored.
   */
  settle?: string[];
}

const SERVER_MANAGED = ['created_at', 'updated_at'];

// ---------------------------------------------------------------------------
// Table maps
// ---------------------------------------------------------------------------

export const TABLES: TableMap[] = [
  {
    key: 'fatclinic_settings',
    table: 'system_settings',
    order: 10,
    single: true,
    // id is sent, not omitted: it is a PRIMARY KEY with no DEFAULT and a CHECK
    // that pins it to 1, so a row without it violates NOT NULL on insert.
    omit: SERVER_MANAGED,
    rowToModel: (r): SystemSettings => ({
      hospitalName: text(r.hospital_name),
      tagline: text(r.tagline),
      address: text(r.address),
      phone: text(r.phone),
      email: text(r.email),
      currency: text(r.currency),
      currencyCode: text(r.currency_code),
      invoicePrefix: text(r.invoice_prefix),
      patientPrefix: text(r.patient_prefix),
      inactivityTimeoutMinutes: num(r.inactivity_timeout_minutes),
    }),
    modelToRow: (m: SystemSettings) => ({
      id: 1,
      hospital_name: m.hospitalName,
      tagline: m.tagline,
      address: m.address,
      phone: m.phone,
      email: m.email,
      currency: m.currency,
      currency_code: m.currencyCode,
      invoice_prefix: m.invoicePrefix,
      patient_prefix: m.patientPrefix,
      inactivity_timeout_minutes: m.inactivityTimeoutMinutes,
    }),
  },

  {
    // created_by points at users, and users.custom_role_id points back here.
    // Pushing roles first breaks the cycle for seeded data, and a role created
    // at runtime is always created by a user who already exists.
    key: 'fatclinic_custom_roles',
    table: 'custom_roles',
    order: 20,
    omit: SERVER_MANAGED,
    rowToModel: (r): CustomRole => ({
      id: text(r.id),
      name: text(r.name),
      description: text(r.description),
      createdAt: optTime(r.created_at) ?? '',
      createdBy: text(r.created_by),
      permissions: [],
    }),
    modelToRow: (m: CustomRole) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? '',
      created_by: fk(m.createdBy),
    }),
    children: [
      {
        table: 'role_permissions',
        fk: 'role_id',
        property: 'permissions',
        conflict: 'role_id,permission_key',
        omit: ['granted_at'],
        // A grant is a bare string in the model: CustomRole.permissions.
        keyOf: (p) => String(p),
        // The primary key is composite, so deletes filter on permission_key
        // within one role rather than on a single id column.
        dbKeyOf: (p: string) => String(p),
        rowToModel: (r) => text(r.permission_key),
        modelToRow: (p: string, roleId: string) => ({
          role_id: roleId,
          permission_key: p,
        }),
      },
    ],
  },

  {
    key: 'fatclinic_users',
    table: 'users',
    order: 30,
    // `password` is deliberately absent: public.users has no such column and
    // credentials belong to Supabase Auth. Reading it back would also be a
    // silent failure, because the column does not exist to read.
    omit: [...SERVER_MANAGED, 'auth_user_id'],
    rowToModel: (r): User => ({
      id: text(r.id),
      name: text(r.name),
      email: text(r.email),
      role: text(r.role) as User['role'],
      department: text(r.department),
      avatar: text(r.avatar),
      pin: text(r.pin),
      // Supabase owns the password, so there is nothing truthful to put here.
      // AuthContext reads the session, not this field.
      password: '',
      customRoleId: optText(r.custom_role_id),
      mustChangePassword: Boolean(r.must_change_password),
      active: Boolean(r.active),
    }),
    modelToRow: (m: User) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      department: m.department ?? '',
      avatar: m.avatar ?? '',
      pin: m.pin || '1234',
      custom_role_id: fk(m.customRoleId),
      must_change_password: Boolean(m.mustChangePassword),
      active: m.active !== false,
    }),
  },

  {
    key: 'fatclinic_patients',
    table: 'patients',
    order: 40,
    omit: SERVER_MANAGED,
    rowToModel: (r): Patient => ({
      id: text(r.id),
      firstName: text(r.first_name),
      middleName: optText(r.middle_name),
      lastName: text(r.last_name),
      dob: date(r.dob),
      age: num(r.age),
      sex: text(r.sex) as Patient['sex'],
      phone: text(r.phone),
      email: optText(r.email),
      address: text(r.address),
      nextOfKin: text(r.next_of_kin),
      emergencyContact: text(r.emergency_contact),
      occupation: optText(r.occupation),
      bloodGroup: optText(r.blood_group),
      genotype: optText(r.genotype),
      allergies: list(r.allergies),
      alerts: list(r.alerts),
      registeredAt: optTime(r.registered_at) ?? '',
    }),
    modelToRow: (m: Patient) => ({
      id: m.id,
      first_name: m.firstName,
      middle_name: orNull(m.middleName),
      last_name: m.lastName,
      dob: m.dob,
      age: m.age,
      sex: m.sex,
      phone: m.phone,
      email: orNull(m.email),
      address: m.address ?? '',
      next_of_kin: m.nextOfKin ?? '',
      emergency_contact: m.emergencyContact ?? '',
      occupation: orNull(m.occupation),
      blood_group: orNull(m.bloodGroup),
      genotype: orNull(m.genotype),
      allergies: m.allergies ?? [],
      alerts: m.alerts ?? [],
      registered_at: orNull(m.registeredAt),
    }),
  },

  {
    key: 'fatclinic_visits',
    table: 'visits',
    order: 50,
    omit: SERVER_MANAGED,
    // `ward` holds a wards.code, which is what the model stores. The display
    // name is resolved by wardName() at render time, so nothing to translate.
    rowToModel: (r): Visit => ({
      id: text(r.id),
      patientId: text(r.patient_id),
      visitDate: date(r.visit_date),
      visitTime: text(r.visit_time),
      visitType: text(r.visit_type) as Visit['visitType'],
      status: text(r.status) as Visit['status'],
      attendingPhysicianId: optText(r.attending_physician_id),
      attendingNurseId: optText(r.attending_nurse_id),
      reasonForVisit: optText(r.reason_for_visit),
      notes: optText(r.notes),
      ward: optText(r.ward),
      admittedAt: optTime(r.admitted_at),
      admittedBy: optText(r.admitted_by),
      dischargedAt: optTime(r.discharged_at),
    }),
    modelToRow: (m: Visit) => ({
      id: m.id,
      patient_id: m.patientId,
      visit_date: m.visitDate,
      visit_time: m.visitTime || '00:00',
      visit_type: m.visitType,
      status: m.status,
      attending_physician_id: fk(m.attendingPhysicianId),
      attending_nurse_id: fk(m.attendingNurseId),
      reason_for_visit: orNull(m.reasonForVisit),
      notes: orNull(m.notes),
      ward: fk(m.ward),
      admitted_at: orNull(m.admittedAt),
      admitted_by: orNull(m.admittedBy),
      discharged_at: orNull(m.dischargedAt),
    }),
  },

  {
    key: 'fatclinic_vitals',
    table: 'vitals',
    order: 60,
    omit: SERVER_MANAGED,
    // The unit suffixes in the schema are deliberate and are carried through
    // unchanged: temperature_c is degrees Celsius, spo2_pct is a percentage.
    rowToModel: (r): Vitals => ({
      id: text(r.id),
      visitId: text(r.visit_id),
      patientId: text(r.patient_id),
      recordedAt: optTime(r.recorded_at) ?? '',
      nurseId: text(r.nurse_id),
      nurseName: text(r.nurse_name),
      temperature: num(r.temperature_c),
      systolicBp: num(r.systolic_bp),
      diastolicBp: num(r.diastolic_bp),
      pulse: num(r.pulse_bpm),
      respiratoryRate: num(r.respiratory_rate),
      spo2: num(r.spo2_pct),
      weight: num(r.weight_kg),
      height: num(r.height_m),
      bmi: num(r.bmi),
      bmiCategory: text(r.bmi_category) as Vitals['bmiCategory'],
      painScore: nullableNum(r.pain_score),
      nursingNotes: optText(r.nursing_notes),
      nursingCarePlan: optText(r.nursing_care_plan),
      nursingProcedures: list(r.nursing_procedures),
      alerts: list(r.alerts),
    }),
    modelToRow: (m: Vitals) => ({
      id: m.id,
      visit_id: m.visitId,
      patient_id: m.patientId,
      recorded_at: orNull(m.recordedAt),
      nurse_id: fk(m.nurseId),
      nurse_name: m.nurseName ?? '',
      temperature_c: m.temperature,
      systolic_bp: m.systolicBp,
      diastolic_bp: m.diastolicBp,
      pulse_bpm: m.pulse,
      respiratory_rate: m.respiratoryRate,
      spo2_pct: m.spo2,
      weight_kg: m.weight,
      height_m: m.height,
      bmi: m.bmi,
      bmi_category: m.bmiCategory,
      pain_score: orNull(m.painScore),
      nursing_notes: orNull(m.nursingNotes),
      nursing_care_plan: orNull(m.nursingCarePlan),
      nursing_procedures: m.nursingProcedures ?? [],
      alerts: m.alerts ?? [],
    }),
  },

  {
    key: 'fatclinic_consultations',
    table: 'consultations',
    order: 70,
    omit: SERVER_MANAGED,
    // physicalExamination is nested in the model and flattened into seven
    // columns here; diagnoses move to clinical_diagnoses as a child table.
    rowToModel: (r) => ({
      id: text(r.id),
      visitId: text(r.visit_id),
      patientId: text(r.patient_id),
      physicianId: text(r.physician_id),
      physicianName: text(r.physician_name),
      consultationDate: optTime(r.consultation_date) ?? '',
      presentingComplaint: text(r.presenting_complaint),
      historyOfPresentingComplaint: text(r.history_presenting_complaint),
      pastMedicalHistory: text(r.past_medical_history),
      surgicalHistory: text(r.surgical_history),
      drugHistory: text(r.drug_history),
      familyHistory: text(r.family_history),
      socialHistory: text(r.social_history),
      allergyHistory: text(r.allergy_history),
      physicalExamination: {
        general: text(r.exam_general),
        cardiovascular: text(r.exam_cardiovascular),
        respiratory: text(r.exam_respiratory),
        abdomen: text(r.exam_abdomen),
        neurological: text(r.exam_neurological),
        musculoskeletal: text(r.exam_musculoskeletal),
        other: text(r.exam_other),
      },
      clinicalFindings: text(r.clinical_findings),
      assessment: text(r.assessment),
      diagnoses: [],
      plan: text(r.plan),
      followUpDate: optDate(r.follow_up_date),
      clinicalNotes: text(r.clinical_notes),
    }),
    modelToRow: (m) => {
      const exam = m.physicalExamination ?? {};
      return {
        id: m.id,
        visit_id: m.visitId,
        patient_id: m.patientId,
        physician_id: fk(m.physicianId),
        physician_name: m.physicianName ?? '',
        consultation_date: orNull(m.consultationDate),
        presenting_complaint: m.presentingComplaint ?? '',
        history_presenting_complaint: m.historyOfPresentingComplaint ?? '',
        past_medical_history: m.pastMedicalHistory ?? '',
        surgical_history: m.surgicalHistory ?? '',
        drug_history: m.drugHistory ?? '',
        family_history: m.familyHistory ?? '',
        social_history: m.socialHistory ?? '',
        allergy_history: m.allergyHistory ?? '',
        exam_general: exam.general ?? '',
        exam_cardiovascular: exam.cardiovascular ?? '',
        exam_respiratory: exam.respiratory ?? '',
        exam_abdomen: exam.abdomen ?? '',
        exam_neurological: exam.neurological ?? '',
        exam_musculoskeletal: exam.musculoskeletal ?? '',
        exam_other: exam.other ?? '',
        clinical_findings: m.clinicalFindings ?? '',
        assessment: m.assessment ?? '',
        plan: m.plan ?? '',
        follow_up_date: orNull(m.followUpDate),
        clinical_notes: m.clinicalNotes ?? '',
      };
    },
    children: [
      {
        table: 'clinical_diagnoses',
        fk: 'consultation_id',
        property: 'diagnoses',
        keyOf: (d: ClinicalDiagnosis) => d.id,
        dbKeyOf: (d: ClinicalDiagnosis) => d.id,
        rowToModel: (r): ClinicalDiagnosis => ({
          id: text(r.id),
          code: text(r.code),
          description: text(r.description),
          type: text(r.diag_type) as ClinicalDiagnosis['type'],
        }),
        modelToRow: (d: ClinicalDiagnosis, consultationId: string) => ({
          id: d.id,
          consultation_id: consultationId,
          code: d.code,
          description: d.description,
          diag_type: d.type,
        }),
      },
    ],
  },

  {
    key: 'fatclinic_lab_defs',
    table: 'lab_investigations',
    order: 80,
    omit: SERVER_MANAGED,
    rowToModel: (r): LabInvestigationDefinition => ({
      id: text(r.id),
      code: text(r.code),
      name: text(r.name),
      category: text(r.category) as LabInvestigationDefinition['category'],
      price: num(r.price),
      sampleType: text(r.sample_type),
      turnaroundTime: text(r.turnaround_time),
      parameters: [],
      description: optText(r.description),
    }),
    modelToRow: (m: LabInvestigationDefinition) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      category: m.category,
      price: m.price,
      sample_type: m.sampleType ?? '',
      turnaround_time: m.turnaroundTime ?? '',
      description: orNull(m.description),
    }),
    children: [
      {
        table: 'lab_parameters',
        fk: 'investigation_id',
        property: 'parameters',
        keyOf: (p: LabParameterTemplate) => p.id,
        dbKeyOf: (p: LabParameterTemplate) => p.id,
        rowToModel: (r): LabParameterTemplate => ({
          id: text(r.id),
          name: text(r.name),
          unit: text(r.unit),
          referenceRange: text(r.reference_range),
          resultType: text(r.result_type) as LabParameterTemplate['resultType'],
          options: list(r.options),
        }),
        modelToRow: (p: LabParameterTemplate, investigationId: string) => ({
          id: p.id,
          investigation_id: investigationId,
          name: p.name,
          unit: p.unit ?? '',
          reference_range: p.referenceRange ?? '',
          result_type: p.resultType,
          options: p.options ?? [],
        }),
      },
    ],
  },

  {
    key: 'fatclinic_lab_requests',
    table: 'lab_requests',
    order: 90,
    omit: SERVER_MANAGED,
    rowToModel: (r): LabRequest => ({
      id: text(r.id),
      visitId: text(r.visit_id),
      patientId: text(r.patient_id),
      physicianId: text(r.physician_id),
      physicianName: text(r.physician_name),
      requestedAt: optTime(r.requested_at) ?? '',
      priority: text(r.priority) as LabRequest['priority'],
      clinicalIndication: optText(r.clinical_indication),
      tests: [],
      paymentStatus: text(r.payment_status) as LabRequest['paymentStatus'],
      totalPrice: num(r.total_price),
    }),
    modelToRow: (m: LabRequest) => ({
      id: m.id,
      visit_id: m.visitId,
      patient_id: m.patientId,
      physician_id: fk(m.physicianId),
      physician_name: m.physicianName ?? '',
      requested_at: orNull(m.requestedAt),
      priority: m.priority,
      clinical_indication: orNull(m.clinicalIndication),
      payment_status: m.paymentStatus,
      total_price: m.totalPrice,
    }),
    children: [
      {
        table: 'lab_test_orders',
        fk: 'request_id',
        property: 'tests',
        keyOf: (t: LabTestOrder) => t.id,
        dbKeyOf: (t: LabTestOrder) => t.id,
        omit: SERVER_MANAGED,
        rowToModel: (r): LabTestOrder => ({
          id: text(r.id),
          testDefinitionId: text(r.test_definition_id),
          testName: text(r.test_name),
          category: text(r.category) as LabTestOrder['category'],
          price: num(r.price),
          sampleType: text(r.sample_type),
          status: text(r.status) as LabTestOrder['status'],
          collectedAt: optTime(r.collected_at),
          scientistId: optText(r.scientist_id),
          scientistName: optText(r.scientist_name),
          verifiedBy: optText(r.verified_by),
          releasedAt: optTime(r.released_at),
          results: [],
          comments: optText(r.comments),
          criticalAlert: Boolean(r.critical_alert),
        }),
        modelToRow: (t: LabTestOrder, requestId: string) => ({
          id: t.id,
          request_id: requestId,
          test_definition_id: fk(t.testDefinitionId),
          test_name: t.testName,
          category: t.category,
          price: t.price,
          sample_type: t.sampleType ?? '',
          status: t.status,
          collected_at: orNull(t.collectedAt),
          scientist_id: fk(t.scientistId),
          scientist_name: orNull(t.scientistName),
          verified_by: fk(t.verifiedBy),
          released_at: orNull(t.releasedAt),
          comments: orNull(t.comments),
          critical_alert: Boolean(t.criticalAlert),
        }),
        // lab_results.parameter_id is deliberately not a foreign key, so a
        // locally-defined parameter still records a result.
        children: [
          {
            table: 'lab_results',
            fk: 'test_order_id',
            property: 'results',
            // A result is identified by its parameter, not by a row id: the
            // model has no id, and re-running a test replaces the value for that
            // parameter rather than adding a second result.
            keyOf: (r: LabResultValue) => r.parameterId,
            // The table's primary key is the composite, so a delete has to
            // rebuild it from the parent id it was not handed.
            dbKeyOf: (r: LabResultValue, testOrderId: string) =>
              `${testOrderId}::${r.parameterId}`,
            rowToModel: (r): LabResultValue => ({
              parameterId: text(r.parameter_id),
              parameterName: text(r.parameter_name),
              value: text(r.value),
              unit: text(r.unit),
              referenceRange: text(r.reference_range),
              flag: text(r.flag) as LabResultValue['flag'],
            }),
            modelToRow: (r: LabResultValue, testOrderId: string) => ({
              id: `${testOrderId}::${r.parameterId}`,
              test_order_id: testOrderId,
              parameter_id: r.parameterId,
              parameter_name: r.parameterName,
              value: r.value ?? '',
              unit: r.unit ?? '',
              reference_range: r.referenceRange ?? '',
              flag: r.flag,
            }),
          },
        ],
      },
    ],
  },

  {
    key: 'fatclinic_medications',
    table: 'medications',
    order: 100,
    omit: SERVER_MANAGED,
    rowToModel: (r): Medication => ({
      id: text(r.id),
      name: text(r.name),
      genericName: text(r.generic_name),
      category: text(r.category),
      dosageForm: text(r.dosage_form),
      strength: text(r.strength),
      unitPrice: num(r.unit_price),
      currentStock: num(r.current_stock),
      minStockAlert: num(r.min_stock_alert),
      dispensingUnit: text(r.dispensing_unit),
    }),
    modelToRow: (m: Medication) => ({
      id: m.id,
      name: m.name,
      generic_name: m.genericName ?? '',
      category: m.category ?? '',
      dosage_form: m.dosageForm ?? '',
      strength: m.strength ?? '',
      unit_price: m.unitPrice,
      current_stock: m.currentStock ?? 0,
      min_stock_alert: m.minStockAlert ?? 0,
      dispensing_unit: m.dispensingUnit ?? '',
    }),
  },

  {
    key: 'fatclinic_prescriptions',
    table: 'prescriptions',
    order: 110,
    omit: SERVER_MANAGED,
    rowToModel: (r): Prescription => ({
      id: text(r.id),
      visitId: text(r.visit_id),
      patientId: text(r.patient_id),
      physicianId: text(r.physician_id),
      physicianName: text(r.physician_name),
      prescribedAt: optTime(r.prescribed_at) ?? '',
      status: text(r.status) as Prescription['status'],
      items: [],
      totalPrice: num(r.total_price),
    }),
    modelToRow: (m: Prescription) => ({
      id: m.id,
      visit_id: m.visitId,
      patient_id: m.patientId,
      physician_id: fk(m.physicianId),
      physician_name: m.physicianName ?? '',
      prescribed_at: orNull(m.prescribedAt),
      status: m.status,
      total_price: m.totalPrice,
    }),
    children: [
      {
        table: 'prescription_items',
        fk: 'prescription_id',
        property: 'items',
        keyOf: (i: PrescriptionItem) => i.id,
        dbKeyOf: (i: PrescriptionItem) => i.id,
        omit: SERVER_MANAGED,
        rowToModel: (r): PrescriptionItem => ({
          id: text(r.id),
          medicationId: text(r.medication_id),
          medicationName: text(r.medication_name),
          dosage: text(r.dosage),
          route: text(r.route),
          frequency: text(r.frequency),
          duration: text(r.duration),
          quantityPrescribed: num(r.quantity_prescribed),
          quantityDispensed: num(r.quantity_dispensed),
          unitPrice: num(r.unit_price),
          totalPrice: num(r.total_price),
          instructions: text(r.instructions),
          dispenseStatus: text(r.dispense_status) as PrescriptionItem['dispenseStatus'],
          pharmacistNotes: optText(r.pharmacist_notes),
          dispensedAt: optTime(r.dispensed_at),
        }),
        modelToRow: (i: PrescriptionItem, prescriptionId: string) => ({
          id: i.id,
          prescription_id: prescriptionId,
          medication_id: fk(i.medicationId),
          medication_name: i.medicationName,
          dosage: i.dosage ?? '',
          route: i.route ?? '',
          frequency: i.frequency ?? '',
          duration: i.duration ?? '',
          quantity_prescribed: i.quantityPrescribed,
          quantity_dispensed: i.quantityDispensed ?? 0,
          unit_price: i.unitPrice,
          total_price: i.totalPrice,
          instructions: i.instructions ?? '',
          dispense_status: i.dispenseStatus,
          pharmacist_notes: orNull(i.pharmacistNotes),
          dispensed_at: orNull(i.dispensedAt),
        }),
      },
    ],
  },

  {
    key: 'fatclinic_services',
    table: 'service_prices',
    order: 120,
    omit: SERVER_MANAGED,
    rowToModel: (r): ServicePriceItem => ({
      id: text(r.id),
      name: text(r.name),
      category: text(r.category) as ServicePriceItem['category'],
      price: num(r.price),
      active: Boolean(r.active),
      effectiveDate: date(r.effective_date),
    }),
    modelToRow: (m: ServicePriceItem) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      price: m.price,
      active: m.active !== false,
      effective_date: m.effectiveDate || undefined,
    }),
  },

  {
    key: 'fatclinic_invoices',
    table: 'invoices',
    order: 130,
    omit: SERVER_MANAGED,
    // recalc_invoice() owns these. The browser also computes them, and where the
    // two disagree the database wins: its arithmetic runs inside a transaction
    // against the persisted line items, whereas the browser's is a snapshot of
    // whatever happened to be in memory.
    dbOwned: ['subtotal', 'total', 'paid_amount', 'balance', 'payment_status'],
    // The trigger clamps discount to the current subtotal, so a discount written
    // before a line item is removed would be clamped to 0 and stay there.
    // Re-sending it after the children land makes the final recalculation see
    // the final subtotal.
    settle: ['discount'],
    rowToModel: (r): Invoice => ({
      id: text(r.id),
      visitId: text(r.visit_id),
      patientId: text(r.patient_id),
      date: date(r.invoice_date),
      items: [],
      subtotal: num(r.subtotal),
      discount: num(r.discount),
      total: num(r.total),
      paidAmount: num(r.paid_amount),
      balance: num(r.balance),
      paymentStatus: text(r.payment_status) as Invoice['paymentStatus'],
      payments: [],
      requirePrepayment: Boolean(r.require_prepayment),
    }),
    modelToRow: (m: Invoice) => ({
      id: m.id,
      visit_id: m.visitId,
      patient_id: m.patientId,
      invoice_date: m.date,
      discount: m.discount,
      require_prepayment: Boolean(m.requirePrepayment),
    }),
    children: [
      {
        table: 'invoice_items',
        fk: 'invoice_id',
        property: 'items',
        // This table has created_at but no updated_at: a billed line item is
        // written once. Omitting a column that does not exist is harmless, but
        // listing it here would misdescribe the table.
        omit: ['created_at'],
        keyOf: (i: InvoiceItem) => i.id,
        dbKeyOf: (i: InvoiceItem) => i.id,
        rowToModel: (r): InvoiceItem => ({
          id: text(r.id),
          serviceCategory: text(r.service_category) as InvoiceItem['serviceCategory'],
          description: text(r.description),
          quantity: num(r.quantity),
          unitPrice: num(r.unit_price),
          totalPrice: num(r.total_price),
          referenceId: optText(r.reference_id),
        }),
        modelToRow: (i: InvoiceItem, invoiceId: string) => ({
          id: i.id,
          invoice_id: invoiceId,
          service_category: i.serviceCategory,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unitPrice,
          total_price: i.totalPrice,
          reference_id: orNull(i.referenceId),
        }),
      },
      {
        // A receipt trail: rows are added, never edited or removed by the app.
        table: 'payments',
        fk: 'invoice_id',
        property: 'payments',
        keyOf: (p: PaymentRecord) => p.id,
        dbKeyOf: (p: PaymentRecord) => p.id,
        omit: ['paid_at', 'created_at'],
        rowToModel: (r): PaymentRecord => ({
          id: text(r.id),
          receiptNumber: text(r.receipt_number),
          paidAt: optTime(r.paid_at) ?? '',
          amount: num(r.amount),
          paymentMethod: text(r.payment_method) as PaymentRecord['paymentMethod'],
          receivedBy: text(r.received_by),
          bankName: optText(r.bank_name),
          transactionReference: optText(r.transaction_reference),
        }),
        modelToRow: (p: PaymentRecord, invoiceId: string) => ({
          id: p.id,
          invoice_id: invoiceId,
          receipt_number: p.receiptNumber,
          paid_at: orNull(p.paidAt),
          amount: p.amount,
          payment_method: p.paymentMethod,
          received_by: p.receivedBy ?? '',
          bank_name: orNull(p.bankName),
          transaction_reference: orNull(p.transactionReference),
        }),
      },
    ],
  },

  {
    key: 'fatclinic_radiology_orders',
    table: 'radiology_orders',
    order: 140,
    omit: SERVER_MANAGED,
    rowToModel: (r): RadiologyOrder => ({
      id: text(r.id),
      visitId: text(r.visit_id),
      patientId: text(r.patient_id),
      orderedBy: text(r.ordered_by),
      orderedAt: optTime(r.ordered_at) ?? '',
      modality: text(r.modality) as RadiologyOrder['modality'],
      investigationName: text(r.investigation_name),
      clinicalNotes: optText(r.clinical_notes),
      findings: optText(r.findings),
      impression: optText(r.impression),
      reportedBy: optText(r.reported_by),
      reportedAt: optTime(r.reported_at),
      filmSize: optText(r.film_size),
      contrastUsed: Boolean(r.contrast_used),
      price: num(r.price),
      status: text(r.status) as RadiologyOrder['status'],
      invoiceId: optText(r.invoice_id),
    }),
    modelToRow: (m: RadiologyOrder) => ({
      id: m.id,
      visit_id: m.visitId,
      patient_id: m.patientId,
      ordered_by: m.orderedBy ?? '',
      ordered_at: orNull(m.orderedAt),
      modality: m.modality,
      investigation_name: m.investigationName,
      clinical_notes: orNull(m.clinicalNotes),
      findings: orNull(m.findings),
      impression: orNull(m.impression),
      reported_by: orNull(m.reportedBy),
      reported_at: orNull(m.reportedAt),
      film_size: orNull(m.filmSize),
      contrast_used: Boolean(m.contrastUsed),
      price: m.price,
      status: m.status,
      invoice_id: fk(m.invoiceId),
    }),
  },

  {
    key: 'fatclinic_physio_orders',
    table: 'physiotherapy_orders',
    order: 150,
    omit: SERVER_MANAGED,
    rowToModel: (r): PhysiotherapyOrder => ({
      id: text(r.id),
      visitId: text(r.visit_id),
      patientId: text(r.patient_id),
      orderedBy: text(r.ordered_by),
      orderedAt: optTime(r.ordered_at) ?? '',
      serviceName: text(r.service_name),
      category: (optText(r.category) ?? undefined) as PhysiotherapyOrder['category'],
      sessions: num(r.sessions),
      sessionsCompleted: num(r.sessions_completed),
      progressNotes: optText(r.progress_notes),
      treatedBy: optText(r.treated_by),
      lastSessionDate: optDate(r.last_session_date),
      price: num(r.price),
      clinicalIndication: optText(r.clinical_indication),
      status: text(r.status) as PhysiotherapyOrder['status'],
      invoiceId: optText(r.invoice_id),
    }),
    modelToRow: (m: PhysiotherapyOrder) => ({
      id: m.id,
      visit_id: m.visitId,
      patient_id: m.patientId,
      ordered_by: m.orderedBy ?? '',
      ordered_at: orNull(m.orderedAt),
      service_name: m.serviceName,
      category: orNull(m.category),
      sessions: m.sessions,
      sessions_completed: m.sessionsCompleted ?? 0,
      progress_notes: orNull(m.progressNotes),
      treated_by: orNull(m.treatedBy),
      last_session_date: orNull(m.lastSessionDate),
      price: m.price,
      clinical_indication: orNull(m.clinicalIndication),
      status: m.status,
      invoice_id: fk(m.invoiceId),
    }),
  },

  {
    key: 'fatclinic_clinical_consumables',
    table: 'clinical_consumables',
    order: 160,
    omit: SERVER_MANAGED,
    rowToModel: (r): ClinicalConsumable => ({
      id: text(r.id),
      name: text(r.name),
      category: text(r.category) as ClinicalConsumable['category'],
      unit: text(r.unit),
      currentStock: num(r.current_stock),
      minAlertLevel: num(r.min_alert_level),
      unitPrice: num(r.unit_price),
      costPrice: num(r.cost_price),
      lastUpdated: optTime(r.last_updated) ?? '',
    }),
    modelToRow: (m: ClinicalConsumable) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      unit: m.unit ?? '',
      current_stock: m.currentStock ?? 0,
      min_alert_level: m.minAlertLevel ?? 0,
      unit_price: m.unitPrice,
      cost_price: m.costPrice,
      last_updated: orNull(m.lastUpdated),
    }),
  },

  {
    key: 'fatclinic_consumable_requests',
    table: 'consumable_requests',
    order: 170,
    omit: SERVER_MANAGED,
    rowToModel: (r): ConsumableStockRequest => ({
      id: text(r.id),
      consumableId: text(r.consumable_id),
      consumableName: text(r.consumable_name),
      section: text(r.section),
      quantityRequested: num(r.quantity_requested),
      requestedBy: text(r.requested_by),
      requestedAt: optTime(r.requested_at) ?? '',
      status: text(r.status) as ConsumableStockRequest['status'],
      urgency: text(r.urgency) as ConsumableStockRequest['urgency'],
    }),
    modelToRow: (m: ConsumableStockRequest) => ({
      id: m.id,
      consumable_id: fk(m.consumableId),
      consumable_name: m.consumableName,
      section: m.section ?? 'General',
      quantity_requested: m.quantityRequested,
      requested_by: m.requestedBy ?? '',
      requested_at: orNull(m.requestedAt),
      status: m.status,
      urgency: m.urgency,
    }),
  },

  {
    key: 'fatclinic_consumable_usage',
    table: 'consumable_usage',
    order: 180,
    // No updated_at on this table, so the trigger does not touch it either.
    omit: ['created_at'],
    rowToModel: (r): ConsumableUsageLog => ({
      id: text(r.id),
      consumableId: text(r.consumable_id),
      consumableName: text(r.consumable_name),
      section: text(r.section),
      quantityUsed: num(r.quantity_used),
      unitPrice: num(r.unit_price),
      totalCharge: num(r.total_charge),
      usedBy: text(r.used_by),
      usedAt: optTime(r.used_at) ?? '',
      patientId: optText(r.patient_id),
      visitId: optText(r.visit_id),
      invoiceId: optText(r.invoice_id),
    }),
    modelToRow: (m: ConsumableUsageLog) => ({
      id: m.id,
      consumable_id: fk(m.consumableId),
      consumable_name: m.consumableName,
      section: m.section ?? 'General',
      quantity_used: m.quantityUsed,
      unit_price: m.unitPrice,
      total_charge: m.totalCharge,
      used_by: m.usedBy ?? '',
      used_at: orNull(m.usedAt),
      patient_id: fk(m.patientId),
      visit_id: fk(m.visitId),
      invoice_id: fk(m.invoiceId),
    }),
  },

  {
    key: 'fatclinic_medication_requests',
    table: 'medication_requests',
    order: 190,
    omit: SERVER_MANAGED,
    rowToModel: (r): MedicationRequest => ({
      id: text(r.id),
      medicationId: text(r.medication_id),
      medicationName: text(r.medication_name),
      quantityRequested: num(r.quantity_requested),
      requestedBy: text(r.requested_by),
      requestedAt: optTime(r.requested_at) ?? '',
      status: text(r.status) as MedicationRequest['status'],
      urgency: text(r.urgency) as MedicationRequest['urgency'],
    }),
    modelToRow: (m: MedicationRequest) => ({
      id: m.id,
      medication_id: fk(m.medicationId),
      medication_name: m.medicationName,
      quantity_requested: m.quantityRequested,
      requested_by: m.requestedBy ?? '',
      requested_at: orNull(m.requestedAt),
      status: m.status,
      urgency: m.urgency,
    }),
  },

  {
    // Append-only, enforced twice: no UPDATE/DELETE policy in section 12, and
    // trg_audit_immutable raises on any attempt. So this collection is only ever
    // inserted into, and a removal in the model is ignored rather than attempted.
    key: 'fatclinic_audit_logs',
    table: 'audit_logs',
    order: 200,
    appendOnly: true,
    rowToModel: (r): AuditLog => ({
      id: text(r.id),
      timestamp: optTime(r.logged_at) ?? '',
      userId: text(r.user_id),
      userName: text(r.user_name),
      userRole: text(r.user_role) as AuditLog['userRole'],
      patientId: optText(r.patient_id),
      patientName: optText(r.patient_name),
      action: text(r.action),
      category: text(r.category) as AuditLog['category'],
      details: text(r.details),
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
    }),
    modelToRow: (m: AuditLog) => ({
      id: m.id,
      logged_at: orNull(m.timestamp),
      user_id: fk(m.userId),
      user_name: m.userName ?? '',
      user_role: m.userRole ?? '',
      patient_id: fk(m.patientId),
      patient_name: orNull(m.patientName),
      action: m.action,
      category: m.category,
      details: m.details ?? '',
      metadata: m.metadata ?? {},
    }),
  },

  {
    key: 'fatclinic_online_bookings',
    table: 'online_bookings',
    order: 210,
    omit: SERVER_MANAGED,
    rowToModel: (r): OnlineBooking => ({
      id: text(r.id),
      patientCode: text(r.patient_code),
      firstName: text(r.first_name),
      middleName: optText(r.middle_name),
      lastName: text(r.last_name),
      dob: date(r.dob),
      age: num(r.age),
      sex: text(r.sex) as OnlineBooking['sex'],
      phone: text(r.phone),
      email: optText(r.email),
      address: text(r.address),
      reasonForAppointment: text(r.reason_for_appointment),
      preferredDate: date(r.preferred_date),
      preferredTime: text(r.preferred_time),
      bookedAt: optTime(r.booked_at) ?? '',
      status: text(r.status) as OnlineBooking['status'],
    }),
    modelToRow: (m: OnlineBooking) => ({
      id: m.id,
      patient_code: m.patientCode,
      first_name: m.firstName,
      middle_name: orNull(m.middleName),
      last_name: m.lastName,
      dob: m.dob,
      age: m.age,
      sex: m.sex,
      phone: m.phone,
      email: orNull(m.email),
      address: m.address ?? '',
      reason_for_appointment: m.reasonForAppointment ?? '',
      preferred_date: m.preferredDate,
      preferred_time: m.preferredTime ?? '',
      booked_at: orNull(m.bookedAt),
      status: m.status,
    }),
  },

  {
    key: 'fatclinic_lab_stock',
    table: 'lab_stock_items',
    order: 220,
    omit: SERVER_MANAGED,
    rowToModel: (r): LabStockItem => ({
      id: text(r.id),
      name: text(r.name),
      category: text(r.category) as LabStockItem['category'],
      currentStock: num(r.current_stock),
      unit: text(r.unit),
      unitCost: num(r.unit_cost),
      minAlertLevel: num(r.min_alert_level),
      lastUsedAt: optTime(r.last_used_at),
    }),
    modelToRow: (m: LabStockItem) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      current_stock: m.currentStock ?? 0,
      unit: m.unit ?? '',
      unit_cost: m.unitCost,
      min_alert_level: m.minAlertLevel ?? 0,
      last_used_at: orNull(m.lastUsedAt),
    }),
  },

  {
    key: 'fatclinic_lab_stock_requests',
    table: 'lab_stock_requests',
    order: 230,
    omit: SERVER_MANAGED,
    rowToModel: (r): LabStockRequest => ({
      id: text(r.id),
      itemId: text(r.item_id),
      itemName: text(r.item_name),
      quantityRequested: num(r.quantity_requested),
      requestedBy: text(r.requested_by),
      requestedAt: optTime(r.requested_at) ?? '',
      status: text(r.status) as LabStockRequest['status'],
      urgency: text(r.urgency) as LabStockRequest['urgency'],
    }),
    modelToRow: (m: LabStockRequest) => ({
      id: m.id,
      item_id: fk(m.itemId),
      item_name: m.itemName,
      quantity_requested: m.quantityRequested,
      requested_by: m.requestedBy ?? '',
      requested_at: orNull(m.requestedAt),
      status: m.status,
      urgency: m.urgency,
    }),
  },

  {
    key: 'fatclinic_receipt_settings',
    table: 'receipt_settings',
    order: 240,
    single: true,
    // id is sent, not omitted: it is a PRIMARY KEY with no DEFAULT and a CHECK
    // that pins it to 1, so a row without it violates NOT NULL on insert.
    omit: SERVER_MANAGED,
    rowToModel: (r): ReceiptSettings => ({
      hospitalName: text(r.hospital_name),
      tagline: text(r.tagline),
      address: text(r.address),
      phone: text(r.phone),
      email: text(r.email),
      footerMessage: text(r.footer_message),
      termsLine: text(r.terms_line),
      receiptPrefix: text(r.receipt_prefix),
      showReceiptCount: Boolean(r.show_receipt_count),
      showPaymentMethod: Boolean(r.show_payment_method),
      showReceivedBy: Boolean(r.show_received_by),
      showBankDetails: Boolean(r.show_bank_details),
      showInvoicePosition: Boolean(r.show_invoice_position),
      showThankYou: Boolean(r.show_thank_you),
    }),
    modelToRow: (m: ReceiptSettings) => ({
      id: 1,
      hospital_name: m.hospitalName,
      tagline: m.tagline ?? '',
      address: m.address ?? '',
      phone: m.phone ?? '',
      email: m.email ?? '',
      footer_message: m.footerMessage ?? '',
      terms_line: m.termsLine ?? '',
      receipt_prefix: m.receiptPrefix || 'RCP',
      show_receipt_count: m.showReceiptCount !== false,
      show_payment_method: m.showPaymentMethod !== false,
      show_received_by: m.showReceivedBy !== false,
      show_bank_details: m.showBankDetails !== false,
      show_invoice_position: m.showInvoicePosition !== false,
      show_thank_you: m.showThankYou !== false,
    }),
  },
];

/** Storage key -> map, for O(1) lookup from the saveStorage seam. */
export const TABLE_BY_KEY = new Map(TABLES.map((t) => [t.key, t]));

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** PostgREST's default page size. A ward-sized clinic fits easily; a large one
 *  would be silently truncated, which for a medical record is unacceptable, so
 *  the cap is raised well past any realistic row count. */
const PAGE_SIZE = 5000;

/**
 * The slice of the Supabase client this module uses.
 *
 * Narrowed deliberately: the self-test passes a recorder in place of a client so
 * the diff logic can be proven without a live project, and a narrow interface is
 * what makes that substitution possible at all.
 *
 * The builders return `PromiseLike` rather than `Promise`, because
 * postgrest-js returns a thenable that is not a real Promise.
 */
export interface SyncClient {
  from(table: string): {
    select(columns?: string): {
      range(
        from: number,
        to: number,
      ): PromiseLike<{ data: any[] | null; error: { message: string } | null }>;
    };
    upsert(
      rows: Record<string, unknown>[],
      options: { onConflict: string },
    ): PromiseLike<{ error: { message: string } | null }>;
    delete(): {
      in(column: string, values: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

async function selectAll(
  client: SyncClient,
  table: string,
  columns = '*',
): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`select ${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

function applyOmit(row: Record<string, unknown>, omit?: string[]): Record<string, unknown> {
  if (!omit?.length) return row;
  const copy = { ...row };
  for (const column of omit) delete copy[column];
  return copy;
}

/** Strip `undefined` so PostgREST does not receive a literal null-by-omission. */
function compact(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Guard against a mapper writing a column the database owns. */
function assertNoDbOwnedColumns(map: TableMap, row: Record<string, unknown>): void {
  if (!map.dbOwned) return;
  for (const column of map.dbOwned) {
    if (column in row) {
      throw new Error(
        `${map.table}.${column} is recalculated by the database; the row mapper must not send it`,
      );
    }
  }
}

/** One table's worth of pending work, in an order that satisfies foreign keys. */
interface Op {
  table: string;
  /** Upsert conflict target. */
  conflict: string;
  /** Column the delete filters on. */
  key: string;
  upserts: Record<string, unknown>[];
  /** Primary key values to remove. */
  deletes: string[];
}

/**
 * Build the ordered operations for one parent's nested children.
 *
 * `before` and `after` are the two versions of the child array, so the diff sees
 * exactly what the collection diff saw: real prior state, not undefined. That
 * matters for grandchildren, where an undefined "before" would silently skip
 * every delete and leave results a pathologist had cleared.
 *
 * Grandchildren are planned per surviving child, because their foreign key is
 * the child's own id rather than the top-level parent's. They are appended after
 * their parent's upserts so the row they point at exists first.
 */
function planChildOps(
  child: ChildMap,
  parentId: string,
  before: unknown,
  after: unknown,
  ops: Op[],
): void {
  const beforeItems = (Array.isArray(before) ? before : []) as any[];
  const afterItems = (Array.isArray(after) ? after : []) as any[];

  const upserts: Record<string, unknown>[] = [];
  const beforeByKey = new Map<string, any>();
  for (const item of beforeItems) beforeByKey.set(child.keyOf(item), item);

  const afterKeys = new Set<string>();
  for (const item of afterItems) {
    const key = child.keyOf(item);
    afterKeys.add(key);
    if (beforeByKey.has(key)) continue; // unchanged: nothing to send
    upserts.push(compact(applyOmit(child.modelToRow(item, parentId), child.omit)));
  }

  const deletes: string[] = [];
  for (const item of beforeItems) {
    const key = child.keyOf(item);
    if (!afterKeys.has(key)) deletes.push(child.dbKeyOf(item, parentId));
  }

  const op: Op = {
    table: child.table,
    conflict: child.conflict ?? 'id',
    // A composite-key table filters on the one column that is unique within a
    // parent, which for role_permissions is the permission key.
    key: child.conflict ? 'permission_key' : 'id',
    upserts,
    deletes,
  };
  ops.push(op);

  for (const grand of child.children ?? []) {
    // A grandchild hangs off one child row, so it is planned once per child id
    // that appears on either side of the diff. Ids only on the "after" side are
    // new children; only on "before" means the child is going away, and its
    // grandchildren go with it via ON DELETE CASCADE.
    const childIds = new Set<string>([
      ...beforeItems.map((i) => child.dbKeyOf(i, parentId)),
      ...afterItems.map((i) => child.dbKeyOf(i, parentId)),
    ]);
    for (const childId of childIds) {
      const grandBefore = pickNested(beforeItems, child.keyOf, childId, grand.property);
      const grandAfter = pickNested(afterItems, child.keyOf, childId, grand.property);
      if (!grandBefore.length && !grandAfter.length) continue;
      planChildOps(grand, childId, grandBefore, grandAfter, ops);
    }
  }
}

/** The nested array of the one child item whose id matches. */
function pickNested(
  items: any[],
  keyOf: (item: unknown) => string,
  childId: string,
  property: string,
): unknown[] {
  const match = items.find((i) => keyOf(i) === childId);
  const value = match?.[property];
  return Array.isArray(value) ? value : [];
}

async function upsertRows(
  client: SyncClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}

async function deleteRows(
  client: SyncClient,
  table: string,
  key: string,
  values: string[],
): Promise<void> {
  if (!values.length) return;
  // One request per batch. A per-value loop would issue a round trip per deleted
  // row, which on a large purge is the difference between one and thousands.
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const { error } = await client.from(table).delete().in(key, chunk);
    if (error) throw new Error(`delete ${table}.${key}: ${error.message}`);
  }
}

/**
 * Push the delta between two versions of one collection.
 *
 * `before` is the previously persisted value and `after` the new one. Only
 * genuinely new, changed and removed rows are sent, and the parent is always
 * written before its children so the foreign key exists.
 */
export async function pushDiff(
  map: TableMap,
  before: unknown,
  after: unknown,
  client: SyncClient | null = getSupabase(),
): Promise<void> {
  if (!client) return;

  // --- single-row tables ---------------------------------------------------
  if (map.single) {
    const row = compact(applyOmit(map.modelToRow(after ?? {}), map.omit));
    assertNoDbOwnedColumns(map, row);
    await upsertRows(client, map.table, [row], 'id');
    return;
  }

  const prevList = Array.isArray(before) ? (before as any[]) : [];
  const nextList = Array.isArray(after) ? (after as any[]) : [];

  const prevById = new Map<string, any>();
  for (const item of prevList) if (item?.id) prevById.set(String(item.id), item);

  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const touched: Array<{ id: string; before: any; after: any; isNew: boolean }> = [];
  const presentIds = new Set<string>();

  for (const item of nextList) {
    if (!item?.id) continue;
    const id = String(item.id);
    presentIds.add(id);
    const prev = prevById.get(id);
    const isNew = !prev;
    const changed = isNew || JSON.stringify(prev) !== JSON.stringify(item);

    if (changed) {
      const row = compact(applyOmit(map.modelToRow(item), map.omit));
      assertNoDbOwnedColumns(map, row);
      if (isNew) inserts.push(row);
      else updates.push(row);
      touched.push({ id, before: prev, after: item, isNew });
    }
  }

  const removedIds = [...prevById.keys()].filter((id) => !presentIds.has(id));

  // --- append-only collections --------------------------------------------
  if (map.appendOnly) {
    // audit_logs has no UPDATE or DELETE policy and a trigger that raises, so a
    // change to an existing entry cannot be represented. Inserts still go up.
    await upsertRows(client, map.table, inserts, 'id');
    return;
  }

  // --- writes, in foreign-key order ---------------------------------------
  await upsertRows(client, map.table, [...inserts, ...updates], 'id');

  // Children are planned for every touched parent, new or changed, because a new
  // parent's children have no prior state and a changed parent's children may
  // have been added to or removed from.
  const ops: Op[] = [];
  for (const { id, before, after } of touched) {
    for (const child of map.children ?? []) {
      planChildOps(
        child,
        id,
        before?.[child.property],
        after?.[child.property],
        ops,
      );
    }
  }

  for (const op of ops) {
    // Deletes first, so a removed line item lowers the subtotal before the
    // parent's discount is re-asserted in the settle pass, and so a child that
    // was re-keyed does not collide with its own replacement.
    await deleteRows(client, op.table, op.key, op.deletes);
    await upsertRows(client, op.table, op.upserts, op.conflict);
  }

  for (const id of removedIds) {
    // Children go with ON DELETE CASCADE, so the parent delete is enough.
    await deleteRows(client, map.table, 'id', [id]);
  }

  // --- settle pass ---------------------------------------------------------
  // Only for rows that already existed. On an insert the discount lands with
  // subtotal still zero and no recalculation fires, so the first one to run is
  // the child insert - which already sees the final subtotal. Re-asserting it
  // would be a second round trip per new invoice for no change in outcome.
  //
  // On an update it is required. The trigger clamps the discount to the subtotal,
  // so a discount written before a line item is removed is clamped away and
  // never restored; writing it again after the children land fixes the order.
  const settleFor = touched.filter((t) => !t.isNew);
  if (map.settle?.length && settleFor.length) {
    for (const { after } of settleFor) {
      const base = compact(applyOmit(map.modelToRow(after), map.omit));
      const settle: Record<string, unknown> = { id: base.id };
      for (const column of map.settle) settle[column] = base[column];
      await upsertRows(client, map.table, [settle], 'id');
    }
  }
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/**
 * Read every table the app owns and rebuild the collections.
 *
 * Children are fetched once and grouped by their foreign key, rather than one
 * request per parent: 500 visits would otherwise be 500 round trips.
 *
 * Returns a map from storage key to model. A collection that comes back empty is
 * still returned, as an empty array, so the caller can tell "no rows" apart from
 * "table missing".
 */
export async function hydrateAll(): Promise<Map<string, unknown>> {
  const client = getSupabase();
  const out = new Map<string, unknown>();
  if (!client) return out;

  // Every distinct child table across all maps, fetched at most once.
  const childTables = new Map<string, ChildMap>();
  for (const map of TABLES) collectChildTables(map.children ?? [], childTables);

  const childRows = new Map<string, Record<string, any>[]>();
  const load = async (table: string) => {
    if (!childRows.has(table)) childRows.set(table, await selectAll(client, table));
    return childRows.get(table)!;
  };

  // Rows grouped by foreign key, built once per table. Filtering the whole table
  // for every parent row would be quadratic: 2,000 visits against 4,000 lab
  // results is eight million comparisons on every page load.
  const grouped = new Map<string, Map<string, Record<string, any>[]>>();
  const groupBy = async (child: ChildMap) => {
    const cacheKey = `${child.table}::${child.fk}`;
    if (grouped.has(cacheKey)) return grouped.get(cacheKey)!;
    const rows = await load(child.table);
    const byFk = new Map<string, Record<string, any>[]>();
    for (const row of rows) {
      const key = String(row[child.fk]);
      const bucket = byFk.get(key);
      if (bucket) bucket.push(row);
      else byFk.set(key, [row]);
    }
    grouped.set(cacheKey, byFk);
    return byFk;
  };

  for (const map of [...TABLES].sort((a, b) => a.order - b.order)) {
    const rows = await selectAll(client, map.table);

    if (map.single) {
      out.set(map.key, rows[0] ? map.rowToModel(rows[0]) : null);
      continue;
    }

    const models: any[] = [];
    for (const row of rows) {
      const model = map.rowToModel(row) as Record<string, any>;
      const id = String(row.id);
      for (const child of map.children ?? []) {
        const byFk = await groupBy(child);
        const mine = byFk.get(id) ?? [];
        // Grandchild groupings are resolved up front, keyed by the child's own
        // row id rather than by array position: two test orders can carry
        // results whose composite ids sort differently from the fetch order.
        const grandGroups = await Promise.all(
          (child.children ?? []).map(async (grand) => ({ grand, byFk: await groupBy(grand) })),
        );

        model[child.property] = mine.map((childRow) => {
          const item = child.rowToModel(childRow) as Record<string, any>;
          for (const { grand, byFk: byGrandFk } of grandGroups) {
            item[grand.property] = (byGrandFk.get(String(childRow.id)) ?? []).map(grand.rowToModel);
          }
          return item;
        });
      }
      models.push(model);
    }
    out.set(map.key, models);
  }
  return out;
}

function collectChildTables(children: ChildMap[], into: Map<string, ChildMap>): void {
  for (const child of children) {
    into.set(child.table, child);
    collectChildTables(child.children ?? [], into);
  }
}

// ---------------------------------------------------------------------------
// Write queue
// ---------------------------------------------------------------------------

/**
 * Saves are serialised through one queue.
 *
 * `db.ts` mutates a collection and calls `saveStorage` synchronously, so several
 * can be queued before any network call returns. Firing them concurrently would
 * race on foreign keys - a visit could be inserted before its patient - and an
 * interleaved failure would leave the queue in an order that no longer matches
 * the app's intent. So each entry waits for the previous one.
 */
interface QueueEntry {
  map: TableMap;
  before: unknown;
  after: unknown;
  client: SyncClient;
}

let queue: QueueEntry[] = [];
let draining: Promise<void> | null = null;
/** Rows with a push still outstanding, so hydration does not overwrite them. */
const inFlight = new Set<string>();

/** Keys currently waiting to be written, for diagnostics and tests. */
export function pendingKeys(): string[] {
  return queue.map((q) => q.map.key);
}

/**
 * Queue the delta for one collection.
 *
 * Returns synchronously: the caller is a synchronous `saveStorage`, and the
 * localStorage write must not wait on the network. Failures are logged rather
 * than thrown, because a failed network write must not take down the UI call
 * that triggered it; the row stays in localStorage and will be retried on the
 * next save of that collection.
 */
export function queueDiff(
  map: TableMap,
  before: unknown,
  after: unknown,
  client: SyncClient | null = getSupabase(),
): void {
  if (!client) return;

  // Touched ids are marked synchronously, before any await, so a hydration that
  // lands while this write is in flight knows to leave those rows alone.
  for (const item of (Array.isArray(after) ? after : []) as any[]) {
    if (item?.id) inFlight.add(`${map.key}:${item.id}`);
  }

  // Coalesce: if the same collection is saved twice before the queue drains, the
  // later value wins. The FIRST `before` is kept, not the later one: the point
  // of `before` is what the server held before any of this session's writes, and
  // replacing it with an intermediate state would re-send rows that are already
  // correct.
  const existing = queue.findIndex((q) => q.map.key === map.key);
  if (existing >= 0) {
    queue[existing] = { map, before: queue[existing].before, after, client };
  } else {
    queue.push({ map, before, after, client });
  }

  if (!draining) draining = drain();
}

/** Resolves when the queue has drained. Used by the self-test. */
export function whenDrained(): Promise<void> {
  return draining ?? Promise.resolve();
}

async function drain(): Promise<void> {
  try {
    while (queue.length) {
      const entry = queue.shift()!;
      try {
        await pushDiff(entry.map, entry.before, entry.after, entry.client);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[sync] could not write ${entry.map.table}:`, message);
        if (isPermanent(message)) {
          // A constraint violation or a rejected policy will fail identically on
          // every retry. Retrying forever would spin and hide the real cause, so
          // the entry is dropped and the row stays in localStorage, where the
          // clinician can still see what they entered.
          console.error(
            `[sync] dropping ${entry.map.key} change: the database rejected it and ` +
              'retrying will not help. The data is still in localStorage.',
          );
        }
      } finally {
        for (const item of (Array.isArray(entry.after) ? entry.after : []) as any[]) {
          if (item?.id) inFlight.delete(`${entry.map.key}:${item.id}`);
        }
      }
    }
  } finally {
    draining = null;
  }
}

/** Errors that will recur identically, so retrying is pointless. */
function isPermanent(message: string): boolean {
  return /violates|duplicate key|not null value|foreign key|permission denied|row-level security/i.test(
    message,
  );
}

/** Ids in a collection that still have an unwritten change. */
export function isInFlight(key: string, id: string): boolean {
  return inFlight.has(`${key}:${id}`);
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** True when a Supabase project is configured and the app should sync. */
export function isSyncEnabled(): boolean {
  return getSupabase() !== null;
}

export type { TableMap, ChildMap };
