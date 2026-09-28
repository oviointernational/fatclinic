// What the database will accept for a set of vitals, and what the nurse's form
// must therefore refuse before it claims the reading was recorded.
//
// The bug this exists for: the nursing form checked only whether a box was
// **empty**. The vitals table has twelve CHECK constraints, so a nurse who typed
// a temperature of 22, a blood pressure of 22/111 and a pulse of 11 was told
// "Recorded!", the app wrote an audit row saying the vitals were recorded - and
// Postgres refused the insert outright, because bmi is NUMERIC(4,1) and cannot
// hold the 22400 the arithmetic produced. The table stayed empty while the
// chart and the audit trail both claimed otherwise.
//
// So this is the same rule the consultation section of the README states, applied
// where it was missed: a value the **column must have** cannot be invented by the
// data layer, so it has to be refused by the form that asks for the number. The
// refusal is named - which field, what the database accepts, what was typed - so
// it can be corrected rather than guessed at.
//
// The ranges are not chosen here. They are transcribed from the CHECK
// constraints in database/fatclinic.sql, and two separate checks hold them to
// that: `db:consultation-test` parses the SQL and fails if a range is not
// declared there, and `db:crud` reads the **live** constraints out of
// information_schema and fails if the form accepts anything the running database
// refuses. A range edited here without the schema cannot pass both.
//
// The derived values are checked too, not just the typed ones. BMI and the
// category are computed, not entered, so a nurse cannot be blamed for them - but
// they still have to fit the columns they are written to, and that is a
// consequence of the weight and the height. computeBmi() therefore refuses a
// combination rather than returning a number the column will not take.

/** A vitals reading exactly as the form collects it, before any of this. */
export interface VitalsDraft {
  temperature: string | number;
  systolicBp: string | number;
  diastolicBp: string | number;
  pulse: string | number;
  respiratoryRate: string | number;
  spo2: string | number;
  weight: string | number;
  height: string | number;
  painScore?: string | number;
}

/**
 * One constrained column, and the rule the database states for it.
 *
 * `field` is a key of VitalsDraft rather than a string, so the limits table
 * cannot name a field the reading does not have - which would silently validate
 * nothing and let the reading through.
 */
export interface VitalsLimit {
  field: Exclude<keyof VitalsDraft, 'painScore'>;
  /** What a clinician calls it. Used in the refusal. */
  label: string;
  /** The unit, so the refusal can be read without a database manual. */
  unit: string;
  min?: number;
  max?: number;
  /** True when the database's rule is `> 0` rather than a range. */
  positiveOnly?: boolean;
  /** How many decimal places the column keeps. A value with more is refused. */
  decimals?: number;
}

export const VITALS_LIMITS: readonly VitalsLimit[] = [
  { field: 'temperature', label: 'Temperature', unit: '°C', min: 25, max: 45, decimals: 1 },
  { field: 'systolicBp', label: 'Systolic BP', unit: 'mmHg', min: 40, max: 300, decimals: 0 },
  { field: 'diastolicBp', label: 'Diastolic BP', unit: 'mmHg', min: 20, max: 200, decimals: 0 },
  { field: 'pulse', label: 'Pulse', unit: 'bpm', min: 20, max: 250, decimals: 0 },
  { field: 'respiratoryRate', label: 'Respiratory rate', unit: 'breaths/min', min: 4, max: 80, decimals: 0 },
  { field: 'spo2', label: 'SpO2', unit: '%', min: 0, max: 100, decimals: 0 },
  { field: 'weight', label: 'Weight', unit: 'kg', positiveOnly: true, decimals: 1 },
  { field: 'height', label: 'Height', unit: 'm', positiveOnly: true, decimals: 2 },
];

/**
 * The human range for a height, in metres.
 *
 * The database only says `> 0`, and it is right to: a bare positivity test lets
 * BMI overflow its column. A 0.05 m entry divides by 0.0025 and produces a BMI
 * four digits too wide for NUMERIC(4,1), so the insert is refused with a message
 * about a number the nurse never typed. The shortest living person is about
 * 0.5 m and the tallest about 2.5 m; anything outside that is a typing error,
 * not a patient.
 */
export const HEIGHT_MIN = 0.5;
export const HEIGHT_MAX = 2.5;

/** The heaviest person the scale can weigh, in kg. Same reasoning as height. */
export const WEIGHT_MAX = 400;

/** The widest BMI NUMERIC(4,1) can hold. */
export const BMI_MAX = 999.9;

export interface VitalsProblem {
  field: string;
  message: string;
}

/** One refusal, phrased so it can be acted on without opening the schema. */
function outOfRange(limit: VitalsLimit, value: number): string {
  const bound = limit.positiveOnly
    ? `greater than 0 ${limit.unit}`
    : `${limit.min} to ${limit.max} ${limit.unit}`;
  return `${limit.label} is ${value} ${limit.unit}. The record accepts ${bound}.`;
}

/**
 * Checks one typed field against the column it is written to.
 *
 * Returns an empty array for a value the database accepts. An empty string is
 * reported as missing rather than as out of range, because that is what it is -
 * the form asks for every one of these, so a blank is a gap in the reading and
 * not a measurement of nothing.
 */
