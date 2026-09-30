// `import type`, like the other services: these are all interfaces, so a value
// import is erased by the bundler but not by Node, which scripts/sync-selftest.mjs
// uses to import this module and check the catalogue against the seed.
import type {
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
  hospitalName: 'Solace Medicare Consult',
  tagline: 'Precision Care. Connected Health. Zero Compromise.',
  address: '14 Healthcare Boulevard, Medical District, Victoria Island',
  phone: '+2348035992252',
  email: 'care@solacemedicares.com',
  currency: '₦',
  currencyCode: 'NGN',
  invoicePrefix: 'FC-INV',
  patientPrefix: 'FC',
  inactivityTimeoutMinutes: 5
};

export const initialReceiptSettings: import('../types').ReceiptSettings = {
  hospitalName: 'Solace Medicare Consult',
  tagline: 'Precision Care. Connected Health. Zero Compromise.',
  address: '14 Healthcare Boulevard, Medical District, Victoria Island',
  phone: '+2348035992252',
  email: 'care@solacemedicares.com',
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

// No staff are seeded.
//
// A seeded account is a credential that ships to production, and a literal
// password in this file is one that ships in the JavaScript bundle, readable by
// anyone who opens devtools. It also cannot be rotated without a redeploy.
//
// The first administrator is created from the command line instead:
//
//     node scripts/provision-staff.mjs --name "Dr. Sarah Alabi" \
//       --email you@solacemedicares.com --role ADMINISTRATOR
//
// See database/fatclinic.sql for the same note on the SQL side.
export const initialUsers: User[] = [];

// The laboratory catalogue, GENERATED - do not hand-edit below this line.
//
// The catalogue is declared once, in database/fatclinic.sql, because that is what
// a fresh install runs. This copy exists so the browser has the same catalogue to
// show before it has ever signed in. The two used to be maintained by hand and
// drifted, and that drift is the whole reason Full Blood Count could be recorded
// in a single free-text box: nine of the investigations came from here and five
// from the schema file, and where both claimed the same id the first one to arrive
// won, so FBC was in the database with no panel at all while its panel sat here in
// a browser cache.
//
// Regenerate after changing the seed:  node scripts/generate-lab-catalogue.mjs
// db:sync:test fails if this file and the seed ever disagree again.
export const initialLabInvestigations: LabInvestigationDefinition[] = [
  {
    id: 'LAB-HEM-01',
    code: 'FBC',
    name: 'Full Blood Count',
    category: 'HEMATOLOGY',
    price: 3500,
    sampleType: 'Whole Blood (EDTA)',
    turnaroundTime: '2-4 hours',
    description: 'Haemoglobin, red-cell indices, total and differential white-cell count, platelets and a morphology note.',
    parameters: [
      { id: 'LAB-HEM-01.p_hb', name: 'Hemoglobin (Hb)', unit: 'g/dL', referenceRange: '12.0 - 17.5', refLow: 12, refHigh: 17.5, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_rbc', name: 'Red Blood Cell Count (RBC)', unit: 'x10^12/L', referenceRange: '4.5 - 6.5', refLow: 4.5, refHigh: 6.5, sortOrder: 20, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_pcv', name: 'Packed Cell Volume (PCV)', unit: '%', referenceRange: '36.0 - 52.0', refLow: 36, refHigh: 52, sortOrder: 30, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_mcv', name: 'Mean Corpuscular Volume (MCV)', unit: 'fL', referenceRange: '80.0 - 100.0', refLow: 80, refHigh: 100, sortOrder: 40, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_mch', name: 'Mean Corpuscular Hemoglobin (MCH)', unit: 'pg', referenceRange: '27.0 - 33.0', refLow: 27, refHigh: 33, sortOrder: 50, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_mchc', name: 'Mean Corpuscular Hemoglobin Concentration (MCHC)', unit: 'g/dL', referenceRange: '32.0 - 36.0', refLow: 32, refHigh: 36, sortOrder: 60, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_rdw', name: 'Red Cell Distribution Width (RDW)', unit: '%', referenceRange: '11.0 - 14.0', refLow: 11, refHigh: 14, sortOrder: 70, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_wbc', name: 'Total White Blood Cell Count (WBC)', unit: 'x10^9/L', referenceRange: '4.0 - 11.0', refLow: 4, refHigh: 11, sortOrder: 80, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_neut', name: 'Neutrophils (Neutrophil %)', unit: '%', referenceRange: '40 - 75', refLow: 40, refHigh: 75, sortOrder: 90, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_lymph', name: 'Lymphocytes (Lymphocyte %)', unit: '%', referenceRange: '20 - 45', refLow: 20, refHigh: 45, sortOrder: 100, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_mono', name: 'Monocytes (Monocyte %)', unit: '%', referenceRange: '2 - 10', refLow: 2, refHigh: 10, sortOrder: 110, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_eos', name: 'Eosinophils (Eosinophil %)', unit: '%', referenceRange: '1 - 6', refLow: 1, refHigh: 6, sortOrder: 120, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_baso', name: 'Basophils (Basophil %)', unit: '%', referenceRange: '0 - 2', refLow: 0, refHigh: 2, sortOrder: 130, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_plt', name: 'Platelet Count', unit: 'x10^9/L', referenceRange: '150 - 450', refLow: 150, refHigh: 450, sortOrder: 140, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_mpv', name: 'Mean Platelet Volume (MPV)', unit: 'fL', referenceRange: '7.0 - 12.0', refLow: 7, refHigh: 12, sortOrder: 150, resultType: 'numeric' },
      { id: 'LAB-HEM-01.p_morph', name: 'Red Cell Morphology & Comment', unit: '-', referenceRange: 'Normochromic normocytes', refLow: null, refHigh: null, sortOrder: 160, resultType: 'text' }
    ]
  },
  {
    id: 'LAB-HEM-02',
    code: 'ESR',
    name: 'Erythrocyte Sedimentation Rate',
    category: 'HEMATOLOGY',
    price: 2500,
    sampleType: 'Whole Blood (Sodium Citrate - Black Top)',
    turnaroundTime: '1.5 hours',
    description: 'Nonspecific marker of systemic inflammation and active infection.',
    parameters: [
      { id: 'LAB-HEM-02.p_esr', name: 'Westergren ESR (1 hour)', unit: 'mm/hr', referenceRange: '0 - 20', refLow: 0, refHigh: 20, sortOrder: 10, resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-HEM-03',
    code: 'COAG',
    name: 'Coagulation Profile (PT/INR & aPTT)',
    category: 'HEMATOLOGY',
    price: 7500,
    sampleType: 'Citrated Plasma (Blue Top)',
    turnaroundTime: '3 hours',
    description: 'Extrinsic and intrinsic coagulation cascade screening.',
    parameters: [
      { id: 'LAB-HEM-03.p_pt', name: 'Prothrombin Time (PT)', unit: 'seconds', referenceRange: '11.0 - 14.0', refLow: 11, refHigh: 14, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-HEM-03.p_inr', name: 'International Normalized Ratio (INR)', unit: 'ratio', referenceRange: '0.8 - 1.2', refLow: 0.8, refHigh: 1.2, sortOrder: 20, resultType: 'numeric' },
      { id: 'LAB-HEM-03.p_aptt', name: 'Activated Partial Thromboplastin Time (aPTT)', unit: 'seconds', referenceRange: '25.0 - 35.0', refLow: 25, refHigh: 35, sortOrder: 30, resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-MIC-01',
    code: 'URC',
    name: 'Urine Culture',
    category: 'MICROBIOLOGY',
    price: 6000,
    sampleType: 'Urine (sterile container)',
    turnaroundTime: '48-72 hours',
    description: 'Quantitative urine culture with the organism isolated and its antibiotic susceptibility pattern.',
    parameters: [
      { id: 'LAB-MIC-01.p_culture_growth', name: 'Quantitative Culture (Colony Count)', unit: 'CFU/mL', referenceRange: '< 100000', refLow: null, refHigh: 100000, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-MIC-01.p_isolate', name: 'Organism Isolated', unit: '-', referenceRange: 'No growth', refLow: null, refHigh: null, sortOrder: 20, resultType: 'text' },
      { id: 'LAB-MIC-01.p_sens_interp', name: 'Sensitivity Interpretation', unit: '-', referenceRange: 'Sensitive (S)', refLow: null, refHigh: null, sortOrder: 30, resultType: 'select', options: ['Sensitive (S)', 'Intermediate (I)', 'Resistant (R)'] },
      { id: 'LAB-MIC-01.p_sens_pattern', name: 'Antibiotic Susceptibility Pattern', unit: '-', referenceRange: 'Record each drug as S, I or R', refLow: null, refHigh: null, sortOrder: 40, resultType: 'text' }
    ]
  },
  {
    id: 'LAB-MIC-02',
    code: 'URINE_MCS',
    name: 'Urine Microscopy, Culture & Sensitivity',
    category: 'MICROBIOLOGY',
    price: 6000,
    sampleType: 'Clean Catch Mid-Stream Urine (Sterile Cup)',
    turnaroundTime: '48 hours',
    description: 'Direct urinalysis followed by microbiological agar culture and antibiotic susceptibility profiling.',
    parameters: [
      { id: 'LAB-MIC-02.p_appearance', name: 'Appearance & Color', unit: '-', referenceRange: 'Clear Straw', refLow: null, refHigh: null, sortOrder: 10, resultType: 'text' },
      { id: 'LAB-MIC-02.p_wbc_hpf', name: 'WBC (Pus Cells)', unit: '/HPF', referenceRange: '0 - 5', refLow: 0, refHigh: 5, sortOrder: 20, resultType: 'numeric' },
      { id: 'LAB-MIC-02.p_rbc_hpf', name: 'RBCs', unit: '/HPF', referenceRange: '0 - 2', refLow: 0, refHigh: 2, sortOrder: 30, resultType: 'numeric' },
      { id: 'LAB-MIC-02.p_culture_growth', name: 'Bacterial Colony Count', unit: 'CFU/mL', referenceRange: '< 100000', refLow: null, refHigh: 100000, sortOrder: 40, resultType: 'numeric' },
      { id: 'LAB-MIC-02.p_isolate', name: 'Isolated Pathogen', unit: '-', referenceRange: 'None', refLow: null, refHigh: null, sortOrder: 50, resultType: 'text' },
      { id: 'LAB-MIC-02.p_sens_interp', name: 'Sensitivity Interpretation', unit: '-', referenceRange: 'Sensitive (S)', refLow: null, refHigh: null, sortOrder: 60, resultType: 'select', options: ['Sensitive (S)', 'Intermediate (I)', 'Resistant (R)'] },
      { id: 'LAB-MIC-02.p_sens_pattern', name: 'Antibiotic Susceptibility Pattern', unit: '-', referenceRange: 'Record each drug as S, I or R', refLow: null, refHigh: null, sortOrder: 70, resultType: 'text' }
    ]
  },
  {
    id: 'LAB-MIC-03',
    code: 'STOOL_TEST',
    name: 'Stool Routine Microscopy & Occult Blood',
    category: 'MICROBIOLOGY',
    price: 3500,
    sampleType: 'Fresh Stool Specimen',
    turnaroundTime: '2 hours',
    description: 'Macroscopic and microscopic examination for parasites, and fecal occult hemoglobin.',
    parameters: [
      { id: 'LAB-MIC-03.p_macro', name: 'Macroscopic Examination', unit: '-', referenceRange: 'Formed, brown, no mucus or blood', refLow: null, refHigh: null, sortOrder: 10, resultType: 'text' },
      { id: 'LAB-MIC-03.p_ova_cysts', name: 'Microscopic Ova / Cysts / Trophozoites', unit: '-', referenceRange: 'None Seen', refLow: null, refHigh: null, sortOrder: 20, resultType: 'text' },
      { id: 'LAB-MIC-03.p_fob', name: 'Fecal Occult Blood (FOB)', unit: '-', referenceRange: 'Negative', refLow: null, refHigh: null, sortOrder: 30, resultType: 'reactive', options: ['Negative', 'Positive'] }
    ]
  },
  {
    id: 'LAB-MIC-04',
    code: 'MAL_TEST',
    name: 'Malaria Parasite Screen (Thick & Thin Film / RDT)',
    category: 'MICROBIOLOGY',
    price: 3000,
    sampleType: 'Capillary or EDTA Whole Blood',
    turnaroundTime: '1 hour',
    description: 'Giemsa-stained thick and thin films for species and density, with a PfHRP2 rapid diagnostic test.',
    parameters: [
      { id: 'LAB-MIC-04.p_mp_density', name: 'Malaria Parasite Density', unit: 'parasites/uL', referenceRange: '0 - 0', refLow: 0, refHigh: 0, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-MIC-04.p_species', name: 'Plasmodium Species Identified', unit: '-', referenceRange: 'None', refLow: null, refHigh: null, sortOrder: 20, resultType: 'select', options: ['None', 'P. falciparum', 'P. vivax', 'P. ovale', 'P. malariae', 'P. knowlesi', 'Mixed infection'] },
      { id: 'LAB-MIC-04.p_stage', name: 'Parasite Stage Seen', unit: '-', referenceRange: 'None seen', refLow: null, refHigh: null, sortOrder: 30, resultType: 'select', options: ['None seen', 'Ring forms', 'Trophozoites', 'Schizonts', 'Gametocytes'] },
      { id: 'LAB-MIC-04.p_rdt', name: 'PfHRP2 Rapid Diagnostic Test', unit: '-', referenceRange: 'Negative', refLow: null, refHigh: null, sortOrder: 40, resultType: 'reactive', options: ['Negative', 'Positive (Pf)', 'Invalid - repeat test'] }
    ]
  },
  {
    id: 'LAB-CHE-01',
    code: 'LFT',
    name: 'Liver Function Tests (Hepatic Panel)',
    category: 'CHEMICAL_PATHOLOGY',
    price: 7000,
    sampleType: 'Serum (Gold/Red Top SST)',
    turnaroundTime: '3 hours',
    description: 'Enzymatic and synthetic functional profile of hepatic parenchyma.',
    parameters: [
      { id: 'LAB-CHE-01.p_alt', name: 'Alanine Aminotransferase (ALT/SGPT)', unit: 'U/L', referenceRange: '7 - 45', refLow: 7, refHigh: 45, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-CHE-01.p_ast', name: 'Aspartate Aminotransferase (AST/SGOT)', unit: 'U/L', referenceRange: '8 - 40', refLow: 8, refHigh: 40, sortOrder: 20, resultType: 'numeric' },
      { id: 'LAB-CHE-01.p_alp', name: 'Alkaline Phosphatase (ALP)', unit: 'U/L', referenceRange: '40 - 130', refLow: 40, refHigh: 130, sortOrder: 30, resultType: 'numeric' },
      { id: 'LAB-CHE-01.p_ggt', name: 'Gamma-Glutamyl Transferase (GGT)', unit: 'U/L', referenceRange: '10 - 71', refLow: 10, refHigh: 71, sortOrder: 40, resultType: 'numeric' },
      { id: 'LAB-CHE-01.p_tbil', name: 'Total Bilirubin', unit: 'mg/dL', referenceRange: '0.2 - 1.2', refLow: 0.2, refHigh: 1.2, sortOrder: 50, resultType: 'numeric' },
      { id: 'LAB-CHE-01.p_dbil', name: 'Direct (Conjugated) Bilirubin', unit: 'mg/dL', referenceRange: '0.0 - 0.3', refLow: 0, refHigh: 0.3, sortOrder: 60, resultType: 'numeric' },
      { id: 'LAB-CHE-01.p_tprot', name: 'Total Serum Protein', unit: 'g/dL', referenceRange: '6.4 - 8.3', refLow: 6.4, refHigh: 8.3, sortOrder: 70, resultType: 'numeric' },
      { id: 'LAB-CHE-01.p_alb', name: 'Serum Albumin', unit: 'g/dL', referenceRange: '3.5 - 5.0', refLow: 3.5, refHigh: 5, sortOrder: 80, resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-CHE-02',
    code: 'UE_CREAT',
    name: 'Urea, Electrolytes & Serum Creatinine (Renal Profile)',
    category: 'CHEMICAL_PATHOLOGY',
    price: 6500,
    sampleType: 'Serum (Gold/Red Top SST)',
    turnaroundTime: '3 hours',
    description: 'Renal clearance, estimated glomerular filtration, and systemic electrolyte homeostasis.',
    parameters: [
      { id: 'LAB-CHE-02.p_sodium', name: 'Sodium (Na+)', unit: 'mmol/L', referenceRange: '135 - 145', refLow: 135, refHigh: 145, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-CHE-02.p_potassium', name: 'Potassium (K+)', unit: 'mmol/L', referenceRange: '3.5 - 5.1', refLow: 3.5, refHigh: 5.1, sortOrder: 20, resultType: 'numeric' },
      { id: 'LAB-CHE-02.p_chloride', name: 'Chloride (Cl-)', unit: 'mmol/L', referenceRange: '98 - 107', refLow: 98, refHigh: 107, sortOrder: 30, resultType: 'numeric' },
      { id: 'LAB-CHE-02.p_bicarb', name: 'Bicarbonate (HCO3-)', unit: 'mmol/L', referenceRange: '22 - 29', refLow: 22, refHigh: 29, sortOrder: 40, resultType: 'numeric' },
      { id: 'LAB-CHE-02.p_urea', name: 'Blood Urea Nitrogen (BUN)', unit: 'mg/dL', referenceRange: '7 - 20', refLow: 7, refHigh: 20, sortOrder: 50, resultType: 'numeric' },
      { id: 'LAB-CHE-02.p_creat', name: 'Serum Creatinine', unit: 'mg/dL', referenceRange: '0.6 - 1.3', refLow: 0.6, refHigh: 1.3, sortOrder: 60, resultType: 'numeric' },
      { id: 'LAB-CHE-02.p_egfr', name: 'Estimated Glomerular Filtration Rate (eGFR)', unit: 'mL/min/1.73m2', referenceRange: '> 90', refLow: 90, refHigh: null, sortOrder: 70, resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-CHE-03',
    code: 'HBA1C',
    name: 'Glycated Hemoglobin (HbA1c)',
    category: 'CHEMICAL_PATHOLOGY',
    price: 6000,
    sampleType: 'Whole Blood (EDTA)',
    turnaroundTime: '2 hours',
    description: 'Long-term glycemic control over the preceding 90-120 days.',
    parameters: [
      { id: 'LAB-CHE-03.p_hba1c', name: 'HbA1c Percentage', unit: '%', referenceRange: '4.0 - 5.6', refLow: 4, refHigh: 5.6, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-CHE-03.p_eag', name: 'Estimated Average Glucose (eAG)', unit: 'mg/dL', referenceRange: '70 - 114', refLow: 70, refHigh: 114, sortOrder: 20, resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-CHE-04',
    code: 'LIPID',
    name: 'Fasting Lipid Panel',
    category: 'CHEMICAL_PATHOLOGY',
    price: 6500,
    sampleType: 'Serum (Fasting 12h)',
    turnaroundTime: '3 hours',
    description: 'Cardiovascular atherosclerotic risk screening.',
    parameters: [
      { id: 'LAB-CHE-04.p_tchol', name: 'Total Cholesterol', unit: 'mg/dL', referenceRange: '< 200', refLow: null, refHigh: 200, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-CHE-04.p_ldl', name: 'LDL Cholesterol (Calculated)', unit: 'mg/dL', referenceRange: '< 100', refLow: null, refHigh: 100, sortOrder: 20, resultType: 'numeric' },
      { id: 'LAB-CHE-04.p_hdl', name: 'HDL Cholesterol', unit: 'mg/dL', referenceRange: '> 40', refLow: 40, refHigh: null, sortOrder: 30, resultType: 'numeric' },
      { id: 'LAB-CHE-04.p_tg', name: 'Serum Triglycerides', unit: 'mg/dL', referenceRange: '< 150', refLow: null, refHigh: 150, sortOrder: 40, resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-CHP-01',
    code: 'EUC',
    name: 'Electrolytes, Urea & Creatinine',
    category: 'CHEMICAL_PATHOLOGY',
    price: 5500,
    sampleType: 'Serum (plain tube)',
    turnaroundTime: '4-6 hours',
    description: 'Electrolyte and renal analyte panel reported without the indices.',
    parameters: [
      { id: 'LAB-CHP-01.p_sodium', name: 'Sodium (Na+)', unit: 'mmol/L', referenceRange: '135 - 145', refLow: 135, refHigh: 145, sortOrder: 10, resultType: 'numeric' },
      { id: 'LAB-CHP-01.p_potassium', name: 'Potassium (K+)', unit: 'mmol/L', referenceRange: '3.5 - 5.1', refLow: 3.5, refHigh: 5.1, sortOrder: 20, resultType: 'numeric' },
      { id: 'LAB-CHP-01.p_chloride', name: 'Chloride (Cl-)', unit: 'mmol/L', referenceRange: '98 - 107', refLow: 98, refHigh: 107, sortOrder: 30, resultType: 'numeric' },
      { id: 'LAB-CHP-01.p_bicarb', name: 'Bicarbonate (HCO3-)', unit: 'mmol/L', referenceRange: '22 - 29', refLow: 22, refHigh: 29, sortOrder: 40, resultType: 'numeric' },
      { id: 'LAB-CHP-01.p_urea', name: 'Blood Urea Nitrogen (BUN)', unit: 'mg/dL', referenceRange: '7 - 20', refLow: 7, refHigh: 20, sortOrder: 50, resultType: 'numeric' },
      { id: 'LAB-CHP-01.p_creat', name: 'Serum Creatinine', unit: 'mg/dL', referenceRange: '0.6 - 1.3', refLow: 0.6, refHigh: 1.3, sortOrder: 60, resultType: 'numeric' }
    ]
  },
  {
    id: 'LAB-HIS-01',
    code: 'HPE',
    name: 'Histopathology Examination',
    category: 'HISTOPATHOLOGY',
    price: 25000,
    sampleType: 'Tissue in formalin',
    turnaroundTime: '5-7 days',
    description: 'Gross description, microscopic examination, pathological diagnosis, and margin status.',
    parameters: [
      { id: 'LAB-HIS-01.p_gross', name: 'Macroscopic / Gross Description', unit: '-', referenceRange: 'Descriptive', refLow: null, refHigh: null, sortOrder: 10, resultType: 'text' },
      { id: 'LAB-HIS-01.p_micro', name: 'Microscopic Examination', unit: '-', referenceRange: 'Descriptive', refLow: null, refHigh: null, sortOrder: 20, resultType: 'text' },
      { id: 'LAB-HIS-01.p_diagnosis', name: 'Pathological Diagnosis', unit: '-', referenceRange: 'Benign / Malignant classification', refLow: null, refHigh: null, sortOrder: 30, resultType: 'text' },
      { id: 'LAB-HIS-01.p_margins', name: 'Surgical Resection Margins', unit: '-', referenceRange: 'Clear', refLow: null, refHigh: null, sortOrder: 40, resultType: 'select', options: ['Clear', 'Close (<1mm)', 'Involved', 'Not applicable'] },
      { id: 'LAB-HIS-01.p_grade', name: 'Tumour Grade / Differentiation', unit: '-', referenceRange: 'Not graded', refLow: null, refHigh: null, sortOrder: 50, resultType: 'text' }
    ]
  },
  {
    id: 'LAB-HIS-02',
    code: 'PAP_SMEAR',
    name: 'Cervical Liquid-Based Cytology (Pap Smear)',
    category: 'HISTOPATHOLOGY',
    price: 9000,
    sampleType: 'Endocervical Brush Vial Specimen',
    turnaroundTime: '3 days',
    description: 'Screening for epithelial cervical dysplasia according to the Bethesda classification.',
    parameters: [
      { id: 'LAB-HIS-02.p_adequacy', name: 'Specimen Adequacy', unit: '-', referenceRange: 'Satisfactory for evaluation', refLow: null, refHigh: null, sortOrder: 10, resultType: 'select', options: ['Satisfactory for evaluation', 'Satisfactory but limited by inflammation', 'Unsatisfactory - repeat in 3 months'] },
      { id: 'LAB-HIS-02.p_bethesda', name: 'Bethesda Category Classification (NILM = Negative for Intraepithelial Lesion or Malignancy)', unit: '-', referenceRange: 'NILM', refLow: null, refHigh: null, sortOrder: 20, resultType: 'select', options: ['NILM', 'ASC-US', 'ASC-H', 'LSIL', 'HSIL', 'Atypical glandular cells', 'Malignant', 'Insufficient sample'] },
      { id: 'LAB-HIS-02.p_cyto_comments', name: 'Cytotechnologist / Pathologist Remarks', unit: '-', referenceRange: 'No atypia', refLow: null, refHigh: null, sortOrder: 30, resultType: 'text' }
    ]
  },
  {
    id: 'LAB-MOL-01',
    code: 'PCR',
    name: 'Polymerase Chain Reaction',
    category: 'MOLECULAR',
    price: 30000,
    sampleType: 'Swab / Blood',
    turnaroundTime: '24-48 hours',
    description: 'Nucleic-acid amplification with the target, assay, interpretation, cycle threshold and quantitation recorded.',
    parameters: [
      { id: 'LAB-MOL-01.p_target', name: 'Molecular Target / Gene Assayed', unit: '-', referenceRange: 'Name the target assayed', refLow: null, refHigh: null, sortOrder: 10, resultType: 'text' },
      { id: 'LAB-MOL-01.p_tech', name: 'Assay Platform / Method', unit: '-', referenceRange: 'Name the platform', refLow: null, refHigh: null, sortOrder: 20, resultType: 'text' },
      { id: 'LAB-MOL-01.p_result', name: 'Result Interpretation', unit: '-', referenceRange: 'Not detected', refLow: null, refHigh: null, sortOrder: 30, resultType: 'select', options: ['Not detected', 'Detected', 'Equivocal / inconclusive', 'Insufficient sample for testing', 'Invalid - repeat sample'] },
      { id: 'LAB-MOL-01.p_ct', name: 'Cycle Threshold (Ct / Cq)', unit: 'cycles', referenceRange: 'Not applicable', refLow: null, refHigh: null, sortOrder: 40, resultType: 'numeric' },
      { id: 'LAB-MOL-01.p_load', name: 'Viral Load / Quantitation', unit: 'copies/mL', referenceRange: 'Below detection limit', refLow: null, refHigh: null, sortOrder: 50, resultType: 'text' },
      { id: 'LAB-MOL-01.p_genotype', name: 'Genotype / Variant Identified', unit: '-', referenceRange: 'Not applicable', refLow: null, refHigh: null, sortOrder: 60, resultType: 'text' }
    ]
  },
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

