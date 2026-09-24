import { 
  User, 
  Patient, 
  Visit, 
  Vitals, 
  Consultation, 
  LabInvestigationDefinition, 
  LabRequest, 
  Prescription, 
  Medication, 
  ServicePriceItem, 
  Invoice, 
  AuditLog, 
  SystemSettings 
} from '../types';

export const initialSettings: SystemSettings = {
  hospitalName: 'FatClinic & Medical Specialties',
  tagline: 'Precision Care. Connected Health. Zero Compromise.',
  address: '14 Healthcare Boulevard, Medical District, Victoria Island',
  phone: '+234 (0) 1 800-FATCLINIC',
  email: 'care@fatclinic.health',
  currency: '₦',
  currencyCode: 'NGN',
  invoicePrefix: 'FC-INV',
  patientPrefix: 'FC',
  inactivityTimeoutMinutes: 5
};

export const initialReceiptSettings: import('../types').ReceiptSettings = {
  hospitalName: 'FatClinic & Medical Specialties',
  tagline: 'Precision Care. Connected Health. Zero Compromise.',
  address: '14 Healthcare Boulevard, Medical District, Victoria Island',
  phone: '+234 (0) 1 800-FATCLINIC',
  email: 'care@fatclinic.health',
  footerMessage: 'Thank you for your patronage. This receipt is computer-generated and valid without signature.',
  termsLine: 'Fees are payable before service except emergencies. Balances must be cleared before discharge.',
  receiptPrefix: 'RCP',
  showReceiptCount: true,
  showPaymentMethod: true,
  showReceivedBy: true,
  showBankDetails: true,
  showInvoicePosition: true,
  showThankYou: true
};

// Production seed: administrator only. All other staff accounts are created
// by the administrator inside the app. Change this password on first sign-in.
export const initialUsers: User[] = [
  {
    id: 'USR-002',
    name: 'Dr. Sarah Alabi',
    email: 'alabi@fatclinic.health',
    role: 'ADMINISTRATOR',
    department: 'Executive Administration & Quality Assurance',
    avatar: '👩‍💼',
    pin: '1234',
    password: 'FatClinic123',
    mustChangePassword: true,
    active: true
  }
];