export function checkVitalsField(
  field: VitalsLimit['field'],
  raw: string | number,
): VitalsProblem[] {
  const limit = VITALS_LIMITS.find((l) => l.field === field);
  if (!limit) return [];

  if (raw === '' || raw === null || raw === undefined) {
    return [{ field, message: `${limit.label} has not been recorded yet.` }];
  }

  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) {
    return [{ field, message: `${limit.label} must be a number.` }];
  }
  if (limit.positiveOnly ? value <= 0 : value < limit.min! || value > limit.max!) {
    return [{ field, message: outOfRange(limit, value) }];
  }
  if (field === 'height' && (value < HEIGHT_MIN || value > HEIGHT_MAX)) {
    return [
      {
        field,
        message: `Height is ${value} m. A patient is between ${HEIGHT_MIN} and ${HEIGHT_MAX} m; check whether centimetres were typed.`,
      },
    ];
  }
  if (field === 'weight' && value > WEIGHT_MAX) {
    return [{ field, message: `Weight is ${value} kg. The scale reads up to ${WEIGHT_MAX} kg.` }];
  }
  return [];
}

/**
 * The database's own cross-field rule: `(diastolic_bp <= systolic_bp)`.
 *
 * Without this a nurse can record 22/111, which the two column ranges both
 * permit - and which the table refuses, for a reason the refusal message does
 * not explain.
 */
export function checkBloodPressureOrder(systolic: number, diastolic: number): VitalsProblem[] {
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return [];
  if (diastolic > systolic) {
    return [
      {
        field: 'diastolicBp',
        message: `Diastolic ${diastolic} mmHg is above systolic ${systolic} mmHg. The lower reading is diastolic.`,
      },
    ];
  }
  return [];
}

/** Metres, from metres or centimetres. Height is entered both ways in practice. */
export function normaliseHeight(value: number): number {
  return value > 3 ? value / 100 : value;
}

export const BMI_CATEGORIES = [
  'Underweight',
  'Normal',
  'Overweight',
  'Obese Class I',
  'Obese Class II',
  'Obese Class III',
] as const;

export type BmiCategory = (typeof BMI_CATEGORIES)[number];

/** The category boundaries, kept in one place so the fold and the check agree. */
export const BMI_BOUNDS: readonly { below: number; category: BmiCategory }[] = [
  { below: 18.5, category: 'Underweight' },
  { below: 25, category: 'Normal' },
  { below: 30, category: 'Overweight' },
  { below: 35, category: 'Obese Class I' },
  { below: 40, category: 'Obese Class II' },
];

export function bmiCategoryFor(bmi: number): BmiCategory {
  return BMI_BOUNDS.find((b) => bmi < b.below)?.category ?? 'Obese Class III';
}

/**
 * BMI, or a refusal.
 *
 * Deliberately does not return a number unconditionally. `bmi` is NUMERIC(4,1)
 * and the category has a CHECK of its own, so a weight and height that are each
 * perfectly valid can still produce a row the database refuses. Returning
 * `null` here is what lets the form say so before the save, instead of after.
 */
export function computeBmi(
  weightKg: number,
  heightM: number,
): { bmi: number; category: BmiCategory } | { problem: VitalsProblem } {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightM) || heightM <= 0) {
    return { problem: { field: 'height', message: 'Height and weight are both needed to calculate BMI.' } };
  }
  const raw = weightKg / (heightM * heightM);
  const bmi = Number(raw.toFixed(1));
  if (!Number.isFinite(bmi) || bmi > BMI_MAX || bmi < 0) {
    return {
      problem: {
        field: 'bmi',
        message: `Weight ${weightKg} kg and height ${heightM} m give a BMI of ${bmi}, which the record cannot hold. Check both readings.`,
      },
    };
  }
  return { bmi, category: bmiCategoryFor(bmi) };
}

/** The clinical thresholds the form raises an alert on, kept beside the ranges. */
export const HIGH_FEVER_C = 38;
export const CRITICAL_SPO2_PCT = 90;
export const HYPERTENSIVE_SYSTOLIC = 180;

/**
 * Every reason this reading cannot be saved, or an empty array.
 *
 * Called by the form before it writes anything, so the reading that reaches the
 * database is one the database accepts. `painScore` is checked against its own
 * range (0-10) even though the column is nullable, because a pain score outside
 * that scale is a typo rather than a finding.
 */
export function checkVitals(draft: VitalsDraft): VitalsProblem[] {
  const problems = VITALS_LIMITS.flatMap((l) => checkVitalsField(l.field, draft[l.field]));

  const sys = Number(String(draft.systolicBp).trim());
  const dia = Number(String(draft.diastolicBp).trim());
  problems.push(...checkBloodPressureOrder(sys, dia));

  if (draft.painScore !== '' && draft.painScore !== undefined && draft.painScore !== null) {
    const pain = Number(String(draft.painScore).trim());
    if (!Number.isFinite(pain) || pain < 0 || pain > 10) {
      problems.push({ field: 'painScore', message: `Pain score is ${draft.painScore}. The scale is 0 to 10.` });
    }
  }

  if (problems.length === 0) {
    const bmi = computeBmi(Number(String(draft.weight).trim()), normaliseHeight(Number(String(draft.height).trim())));
    if ('problem' in bmi) problems.push(bmi.problem);
  }

  return problems;
}

/** The alerts a valid reading raises, so the form and the record cannot disagree. */
export function alertsFor(draft: VitalsDraft): string[] {
  const num = (v: string | number) => Number(String(v).trim());
  const alerts: string[] = [];
  if (num(draft.temperature) >= HIGH_FEVER_C) alerts.push('High Grade Fever Spike');
  if (num(draft.spo2) < CRITICAL_SPO2_PCT) alerts.push('Critical Oxygen Saturation');
  if (num(draft.systolicBp) >= HYPERTENSIVE_SYSTOLIC) alerts.push('Severe Hypertension');
  return alerts;
}
