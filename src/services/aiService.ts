import { Patient, Consultation, Vitals, LabRequest, Prescription, Medication } from '../types';
import { db } from './db';

export interface AISummaryResult {
  patientId: string;
  generatedAt: string;
  summaryText: string;
  keyDiagnoses: string[];
  abnormalLabs: string[];
  activeMedications: string[];
  vitalTrends: string;
  clinicalAlerts: string[];
  disclaimer: string;
}

export interface AIQueryResult {
  query: string;
  interpretation: string;
  matchedCount: number;
  data: any[];
  displayType: 'patients' | 'labs' | 'medications' | 'invoices' | 'text';
  disclaimer: string;
}

export const aiService = {
  disclaimer: 'AI-assisted clinical intelligence. Requires professional clinical review and physician confirmation before decision making.',

  /**
   * Summarizes a patient's full medical history and current encounter
   */
  summarizePatient(patient: Patient, activeVisitId?: string): AISummaryResult {
    const visits = db.getVisits(patient.id);
    const vitalsList = db.getVitals(undefined, patient.id);
    const consultations = db.getPatientConsultations(patient.id);
    const labRequests = db.getLabRequests({ patientId: patient.id });
    const prescriptions = db.getPrescriptions(patient.id);

    // Identify all abnormal lab values across patient history
    const abnormalLabs: string[] = [];
    labRequests.forEach(req => {
      req.tests.forEach(test => {
        if (test.results) {
          test.results.forEach(res => {
            if (res.flag === 'High' || res.flag === 'Low' || res.flag === 'Critical' || res.flag === 'Abnormal') {
              abnormalLabs.push(`${test.testName}: ${res.parameterName} = ${res.value} ${res.unit} [${res.flag}] (Ref: ${res.referenceRange})`);
            }
          });
        }
      });
    });

    // Identify active medications
    const activeMedications: string[] = [];
    prescriptions.forEach(rx => {
      rx.items.forEach(item => {
        activeMedications.push(`${item.medicationName} (${item.dosage}) - ${item.frequency}`);
      });
    });

    // Diagnoses list
    const keyDiagnoses: string[] = [];
    consultations.forEach(c => {
      c.diagnoses.forEach(d => {
        if (!keyDiagnoses.includes(`${d.description} (${d.code})`)) {
          keyDiagnoses.push(`${d.description} (${d.code})`);
        }
      });
    });

    // Latest Vitals
    const latestVitals = vitalsList[0];
    let vitalTrends = 'No recent vitals documented.';
    if (latestVitals) {
      vitalTrends = `T: ${latestVitals.temperature}°C, BP: ${latestVitals.systolicBp}/${latestVitals.diastolicBp} mmHg, Pulse: ${latestVitals.pulse} bpm, SpO2: ${latestVitals.spo2}%, BMI: ${latestVitals.bmi} kg/m² (${latestVitals.bmiCategory})`;
    }

    // Synthesis text
    const latestConsultation = consultations[0];
    const summaryText = `
**Patient Overview**: ${patient.firstName} ${patient.lastName} (${patient.sex}, ${patient.age}y). Registered with ${visits.length} recorded clinical encounter(s).
**Current/Recent Presentation**: ${latestConsultation ? latestConsultation.presentingComplaint : 'Routine check-in or awaiting initial physician documentation.'}
**Clinical Assessment**: ${latestConsultation ? latestConsultation.assessment : 'Pending evaluation.'}
**Critical Diagnostic Signals**: ${abnormalLabs.length > 0 ? `Identified ${abnormalLabs.length} abnormal lab parameter(s) requiring attention.` : 'No critical laboratory flags detected on released records.'}
**Allergies & Cautions**: ${patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None documented.'}
    `.trim();

    return {
      patientId: patient.id,
      generatedAt: new Date().toISOString(),
      summaryText,
      keyDiagnoses,
      abnormalLabs,
      activeMedications,
      vitalTrends,
      clinicalAlerts: patient.alerts,
      disclaimer: this.disclaimer
    };
  },

  /**
   * Safe read-only natural language query processor
   */
  processNaturalLanguageQuery(query: string): AIQueryResult {
    const q = query.trim().toLowerCase();

    // 1. HbA1c query
    if (q.includes('hba1c') || q.includes('diabetes') || q.includes('glucose')) {
      const allLabs = db.getLabRequests();
      const matched = allLabs.filter(req => 
        req.tests.some(t => 
          (t.testName.toLowerCase().includes('hba1c') || t.testDefinitionId === 'LAB-CHE-03') &&
          t.results?.some(r => parseFloat(r.value) > 7.0 || r.flag === 'High')
        )
      );

      const patientDetails = matched.map(req => {
        const p = db.getPatientById(req.patientId);
        const test = req.tests.find(t => t.testDefinitionId === 'LAB-CHE-03');
        const val = test?.results?.find(r => r.parameterId === 'p_hba1c')?.value;
        return {
          patientId: req.patientId,
          name: p ? `${p.firstName} ${p.lastName}` : 'Unknown',
          age: p?.age,
          gender: p?.sex,
          test: 'HbA1c',
          value: `${val || 'Elevated'}%`,
          date: req.requestedAt.split('T')[0]
        };
      });

      return {
        query,
        interpretation: 'Searching clinical records for patients with elevated HbA1c or Glycemic pathology',
        matchedCount: patientDetails.length,
        data: patientDetails,
        displayType: 'patients',
        disclaimer: this.disclaimer
      };
    }

    // 2. Abnormal Liver Function / LFT
    if (q.includes('liver') || q.includes('lft') || q.includes('hepatic')) {
      const allLabs = db.getLabRequests();
      const lftLabs = allLabs.filter(req => 
        req.tests.some(t => t.category === 'CHEMICAL_PATHOLOGY' && (t.testName.toLowerCase().includes('liver') || t.testDefinitionId === 'LAB-CHE-01'))
      );

      const results = lftLabs.map(req => {
        const p = db.getPatientById(req.patientId);
        const test = req.tests.find(t => t.testDefinitionId === 'LAB-CHE-01');
        return {
          patientId: req.patientId,
          patientName: p ? `${p.firstName} ${p.lastName}` : 'Unknown',
          status: test?.status,
          date: req.requestedAt.split('T')[0],
          abnormalFindings: test?.results?.filter(r => r.flag !== 'Normal') || []
        };
      });

      return {
        query,
        interpretation: 'Aggregating Chemical Pathology investigations for Liver Function Tests (LFT)',
        matchedCount: results.length,
        data: results,
        displayType: 'labs',
        disclaimer: this.disclaimer
      };
    }

    // 3. Outstanding / Pending Lab Results
    if (q.includes('outstanding') || q.includes('pending') || q.includes('lab') || q.includes('requests')) {
      const allLabs = db.getLabRequests();
      const pending: any[] = [];
      allLabs.forEach(req => {
        req.tests.forEach(test => {
          if (test.status !== 'Released') {
            const p = db.getPatientById(req.patientId);
            pending.push({
              requestId: req.id,
              patientId: req.patientId,
              patientName: p ? `${p.firstName} ${p.lastName}` : 'Unknown',
              testName: test.testName,
              category: test.category,
              status: test.status,
              priority: req.priority,
              requestedAt: req.requestedAt.split('T')[0]
            });
          }
        });
      });

      return {
        query,
        interpretation: 'Filtering active laboratory queue for unreleased investigation requests',
        matchedCount: pending.length,
        data: pending,
        displayType: 'labs',
        disclaimer: this.disclaimer
      };
    }

    // 4. Low Stock Medications
    if (q.includes('stock') || q.includes('drug') || q.includes('pharmacy') || q.includes('low stock')) {
      const meds = db.getMedications().filter(m => m.currentStock <= m.minStockAlert * 1.5);
      return {
        query,
        interpretation: 'Auditing pharmacy inventory for drugs approaching or below minimum threshold',
        matchedCount: meds.length,
        data: meds,
        displayType: 'medications',
        disclaimer: this.disclaimer
      };
    }

    // 5. General patient search or fallback
    const matchedPatients = db.searchPatients(query);
    return {
      query,
      interpretation: `Searching patient registry matching term: "${query}"`,
      matchedCount: matchedPatients.length,
      data: matchedPatients.map(p => ({
        patientId: p.id,
        name: `${p.firstName} ${p.lastName}`,
        age: p.age,
        sex: p.sex,
        phone: p.phone,
        allergies: p.allergies.join(', ') || 'None',
        registeredAt: p.registeredAt.split('T')[0]
      })),
      displayType: 'patients',
      disclaimer: this.disclaimer
    };
  },

  /**
   * Autocomplete suggestions for physician documentation
   */
  getAutocompleteSuggestions(field: 'complaint' | 'exam' | 'plan' | 'diagnosis', input: string): string[] {
    const term = input.toLowerCase();

    const dictionary = {
      complaint: [
        'High-grade fever with chills and rigors x 3 days',
        'Persistent throbbing retro-orbital headache with photophobia',
        'Productive cough with yellowish-green sputum and pleuritic chest pain',
        'Generalized body weakness, anorexia, and bitter taste in mouth',
        'Colicky lower abdominal pain with watery loose stools',
        'Epigastric burning pain aggravated by fasting or spicy food',
        'Progressive dyspnea on exertion with bilateral pedal swelling'
      ],
      exam: [
        'Conscious, alert, febrile (38.5°C), not pale, anicteric, acyanotic, no pedal edema.',
        'Pulse 92 bpm regular, BP 130/80 mmHg. S1 S2 heard, no murmurs.',
        'Chest: Vesicular breath sounds bilaterally, clear lung fields, no wheeze or crepitations.',
        'Abdomen: Soft, non-tender, non-distended. Mild epigastric tenderness. Bowel sounds active.',
        'Neurological: GCS 15/15, pupils 3mm equal and reactive to light. No focal deficit.'
      ],
      plan: [
        '1. Urgent Full Blood Count, Malaria Parasite Giemsa film, and Liver Function Tests.',
        '2. Initiate oral Artemether/Lumefantrine (Coartem) 80/480mg BD with fatty meal.',
        '3. Antipyretic analgesia: Paracetamol 1g TDS for 3-5 days.',
        '4. Oral hydration therapy (>2.5 L/day) and adequate bed rest.',
        '5. Strict avoidance of allergen medications.',
        '6. Review in clinic in 72 hours or return sooner if danger signs arise.'
      ],
      diagnosis: [
        'Plasmodium falciparum malaria, unspecified (ICD-10: B50.9)',
        'Essential (primary) hypertension (ICD-10: I10)',
        'Type 2 diabetes mellitus without complications (ICD-10: E11.9)',
        'Acute bronchitis, unspecified (ICD-10: J20.9)',
        'Gastro-esophageal reflux disease without esophagitis (ICD-10: K21.9)',
        'Urinary tract infection, site not specified (ICD-10: N39.0)',
        'Gastroenteritis and colitis of unspecified origin (ICD-10: A09)'
      ]
    };

    return dictionary[field].filter(s => !input || s.toLowerCase().includes(term));
  }
};
