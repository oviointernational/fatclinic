import { Patient, Visit, Consultation, Vitals, LabRequest, Prescription, Invoice, PaymentRecord, SystemSettings, wardName } from '../types';
import { db } from './db';

export const pdfService = {
  /**
   * Opens a formatted printable window styled specifically for medical documentation and triggers print/PDF saving
   */
  printDocument(
    title: string,
    contentHtml: string,
    company?: { name: string; tagline: string; address: string; phone: string; email: string }
  ): void {
    const printWindow = window.open('', '_blank', 'width=850,height=1100');
    if (!printWindow) {
      alert('Please allow popups to export and print documents.');
      return;
    }

    const settings = db.getSettings();
    const co = company || {
      name: settings.hospitalName,
      tagline: settings.tagline,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
    };

    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${title} - ${co.name}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 15mm 15mm 15mm 15mm;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #1a202c;
              background: #fff;
              margin: 0;
              padding: 20px;
              font-size: 13px;
              line-height: 1.5;
            }
            .header-table {
              width: 100%;
              border-bottom: 2px solid #059669;
              padding-bottom: 12px;
              margin-bottom: 20px;
            }
            .hospital-name {
              font-size: 22px;
              font-weight: 800;
              color: #065f46;
              letter-spacing: -0.5px;
            }
            .hospital-tagline {
              font-size: 11px;
              color: #4b5563;
              margin-top: 2px;
            }
            .hospital-contact {
              font-size: 11px;
              color: #6b7280;
              text-align: right;
            }
            .doc-badge {
              display: inline-block;
              background: #ecfdf5;
              color: #047857;
              border: 1px solid #a7f3d0;
              padding: 4px 12px;
              border-radius: 4px;
              font-weight: 700;
              font-size: 14px;
              margin-bottom: 16px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 10px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              padding: 12px;
              margin-bottom: 20px;
            }
            .meta-item {
              font-size: 12px;
            }
            .meta-label {
              font-weight: 600;
              color: #64748b;
            }
            .meta-val {
              font-weight: 600;
              color: #0f172a;
            }
            table.data-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 15px;
              margin-bottom: 20px;
            }
            table.data-table th {
              background: #f1f5f9;
              color: #334155;
              text-align: left;
              padding: 8px 10px;
              font-size: 11px;
              font-weight: 700;
              border-bottom: 1px solid #cbd5e1;
              text-transform: uppercase;
            }
            table.data-table td {
              padding: 8px 10px;
              border-bottom: 1px solid #e2e8f0;
              font-size: 12px;
            }
            .flag-high, .flag-critical {
              color: #dc2626;
              font-weight: 700;
            }
            .flag-low {
              color: #2563eb;
              font-weight: 700;
            }
            .flag-normal {
              color: #16a34a;
              font-weight: 600;
            }
            .footer-sign {
              margin-top: 40px;
              display: flex;
              justify-content: space-between;
              padding-top: 20px;
              border-top: 1px dashed #cbd5e1;
              font-size: 11px;
              color: #64748b;
            }
            @media print {
              body {
                padding: 0;
              }
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <table class="header-table">
            <tr>
              <td>
                <div class="hospital-name">${co.name}</div>
                <div class="hospital-tagline">${co.tagline}</div>
              </td>
              <td class="hospital-contact">
                <div>${co.address}</div>
                <div>Tel: ${co.phone} | Email: ${co.email}</div>
              </td>
            </tr>
          </table>

          ${contentHtml}

          <div class="footer-sign">
            <div>
              Generated on: <strong>${new Date().toLocaleString()}</strong><br>
              FatClinic Connected Health Information System (EHR v2.6)
            </div>
            <div style="text-align: right;">
              Certified Electronic Medical Record<br>
              Confidential Medical Data
            </div>
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(fullHtml);
    printWindow.document.close();
  },

  /**
   * Thermal / POS (80mm) print window for receipts.
   */
  printThermalDocument(title: string, contentHtml: string): void {
    const printWindow = window.open('', '_blank', 'width=320,height=600');
    if (!printWindow) {
      alert('Please allow popups to export and print documents.');
      return;
    }

    const settings = db.getSettings();

    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${title} - ${settings.hospitalName}</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 2mm;
            }
            body {
              font-family: "Courier New", Courier, monospace;
              color: #000;
              background: #fff;
              margin: 0;
              padding: 4px;
              font-size: 12px;
              line-height: 1.45;
              width: 72mm;
            }
            .center { text-align: center; }
            .right { text-align: right; }
            .bold { font-weight: bold; }
            .big { font-size: 15px; font-weight: bold; }
            hr.dash { border: none; border-top: 1px dashed #000; margin: 6px 0; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            td { vertical-align: top; padding: 1px 0; }
            @media print {
              body { padding: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          ${contentHtml}
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(fullHtml);
    printWindow.document.close();
  },

  /**
   * Export Lab Investigation Report
   */
  exportLabReport(request: LabRequest, patient: Patient): void {
    let testsHtml = '';

    request.tests.forEach(test => {
      let resultsTable = '';
      if (test.results && test.results.length > 0) {
        resultsTable = `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 35%;">Parameter</th>
                <th style="width: 20%;">Result</th>
                <th style="width: 15%;">Unit</th>
                <th style="width: 20%;">Reference Range</th>
                <th style="width: 10%;">Flag</th>
              </tr>
            </thead>
            <tbody>
              ${test.results.map(r => `
                <tr>
                  <td><strong>${r.parameterName}</strong></td>
                  <td><strong>${r.value}</strong></td>
                  <td>${r.unit || '-'}</td>
                  <td>${r.referenceRange}</td>
                  <td><span class="flag-${r.flag.toLowerCase()}">${r.flag}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else {
        resultsTable = `<p style="font-style: italic; color: #64748b; margin: 10px 0;">Investigation in progress: ${test.status}</p>`;
      }

      testsHtml += `
        <div style="margin-bottom: 24px;">
          <div style="background: #f8fafc; border-left: 4px solid #059669; padding: 8px 12px; margin-bottom: 8px;">
            <div style="font-weight: 700; font-size: 14px; color: #0f172a;">${test.testName}</div>
            <div style="font-size: 11px; color: #64748b;">
              Category: <strong>${test.category.replace('_', ' ')}</strong> | 
              Specimen: <strong>${test.sampleType}</strong> | 
              Status: <strong>${test.status}</strong>
            </div>
          </div>
          ${resultsTable}
          ${test.comments ? `<div style="font-size: 12px; background: #fffbeb; border: 1px solid #fef3c7; padding: 8px; border-radius: 4px;"><strong>Scientist Comments:</strong> ${test.comments}</div>` : ''}
          ${test.verifiedBy ? `<div style="font-size: 11px; color: #64748b; margin-top: 6px; text-align: right;">Verified & Released by: <strong>${test.verifiedBy}</strong> on ${test.releasedAt ? new Date(test.releasedAt).toLocaleString() : ''}</div>` : ''}
        </div>
      `;
    });

    const content = `
      <div class="doc-badge">Official Diagnostic Laboratory Report</div>
      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">Patient Name:</span> <span class="meta-val">${patient.firstName} ${patient.middleName || ''} ${patient.lastName}</span></div>
        <div class="meta-item"><span class="meta-label">Patient ID:</span> <span class="meta-val">${patient.id}</span></div>
        <div class="meta-item"><span class="meta-label">Age / Sex:</span> <span class="meta-val">${patient.age} Yrs / ${patient.sex}</span></div>
        <div class="meta-item"><span class="meta-label">Date Requested:</span> <span class="meta-val">${new Date(request.requestedAt).toLocaleDateString()}</span></div>
        <div class="meta-item"><span class="meta-label">Requesting Physician:</span> <span class="meta-val">${request.physicianName}</span></div>
        <div class="meta-item"><span class="meta-label">Clinical Indication:</span> <span class="meta-val">${request.clinicalIndication || 'Clinical investigation'}</span></div>
      </div>

      ${testsHtml}
    `;

    this.printDocument(`Lab_Report_${patient.id}`, content);
  },

  /**
   * Export Patient Clinical Profile / Summary
   */
  exportPatientProfile(patient: Patient): void {
    const visits = db.getVisits(patient.id);
    const vitalsList = db.getVitals(undefined, patient.id);
    const consultations = db.getPatientConsultations(patient.id);
    const prescriptions = db.getPrescriptions(patient.id);

    const latestConsultation = consultations[0];
    const latestVitals = vitalsList[0];

    const content = `
      <div class="doc-badge">Comprehensive Patient Health Record</div>
      
      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">Full Name:</span> <span class="meta-val">${patient.firstName} ${patient.middleName || ''} ${patient.lastName}</span></div>
        <div class="meta-item"><span class="meta-label">Hospital ID:</span> <span class="meta-val">${patient.id}</span></div>
        <div class="meta-item"><span class="meta-label">Age / Sex:</span> <span class="meta-val">${patient.age} Yrs / ${patient.sex}</span></div>
        <div class="meta-item"><span class="meta-label">Phone / Contact:</span> <span class="meta-val">${patient.phone}</span></div>
        <div class="meta-item"><span class="meta-label">Blood Group / Genotype:</span> <span class="meta-val">${patient.bloodGroup || 'N/A'} / ${patient.genotype || 'N/A'}</span></div>
        <div class="meta-item"><span class="meta-label">Registered Since:</span> <span class="meta-val">${new Date(patient.registeredAt).toLocaleDateString()}</span></div>
        <div class="meta-item" style="grid-column: span 2;"><span class="meta-label">Known Allergies:</span> <span class="meta-val" style="color: #dc2626;">${patient.allergies.join(', ') || 'No known drug allergies'}</span></div>
      </div>

      <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Most Recent Clinical Encounter</h3>
      ${latestConsultation ? `
        <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
          <div><strong>Consultation Date:</strong> ${new Date(latestConsultation.consultationDate).toLocaleString()} by ${latestConsultation.physicianName}</div>
          <div style="margin-top: 6px;"><strong>Presenting Complaint:</strong> ${latestConsultation.presentingComplaint}</div>
          <div style="margin-top: 6px;"><strong>History:</strong> ${latestConsultation.historyOfPresentingComplaint}</div>
          <div style="margin-top: 6px;"><strong>Diagnoses:</strong> 
            ${latestConsultation.diagnoses.map(d => `<span style="display:inline-block; background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px; font-weight:600; font-size:11px; margin-right:4px;">${d.description} (${d.code}) [${d.type}]</span>`).join('')}
          </div>
          <div style="margin-top: 6px;"><strong>Clinical Plan:</strong> <pre style="font-family: inherit; margin: 4px 0 0 0; white-space: pre-wrap;">${latestConsultation.plan}</pre></div>
        </div>
      ` : '<p style="color: #64748b;">No consultation notes recorded yet.</p>'}

      ${latestVitals ? `
        <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Latest Recorded Vital Signs</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Temperature</th>
              <th>Blood Pressure</th>
              <th>Pulse</th>
              <th>Resp Rate</th>
              <th>SpO2</th>
              <th>BMI (Category)</th>
              <th>Recorded By</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${latestVitals.temperature}°C</td>
              <td>${latestVitals.systolicBp}/${latestVitals.diastolicBp} mmHg</td>
              <td>${latestVitals.pulse} bpm</td>
              <td>${latestVitals.respiratoryRate} cpm</td>
              <td>${latestVitals.spo2}%</td>
              <td>${latestVitals.bmi} kg/m² (${latestVitals.bmiCategory})</td>
              <td>${latestVitals.nurseName}</td>
            </tr>
          </tbody>
        </table>
      ` : ''}

      <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Active Medications & Prescriptions</h3>
      ${prescriptions.length > 0 ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>Medication</th>
              <th>Dosage</th>
              <th>Frequency</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Prescribed By</th>
            </tr>
          </thead>
          <tbody>
            ${prescriptions.flatMap(rx => rx.items.map(item => `
              <tr>
                <td><strong>${item.medicationName}</strong></td>
                <td>${item.dosage}</td>
                <td>${item.frequency}</td>
                <td>${item.duration}</td>
                <td><span style="font-weight:600; color: ${item.dispenseStatus === 'Dispensed' ? '#16a34a' : '#d97706'}">${item.dispenseStatus}</span></td>
                <td>${rx.physicianName}</td>
              </tr>
            `)).join('')}
          </tbody>
        </table>
      ` : '<p style="color: #64748b;">No active medications.</p>'}

      <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Recorded Encounter History (${visits.length})</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Status</th>
            <th>Reason For Visit</th>
          </tr>
        </thead>
        <tbody>
          ${visits.map(v => `
            <tr>
              <td><strong>${v.visitDate}</strong> ${v.visitTime || ''}</td>
              <td>${v.visitType}</td>
              <td>${v.status}</td>
              <td>${v.reasonForVisit || 'General Clinical Encounter'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    this.printDocument(`Patient_Record_${patient.id}`, content);
  },

  /**
   * Export Central Hospital Invoice & Payment Receipt
   */
  exportInvoice(invoice: Invoice, patient: Patient): void {
    const settings = db.getSettings();

    const itemsRows = invoice.items.map(item => `
      <tr>
        <td><strong>${item.description}</strong></td>
        <td><span style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 11px;">${item.serviceCategory}</span></td>
        <td style="text-align: center;">${item.quantity}</td>
        <td style="text-align: right;">${settings.currency}${item.unitPrice.toLocaleString()}</td>
        <td style="text-align: right;"><strong>${settings.currency}${item.totalPrice.toLocaleString()}</strong></td>
      </tr>
    `).join('');

    const paymentsRows = invoice.payments.map(p => `
      <tr>
        <td><strong>${p.receiptNumber}</strong></td>
        <td>${new Date(p.paidAt).toLocaleDateString()}</td>
        <td>${p.paymentMethod}</td>
        <td>${p.receivedBy}</td>
        <td style="text-align: right;"><strong>${settings.currency}${p.amount.toLocaleString()}</strong></td>
      </tr>
    `).join('');

    const content = `
      <div class="doc-badge">Hospital Billing Invoice & Payment Receipt</div>

      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">Invoice Number:</span> <span class="meta-val">${invoice.id}</span></div>
        <div class="meta-item"><span class="meta-label">Invoice Date:</span> <span class="meta-val">${invoice.date}</span></div>
        <div class="meta-item"><span class="meta-label">Patient Name:</span> <span class="meta-val">${patient.firstName} ${patient.lastName}</span></div>
        <div class="meta-item"><span class="meta-label">Hospital ID:</span> <span class="meta-val">${patient.id}</span></div>
        <div class="meta-item"><span class="meta-label">Payment Status:</span> <span class="meta-val" style="color: ${invoice.paymentStatus === 'Paid' ? '#16a34a' : '#dc2626'}; font-weight: 800;">${invoice.paymentStatus}</span></div>
        <div class="meta-item"><span class="meta-label">Outstanding Balance:</span> <span class="meta-val">${settings.currency}${invoice.balance.toLocaleString()}</span></div>
      </div>

      <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Itemized Clinical Services</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 45%;">Service / Item Description</th>
            <th style="width: 20%;">Category</th>
            <th style="width: 10%; text-align: center;">Qty</th>
            <th style="width: 12%; text-align: right;">Unit Fee</th>
            <th style="width: 13%; text-align: right;">Total Fee</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div style="float: right; width: 280px; margin-bottom: 30px;">
        <table style="width: 100%; font-size: 13px;">
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Subtotal:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600;">${settings.currency}${invoice.subtotal.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Discount:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #16a34a;">- ${settings.currency}${invoice.discount.toLocaleString()}</td>
          </tr>
          <tr style="border-top: 2px solid #059669; font-size: 15px;">
            <td style="padding: 8px 0; font-weight: 800; color: #065f46;">Total Due:</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 800; color: #065f46;">${settings.currency}${invoice.total.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Amount Paid:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 700; color: #16a34a;">${settings.currency}${invoice.paidAmount.toLocaleString()}</td>
          </tr>
          <tr style="border-top: 1px dashed #cbd5e1; font-weight: 700;">
            <td style="padding: 6px 0; color: ${invoice.balance > 0 ? '#dc2626' : '#64748b'};">Balance Due:</td>
            <td style="padding: 6px 0; text-align: right; color: ${invoice.balance > 0 ? '#dc2626' : '#64748b'};">${settings.currency}${invoice.balance.toLocaleString()}</td>
          </tr>
        </table>
      </div>
      <div style="clear: both;"></div>

      ${invoice.payments.length > 0 ? `
        <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Payment Transaction Receipts</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Receipt Number</th>
              <th>Payment Date</th>
              <th>Channel / Method</th>
              <th>Authorized Officer</th>
              <th style="text-align: right;">Amount Paid</th>
            </tr>
          </thead>
          <tbody>
            ${paymentsRows}
          </tbody>
        </table>
      ` : ''}
    `;

    this.printDocument(`Invoice_${invoice.id}`, content + this.receiptFooter(), this.receiptCompany());
  },

  /**
   * Company header + footer pulled from Administration → Receipt Settings,
   * so every printed detail is editable in one place.
   */
  receiptCompany() {
    const rc = db.getReceiptSettings();
    return { name: rc.hospitalName, tagline: rc.tagline, address: rc.address, phone: rc.phone, email: rc.email };
  },

  receiptFooter(): string {
    const rc = db.getReceiptSettings();
    return `
      ${rc.footerMessage ? `<p style="margin-top: 18px; font-size: 12px; color: #047857; font-weight: 600;">${rc.footerMessage}</p>` : ''}
      ${rc.termsLine ? `<p style="font-size: 11px; color: #64748b;">Terms: ${rc.termsLine}</p>` : ''}
    `;
  },

  /**
   * Single payment receipt details (A4).
   */
  exportReceipt(invoice: Invoice, receipt: PaymentRecord, patient: Patient): void {
    const settings = db.getSettings();
    const rc = db.getReceiptSettings();
    const idx = invoice.payments.findIndex(p => p.id === receipt.id);
    const countLabel = rc.showReceiptCount && idx >= 0
      ? ` (Receipt ${idx + 1} of ${invoice.payments.length})`
      : '';

    const content = `
      <div class="doc-badge">Official Payment Receipt${countLabel}</div>

      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">Receipt Number:</span> <span class="meta-val">${receipt.receiptNumber}</span></div>
        <div class="meta-item"><span class="meta-label">Receipt Date:</span> <span class="meta-val">${new Date(receipt.paidAt).toLocaleString()}</span></div>
        <div class="meta-item"><span class="meta-label">Patient Name:</span> <span class="meta-val">${patient.firstName} ${patient.lastName}</span></div>
        <div class="meta-item"><span class="meta-label">Hospital ID:</span> <span class="meta-val">${patient.id}</span></div>
        <div class="meta-item"><span class="meta-label">Invoice Number:</span> <span class="meta-val">${invoice.id} (${invoice.date})</span></div>
        ${rc.showPaymentMethod ? `<div class="meta-item"><span class="meta-label">Means of Payment:</span> <span class="meta-val">${receipt.paymentMethod}${rc.showBankDetails && receipt.bankName ? ` • ${receipt.bankName}` : ''}${rc.showBankDetails && receipt.transactionReference ? ` • Ref: ${receipt.transactionReference}` : ''}</span></div>` : ''}
        ${rc.showReceivedBy ? `<div class="meta-item"><span class="meta-label">Received By:</span> <span class="meta-val">${receipt.receivedBy}</span></div>` : ''}
        <div class="meta-item"><span class="meta-label">Invoice Total:</span> <span class="meta-val">${settings.currency}${invoice.total.toLocaleString()}</span></div>
      </div>

      <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Amount Received</h3>
      <div style="font-size: 26px; font-weight: 800; color: #065f46; margin: 8px 0 16px;">${settings.currency}${receipt.amount.toLocaleString()}</div>

      ${rc.showInvoicePosition ? `
      <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Invoice Position After This Receipt</h3>
      <table class="data-table">
        <tbody>
          <tr><td>Invoice Total</td><td style="text-align: right;"><strong>${settings.currency}${invoice.total.toLocaleString()}</strong></td></tr>
          <tr><td>Total Paid (all receipts)</td><td style="text-align: right; color: #16a34a;"><strong>${settings.currency}${invoice.paidAmount.toLocaleString()}</strong></td></tr>
          <tr><td>Outstanding Balance</td><td style="text-align: right; color: ${invoice.balance > 0 ? '#dc2626' : '#64748b'};"><strong>${settings.currency}${invoice.balance.toLocaleString()}</strong></td></tr>
        </tbody>
      </table>` : ''}
      ${this.receiptFooter()}
    `;

    this.printDocument(`Receipt_${receipt.receiptNumber}`, content, this.receiptCompany());
  },

  /**
   * Single payment receipt in thermal / POS (80mm) format.
   */
  exportThermalReceipt(invoice: Invoice, receipt: PaymentRecord, patient: Patient): void {
    const settings = db.getSettings();
    const rc = db.getReceiptSettings();

    const content = `
      <div class="center">
        <div class="big">${rc.hospitalName}</div>
        <div>${rc.address}</div>
        <div>Tel: ${rc.phone}${rc.email ? ` • ${rc.email}` : ''}</div>
      </div>
      <hr class="dash" />
      <div class="center bold">*** PAYMENT RECEIPT ***</div>
      <hr class="dash" />
      <table>
        <tr><td>Receipt No:</td><td class="right bold">${receipt.receiptNumber}</td></tr>
        <tr><td>Date:</td><td class="right">${new Date(receipt.paidAt).toLocaleString()}</td></tr>
        <tr><td>Patient:</td><td class="right">${patient.firstName} ${patient.lastName}</td></tr>
        <tr><td>Hospital ID:</td><td class="right">${patient.id}</td></tr>
        <tr><td>Invoice:</td><td class="right">${invoice.id}</td></tr>
        ${rc.showPaymentMethod ? `<tr><td>Method:</td><td class="right">${receipt.paymentMethod}</td></tr>` : ''}
        ${rc.showBankDetails && receipt.bankName ? `<tr><td>Bank:</td><td class="right">${receipt.bankName}</td></tr>` : ''}
        ${rc.showBankDetails && receipt.transactionReference ? `<tr><td>Ref:</td><td class="right">${receipt.transactionReference}</td></tr>` : ''}
        ${rc.showReceivedBy ? `<tr><td>Received by:</td><td class="right">${receipt.receivedBy}</td></tr>` : ''}
      </table>
      <hr class="dash" />
      <table>
        <tr class="big"><td>AMOUNT:</td><td class="right">${settings.currency}${receipt.amount.toLocaleString()}</td></tr>
        ${rc.showInvoicePosition ? `
        <tr><td>Inv. Total:</td><td class="right">${settings.currency}${invoice.total.toLocaleString()}</td></tr>
        <tr><td>Total Paid:</td><td class="right">${settings.currency}${invoice.paidAmount.toLocaleString()}</td></tr>
        <tr><td>Balance:</td><td class="right">${settings.currency}${invoice.balance.toLocaleString()}</td></tr>` : ''}
      </table>
      <hr class="dash" />
      ${rc.showThankYou ? `<div class="center">${rc.footerMessage}<br/>${rc.tagline}</div>` : ''}
      ${rc.termsLine ? `<div class="center">${rc.termsLine}</div>` : ''}
      <div class="center">Generated: ${new Date().toLocaleString()}</div>
    `;

    this.printThermalDocument(`Receipt_${receipt.receiptNumber}`, content);
  },

  /**
   * Combined billing statement across selected visits (or all = end-to-end).
   */
  exportVisitStatement(patient: Patient, visits: Visit[], invoices: Invoice[]): void {
    const settings = db.getSettings();
    const scope = visits.length === db.getVisits(patient.id).length ? 'End-to-End (All Visits)' : `${visits.length} Selected Visit${visits.length === 1 ? '' : 's'}`;

    const blocks = visits.map(v => {
      const inv = invoices.find(i => i.visitId === v.id);
      const rows = inv
        ? inv.items.map(item => `
          <tr>
            <td><strong>${item.description}</strong></td>
            <td style="text-align: center;">${item.quantity}</td>
            <td style="text-align: right;">${settings.currency}${item.totalPrice.toLocaleString()}</td>
          </tr>`).join('')
        : `<tr><td colspan="3" style="color: #94a3b8;">No bills raised for this visit yet.</td></tr>`;
      return `
        <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">
          Visit: ${v.visitDate} (${v.visitType}) — ${v.status}${v.ward ? ` • Ward: ${wardName(v.ward)}` : ''}
        </h3>
        <table class="data-table">
          <thead><tr><th>Service / Item</th><th style="text-align: center;">Qty</th><th style="text-align: right;">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${inv ? `
        <div style="text-align: right; font-size: 12px; margin: 6px 0 18px;">
          Billed: <strong>${settings.currency}${inv.total.toLocaleString()}</strong> •
          Paid: <strong style="color: #16a34a;">${settings.currency}${inv.paidAmount.toLocaleString()}</strong> •
          Balance: <strong style="color: ${inv.balance > 0 ? '#dc2626' : '#64748b'};">${settings.currency}${inv.balance.toLocaleString()}</strong>
        </div>` : ''}
      `;
    }).join('');

    const grandBilled = invoices.reduce((s, i) => s + i.total, 0);
    const grandPaid = invoices.reduce((s, i) => s + i.paidAmount, 0);
    const grandBal = invoices.reduce((s, i) => s + i.balance, 0);

    const content = `
      <div class="doc-badge">Patient Billing Statement — ${scope}</div>

      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">Patient Name:</span> <span class="meta-val">${patient.firstName} ${patient.lastName}</span></div>
        <div class="meta-item"><span class="meta-label">Hospital ID:</span> <span class="meta-val">${patient.id}</span></div>
        <div class="meta-item"><span class="meta-label">Phone:</span> <span class="meta-val">${patient.phone}</span></div>
        <div class="meta-item"><span class="meta-label">Visits Covered:</span> <span class="meta-val">${visits.map(v => v.visitDate).join(', ') || '—'}</span></div>
      </div>

      ${blocks}

      <h3 style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a;">Statement Totals</h3>
      <table class="data-table">
        <tbody>
          <tr><td>Total Billed</td><td style="text-align: right;"><strong>${settings.currency}${grandBilled.toLocaleString()}</strong></td></tr>
          <tr><td>Total Paid</td><td style="text-align: right; color: #16a34a;"><strong>${settings.currency}${grandPaid.toLocaleString()}</strong></td></tr>
          <tr><td>Outstanding Balance</td><td style="text-align: right; color: ${grandBal > 0 ? '#dc2626' : '#64748b'};"><strong>${settings.currency}${grandBal.toLocaleString()}</strong></td></tr>
        </tbody>
      </table>
    `;

    this.printDocument(`Statement_${patient.id}`, content + this.receiptFooter(), this.receiptCompany());
  }
};