export const initialLabInvestigations: LabInvestigationDefinition[] = [
  // 1. HEMATOLOGY
  {
    id: 'LAB-HEM-01',
    code: 'FBC',
    name: 'Full Blood Count (Complete Blood Count)',
    category: 'HEMATOLOGY',
    price: 5000,
    sampleType: 'Whole Blood (EDTA - Purple Top)',
    turnaroundTime: '2 Hours',
    description: 'Comprehensive assessment of RBCs, WBCs, platelets, and hemoglobin indices.',
    parameters: [
      { id: 'p_hb', name: 'Hemoglobin (Hb)', unit: 'g/dL', referenceRange: '12.0 - 17.5', resultType: 'numeric' },
      { id: 'p_pcv', name: 'Packed Cell Volume (PCV)', unit: '%', referenceRange: '36.0 - 52.0', resultType: 'numeric' },
      { id: 'p_wbc', name: 'Total White Blood Cell Count', unit: 'x10^9/L', referenceRange: '4.0 - 11.0', resultType: 'numeric' },
      { id: 'p_neut', name: 'Neutrophils', unit: '%', referenceRange: '40 - 75', resultType: 'numeric' },
      { id: 'p_lymph', name: 'Lymphocytes', unit: '%', referenceRange: '20 - 45', resultType: 'numeric' },
      { id: 'p_plt', name: 'Platelet Count', unit: 'x10^9/L', referenceRange: '150 - 450', resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-HEM-02',
    code: 'ESR',
    name: 'Erythrocyte Sedimentation Rate',
    category: 'HEMATOLOGY',
    price: 2500,
    sampleType: 'Whole Blood (Sodium Citrate - Black Top)',
    turnaroundTime: '1.5 Hours',
    description: 'Nonspecific marker of systemic inflammation and active infection.',
    parameters: [
      { id: 'p_esr', name: 'Westergren ESR (1 hour)', unit: 'mm/hr', referenceRange: '0 - 20', resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-HEM-03',
    code: 'COAG',
    name: 'Coagulation Profile (PT/INR & aPTT)',
    category: 'HEMATOLOGY',
    price: 7500,
    sampleType: 'Citrated Plasma (Blue Top)',
    turnaroundTime: '3 Hours',
    description: 'Extrinsic and intrinsic coagulation cascade screening.',
    parameters: [
      { id: 'p_pt', name: 'Prothrombin Time (PT)', unit: 'seconds', referenceRange: '11.0 - 14.0', resultType: 'numeric' },
      { id: 'p_inr', name: 'International Normalized Ratio (INR)', unit: 'ratio', referenceRange: '0.8 - 1.2', resultType: 'numeric' },
      { id: 'p_aptt', name: 'Activated Partial Thromboplastin Time (aPTT)', unit: 'seconds', referenceRange: '25.0 - 35.0', resultType: 'numeric' }
    ]
  },

  // 2. MEDICAL MICROBIOLOGY
  {
    id: 'LAB-MIC-01',
    code: 'MAL_TEST',
    name: 'Malaria Parasite Screen (Thick & Thin Film / Ag)',
    category: 'MICROBIOLOGY',
    price: 3000,
    sampleType: 'Capillary / EDTA Whole Blood',
    turnaroundTime: '1 Hour',
    description: 'Gold-standard Giemsa microscopic examination for Plasmodium falciparum/vivax.',
    parameters: [
      { id: 'p_mp_density', name: 'Malaria Parasite Microscopic Density', unit: 'parasites/µL', referenceRange: 'Not Detected', resultType: 'text' },
      { id: 'p_species', name: 'Plasmodium Species Identified', unit: '-', referenceRange: 'None', resultType: 'text' },
      { id: 'p_rdt', name: 'PfHRP2 Rapid Diagnostic Test', unit: '-', referenceRange: 'Negative', resultType: 'reactive', options: ['Negative', 'Positive (Pf)', 'Positive (Pan)'] }
    ]
  },
  {
    id: 'LAB-MIC-02',
    code: 'URINE_MCS',
    name: 'Urine Microscopy, Culture & Sensitivity',
    category: 'MICROBIOLOGY',
    price: 6000,
    sampleType: 'Clean Catch Mid-Stream Urine (Sterile Cup)',
    turnaroundTime: '48 Hours',
    description: 'Direct urinalysis followed by microbiological agar culture and antibiotic susceptibility profiling.',
    parameters: [
      { id: 'p_appearance', name: 'Appearance & Color', unit: '-', referenceRange: 'Clear Straw', resultType: 'text' },
      { id: 'p_wbc_hpf', name: 'WBC (Pus Cells)', unit: '/HPF', referenceRange: '0 - 5', resultType: 'text' },
      { id: 'p_rbc_hpf', name: 'RBCs', unit: '/HPF', referenceRange: '0 - 2', resultType: 'text' },
      { id: 'p_culture_growth', name: 'Bacterial Colony Count', unit: 'CFU/mL', referenceRange: '<10^4 (No Significant Growth)', resultType: 'text' },
      { id: 'p_isolate', name: 'Isolated Pathogen', unit: '-', referenceRange: 'None', resultType: 'text' }
    ]
  },
  {
    id: 'LAB-MIC-03',
    code: 'STOOL_TEST',
    name: 'Stool Routine Microscopy & Occult Blood',
    category: 'MICROBIOLOGY',
    price: 3500,
    sampleType: 'Fresh Stool Specimen',
    turnaroundTime: '2 Hours',
    description: 'Detection of parasitic ova, cysts, protozoa, and fecal occult hemoglobin.',
    parameters: [
      { id: 'p_fob', name: 'Fecal Occult Blood (FOB)', unit: '-', referenceRange: 'Negative', resultType: 'reactive', options: ['Negative', 'Positive'] },
      { id: 'p_ova_cysts', name: 'Microscopic Ova / Cysts / Trophozoites', unit: '-', referenceRange: 'None Seen', resultType: 'text' }
    ]
  },

  // 3. CHEMICAL PATHOLOGY
  {
    id: 'LAB-CHE-01',
    code: 'LFT',
    name: 'Liver Function Tests (Hepatic Panel)',
    category: 'CHEMICAL_PATHOLOGY',
    price: 7000,
    sampleType: 'Serum (Gold/Red Top SST)',
    turnaroundTime: '3 Hours',
    description: 'Enzymatic and synthetic functional profile of hepatic parenchyma.',
    parameters: [
      { id: 'p_alt', name: 'Alanine Aminotransferase (ALT/SGPT)', unit: 'U/L', referenceRange: '7 - 45', resultType: 'numeric' },
      { id: 'p_ast', name: 'Aspartate Aminotransferase (AST/SGOT)', unit: 'U/L', referenceRange: '8 - 40', resultType: 'numeric' },
      { id: 'p_alp', name: 'Alkaline Phosphatase (ALP)', unit: 'U/L', referenceRange: '40 - 130', resultType: 'numeric' },
      { id: 'p_tbil', name: 'Total Bilirubin', unit: 'mg/dL', referenceRange: '0.2 - 1.2', resultType: 'numeric' },
      { id: 'p_dbil', name: 'Direct (Conjugated) Bilirubin', unit: 'mg/dL', referenceRange: '0.0 - 0.3', resultType: 'numeric' },
      { id: 'p_alb', name: 'Serum Albumin', unit: 'g/dL', referenceRange: '3.5 - 5.0', resultType: 'numeric' },
      { id: 'p_tprot', name: 'Total Serum Protein', unit: 'g/dL', referenceRange: '6.4 - 8.3', resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-CHE-02',
    code: 'UE_CREAT',
    name: 'Urea, Electrolytes & Serum Creatinine (Renal Profile)',
    category: 'CHEMICAL_PATHOLOGY',
    price: 6500,
    sampleType: 'Serum (Gold/Red Top SST)',
    turnaroundTime: '3 Hours',
    description: 'Renal clearance and systemic electrolyte homeostasis monitoring.',
    parameters: [
      { id: 'p_sodium', name: 'Sodium (Na+)', unit: 'mmol/L', referenceRange: '135 - 145', resultType: 'numeric' },
      { id: 'p_potassium', name: 'Potassium (K+)', unit: 'mmol/L', referenceRange: '3.5 - 5.1', resultType: 'numeric' },
      { id: 'p_chloride', name: 'Chloride (Cl-)', unit: 'mmol/L', referenceRange: '98 - 107', resultType: 'numeric' },
      { id: 'p_bicarb', name: 'Bicarbonate (HCO3-)', unit: 'mmol/L', referenceRange: '22 - 29', resultType: 'numeric' },
      { id: 'p_urea', name: 'Blood Urea Nitrogen (BUN)', unit: 'mg/dL', referenceRange: '7 - 20', resultType: 'numeric' },
      { id: 'p_creat', name: 'Serum Creatinine', unit: 'mg/dL', referenceRange: '0.6 - 1.3', resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-CHE-03',
    code: 'HBA1C',
    name: 'Glycated Hemoglobin (HbA1c)',
    category: 'CHEMICAL_PATHOLOGY',
    price: 6000,
    sampleType: 'Whole Blood (EDTA)',
    turnaroundTime: '2 Hours',
    description: 'Long-term glycemic control over preceding 90-120 days.',
    parameters: [
      { id: 'p_hba1c', name: 'HbA1c Percentage', unit: '%', referenceRange: '4.0 - 5.6 (Non-Diabetic)', resultType: 'numeric' },
      { id: 'p_eag', name: 'Estimated Average Glucose (eAG)', unit: 'mg/dL', referenceRange: '70 - 114', resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-CHE-04',
    code: 'LIPID',
    name: 'Fasting Lipid Panel',
    category: 'CHEMICAL_PATHOLOGY',
    price: 6500,
    sampleType: 'Serum (Fasting 12h)',
    turnaroundTime: '3 Hours',
    description: 'Cardiovascular atherosclerotic risk screening.',
    parameters: [
      { id: 'p_tchol', name: 'Total Cholesterol', unit: 'mg/dL', referenceRange: '< 200', resultType: 'numeric' },
      { id: 'p_ldl', name: 'LDL Cholesterol (Calculated)', unit: 'mg/dL', referenceRange: '< 100', resultType: 'numeric' },
      { id: 'p_hdl', name: 'HDL Cholesterol', unit: 'mg/dL', referenceRange: '> 40 (Male) / > 50 (Female)', resultType: 'numeric' },
      { id: 'p_tg', name: 'Serum Triglycerides', unit: 'mg/dL', referenceRange: '< 150', resultType: 'numeric' }
    ]
  },

  // 4. HISTOPATHOLOGY
  {
    id: 'LAB-HIS-01',
    code: 'BIOPSY_HISTO',
    name: 'Tissue Biopsy Histopathological Evaluation',
    category: 'HISTOPATHOLOGY',
    price: 20000,
    sampleType: 'Formalin-fixed Tissue Specimen (10% Neutral Buffered Formalin)',
    turnaroundTime: '5 - 7 Days',
    description: 'Gross anatomical grossing, paraffin embedding, microtome sectioning, H&E staining, and board-certified pathologist diagnosis.',
    parameters: [
      { id: 'p_gross', name: 'Macroscopic / Gross Description', unit: '-', referenceRange: 'Descriptive', resultType: 'text' },
      { id: 'p_micro', name: 'Microscopic Examination', unit: '-', referenceRange: 'Descriptive', resultType: 'text' },
      { id: 'p_histo_diag', name: 'Histopathological Pathological Diagnosis', unit: '-', referenceRange: 'Benign / Malignant classification', resultType: 'text' },
      { id: 'p_margins', name: 'Surgical Resection Margins', unit: '-', referenceRange: 'Clear / Involved', resultType: 'text' }
    ]
  },
  {
    id: 'LAB-HIS-02',
    code: 'PAP_SMEAR',
    name: 'Cervical Liquid-Based Cytology (Pap Smear)',
    category: 'HISTOPATHOLOGY',
    price: 9000,
    sampleType: 'Endocervical Brush Vial Specimen',
    turnaroundTime: '3 Days',
    description: 'Screening for epithelial cervical dysplasia according to the Bethesda Classification.',
    parameters: [
      { id: 'p_adequacy', name: 'Specimen Adequacy', unit: '-', referenceRange: 'Satisfactory for evaluation', resultType: 'text' },
      { id: 'p_bethesda', name: 'Bethesda Category Classification', unit: '-', referenceRange: 'NILM (Negative for Intraepithelial Lesion or Malignancy)', resultType: 'text' },
      { id: 'p_cyto_comments', name: 'Cytotechnologist / Pathologist Remarks', unit: '-', referenceRange: 'No atypia', resultType: 'text' }
    ]
  }
];

export const initialMedications: Medication[] = [
  {
    id: 'MED-001',
    name: 'Coartem (Artemether 80mg / Lumefantrine 480mg)',
    genericName: 'Artemether + Lumefantrine',
    category: 'Antimalarial',
    dosageForm: 'Tablet',
    strength: '80/480 mg',
    unitPrice: 3500,
    currentStock: 140,
    minStockAlert: 20,
    dispensingUnit: 'Pack (6 tabs)'
  },
  {
    id: 'MED-002',
    name: 'Amoxicillin / Clavulanate (Augmentin)',
    genericName: 'Amoxicillin + Clavulanic Acid',
    category: 'Antibiotics',
    dosageForm: 'Film-coated Tablet',
    strength: '625 mg',
    unitPrice: 4500,
    currentStock: 85,
    minStockAlert: 15,
    dispensingUnit: 'Blister pack (14 tabs)'
  },
  {
    id: 'MED-003',
    name: 'Paracetamol (Acetaminophen)',
    genericName: 'Paracetamol',
    category: 'Analgesic / Antipyretic',
    dosageForm: 'Tablet',
    strength: '500 mg',
    unitPrice: 50,
    currentStock: 1200,
    minStockAlert: 100,
    dispensingUnit: 'Tablet'
  },
  {
    id: 'MED-004',
    name: 'Metformin Hydrochloride',
    genericName: 'Metformin',
    category: 'Antidiabetic / Biguanide',
    dosageForm: 'Extended Release Tablet',
    strength: '500 mg',
    unitPrice: 120,
    currentStock: 450,
    minStockAlert: 50,
    dispensingUnit: 'Tablet'
  },
  {
    id: 'MED-005',
    name: 'Amlodipine Besylate (Norvasc)',
    genericName: 'Amlodipine',
    category: 'Antihypertensive (CCB)',
    dosageForm: 'Tablet',
    strength: '5 mg',
    unitPrice: 150,
    currentStock: 380,
    minStockAlert: 40,
    dispensingUnit: 'Tablet'
  },
  {
    id: 'MED-006',
    name: 'Omeprazole',
    genericName: 'Omeprazole',
    category: 'Gastrointestinal (PPI)',
    dosageForm: 'Delayed Release Capsule',
    strength: '20 mg',
    unitPrice: 150,
    currentStock: 260,
    minStockAlert: 30,
    dispensingUnit: 'Capsule'
  },
  {
    id: 'MED-007',
    name: 'Ciprofloxacin',
    genericName: 'Ciprofloxacin HCl',
    category: 'Fluoroquinolone Antibiotic',
    dosageForm: 'Tablet',
    strength: '500 mg',
    unitPrice: 200,
    currentStock: 180,
    minStockAlert: 25,
    dispensingUnit: 'Tablet'
  }
];

export const initialServicePrices: ServicePriceItem[] = [
  { id: 'SVC-001', name: 'General Physician Consultation', category: 'Consultation', price: 10000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-002', name: 'Specialist Physician Consultation', category: 'Consultation', price: 18000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-003', name: 'Standard Nursing Care & Vitals Triage', category: 'Nursing', price: 3000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-004', name: 'Wound Dressing & Aseptic Bandaging', category: 'Procedure', price: 4500, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-005', name: 'Intravenous Cannulation & Fluid Setup', category: 'Procedure', price: 5000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-006', name: 'Intramuscular/Subcutaneous Injection Fee', category: 'Nursing', price: 1500, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-007', name: 'ECG 12-Lead Diagnostic Trace', category: 'Procedure', price: 8000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-008', name: 'Hospital Registration & Smart Card', category: 'Other', price: 2000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-009', name: 'Antenatal Care Visit & Monitoring', category: 'Consultation', price: 7500, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-010', name: 'Follow-up Consultation Visit', category: 'Consultation', price: 5000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-RAD-01', name: 'Digital Chest X-Ray (PA View)', category: 'Procedure', price: 12500, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-RAD-02', name: 'Abdominal & Pelvic Ultrasound Scan', category: 'Procedure', price: 15000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-RAD-03', name: 'Brain CT Scan (Plain)', category: 'Procedure', price: 65000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-RAD-04', name: 'Lumbar Spine MRI (Plain & Contrast)', category: 'Procedure', price: 120000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-PT-01', name: 'Musculoskeletal Spinal Decompression & Traction', category: 'Procedure', price: 15000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-PT-02', name: 'Stroke & Neurological Rehabilitation Session', category: 'Procedure', price: 12000, active: true, effectiveDate: '2026-01-01' },
  { id: 'SVC-PT-03', name: 'Sports Injury Joint Mobilization & Electrotherapy', category: 'Procedure', price: 10000, active: true, effectiveDate: '2026-01-01' }
];

export const initialPatients: Patient[] = [];

export const initialVisits: Visit[] = [];

export const initialVitals: Vitals[] = [];

export const initialConsultations: Consultation[] = [];

export const initialLabRequests: LabRequest[] = [];

export const initialPrescriptions: Prescription[] = [];

export const initialInvoices: Invoice[] = [];

export const initialAuditLogs: AuditLog[] = [];

export const initialOnlineBookings: import('../types').OnlineBooking[] = [];

export const initialLabStock: import('../types').LabStockItem[] = [
  {
    id: 'STK-001',
    name: 'EDTA Vacutainer Tubes (Purple Top 4ml)',
    category: 'Tubes',
    currentStock: 450,
    unit: 'Tubes',
    unitCost: 150,
    minAlertLevel: 100,
    lastUsedAt: '2026-09-08T08:00:00Z'
  },
  {
    id: 'STK-002',
    name: 'Plain Clot Activator Tubes (Red Top 5ml)',
    category: 'Tubes',
    currentStock: 380,
    unit: 'Tubes',
    unitCost: 160,
    minAlertLevel: 80,
    lastUsedAt: '2026-09-08T08:30:00Z'
  },
  {
    id: 'STK-003',
    name: 'Sodium Citrate Tubes (Blue Top 2.7ml)',
    category: 'Tubes',
    currentStock: 190,
    unit: 'Tubes',
    unitCost: 200,
    minAlertLevel: 50,
    lastUsedAt: '2026-09-07T14:00:00Z'
  },
  {
    id: 'STK-004',
    name: 'Mindray 5-Part Hematology Diluent & Lyse Reagents',
    category: 'Reagents',
    currentStock: 18,
    unit: 'Litres',
    unitCost: 35000,
    minAlertLevel: 5,
    lastUsedAt: '2026-09-08T09:00:00Z'
  },
  {
    id: 'STK-005',
    name: 'Pf/Pan Rapid Diagnostic Malaria Antigen Test Strips',
    category: 'Kits',
    currentStock: 250,
    unit: 'Test Strips',
    unitCost: 800,
    minAlertLevel: 50,
    lastUsedAt: '2026-09-08T09:15:00Z'
  },
  {
    id: 'STK-006',
    name: 'Urine 10-Parameter Chemical Reagent Strips (Combi 10)',
    category: 'Kits',
    currentStock: 120,
    unit: 'Strips',
    unitCost: 400,
    minAlertLevel: 30,
    lastUsedAt: '2026-09-08T08:45:00Z'
  },
  {
    id: 'STK-007',
    name: 'Giemsa Stain Solution 1L',
    category: 'Stains',
    currentStock: 6,
    unit: 'Bottles',
    unitCost: 12000,
    minAlertLevel: 2,
    lastUsedAt: '2026-09-07T16:00:00Z'
  },
  {
    id: 'STK-008',
    name: 'Microscope Frosted Slides & Cover Slips (Box of 100)',
    category: 'Consumables',
    currentStock: 45,
    unit: 'Boxes',
    unitCost: 2500,
    minAlertLevel: 10,
    lastUsedAt: '2026-09-08T08:15:00Z'
  }
];

export const initialLabStockRequests: import('../types').LabStockRequest[] = [];

export const initialRadiologyOrders: import('../types').RadiologyOrder[] = [];

export const initialPhysiotherapyOrders: import('../types').PhysiotherapyOrder[] = [];

export const initialClinicalConsumables: import('../types').ClinicalConsumable[] = [
  {
    id: 'CSM-001',
    name: 'Disposable Examination Gloves (Latex Free, Box of 100)',
    category: 'Nursing',
    unit: 'Boxes',
    currentStock: 120,
    minAlertLevel: 20,
    unitPrice: 3500,
    costPrice: 2400,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-002',
    name: 'Disposable Hypodermic Syringes 5ml with 21G Needle (Box of 100)',
    category: 'Nursing',
    unit: 'Boxes',
    currentStock: 85,
    minAlertLevel: 15,
    unitPrice: 4500,
    costPrice: 3100,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-003',
    name: 'Intravenous Cannula 20G Pink with Wings (Box of 50)',
    category: 'Emergency',
    unit: 'Boxes',
    currentStock: 60,
    minAlertLevel: 10,
    unitPrice: 6500,
    costPrice: 4800,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-004',
    name: 'Elastic Crepe Bandage Rolls 4 inch (Pack of 12)',
    category: 'Consultation',
    unit: 'Packs',
    currentStock: 40,
    minAlertLevel: 8,
    unitPrice: 5000,
    costPrice: 3500,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-005',
    name: 'Absorbent Cotton Wool Roll 500g B.P.',
    category: 'Nursing',
    unit: 'Rolls',
    currentStock: 75,
    minAlertLevel: 12,
    unitPrice: 2200,
    costPrice: 1500,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-006',
    name: 'Foley 2-Way Silicone Urinary Catheter 16Fr',
    category: 'Surgical',
    unit: 'Pieces',
    currentStock: 35,
    minAlertLevel: 10,
    unitPrice: 1800,
    costPrice: 1100,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-007',
    name: 'Urine Drainage Collector Bag 2000ml with Anti-Reflux Valve',
    category: 'Nursing',
    unit: 'Pieces',
    currentStock: 50,
    minAlertLevel: 15,
    unitPrice: 1200,
    costPrice: 750,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-008',
    name: 'Medical Ultrasound Acoustic Coupling Gel (5 Litre Dispenser)',
    category: 'Radiology',
    unit: 'Gallons',
    currentStock: 18,
    minAlertLevel: 4,
    unitPrice: 14000,
    costPrice: 9500,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-009',
    name: 'Digital X-Ray Blue Sensitive Medical Laser Films (Box of 100)',
    category: 'Radiology',
    unit: 'Boxes',
    currentStock: 25,
    minAlertLevel: 5,
    unitPrice: 28000,
    costPrice: 20000,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-010',
    name: 'TENS / EMS Self-Adhesive Electrotherapy Gel Pads (Pack of 4)',
    category: 'Physiotherapy',
    unit: 'Packs',
    currentStock: 30,
    minAlertLevel: 6,
    unitPrice: 3800,
    costPrice: 2500,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-011',
    name: 'Therapy Resistance Latex Exercise Bands (Set of 5 Strengths)',
    category: 'Physiotherapy',
    unit: 'Sets',
    currentStock: 20,
    minAlertLevel: 5,
    unitPrice: 8500,
    costPrice: 5500,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-012',
    name: 'Vacutainer EDTA Blood Collection Tubes 4ml (Pack of 100)',
    category: 'Laboratory',
    unit: 'Packs',
    currentStock: 45,
    minAlertLevel: 10,
    unitPrice: 12000,
    costPrice: 8500,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-013',
    name: 'Glass Microscope Slides with Frosted End (Box of 50)',
    category: 'Laboratory',
    unit: 'Boxes',
    currentStock: 38,
    minAlertLevel: 8,
    unitPrice: 4500,
    costPrice: 3000,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-014',
    name: 'Sterile Urine Sample Containers 30ml (Pack of 100)',
    category: 'Laboratory',
    unit: 'Packs',
    currentStock: 52,
    minAlertLevel: 12,
    unitPrice: 6000,
    costPrice: 4200,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-015',
    name: 'Pharmacy Dispensing Envelopes Small (Pack of 500)',
    category: 'Pharmacy',
    unit: 'Packs',
    currentStock: 25,
    minAlertLevel: 6,
    unitPrice: 3500,
    costPrice: 2200,
    lastUpdated: '2026-09-08T10:00:00Z'
  },
  {
    id: 'CSM-016',
    name: 'Amber Medicine Dispensing Bottles 100ml (Pack of 50)',
    category: 'Pharmacy',
    unit: 'Packs',
    currentStock: 30,
    minAlertLevel: 8,
    unitPrice: 7500,
    costPrice: 5000,
    lastUpdated: '2026-09-08T10:00:00Z'
  }
];

