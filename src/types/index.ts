export type UserRole = 
  | 'ADMINISTRATOR' 
  | 'PHYSICIAN' 
  | 'NURSE' 
  | 'LAB_SCIENTIST' 
  | 'PHARMACIST' 
  | 'RADIOLOGIST'
  | 'PHYSIOTHERAPIST'
  | 'FRONT_DESK' 
  | 'BILLING_OFFICER';

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  createdAt: string;
  createdBy: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  avatar: string;
  pin: string; // 4-digit device PIN
  password: string; // workstation login password (DB-controlled; admin can regenerate)
  customRoleId?: string; // assigned granular access-control role (Admin assigns)
  mustChangePassword?: boolean; // set when admin regenerates password
  active: boolean;
}

export interface Patient {
  id: string; // Hospital Number e.g. FC-2026-00101
  firstName: string;
  middleName?: string;
  lastName: string;
  dob: string;
  age: number;
  sex: 'Male' | 'Female' | 'Other';
  phone: string;
  email?: string;
  address: string;
  nextOfKin: string;
  emergencyContact: string;
  occupation?: string;
  bloodGroup?: string;
  genotype?: string;
  allergies: string[];
  alerts: string[];
  registeredAt: string;
}

export interface Visit {
  id: string;
  patientId: string;
  visitDate: string; // YYYY-MM-DD
  visitTime: string; // HH:mm
  visitType: 'New Visit' | 'Follow-up' | 'Emergency' | 'Routine';
  status: 
    | 'Awaiting Vitals' 
    | 'With Nurse' 
    | 'Awaiting Physician' 
    | 'With Doctor'
    | 'In Consultation' 
    | 'Awaiting Lab' 
    | 'Awaiting Pharmacy' 
    | 'Awaiting Payment' 
    | 'Admitted'
    | 'Treated'
    | 'Discharged'
    | 'Completed';
  attendingPhysicianId?: string;
  attendingNurseId?: string;
  reasonForVisit?: string;
  notes?: string;
  ward?: string; // specified on admission (e.g. Male General Ward)
  admittedAt?: string;
  admittedBy?: string;
  dischargedAt?: string;
}

export const WARDS: string[] = [
  'Male General Ward',
  'Female General Ward',
  'Pediatric Ward',
  'Maternity Ward',
  'Neonatal (NICU)',
  'Intensive Care (ICU)',
  'Emergency Ward',
  'Isolation Ward',
  'Private / Single Room',
  'Day-Care / Observation'
];

export interface Vitals {
  id: string;
  visitId: string;
  patientId: string;
  recordedAt: string;
  nurseId: string;
  nurseName: string;
  temperature: number; // °C
  systolicBp: number; // mmHg
  diastolicBp: number; // mmHg
  pulse: number; // bpm
  respiratoryRate: number; // breaths/min
  spo2: number; // %
  weight: number; // kg
  height: number; // meters (e.g. 1.75)
  bmi: number; // kg/m² auto-calculated
  bmiCategory: 'Underweight' | 'Normal' | 'Overweight' | 'Obese Class I' | 'Obese Class II' | 'Obese Class III';
  painScore?: number; // 0-10
  nursingNotes?: string;
  nursingCarePlan?: string;
  nursingProcedures?: string[];
  alerts?: string[];
}

export interface PhysicalExamination {
  general: string;
  cardiovascular: string;
  respiratory: string;
  abdomen: string;
  neurological: string;
  musculoskeletal: string;
  other: string;
}

export interface ClinicalDiagnosis {
  id: string;
  code: string; // ICD-10 e.g. B50.9
  description: string;
  type: 'Primary' | 'Secondary';
}

export interface Consultation {
  id: string;
  visitId: string;
  patientId: string;
  physicianId: string;
  physicianName: string;
  consultationDate: string;
  presentingComplaint: string;
  historyOfPresentingComplaint: string;
  pastMedicalHistory: string;
  surgicalHistory: string;
  drugHistory: string;
  familyHistory: string;
  socialHistory: string;
  allergyHistory: string;
  physicalExamination: PhysicalExamination;
  clinicalFindings: string;
  assessment: string;
  diagnoses: ClinicalDiagnosis[];
  plan: string;
  followUpDate?: string;
  clinicalNotes: string;
}

export type LabCategory = 
  | 'HEMATOLOGY' 
  | 'MICROBIOLOGY' 
  | 'CHEMICAL_PATHOLOGY' 
  | 'HISTOPATHOLOGY'
  | 'MOLECULAR';

export interface LabParameterTemplate {
  id: string;
  name: string;
  unit: string;
  referenceRange: string;
  resultType: 'numeric' | 'text' | 'select' | 'reactive';
  options?: string[];
}

export interface LabInvestigationDefinition {
  id: string;
  code: string;
  name: string;
  category: LabCategory;
  price: number;
  sampleType: string;
  turnaroundTime: string;
  parameters: LabParameterTemplate[];
  description?: string;
}

export interface LabResultValue {
  parameterId: string;
  parameterName: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag: 'Normal' | 'Low' | 'High' | 'Critical' | 'Abnormal';
}

export type LabTestStatus = 
  | 'Requested' 
  | 'Paid' 
  | 'Sample Collected' 
  | 'Processing' 
  | 'Result Entered' 
  | 'Verified' 
  | 'Released';

export interface LabTestOrder {
  id: string;
  testDefinitionId: string;
  testName: string;
  category: LabCategory;
  price: number;
  sampleType: string;
  status: LabTestStatus;
  collectedAt?: string;
  scientistId?: string;
  scientistName?: string;
  verifiedBy?: string;
  releasedAt?: string;
  results?: LabResultValue[];
  comments?: string;
  criticalAlert?: boolean;
}

export interface LabRequest {
  id: string;
  visitId: string;
  patientId: string;
  physicianId: string;
  physicianName: string;
  requestedAt: string;
  priority: 'Routine' | 'Urgent' | 'STAT';
  clinicalIndication?: string;
  tests: LabTestOrder[];
  paymentStatus: 'Unpaid' | 'Paid';
  totalPrice: number;
}

export interface PrescriptionItem {
  id: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantityPrescribed: number;
  quantityDispensed: number;
  unitPrice: number;
  totalPrice: number;
  instructions: string;
  dispenseStatus: 'Pending' | 'Dispensed' | 'Partially Dispensed' | 'Out of Stock';
  pharmacistNotes?: string;
  dispensedAt?: string; // last dispense timestamp (ISO)
}

export interface Prescription {
  id: string;
  visitId: string;
  patientId: string;
  physicianId: string;
  physicianName: string;
  prescribedAt: string;
  status: 'Pending' | 'Partially Dispensed' | 'Completed' | 'Cancelled';
  items: PrescriptionItem[];
  totalPrice: number;
}

export interface Medication {
  id: string;
  name: string;
  genericName: string;
  category: string;
  dosageForm: string;
  strength: string;
  unitPrice: number;
  currentStock: number;
  minStockAlert: number;
  dispensingUnit: string;
}

export interface MedicationRequest {
  id: string;
  medicationId: string;
  medicationName: string;
  quantityRequested: number;
  requestedBy: string;
  requestedAt: string;
  status: 'Pending' | 'Approved' | 'Dispatched';
  urgency: 'Routine' | 'Urgent';
}

export interface ServicePriceItem {
  id: string;
  name: string;
  category: 'Consultation' | 'Laboratory' | 'Pharmacy' | 'Nursing' | 'Procedure' | 'Other';
  price: number;
  active: boolean;
  effectiveDate: string;
}

export interface InvoiceItem {
  id: string;
  serviceCategory: 'Consultation' | 'Laboratory' | 'Pharmacy' | 'Nursing' | 'Procedure' | 'Other';
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  referenceId?: string;
}

export interface PaymentRecord {
  id: string;
  receiptNumber: string;
  paidAt: string;
  amount: number;
  paymentMethod: 'Cash' | 'Transfer' | 'POS' | 'Card' | 'Insurance';
  receivedBy: string;
  bankName?: string;
  transactionReference?: string;
}

export interface Invoice {
  id: string;
  visitId: string;
  patientId: string;
  date: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  balance: number;
  paymentStatus: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Refunded';
  payments: PaymentRecord[];
  requirePrepayment?: boolean;
}

export interface OnlineBooking {
  id: string;
  patientCode: string; // e.g. REG-7821
  firstName: string;
  middleName?: string;
  lastName: string;
  dob: string;
  age: number;
  sex: 'Male' | 'Female' | 'Other';
  phone: string;
  email?: string;
  address: string;
  reasonForAppointment: string;
  preferredDate: string;
  preferredTime: string;
  bookedAt: string;
  status: 'Pending Arrival' | 'Completed' | 'Cancelled';
}

export interface LabStockItem {
  id: string;
  name: string;
  category: 'Reagents' | 'Consumables' | 'Tubes' | 'Kits' | 'Stains';
  currentStock: number;
  unit: string;
  unitCost: number;
  minAlertLevel: number;
  lastUsedAt?: string;
}

export interface LabStockRequest {
  id: string;
  itemId: string;
  itemName: string;
  quantityRequested: number;
  requestedBy: string;
  requestedAt: string;
  status: 'Pending' | 'Approved' | 'Dispatched';
  urgency: 'Routine' | 'Urgent';
}

export interface RadiologyOrder {
  id: string;
  visitId: string;
  patientId: string;
  orderedBy: string;
  orderedAt: string;
  modality: 'X-Ray' | 'Ultrasound' | 'CT Scan' | 'MRI' | 'Echocardiogram';
  investigationName: string;
  clinicalNotes?: string;
  findings?: string;
  impression?: string;
  reportedBy?: string;
  reportedAt?: string;
  filmSize?: string;
  contrastUsed?: boolean;
  price: number;
  status: 'Requested' | 'Completed' | 'Report Ready';
  invoiceId?: string;
}

export interface PhysiotherapyOrder {
  id: string;
  visitId: string;
  patientId: string;
  orderedBy: string;
  orderedAt: string;
  serviceName: string;
  category?: 'Musculoskeletal' | 'Neurological' | 'Sports' | 'Pediatric' | 'General';
  sessions: number;
  sessionsCompleted?: number;
  progressNotes?: string;
  treatedBy?: string;
  lastSessionDate?: string;
  price: number;
  clinicalIndication?: string;
  status: 'Requested' | 'In Progress' | 'Completed';
  invoiceId?: string;
}

export type ConsumableSection =
  | 'Nursing'
  | 'Consultation'
  | 'Surgical'
  | 'Emergency'
  | 'Radiology'
  | 'Physiotherapy'
  | 'Laboratory'
  | 'Pharmacy'
  | 'General';

export interface ClinicalConsumable {
  id: string;
  name: string;
  category: ConsumableSection;
  unit: string;
  currentStock: number;
  minAlertLevel: number;
  unitPrice: number;
  costPrice: number;
  lastUpdated: string;
}

export interface ConsumableStockRequest {
  id: string;
  consumableId: string;
  consumableName: string;
  section: string;
  quantityRequested: number;
  requestedBy: string;
  requestedAt: string;
  status: 'Pending' | 'Approved' | 'Dispatched';
  urgency: 'Routine' | 'Urgent';
}

export interface ConsumableUsageLog {
  id: string;
  consumableId: string;
  consumableName: string;
  section: string;
  quantityUsed: number;
  unitPrice: number;
  totalCharge: number;
  usedBy: string;
  usedAt: string;
  patientId?: string;
  visitId?: string;
  invoiceId?: string;
}

export type MainNavId = 
  | 'dashboard' 
  | 'patients' 
  | 'clinical' 
  | 'laboratory' 
  | 'pharmacy' 
  | 'radiology'
  | 'physiotherapy'
  | 'billing' 
  | 'analytics' 
  | 'ai' 
  | 'admin';

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  patientId?: string;
  patientName?: string;
  action: string;
  category: 'PATIENT' | 'CLINICAL' | 'LABORATORY' | 'PHARMACY' | 'BILLING' | 'ADMIN';
  details: string;
  metadata?: Record<string, any>;
}

export interface ReceiptSettings {
  hospitalName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  footerMessage: string;
  termsLine: string;
  receiptPrefix: string;
  showReceiptCount: boolean;
  showPaymentMethod: boolean;
  showReceivedBy: boolean;
  showBankDetails: boolean;
  showInvoicePosition: boolean;
  showThankYou: boolean;
}

export interface SystemSettings {
  hospitalName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  currency: string; // e.g. '₦' or '$'
  currencyCode: string; // 'NGN' or 'USD'
  invoicePrefix: string;
  patientPrefix: string;
  inactivityTimeoutMinutes: number;
}
