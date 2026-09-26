import { 
  User, 
  Patient, 
  Visit, 
  Vitals, 
  Consultation, 
  LabInvestigationDefinition, 
  LabRequest, 
  LabCategory, 
  Prescription, 
  Medication, 
  ServicePriceItem, 
  Invoice, 
  InvoiceItem,
  PaymentRecord, 
  AuditLog, 
  SystemSettings,
  OnlineBooking,
  ReceiptSettings,
  LabStockItem,
  LabStockRequest,
  RadiologyOrder,
  PhysiotherapyOrder,
  ClinicalConsumable,
  ConsumableStockRequest,
  ConsumableUsageLog,
  MedicationRequest,
  CustomRole
} from '../types';
import { 
  initialSettings,
  initialReceiptSettings,
  initialUsers, 
  initialLabInvestigations, 
  initialMedications, 
  initialServicePrices, 
  initialPatients, 
  initialVisits, 
  initialVitals, 
  initialConsultations, 
  initialLabRequests, 
  initialPrescriptions, 
  initialInvoices, 
  initialAuditLogs,
  initialOnlineBookings,
  initialLabStock,
  initialLabStockRequests,
  initialRadiologyOrders,
  initialPhysiotherapyOrders,
  initialClinicalConsumables
} from './seedData';
import {
  TABLE_BY_KEY,
  TABLES,
  hydrateAll,
  isSyncEnabled,
  isInFlight,
  queueDiff,
} from './sync';

const STORAGE_KEYS = {
  SETTINGS: 'fatclinic_settings',
  USERS: 'fatclinic_users',
  PATIENTS: 'fatclinic_patients',
  VISITS: 'fatclinic_visits',
  VITALS: 'fatclinic_vitals',
  CONSULTATIONS: 'fatclinic_consultations',
  LAB_DEFS: 'fatclinic_lab_defs',
  LAB_REQUESTS: 'fatclinic_lab_requests',
  PRESCRIPTIONS: 'fatclinic_prescriptions',
  MEDICATIONS: 'fatclinic_medications',
  SERVICES: 'fatclinic_services',
  INVOICES: 'fatclinic_invoices',
  AUDIT_LOGS: 'fatclinic_audit_logs',
  ONLINE_BOOKINGS: 'fatclinic_online_bookings',
  LAB_STOCK: 'fatclinic_lab_stock',
  LAB_STOCK_REQUESTS: 'fatclinic_lab_stock_requests',
  RADIOLOGY_ORDERS: 'fatclinic_radiology_orders',
  PHYSIOTHERAPY_ORDERS: 'fatclinic_physio_orders',
  CLINICAL_CONSUMABLES: 'fatclinic_clinical_consumables',
  CONSUMABLE_REQUESTS: 'fatclinic_consumable_requests',
  CONSUMABLE_USAGE: 'fatclinic_consumable_usage',
  MEDICATION_REQUESTS: 'fatclinic_medication_requests',
  RECEIPT_SETTINGS: 'fatclinic_receipt_settings',
  CUSTOM_ROLES: 'fatclinic_custom_roles'
};

/**
 * Storage key -> the class field it backs.
 *
 * Declared explicitly rather than derived, because the constructor assigns each
 * field by hand and a derived name would be a guess. Hydration uses this to
 * write a server-authoritative value into the right field.
 */
const STORAGE_FIELD: Record<string, string> = {
  [STORAGE_KEYS.SETTINGS]: 'settings',
  [STORAGE_KEYS.RECEIPT_SETTINGS]: 'receiptSettings',
  [STORAGE_KEYS.USERS]: 'users',
  [STORAGE_KEYS.PATIENTS]: 'patients',
  [STORAGE_KEYS.VISITS]: 'visits',
  [STORAGE_KEYS.VITALS]: 'vitals',
  [STORAGE_KEYS.CONSULTATIONS]: 'consultations',
  [STORAGE_KEYS.LAB_DEFS]: 'labDefs',
  [STORAGE_KEYS.LAB_REQUESTS]: 'labRequests',
  [STORAGE_KEYS.PRESCRIPTIONS]: 'prescriptions',
  [STORAGE_KEYS.MEDICATIONS]: 'medications',
  [STORAGE_KEYS.SERVICES]: 'services',
  [STORAGE_KEYS.INVOICES]: 'invoices',
  [STORAGE_KEYS.AUDIT_LOGS]: 'auditLogs',
  [STORAGE_KEYS.ONLINE_BOOKINGS]: 'onlineBookings',
  [STORAGE_KEYS.LAB_STOCK]: 'labStock',
  [STORAGE_KEYS.LAB_STOCK_REQUESTS]: 'labStockRequests',
  [STORAGE_KEYS.RADIOLOGY_ORDERS]: 'radiologyOrders',
  [STORAGE_KEYS.PHYSIOTHERAPY_ORDERS]: 'physiotherapyOrders',
  [STORAGE_KEYS.CLINICAL_CONSUMABLES]: 'clinicalConsumables',
  [STORAGE_KEYS.CONSUMABLE_REQUESTS]: 'consumableRequests',
  [STORAGE_KEYS.CONSUMABLE_USAGE]: 'consumableUsage',
  [STORAGE_KEYS.MEDICATION_REQUESTS]: 'medicationRequests',
  [STORAGE_KEYS.CUSTOM_ROLES]: 'customRoles'
};

/**
 * The last value written to localStorage for each key.
 *
 * `saveStorage` is handed a whole collection, so the sync layer needs to know
 * what the collection looked like *before* the change in order to work out which
 * rows are new, which changed and which went away. That prior state is exactly
 * what was last persisted, which is what this holds.
 *
 * It is also the baseline for a fresh page load: `loadStorage` seeds it, so the
 * first save after a reload diffs against what was actually on disk rather than
 * against an empty array (which would make every row look like a new row).
 */
const baseline = new Map<string, unknown>();

function loadStorage<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    const value = data ? (JSON.parse(data) as T) : fallback;
    baseline.set(key, value);
    return value;
  } catch (err) {
    console.error(`Error loading ${key} from storage:`, err);
    baseline.set(key, fallback);
    return fallback;
  }
}

function saveStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Error saving ${key} to storage:`, err);
  }

  // Mirror to Postgres. The diff is against the previously persisted value, so
  // only genuinely new, changed and removed rows are sent; a save that changed
  // nothing sends nothing at all.
  const map = TABLE_BY_KEY.get(key);
  const before = baseline.get(key);
  baseline.set(key, value);
  // Returns synchronously: the localStorage write above must not wait on the
  // network, and a failed sync leaves the data intact on disk.
  if (map) queueDiff(map, before, value);
}

// Production storage version. Bumped whenever seed data is retired so stale
// demo records on existing machines are purged and reseeded cleanly.
const STORAGE_VERSION = 2;
const VERSION_KEY = 'fatclinic_schema_version';

function ensureProductionStorage(): void {
  try {
    if (localStorage.getItem(VERSION_KEY) !== String(STORAGE_VERSION)) {
      Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
      localStorage.removeItem('fatclinic_active_user');
      localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION));
    }
  } catch (err) {
    console.error('Error ensuring production storage:', err);
  }
}

class FatClinicDatabase {
  private settings: SystemSettings;
  private users: User[];
  private patients: Patient[];
  private visits: Visit[];
  private vitals: Vitals[];
  private consultations: Consultation[];
  private labDefs: LabInvestigationDefinition[];
  private labRequests: LabRequest[];
  private prescriptions: Prescription[];
  private medications: Medication[];
  private services: ServicePriceItem[];
  private invoices: Invoice[];
  private auditLogs: AuditLog[];
  private onlineBookings: OnlineBooking[];
  private labStock: LabStockItem[];
  private labStockRequests: LabStockRequest[];
  private radiologyOrders: RadiologyOrder[];
  private physiotherapyOrders: PhysiotherapyOrder[];
  private clinicalConsumables: ClinicalConsumable[];
  private consumableRequests: ConsumableStockRequest[];
  private consumableUsage: ConsumableUsageLog[];
  private medicationRequests: MedicationRequest[];
  private receiptSettings: ReceiptSettings;
  private customRoles: CustomRole[];
  private listeners: Set<() => void> = new Set();

  /**
   * Resolves once the initial reconciliation with Postgres has finished,
   * successfully or not. The app never blocks on it: the constructor has already
   * filled every field from localStorage, so the UI is usable immediately and
   * works offline. This exists so a sign-in screen or a test can wait for the
   * database state rather than racing it.
   */
  public readonly ready: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.resolveReady = () => {};
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    ensureProductionStorage();
    this.settings = loadStorage(STORAGE_KEYS.SETTINGS, initialSettings);
    this.receiptSettings = { ...initialReceiptSettings, ...loadStorage(STORAGE_KEYS.RECEIPT_SETTINGS, {}) };
    this.users = loadStorage(STORAGE_KEYS.USERS, initialUsers);
    // Merge newer seed staff + backfill DB-controlled credentials on existing installs
    {
      let dirty = false;
      const knownIds = new Set(this.users.map(u => u.id));
      initialUsers.forEach(su => {
        if (!knownIds.has(su.id)) {
          this.users = [...this.users, su];
          dirty = true;
        }
      });
      this.users = this.users.map(u => {
        if (!u.password) {
          dirty = true;
          return { ...u, password: 'FatClinic123' };
        }
        return u;
      });
      if (dirty) saveStorage(STORAGE_KEYS.USERS, this.users);
    }
    this.patients = loadStorage(STORAGE_KEYS.PATIENTS, initialPatients);
    this.visits = loadStorage(STORAGE_KEYS.VISITS, initialVisits);
    this.vitals = loadStorage(STORAGE_KEYS.VITALS, initialVitals);
    this.consultations = loadStorage(STORAGE_KEYS.CONSULTATIONS, initialConsultations);
    this.labDefs = loadStorage(STORAGE_KEYS.LAB_DEFS, initialLabInvestigations);
    this.labRequests = loadStorage(STORAGE_KEYS.LAB_REQUESTS, initialLabRequests);
    this.prescriptions = loadStorage(STORAGE_KEYS.PRESCRIPTIONS, initialPrescriptions);
    this.medications = loadStorage(STORAGE_KEYS.MEDICATIONS, initialMedications);
    this.services = loadStorage(STORAGE_KEYS.SERVICES, initialServicePrices);
    // Merge any newer seed services (e.g. Antenatal, Follow-up) into existing installs
    {
      const knownIds = new Set(this.services.map(s => s.id));
      const missing = initialServicePrices.filter(s => !knownIds.has(s.id));
      if (missing.length > 0) {
        this.services = [...this.services, ...missing];
        saveStorage(STORAGE_KEYS.SERVICES, this.services);
      }
    }
    this.invoices = loadStorage(STORAGE_KEYS.INVOICES, initialInvoices);
    this.auditLogs = loadStorage(STORAGE_KEYS.AUDIT_LOGS, initialAuditLogs);
    this.onlineBookings = loadStorage(STORAGE_KEYS.ONLINE_BOOKINGS, initialOnlineBookings);
    this.labStock = loadStorage(STORAGE_KEYS.LAB_STOCK, initialLabStock);
    this.labStockRequests = loadStorage(STORAGE_KEYS.LAB_STOCK_REQUESTS, initialLabStockRequests);
    this.radiologyOrders = loadStorage(STORAGE_KEYS.RADIOLOGY_ORDERS, initialRadiologyOrders);
    this.physiotherapyOrders = loadStorage(STORAGE_KEYS.PHYSIOTHERAPY_ORDERS, initialPhysiotherapyOrders);
    this.clinicalConsumables = loadStorage(STORAGE_KEYS.CLINICAL_CONSUMABLES, initialClinicalConsumables);
    // Merge newer seed consumables (e.g. Laboratory / Pharmacy) into existing installs
    {
      const knownIds = new Set(this.clinicalConsumables.map(c => c.id));
      const missing = initialClinicalConsumables.filter(c => !knownIds.has(c.id));
      if (missing.length > 0) {
        this.clinicalConsumables = [...this.clinicalConsumables, ...missing];
        saveStorage(STORAGE_KEYS.CLINICAL_CONSUMABLES, this.clinicalConsumables);
      }
    }
    this.consumableRequests = loadStorage(STORAGE_KEYS.CONSUMABLE_REQUESTS, []);
    this.consumableUsage = loadStorage(STORAGE_KEYS.CONSUMABLE_USAGE, []);
    this.medicationRequests = loadStorage(STORAGE_KEYS.MEDICATION_REQUESTS, []);
    this.customRoles = loadStorage(STORAGE_KEYS.CUSTOM_ROLES, []);

    // Every field now holds a complete, usable copy. Reconcile with Postgres in
    // the background and re-render when it lands.
    void this.hydrateFromServer();
  }

  // --- Postgres hydration --------------------------------------------------

  /**
   * Reconcile localStorage with Postgres.
   *
   * CONFLICT POLICY, and it is a decision rather than a detail:
   *
   *   * A row the server holds wins. The server is the durable record; a browser
   *     copy that lost a race, or was restored from a stale backup, must not
   *     overwrite a colleague's committed work.
   *   * A row only this browser holds is pushed up. That is how a fresh install
   *     seeds a new database, and how work done offline survives.
   *   * A row with a write still queued is never overwritten. Otherwise a
   *     clinician who saved while the network was down would watch their entry
   *     disappear the moment connectivity returned - the moment the data matters
   *     most.
   *
   * The cost of "server wins" is that two clinicians editing the same patient at
   * once resolve last-write-wins on the browser's schedule. That is a narrower
   * problem than losing data, and the proper fix is per-role RLS plus optimistic
   * concurrency, not making the browser authoritative over the record.
   */
  private async hydrateFromServer(): Promise<void> {
    try {
      if (!isSyncEnabled()) return;

      const server = await hydrateAll();

      // Ascending order, so a parent is in place before a child referencing it.
      for (const map of [...TABLES].sort((a, b) => a.order - b.order)) {
        const remote = server.get(map.key);
        if (remote === undefined) continue;

        if (map.single) {
          // Replaced wholesale: there is one shared configuration and one source
          // of truth for it. A partial admin edit on this device does not
          // survive, which is the intended behaviour.
          if (remote) this.adopt(map.key, remote);
          continue;
        }

        const local = baseline.get(map.key);
        const localList = Array.isArray(local) ? (local as any[]) : [];
        const remoteList = Array.isArray(remote) ? (remote as any[]) : [];

        // Browser-only rows are either new work or offline edits; both go up.
        const remoteIds = new Set(remoteList.map((r) => String(r?.id)));
        const localOnly = localList.filter(
          (r) => r?.id && !remoteIds.has(String(r.id)) && !isInFlight(map.key, String(r.id)),
        );

        if (localOnly.length) {
          const merged = [...remoteList, ...localOnly];
          this.adopt(map.key, merged);
          queueDiff(map, remoteList, merged);
        } else if (remoteList.length || !localList.length) {
          this.adopt(map.key, remoteList);
        }
        // Otherwise the local copy is non-empty and the server holds nothing
        // new, so the browser copy stands and nothing is written.
      }

      this.notify();
    } catch (err) {
      // A failed read must not stop the app. localStorage is a complete copy and
      // the clinician can keep working; the next save retries the write.
      console.error('[db] could not read from Postgres, continuing on local data:', err);
    } finally {
      this.resolveReady();
    }
  }

  /**
   * Replace a collection with a server-authoritative value without treating it
   * as a user edit. The baseline moves with it, so the next real save diffs
   * against what the server holds instead of re-pushing the whole collection.
   */
  private adopt(key: string, value: unknown): void {
    const field = STORAGE_FIELD[key];
    if (!field) return;
    (this as unknown as Record<string, unknown>)[field] = value;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error(`Error persisting ${key} after sync:`, err);
    }
    baseline.set(key, value);
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  // --- Audit Log (Immutable) ---
  public log(logData: Omit<AuditLog, 'id' | 'timestamp'>): void {
    const newLog: AuditLog = {
      ...logData,
      id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      timestamp: new Date().toISOString()
    };
    this.auditLogs = [newLog, ...this.auditLogs];
    saveStorage(STORAGE_KEYS.AUDIT_LOGS, this.auditLogs);
    this.notify();
  }

  public getAuditLogs(patientId?: string): AuditLog[] {
    if (patientId) {
      return this.auditLogs.filter(l => l.patientId === patientId);
    }
    return [...this.auditLogs];
  }

  // --- System Settings ---
  public getSettings(): SystemSettings {
    return { ...this.settings };
  }

  // --- Receipt Settings (every printed receipt detail, Administration-editable) ---
  public getReceiptSettings(): ReceiptSettings {
    return { ...initialReceiptSettings, ...this.receiptSettings };
  }

  public updateReceiptSettings(patch: Partial<ReceiptSettings>, user: User): void {
    this.receiptSettings = { ...this.getReceiptSettings(), ...patch };
    saveStorage(STORAGE_KEYS.RECEIPT_SETTINGS, this.receiptSettings);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_RECEIPT_SETTINGS',
      category: 'ADMIN',
      details: `Updated company receipt details (header, footer, prefix ${this.receiptSettings.receiptPrefix}, visible sections).`
    });
    this.notify();
  }

  public updateSettings(settings: Partial<SystemSettings>, user: User): void {
    this.settings = { ...this.settings, ...settings };
    saveStorage(STORAGE_KEYS.SETTINGS, this.settings);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_SYSTEM_SETTINGS',
      category: 'ADMIN',
      details: 'Updated global hospital system settings.'
    });
    this.notify();
  }

  // --- Users & RBAC ---
  public getUsers(): User[] {
    return [...this.users];
  }

  public getUserById(id: string): User | undefined {
    return this.users.find(u => u.id === id);
  }

  public updateUser(user: User, adminUser: User): void {
    this.users = this.users.map(u => u.id === user.id ? user : u);
    saveStorage(STORAGE_KEYS.USERS, this.users);
    const selfEdit = adminUser.id === user.id;
    this.log({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      action: selfEdit ? 'UPDATE_OWN_ACCOUNT' : 'UPDATE_USER',
      category: 'ADMIN',
      details: selfEdit
        ? `${user.name} updated their own account details.`
        : `Updated staff profile for ${user.name} (${user.role}).`
    });
    this.notify();
  }

  public assignCustomRole(userId: string, customRoleId: string | null, adminUser: User): void {
    const target = this.users.find(u => u.id === userId);
    if (!target) throw new Error(`User ${userId} not found`);
    const updated: User = { ...target, customRoleId: customRoleId || undefined };
    this.users = this.users.map(u => u.id === userId ? updated : u);
    saveStorage(STORAGE_KEYS.USERS, this.users);
    const roleName = customRoleId ? (this.customRoles.find(r => r.id === customRoleId)?.name || customRoleId) : 'None (base role only)';
    this.log({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      action: 'ASSIGN_CUSTOM_ROLE',
      category: 'ADMIN',
      details: `Assigned access-control role "${roleName}" to ${target.name}.`
    });
    this.notify();
  }

  /** Administration assigns a new login password to a staff member. */
  public assignUserPassword(userId: string, newPassword: string, adminUser: User): void {
    const target = this.users.find(u => u.id === userId);
    if (!target) throw new Error(`User ${userId} not found`);
    if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
    const updated: User = { ...target, password: newPassword, mustChangePassword: false };
    this.users = this.users.map(u => u.id === userId ? updated : u);
    saveStorage(STORAGE_KEYS.USERS, this.users);
    this.log({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      action: 'ASSIGN_PASSWORD',
      category: 'ADMIN',
      details: `Assigned a new login password to ${target.name}.`
    });
    this.notify();
  }

  public changeOwnPassword(userId: string, currentPassword: string, newPassword: string): void {
    const target = this.users.find(u => u.id === userId);
    if (!target) throw new Error(`User ${userId} not found`);
    if ((target.password || '') !== currentPassword) throw new Error('Current password is incorrect.');
    if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
    const updated: User = { ...target, password: newPassword, mustChangePassword: false };
    this.users = this.users.map(u => u.id === userId ? updated : u);
    saveStorage(STORAGE_KEYS.USERS, this.users);
    this.log({
      userId: target.id,
      userName: target.name,
      userRole: target.role,
      action: 'CHANGE_OWN_PASSWORD',
      category: 'ADMIN',
      details: `${target.name} changed their login password.`
    });
    this.notify();
  }

  public addUser(newUser: Omit<User, 'id'>, adminUser: User): User {
    const user: User = {
      ...newUser,
      id: `USR-${String(this.users.length + 1).padStart(3, '0')}`
    };
    this.users = [...this.users, user];
    saveStorage(STORAGE_KEYS.USERS, this.users);
    this.log({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      action: 'CREATE_USER',
      category: 'ADMIN',
      details: `Created new staff account: ${user.name} (${user.role}).`
    });
    this.notify();
    return user;
  }

  public deleteUser(id: string, adminUser: User): void {
    const target = this.users.find(u => u.id === id);
    this.users = this.users.filter(u => u.id !== id);
    saveStorage(STORAGE_KEYS.USERS, this.users);
    this.log({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      action: 'DELETE_USER',
      category: 'ADMIN',
      details: `Deleted staff account ${target ? target.name : id}.`
    });
    this.notify();
  }

  // --- Patients ---
  public getPatients(): Patient[] {
    return [...this.patients];
  }

  public getPatientById(id: string): Patient | undefined {
    return this.patients.find(p => p.id.toLowerCase() === id.toLowerCase());
  }

  public searchPatients(query: string): Patient[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.patients;
    return this.patients.filter(p => 
      p.id.toLowerCase().includes(q) ||
      `${p.firstName} ${p.middleName || ''} ${p.lastName}`.toLowerCase().includes(q) ||
      p.phone.includes(q) ||
      (p.email && p.email.toLowerCase().includes(q))
    );
  }

  public registerPatient(patientData: Omit<Patient, 'id' | 'registeredAt'>, creator: User): Patient {
    const currentYear = new Date().getFullYear();
    const count = this.patients.length + 1;
    const patientId = `${this.settings.patientPrefix}-${currentYear}-${String(count).padStart(5, '0')}`;
    
    const newPatient: Patient = {
      ...patientData,
      id: patientId,
      registeredAt: new Date().toISOString()
    };

    this.patients = [newPatient, ...this.patients];
    saveStorage(STORAGE_KEYS.PATIENTS, this.patients);

    // Automatically create initial visit
    const initialVisit = this.createVisit({
      patientId: newPatient.id,
      visitDate: new Date().toISOString().split('T')[0],
      visitTime: new Date().toTimeString().slice(0, 5),
      visitType: 'New Visit',
      status: 'Awaiting Vitals',
      reasonForVisit: 'Initial Registration & Triage'
    }, creator);

    this.log({
      userId: creator.id,
      userName: creator.name,
      userRole: creator.role,
      patientId: newPatient.id,
      patientName: `${newPatient.firstName} ${newPatient.lastName}`,
      action: 'REGISTER_PATIENT',
      category: 'PATIENT',
      details: `Registered new patient ${newPatient.firstName} ${newPatient.lastName} (${newPatient.id}). Initial visit ${initialVisit.id} created.`
    });

    this.notify();
    return newPatient;
  }

  public updatePatient(updated: Patient, modifier: User): void {
    this.patients = this.patients.map(p => p.id === updated.id ? updated : p);
    saveStorage(STORAGE_KEYS.PATIENTS, this.patients);
    this.log({
      userId: modifier.id,
      userName: modifier.name,
      userRole: modifier.role,
      patientId: updated.id,
      patientName: `${updated.firstName} ${updated.lastName}`,
      action: 'UPDATE_PATIENT_BIODATA',
      category: 'PATIENT',
      details: `Updated biodata/contact information for patient ${updated.id}.`
    });
    this.notify();
  }

  // --- Visits (Acts as Date Tabs!) ---
  public getVisits(patientId?: string): Visit[] {
    if (patientId) {
      return this.visits
        .filter(v => v.patientId === patientId)
        .sort((a, b) => new Date(`${b.visitDate}T${b.visitTime || '00:00'}`).getTime() - new Date(`${a.visitDate}T${a.visitTime || '00:00'}`).getTime());
    }
    return [...this.visits];
  }

  public getVisitById(visitId: string): Visit | undefined {
    return this.visits.find(v => v.id === visitId);
  }

  public createVisit(visitData: Omit<Visit, 'id'>, creator: User): Visit {
    const id = `VIS-${new Date().getFullYear()}-${String(this.visits.length + 1).padStart(3, '0')}`;
    const newVisit: Visit = { ...visitData, id };
    this.visits = [newVisit, ...this.visits];
    saveStorage(STORAGE_KEYS.VISITS, this.visits);

    const patient = this.getPatientById(newVisit.patientId);
    this.log({
      userId: creator.id,
      userName: creator.name,
      userRole: creator.role,
      patientId: newVisit.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'SCHEDULE_VISIT',
      category: 'CLINICAL',
      details: `Created visit tab for ${newVisit.visitDate} (${newVisit.visitType}) - ${newVisit.reasonForVisit || 'General'}.`
    });

    this.notify();
    return newVisit;
  }

  public updateVisitStatus(visitId: string, status: Visit['status'], modifier: User): void {
    this.visits = this.visits.map(v => {
      if (v.id !== visitId) return v;
      const patch: Partial<Visit> = { status };
      if (status === 'Discharged') patch.dischargedAt = new Date().toISOString();
      return { ...v, ...patch };
    });
    saveStorage(STORAGE_KEYS.VISITS, this.visits);
    this.notify();
  }

  /** Admit a patient — a ward MUST be specified. */
  public admitVisit(visitId: string, ward: string, actor: User): void {
    if (!ward || !ward.trim()) throw new Error('A ward must be specified to admit a patient.');
    const visit = this.visits.find(v => v.id === visitId);
    if (!visit) throw new Error(`Visit ${visitId} not found`);
    this.visits = this.visits.map(v =>
      v.id === visitId
        ? {
            ...v,
            status: 'Admitted' as Visit['status'],
            ward: ward.trim(),
            admittedAt: new Date().toISOString(),
            admittedBy: `${actor.name} (${actor.role})`
          }
        : v
    );
    saveStorage(STORAGE_KEYS.VISITS, this.visits);
    const patient = this.getPatientById(visit.patientId);
    this.log({
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      patientId: visit.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'ADMIT_PATIENT',
      category: 'CLINICAL',
      details: `Admitted patient to ${ward.trim()} (visit ${visitId}).`
    });
    this.notify();
  }

  // --- Vitals ---
  public getVitals(visitId?: string, patientId?: string): Vitals[] {
    let list = this.vitals;
    if (visitId) list = list.filter(v => v.visitId === visitId);
    if (patientId) list = list.filter(v => v.patientId === patientId);
    return list.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  }

  public recordVitals(vitalsData: Omit<Vitals, 'id' | 'recordedAt' | 'bmi' | 'bmiCategory'>, nurse: User): Vitals {
    // Auto calculate BMI = weight (kg) / (height (m) ^ 2)
    const h = vitalsData.height > 3 ? vitalsData.height / 100 : vitalsData.height; // handle cm vs m
    const bmiVal = Number((vitalsData.weight / (h * h)).toFixed(1));
    
    let bmiCategory: Vitals['bmiCategory'] = 'Normal';
    if (bmiVal < 18.5) bmiCategory = 'Underweight';
    else if (bmiVal < 25) bmiCategory = 'Normal';
    else if (bmiVal < 30) bmiCategory = 'Overweight';
    else if (bmiVal < 35) bmiCategory = 'Obese Class I';
    else if (bmiVal < 40) bmiCategory = 'Obese Class II';
    else bmiCategory = 'Obese Class III';

    const newVitals: Vitals = {
      ...vitalsData,
      height: h,
      id: `VIT-${Date.now()}`,
      recordedAt: new Date().toISOString(),
      bmi: bmiVal,
      bmiCategory
    };

    this.vitals = [newVitals, ...this.vitals];
    saveStorage(STORAGE_KEYS.VITALS, this.vitals);

    // Vitals recorded by nurse — patient stays with nursing until explicitly sent to doctor
    this.updateVisitStatus(vitalsData.visitId, 'With Nurse', nurse);

    const patient = this.getPatientById(vitalsData.patientId);
    this.log({
      userId: nurse.id,
      userName: nurse.name,
      userRole: nurse.role,
      patientId: vitalsData.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'RECORD_VITALS',
      category: 'CLINICAL',
      details: `Recorded vitals: T ${vitalsData.temperature}°C, BP ${vitalsData.systolicBp}/${vitalsData.diastolicBp} mmHg, Pulse ${vitalsData.pulse} bpm, BMI ${bmiVal} kg/m² (${bmiCategory}).`
    });

    this.notify();
    return newVitals;
  }

  // --- Consultations ---
  public getConsultation(visitId: string): Consultation | undefined {
    return this.consultations.find(c => c.visitId === visitId);
  }

  public getPatientConsultations(patientId: string): Consultation[] {
    return this.consultations.filter(c => c.patientId === patientId);
  }

  public saveConsultation(consultationData: Omit<Consultation, 'id' | 'consultationDate'>, physician: User): Consultation {
    const existingIndex = this.consultations.findIndex(c => c.visitId === consultationData.visitId);
    let result: Consultation;

    if (existingIndex >= 0) {
      result = {
        ...this.consultations[existingIndex],
        ...consultationData,
        consultationDate: new Date().toISOString()
      };
      this.consultations[existingIndex] = result;
    } else {
      result = {
        ...consultationData,
        id: `CON-${Date.now()}`,
        consultationDate: new Date().toISOString()
      };
      this.consultations = [result, ...this.consultations];
    }

    saveStorage(STORAGE_KEYS.CONSULTATIONS, this.consultations);

    // Ensure consultation fee is attached to Central Invoice
    this.ensureInvoiceConsultationItem(result.visitId, result.patientId);

    const patient = this.getPatientById(result.patientId);
    this.log({
      userId: physician.id,
      userName: physician.name,
      userRole: physician.role,
      patientId: result.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'SAVE_CONSULTATION',
      category: 'CLINICAL',
      details: `Physician consultation completed. Primary Diagnosis: ${result.diagnoses[0]?.description || 'None'}.`
    });

    this.notify();
    return result;
  }

  // --- Laboratory ---
  public getLabInvestigations(category?: LabCategory): LabInvestigationDefinition[] {
    if (category) {
      return this.labDefs.filter(d => d.category === category);
    }
    return [...this.labDefs];
  }

  public getLabInvestigationById(id: string): LabInvestigationDefinition | undefined {
    return this.labDefs.find(d => d.id === id);
  }

  public updateLabPrice(definitionId: string, newPrice: number, adminUser: User): void {
    this.labDefs = this.labDefs.map(d => d.id === definitionId ? { ...d, price: newPrice } : d);
    saveStorage(STORAGE_KEYS.LAB_DEFS, this.labDefs);
    const def = this.getLabInvestigationById(definitionId);
    this.log({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      action: 'UPDATE_LAB_PRICE',
      category: 'ADMIN',
      details: `Updated investigation price for ${def?.name || definitionId} to ${this.settings.currency}${newPrice.toLocaleString()}.`
    });
    this.notify();
  }

  public getLabRequests(filter?: { category?: LabCategory; status?: string; patientId?: string; visitId?: string }): LabRequest[] {
    let list = this.labRequests;
    if (filter?.patientId) list = list.filter(r => r.patientId === filter.patientId);
    if (filter?.visitId) list = list.filter(r => r.visitId === filter.visitId);
    if (filter?.category) {
      list = list.filter(r => r.tests.some(t => t.category === filter.category));
    }
    return [...list].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }

  public createLabRequest(requestData: Omit<LabRequest, 'id' | 'requestedAt'>, physician: User): LabRequest {
    const id = `LAB-REQ-${Date.now().toString().slice(-6)}`;
    const newRequest: LabRequest = {
      ...requestData,
      id,
      requestedAt: new Date().toISOString()
    };

    this.labRequests = [newRequest, ...this.labRequests];
    saveStorage(STORAGE_KEYS.LAB_REQUESTS, this.labRequests);

    // Automatically feed investigation charges into Central Invoice
    this.syncLabRequestToInvoice(newRequest);

    const patient = this.getPatientById(newRequest.patientId);
    const testNames = newRequest.tests.map(t => t.testName).join(', ');

    this.log({
      userId: physician.id,
      userName: physician.name,
      userRole: physician.role,
      patientId: newRequest.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'ORDER_LABORATORY',
      category: 'LABORATORY',
      details: `Ordered tests: ${testNames}. Total Lab fee: ${this.settings.currency}${newRequest.totalPrice.toLocaleString()}.`
    });

    this.notify();
    return newRequest;
  }

  public updateLabTestStatus(
    requestId: string, 
    testOrderId: string, 
    status: LabRequest['tests'][0]['status'], 
    user: User, 
    results?: LabRequest['tests'][0]['results'], 
    comments?: string
  ): void {
    this.labRequests = this.labRequests.map(req => {
      if (req.id !== requestId) return req;
      const updatedTests = req.tests.map(t => {
        if (t.id !== testOrderId) return t;
        return {
          ...t,
          status,
          results: results !== undefined ? results : t.results,
          comments: comments !== undefined ? comments : t.comments,
          scientistId: user.role === 'LAB_SCIENTIST' ? user.id : t.scientistId,
          scientistName: user.role === 'LAB_SCIENTIST' ? user.name : t.scientistName,
          verifiedBy: status === 'Released' ? user.name : t.verifiedBy,
          releasedAt: status === 'Released' ? new Date().toISOString() : t.releasedAt
        };
      });
      return { ...req, tests: updatedTests };
    });

    saveStorage(STORAGE_KEYS.LAB_REQUESTS, this.labRequests);

    const req = this.labRequests.find(r => r.id === requestId);
    const test = req?.tests.find(t => t.id === testOrderId);
    const patient = req ? this.getPatientById(req.patientId) : undefined;

    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      patientId: req?.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: status === 'Released' ? 'RELEASE_LAB_RESULT' : 'UPDATE_LAB_STATUS',
      category: 'LABORATORY',
      details: `Investigation ${test?.testName || testOrderId} status changed to ${status}.`
    });

    this.notify();
  }

  // --- Pharmacy ---
  public getMedications(): Medication[] {
    return [...this.medications];
  }

  public getMedicationById(id: string): Medication | undefined {
    return this.medications.find(m => m.id === id);
  }

  public updateMedicationStock(id: string, newStock: number, user: User): void {
    this.medications = this.medications.map(m => m.id === id ? { ...m, currentStock: newStock } : m);
    saveStorage(STORAGE_KEYS.MEDICATIONS, this.medications);
    this.notify();
  }

  public updateMedicationPrice(id: string, newPrice: number, adminUser: User): void {
    this.medications = this.medications.map(m => m.id === id ? { ...m, unitPrice: newPrice } : m);
    saveStorage(STORAGE_KEYS.MEDICATIONS, this.medications);
    const med = this.getMedicationById(id);
    this.log({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      action: 'UPDATE_DRUG_PRICE',
      category: 'ADMIN',
      details: `Updated drug price for ${med?.name || id} to ${this.settings.currency}${newPrice.toLocaleString()}.`
    });
    this.notify();
  }

  public getPrescriptions(patientId?: string, visitId?: string): Prescription[] {
    let list = this.prescriptions;
    if (patientId) list = list.filter(p => p.patientId === patientId);
    if (visitId) list = list.filter(p => p.visitId === visitId);
    return [...list].sort((a, b) => new Date(b.prescribedAt).getTime() - new Date(a.prescribedAt).getTime());
  }

  public createPrescription(rxData: Omit<Prescription, 'id' | 'prescribedAt'>, physician: User): Prescription {
    const id = `RX-${Date.now().toString().slice(-6)}`;
    const newRx: Prescription = {
      ...rxData,
      id,
      prescribedAt: new Date().toISOString()
    };

    this.prescriptions = [newRx, ...this.prescriptions];
    saveStorage(STORAGE_KEYS.PRESCRIPTIONS, this.prescriptions);

    // Automatically feed prescription items into Central Invoice
    this.syncPrescriptionToInvoice(newRx);

    const patient = this.getPatientById(newRx.patientId);
    const meds = newRx.items.map(i => `${i.medicationName} (${i.dosage})`).join(', ');

    this.log({
      userId: physician.id,
      userName: physician.name,
      userRole: physician.role,
      patientId: newRx.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'ISSUE_PRESCRIPTION',
      category: 'PHARMACY',
      details: `Issued prescription for: ${meds}. Total Pharmacy fee: ${this.settings.currency}${newRx.totalPrice.toLocaleString()}.`
    });

    this.notify();
    return newRx;
  }

  public dispensePrescriptionItem(
    rxId: string, 
    itemId: string, 
    quantityDispensed: number, 
    pharmacistNotes: string, 
    pharmacist: User
  ): void {
    let drugToDeduct: { medId: string; qty: number } | null = null;

    this.prescriptions = this.prescriptions.map(rx => {
      if (rx.id !== rxId) return rx;

      const updatedItems = rx.items.map(item => {
        if (item.id !== itemId) return item;
        const totalDispensed = item.quantityDispensed + quantityDispensed;
        let dispenseStatus: Prescription['items'][0]['dispenseStatus'] = 'Dispensed';
        if (totalDispensed === 0) dispenseStatus = 'Pending';
        else if (totalDispensed < item.quantityPrescribed) dispenseStatus = 'Partially Dispensed';

        drugToDeduct = { medId: item.medicationId, qty: quantityDispensed };

        return {
          ...item,
          quantityDispensed: totalDispensed,
          dispenseStatus,
          pharmacistNotes,
          dispensedAt: quantityDispensed > 0 ? new Date().toISOString() : item.dispensedAt
        };
      });

      const allCompleted = updatedItems.every(i => i.dispenseStatus === 'Dispensed');
      const anyDispensed = updatedItems.some(i => i.dispenseStatus === 'Dispensed' || i.dispenseStatus === 'Partially Dispensed');

      return {
        ...rx,
        items: updatedItems,
        status: allCompleted ? 'Completed' : anyDispensed ? 'Partially Dispensed' : 'Pending'
      };
    });

    saveStorage(STORAGE_KEYS.PRESCRIPTIONS, this.prescriptions);

    // Deduct stock from medication inventory
    if (drugToDeduct) {
      const { medId, qty } = drugToDeduct;
      this.medications = this.medications.map(m => {
        if (m.id === medId) {
          return { ...m, currentStock: Math.max(0, m.currentStock - qty) };
        }
        return m;
      });
      saveStorage(STORAGE_KEYS.MEDICATIONS, this.medications);
    }

    const rx = this.prescriptions.find(r => r.id === rxId);
    const item = rx?.items.find(i => i.id === itemId);
    const patient = rx ? this.getPatientById(rx.patientId) : undefined;

    this.log({
      userId: pharmacist.id,
      userName: pharmacist.name,
      userRole: pharmacist.role,
      patientId: rx?.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'DISPENSE_MEDICATION',
      category: 'PHARMACY',
      details: `Dispensed ${quantityDispensed} of ${item?.medicationName}. Stock updated.`
    });

    this.notify();
  }

  // --- Central Billing Engine ---
  public getServicePrices(): ServicePriceItem[] {
    return [...this.services];
  }

  public updateServicePrice(serviceId: string, newPrice: number, adminUser: User): void {
    this.services = this.services.map(s => s.id === serviceId ? { ...s, price: newPrice } : s);
    saveStorage(STORAGE_KEYS.SERVICES, this.services);
    const svc = this.services.find(s => s.id === serviceId);
    this.log({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      action: 'UPDATE_SERVICE_PRICE',
      category: 'ADMIN',
      details: `Updated service fee for ${svc?.name || serviceId} to ${this.settings.currency}${newPrice.toLocaleString()}.`
    });
    this.notify();
  }

  public getInvoices(patientId?: string, visitId?: string): Invoice[] {
    let list = this.invoices;
    if (patientId) list = list.filter(i => i.patientId === patientId);
    if (visitId) list = list.filter(i => i.visitId === visitId);
    return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  public getInvoiceById(id: string): Invoice | undefined {
    return this.invoices.find(i => i.id === id);
  }

  public getOrCreateVisitInvoice(visitId: string, patientId: string): Invoice {
    let invoice = this.invoices.find(i => i.visitId === visitId);
    if (!invoice) {
      const id = `${this.settings.invoicePrefix}-${new Date().getFullYear()}-${String(this.invoices.length + 1).padStart(3, '0')}`;
      invoice = {
        id,
        visitId,
        patientId,
        date: new Date().toISOString().split('T')[0],
        items: [],
        subtotal: 0,
        discount: 0,
        total: 0,
        paidAmount: 0,
        balance: 0,
        paymentStatus: 'Unpaid',
        payments: []
      };
      this.invoices = [invoice, ...this.invoices];
      saveStorage(STORAGE_KEYS.INVOICES, this.invoices);
    }
    return invoice;
  }

  private recalculateInvoice(invoice: Invoice): Invoice {
    const subtotal = invoice.items.reduce((sum, item) => sum + item.totalPrice, 0);
    const total = Math.max(0, subtotal - invoice.discount);
    const paidAmount = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = Math.max(0, total - paidAmount);

    let paymentStatus: Invoice['paymentStatus'] = 'Unpaid';
    if (paidAmount >= total && total > 0) paymentStatus = 'Paid';
    else if (paidAmount > 0) paymentStatus = 'Partially Paid';

    return {
      ...invoice,
      subtotal,
      total,
      paidAmount,
      balance,
      paymentStatus
    };
  }

  private ensureInvoiceConsultationItem(visitId: string, patientId: string): void {
    let invoice = this.getOrCreateVisitInvoice(visitId, patientId);
    const hasConsultation = invoice.items.some(i => i.serviceCategory === 'Consultation');
    if (!hasConsultation) {
      const consultSvc = this.services.find(s => s.category === 'Consultation' && s.active) || { price: 10000, name: 'General Physician Consultation' };
      const newItem = {
        id: `INV-ITM-${Date.now()}`,
        serviceCategory: 'Consultation' as const,
        description: consultSvc.name,
        quantity: 1,
        unitPrice: consultSvc.price,
        totalPrice: consultSvc.price
      };
      invoice.items.push(newItem);
      invoice = this.recalculateInvoice(invoice);
      this.invoices = this.invoices.map(i => i.id === invoice.id ? invoice : i);
      saveStorage(STORAGE_KEYS.INVOICES, this.invoices);
    }
  }

  private syncLabRequestToInvoice(labReq: LabRequest): void {
    let invoice = this.getOrCreateVisitInvoice(labReq.visitId, labReq.patientId);
    // Add items for each ordered test
    labReq.tests.forEach(test => {
      invoice.items.push({
        id: `INV-ITM-${Date.now()}-${test.id}`,
        serviceCategory: 'Laboratory',
        description: `${test.testName} (${test.category.replace('_', ' ')})`,
        quantity: 1,
        unitPrice: test.price,
        totalPrice: test.price,
        referenceId: labReq.id
      });
    });

    invoice = this.recalculateInvoice(invoice);
    this.invoices = this.invoices.map(i => i.id === invoice.id ? invoice : i);
    saveStorage(STORAGE_KEYS.INVOICES, this.invoices);
  }

  private syncPrescriptionToInvoice(rx: Prescription): void {
    let invoice = this.getOrCreateVisitInvoice(rx.visitId, rx.patientId);
    rx.items.forEach(item => {
      invoice.items.push({
        id: `INV-ITM-${Date.now()}-${item.id}`,
        serviceCategory: 'Pharmacy',
        description: `${item.medicationName} x ${item.quantityPrescribed}`,
        quantity: item.quantityPrescribed,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        referenceId: rx.id
      });
    });

    invoice = this.recalculateInvoice(invoice);
    this.invoices = this.invoices.map(i => i.id === invoice.id ? invoice : i);
    saveStorage(STORAGE_KEYS.INVOICES, this.invoices);
  }

  // Front Desk Controller guard - only front desk can mutate billing payments sitewide
  private isFrontDeskController(role: User['role']): boolean {
    return (['FRONT_DESK','BILLING_OFFICER','ADMINISTRATOR'] as User['role'][]).includes(role);
  }

  public recordPayment(
    invoiceId: string, 
    amount: number, 
    method: PaymentRecord['paymentMethod'], 
    officer: User,
    bankName?: string,
    transactionReference?: string
  ): PaymentRecord {
    if (!this.isFrontDeskController(officer.role)) {
      throw new Error(`Front Desk Controlled: Payments can only be processed by Front Desk / Billing Officer / Administrator (current role: ${officer.role}). Please route payment via Front Desk Cashier.`);
    }
    const invoice = this.getInvoiceById(invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    const prefix = (this.getReceiptSettings().receiptPrefix || 'RCP').trim() || 'RCP';
    const receiptNumber = `${prefix}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const payment: PaymentRecord = {
      id: `PMT-${Date.now()}`,
      receiptNumber,
      paidAt: new Date().toISOString(),
      amount,
      paymentMethod: method,
      receivedBy: `${officer.name} (${officer.role})`,
      bankName: bankName || undefined,
      transactionReference: transactionReference || undefined
    };

    invoice.payments.push(payment);
    const updated = this.recalculateInvoice(invoice);
    this.invoices = this.invoices.map(i => i.id === invoiceId ? updated : i);
    saveStorage(STORAGE_KEYS.INVOICES, this.invoices);

    const patient = this.getPatientById(invoice.patientId);
    this.log({
      userId: officer.id,
      userName: officer.name,
      userRole: officer.role,
      patientId: invoice.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'PROCESS_PAYMENT',
      category: 'BILLING',
      details: `Processed payment of ${this.settings.currency}${amount.toLocaleString()} via ${method} (${bankName ? bankName + ', ' : ''}${transactionReference || receiptNumber}) for invoice ${invoiceId}. Receipt: ${receiptNumber}.`
    });

    this.notify();
    return payment;
  }

  public createFrontDeskBill(
    patientId: string,
    visitId: string,
    items: Array<{ serviceCategory: InvoiceItem['serviceCategory']; description: string; quantity: number; unitPrice: number }>,
    requirePrepayment: boolean = false,
    officer: User
  ): Invoice {
    if (!this.isFrontDeskController(officer.role)) {
      throw new Error(`Front Desk Controlled: Bills can only be generated by Front Desk / Billing Officer / Administrator (current role: ${officer.role}).`);
    }
    let invoice = this.getOrCreateVisitInvoice(visitId, patientId);
    invoice.requirePrepayment = requirePrepayment;

    items.forEach(itm => {
      invoice.items.push({
        id: `INV-ITM-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        serviceCategory: itm.serviceCategory,
        description: itm.description,
        quantity: itm.quantity,
        unitPrice: itm.unitPrice,
        totalPrice: itm.unitPrice * itm.quantity
      });
    });

    invoice = this.recalculateInvoice(invoice);
    this.invoices = this.invoices.map(i => i.id === invoice.id ? invoice : i);
    saveStorage(STORAGE_KEYS.INVOICES, this.invoices);

    this.log({
      userId: officer.id,
      userName: officer.name,
      userRole: officer.role,
      patientId,
      action: 'CREATE_BILL',
      category: 'BILLING',
      details: `Created invoice ${invoice.id} with ${items.length} items. Total: ${this.settings.currency}${invoice.total.toLocaleString()}. Pre-payment required: ${requirePrepayment ? 'YES' : 'NO'}.`
    });

    this.notify();
    return invoice;
  }

  public setInvoicePrepayment(invoiceId: string, requirePrepayment: boolean, actor?: User): void {
    this.invoices = this.invoices.map(inv => {
      if (inv.id === invoiceId) {
        return { ...inv, requirePrepayment };
      }
      return inv;
    });
    saveStorage(STORAGE_KEYS.INVOICES, this.invoices);
    if (actor) {
      const invoice = this.invoices.find(i => i.id === invoiceId);
      const patient = invoice ? this.getPatientById(invoice.patientId) : undefined;
      this.log({
        userId: actor.id,
        userName: actor.name,
        userRole: actor.role,
        patientId: invoice?.patientId,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
        action: 'SET_INVOICE_PREPAYMENT',
        category: 'BILLING',
        details: `Set pre-payment requirement to ${requirePrepayment ? 'YES' : 'NO'} for invoice ${invoiceId}.`
      });
    }
    this.notify();
  }

  public isVisitServiceAllowed(visitId: string): { allowed: boolean; invoiceId?: string; balanceDue: number } {
    const invoice = this.invoices.find(i => i.visitId === visitId);
    if (!invoice) return { allowed: true, balanceDue: 0 };
    if (!invoice.requirePrepayment) return { allowed: true, invoiceId: invoice.id, balanceDue: invoice.balance };
    const allowed = invoice.balance === 0;
    return { allowed, invoiceId: invoice.id, balanceDue: invoice.balance };
  }

  // --- Online Self-Registration / Appointments ---
  public getOnlineBookings(): OnlineBooking[] {
    return [...this.onlineBookings].sort((a, b) => new Date(b.bookedAt).getTime() - new Date(a.bookedAt).getTime());
  }

  public getOnlineBookingByCode(code: string): OnlineBooking | undefined {
    return this.onlineBookings.find(b => b.patientCode.toUpperCase() === code.trim().toUpperCase());
  }

  public createOnlineBooking(bookingData: Omit<OnlineBooking, 'id' | 'patientCode' | 'bookedAt' | 'status'>): OnlineBooking {
    const randomCode = `REG-${Math.floor(1000 + Math.random() * 9000)}`;
    const newBooking: OnlineBooking = {
      ...bookingData,
      id: `OB-${Date.now()}`,
      patientCode: randomCode,
      bookedAt: new Date().toISOString(),
      status: 'Pending Arrival'
    };

    this.onlineBookings = [newBooking, ...this.onlineBookings];
    saveStorage(STORAGE_KEYS.ONLINE_BOOKINGS, this.onlineBookings);
    this.notify();
    return newBooking;
  }

  public convertBookingToPatient(bookingIdOrCode: string, officerUser: User): { patient: Patient; visit: Visit } {
    const booking = this.onlineBookings.find(b => b.id === bookingIdOrCode || b.patientCode.toUpperCase() === bookingIdOrCode.trim().toUpperCase());
    if (!booking) throw new Error('Online booking record not found');

    const patient = this.registerPatient({
      firstName: booking.firstName,
      middleName: booking.middleName,
      lastName: booking.lastName,
      dob: booking.dob,
      age: booking.age,
      sex: booking.sex,
      phone: booking.phone,
      email: booking.email,
      address: booking.address,
      nextOfKin: 'Self-Registered',
      emergencyContact: booking.phone,
      allergies: [],
      alerts: [`Pre-registered online (${booking.patientCode})`]
    }, officerUser);

    const visit = this.createVisit({
      patientId: patient.id,
      visitDate: new Date().toISOString().split('T')[0],
      visitTime: new Date().toTimeString().slice(0, 5),
      visitType: 'New Visit',
      status: 'Awaiting Vitals',
      reasonForVisit: booking.reasonForAppointment
    }, officerUser);

    // Update booking status
    this.onlineBookings = this.onlineBookings.map(b => b.id === booking.id ? { ...b, status: 'Completed' } : b);
    saveStorage(STORAGE_KEYS.ONLINE_BOOKINGS, this.onlineBookings);

    this.notify();
    return { patient, visit };
  }

  // --- Lab Stock Management ---
  public getLabStockItems(): LabStockItem[] {
    return [...this.labStock];
  }

  public logLabStockUsage(itemId: string, quantity: number, user: User): void {
    this.labStock = this.labStock.map(s => {
      if (s.id === itemId) {
        return {
          ...s,
          currentStock: Math.max(0, s.currentStock - quantity),
          lastUsedAt: new Date().toISOString()
        };
      }
      return s;
    });
    saveStorage(STORAGE_KEYS.LAB_STOCK, this.labStock);
    const item = this.labStock.find(s => s.id === itemId);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_LAB_STOCK_USAGE',
      category: 'LABORATORY',
      details: `Logged usage of ${quantity} ${item?.unit || 'units'} of ${item?.name || itemId}. Current stock: ${item?.currentStock}.`
    });
    this.notify();
  }

  public requestLabRestock(itemId: string, quantity: number, urgency: 'Routine' | 'Urgent', user: User): LabStockRequest {
    const item = this.labStock.find(s => s.id === itemId);
    const req: LabStockRequest = {
      id: `SREQ-${Date.now()}`,
      itemId,
      itemName: item?.name || itemId,
      quantityRequested: quantity,
      requestedBy: `${user.name} (${user.role})`,
      requestedAt: new Date().toISOString(),
      status: 'Pending',
      urgency
    };
    this.labStockRequests = [req, ...this.labStockRequests];
    saveStorage(STORAGE_KEYS.LAB_STOCK_REQUESTS, this.labStockRequests);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'SUBMIT_STOCK_REORDER',
      category: 'LABORATORY',
      details: `Submitted restock request for ${quantity} of ${req.itemName} (${urgency}).`
    });
    this.notify();
    return req;
  }

  public getLabStockRequests(): LabStockRequest[] {
    return [...this.labStockRequests];
  }

  public updateLabInvestigationPrice(id: string, newPrice: number, user: User): void {
    this.labDefs = this.labDefs.map(def => def.id === id ? { ...def, price: newPrice } : def);
    saveStorage(STORAGE_KEYS.LAB_DEFS, this.labDefs);
    const def = this.labDefs.find(d => d.id === id);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_LAB_TEST_PRICE',
      category: 'ADMIN',
      details: `Updated investigation price for ${def?.name || id} to ${this.settings.currency}${newPrice.toLocaleString()}.`
    });
    this.notify();
  }

  // --- Radiology & Physiotherapy Orders ---
  public getRadiologyOrders(patientId?: string, visitId?: string): RadiologyOrder[] {
    let list = this.radiologyOrders;
    if (patientId) list = list.filter(r => r.patientId === patientId);
    if (visitId) list = list.filter(r => r.visitId === visitId);
    return [...list].sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());
  }

  public createRadiologyOrder(orderData: Omit<RadiologyOrder, 'id' | 'orderedAt' | 'status'>, user: User): RadiologyOrder {
    const id = `RAD-${Date.now()}`;
    const newOrder: RadiologyOrder = {
      ...orderData,
      id,
      orderedAt: new Date().toISOString(),
      status: 'Requested'
    };
    this.radiologyOrders = [newOrder, ...this.radiologyOrders];
    saveStorage(STORAGE_KEYS.RADIOLOGY_ORDERS, this.radiologyOrders);

    // Sync to visit invoice
    let invoice = this.getOrCreateVisitInvoice(newOrder.visitId, newOrder.patientId);
    invoice.items.push({
      id: `INV-ITM-${id}`,
      serviceCategory: 'Procedure',
      description: `Radiology: ${newOrder.investigationName} (${newOrder.modality})`,
      quantity: 1,
      unitPrice: newOrder.price,
      totalPrice: newOrder.price,
      referenceId: id
    });
    invoice = this.recalculateInvoice(invoice);
    this.invoices = this.invoices.map(i => i.id === invoice.id ? invoice : i);
    saveStorage(STORAGE_KEYS.INVOICES, this.invoices);

    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      patientId: newOrder.patientId,
      action: 'ORDER_RADIOLOGY',
      category: 'CLINICAL',
      details: `Ordered ${newOrder.investigationName} (${newOrder.modality}) for visit ${newOrder.visitId}. Fee: ${this.settings.currency}${newOrder.price.toLocaleString()}.`
    });
    this.notify();
    return newOrder;
  }

  public getPhysiotherapyOrders(patientId?: string, visitId?: string): PhysiotherapyOrder[] {
    let list = this.physiotherapyOrders;
    if (patientId) list = list.filter(p => p.patientId === patientId);
    if (visitId) list = list.filter(p => p.visitId === visitId);
    return [...list].sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());
  }

  public createPhysiotherapyOrder(orderData: Omit<PhysiotherapyOrder, 'id' | 'orderedAt' | 'status'>, user: User): PhysiotherapyOrder {
    const id = `PT-${Date.now()}`;
    const newOrder: PhysiotherapyOrder = {
      ...orderData,
      id,
      orderedAt: new Date().toISOString(),
      status: 'Requested'
    };
    this.physiotherapyOrders = [newOrder, ...this.physiotherapyOrders];
    saveStorage(STORAGE_KEYS.PHYSIOTHERAPY_ORDERS, this.physiotherapyOrders);

    // Sync to visit invoice
    let invoice = this.getOrCreateVisitInvoice(newOrder.visitId, newOrder.patientId);
    invoice.items.push({
      id: `INV-ITM-${id}`,
      serviceCategory: 'Procedure',
      description: `Physiotherapy: ${newOrder.serviceName} (${newOrder.sessions} sessions)`,
      quantity: newOrder.sessions,
      unitPrice: Math.round(newOrder.price / newOrder.sessions),
      totalPrice: newOrder.price,
      referenceId: id
    });
    invoice = this.recalculateInvoice(invoice);
    this.invoices = this.invoices.map(i => i.id === invoice.id ? invoice : i);
    saveStorage(STORAGE_KEYS.INVOICES, this.invoices);

    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      patientId: newOrder.patientId,
      action: 'ORDER_PHYSIOTHERAPY',
      category: 'CLINICAL',
      details: `Ordered ${newOrder.serviceName} (${newOrder.sessions} sessions) for visit ${newOrder.visitId}. Fee: ${this.settings.currency}${newOrder.price.toLocaleString()}.`
    });
    this.notify();
    return newOrder;
  }

  public updateRadiologyOrderStatus(orderId: string, status: RadiologyOrder['status'], user: User): void {
    this.radiologyOrders = this.radiologyOrders.map(ord => ord.id === orderId ? { ...ord, status } : ord);
    saveStorage(STORAGE_KEYS.RADIOLOGY_ORDERS, this.radiologyOrders);
    this.notify();
  }

  public saveRadiologyReport(orderId: string, reportData: { findings: string; impression: string; filmSize?: string; contrastUsed?: boolean }, user: User): void {
    this.radiologyOrders = this.radiologyOrders.map(ord => {
      if (ord.id === orderId) {
        return {
          ...ord,
          ...reportData,
          status: 'Report Ready',
          reportedBy: user.name,
          reportedAt: new Date().toISOString()
        };
      }
      return ord;
    });
    saveStorage(STORAGE_KEYS.RADIOLOGY_ORDERS, this.radiologyOrders);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'RADIOLOGY_REPORT_SAVED',
      category: 'CLINICAL',
      details: `Diagnostic imaging report filed for Order #${orderId} by ${user.name}.`
    });
    this.notify();
  }

  public updatePhysiotherapyOrderStatus(orderId: string, status: PhysiotherapyOrder['status'], user: User): void {
    this.physiotherapyOrders = this.physiotherapyOrders.map(ord => ord.id === orderId ? { ...ord, status } : ord);
    saveStorage(STORAGE_KEYS.PHYSIOTHERAPY_ORDERS, this.physiotherapyOrders);
    this.notify();
  }

  public recordPhysiotherapySession(orderId: string, sessionData: { progressNotes: string; sessionsCompleted: number; status?: PhysiotherapyOrder['status'] }, user: User): void {
    this.physiotherapyOrders = this.physiotherapyOrders.map(ord => {
      if (ord.id === orderId) {
        return {
          ...ord,
          ...sessionData,
          status: sessionData.status || (sessionData.sessionsCompleted >= ord.sessions ? 'Completed' : 'In Progress'),
          treatedBy: user.name,
          lastSessionDate: new Date().toISOString().split('T')[0]
        };
      }
      return ord;
    });
    saveStorage(STORAGE_KEYS.PHYSIOTHERAPY_ORDERS, this.physiotherapyOrders);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'PHYSIOTHERAPY_SESSION_LOGGED',
      category: 'CLINICAL',
      details: `Rehabilitation session logged for Order #${orderId} by ${user.name}.`
    });
    this.notify();
  }

  // --- Clinical Consumables Management ---
  public getClinicalConsumables(): ClinicalConsumable[] {
    return [...this.clinicalConsumables];
  }

  public addClinicalConsumable(itemData: Omit<ClinicalConsumable, 'id' | 'lastUpdated'>, user: User): ClinicalConsumable {
    const id = `CSM-${String(this.clinicalConsumables.length + 1).padStart(3, '0')}`;
    const newItem: ClinicalConsumable = {
      ...itemData,
      id,
      lastUpdated: new Date().toISOString()
    };
    this.clinicalConsumables = [newItem, ...this.clinicalConsumables];
    saveStorage(STORAGE_KEYS.CLINICAL_CONSUMABLES, this.clinicalConsumables);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'ADD_CONSUMABLE',
      category: 'ADMIN',
      details: `Added new consumable item: ${newItem.name} (${newItem.category}). Price: ${this.settings.currency}${newItem.unitPrice}.`
    });
    this.notify();
    return newItem;
  }

  public updateClinicalConsumable(updated: ClinicalConsumable, user: User): void {
    this.clinicalConsumables = this.clinicalConsumables.map(c => c.id === updated.id ? { ...updated, lastUpdated: new Date().toISOString() } : c);
    saveStorage(STORAGE_KEYS.CLINICAL_CONSUMABLES, this.clinicalConsumables);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_CONSUMABLE',
      category: 'ADMIN',
      details: `Updated consumable item: ${updated.name}. Stock: ${updated.currentStock}, Price: ${this.settings.currency}${updated.unitPrice}.`
    });
    this.notify();
  }

  public deleteClinicalConsumable(id: string, user: User): void {
    const target = this.clinicalConsumables.find(c => c.id === id);
    this.clinicalConsumables = this.clinicalConsumables.filter(c => c.id !== id);
    saveStorage(STORAGE_KEYS.CLINICAL_CONSUMABLES, this.clinicalConsumables);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'DELETE_CONSUMABLE',
      category: 'ADMIN',
      details: `Deleted consumable item: ${target ? target.name : id}.`
    });
    this.notify();
  }

  public updateConsumableStock(id: string, newStock: number, user: User): void {
    this.clinicalConsumables = this.clinicalConsumables.map(c => c.id === id ? { ...c, currentStock: newStock, lastUpdated: new Date().toISOString() } : c);
    saveStorage(STORAGE_KEYS.CLINICAL_CONSUMABLES, this.clinicalConsumables);
    this.notify();
  }

  public getLowStockConsumables(): ClinicalConsumable[] {
    return this.clinicalConsumables.filter(c => c.currentStock <= c.minAlertLevel);
  }

  public getConsumableRequests(section?: string): ConsumableStockRequest[] {
    let list = [...this.consumableRequests];
    if (section) list = list.filter(r => r.section === section);
    return list.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }

  public requestConsumableRestock(
    consumableId: string,
    quantity: number,
    urgency: 'Routine' | 'Urgent',
    user: User,
    section?: string
  ): ConsumableStockRequest {
    const item = this.clinicalConsumables.find(c => c.id === consumableId);
    const req: ConsumableStockRequest = {
      id: `CREQ-${Date.now()}`,
      consumableId,
      consumableName: item?.name || consumableId,
      section: section || item?.category || user.department || 'General',
      quantityRequested: quantity,
      requestedBy: `${user.name} (${user.role})`,
      requestedAt: new Date().toISOString(),
      status: 'Pending',
      urgency
    };
    this.consumableRequests = [req, ...this.consumableRequests];
    saveStorage(STORAGE_KEYS.CONSUMABLE_REQUESTS, this.consumableRequests);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'SUBMIT_CONSUMABLE_REQUEST',
      category: 'ADMIN',
      details: `Submitted consumable restock request: ${quantity} x ${req.consumableName} [${req.section}] (${urgency}).`
    });
    this.notify();
    return req;
  }

  public updateConsumableRequestStatus(requestId: string, status: ConsumableStockRequest['status'], user: User): void {
    this.consumableRequests = this.consumableRequests.map(r => {
      if (r.id !== requestId) return r;
      // When dispatched, add the requested quantity back into stock (admin fulfilment)
      if (status === 'Dispatched') {
        this.clinicalConsumables = this.clinicalConsumables.map(c =>
          c.id === r.consumableId
            ? { ...c, currentStock: c.currentStock + r.quantityRequested, lastUpdated: new Date().toISOString() }
            : c
        );
        saveStorage(STORAGE_KEYS.CLINICAL_CONSUMABLES, this.clinicalConsumables);
      }
      return { ...r, status };
    });
    saveStorage(STORAGE_KEYS.CONSUMABLE_REQUESTS, this.consumableRequests);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_CONSUMABLE_REQUEST',
      category: 'ADMIN',
      details: `Updated consumable request ${requestId} to ${status}.`
    });
    this.notify();
  }

  public getConsumableUsageLogs(section?: string): ConsumableUsageLog[] {
    let list = [...this.consumableUsage];
    if (section) list = list.filter(l => l.section === section);
    return list.sort((a, b) => new Date(b.usedAt).getTime() - new Date(a.usedAt).getTime());
  }

  private consumableCategoryToInvoiceCategory(category: string): InvoiceItem['serviceCategory'] {
    if (category === 'Laboratory') return 'Laboratory';
    if (category === 'Pharmacy') return 'Pharmacy';
    if (category === 'Nursing') return 'Nursing';
    if (category === 'Consultation') return 'Consultation';
    return 'Procedure';
  }

  /**
   * Harmonized consumable usage: subtracts from stock, records a usage log,
   * and (when patientId + visitId are supplied) posts the charge to that visit's
   * single invoice so billing stays in sync with what each section actually used.
   */
  public logConsumableUsage(
    consumableId: string,
    quantity: number,
    user: User,
    opts?: { section?: string; patientId?: string; visitId?: string }
  ): ConsumableUsageLog {
    const item = this.clinicalConsumables.find(c => c.id === consumableId);
    if (!item) throw new Error(`Consumable ${consumableId} not found`);
    if (quantity <= 0) throw new Error('Quantity must be greater than zero');
    if (item.currentStock < quantity) {
      throw new Error(`Insufficient stock for ${item.name}. Available: ${item.currentStock}, requested: ${quantity}.`);
    }
    const section = opts?.section || item.category;
    const totalCharge = item.unitPrice * quantity;

    this.clinicalConsumables = this.clinicalConsumables.map(c =>
      c.id === consumableId
        ? { ...c, currentStock: Math.max(0, c.currentStock - quantity), lastUpdated: new Date().toISOString() }
        : c
    );
    saveStorage(STORAGE_KEYS.CLINICAL_CONSUMABLES, this.clinicalConsumables);

    let invoiceId: string | undefined;
    if (opts?.patientId && opts?.visitId) {
      let invoice = this.getOrCreateVisitInvoice(opts.visitId, opts.patientId);
      invoice.items.push({
        id: `INV-ITM-${Date.now()}-${consumableId}`,
        serviceCategory: this.consumableCategoryToInvoiceCategory(item.category),
        description: `Consumable: ${item.name} [${section}]`,
        quantity,
        unitPrice: item.unitPrice,
        totalPrice: totalCharge,
        referenceId: consumableId
      });
      invoice = this.recalculateInvoice(invoice);
      this.invoices = this.invoices.map(i => i.id === invoice.id ? invoice : i);
      saveStorage(STORAGE_KEYS.INVOICES, this.invoices);
      invoiceId = invoice.id;
    }

    const entry: ConsumableUsageLog = {
      id: `CUSE-${Date.now()}`,
      consumableId,
      consumableName: item.name,
      section,
      quantityUsed: quantity,
      unitPrice: item.unitPrice,
      totalCharge,
      usedBy: `${user.name} (${user.role})`,
      usedAt: new Date().toISOString(),
      patientId: opts?.patientId,
      visitId: opts?.visitId,
      invoiceId
    };
    this.consumableUsage = [entry, ...this.consumableUsage];
    saveStorage(STORAGE_KEYS.CONSUMABLE_USAGE, this.consumableUsage);
    const patient = opts?.patientId ? this.getPatientById(opts.patientId) : undefined;
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      patientId: opts?.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
      action: 'LOG_CONSUMABLE_USAGE',
      category: 'ADMIN',
      details: `Logged usage of ${quantity} x ${item.name} [${section}]${invoiceId ? ` billed to invoice ${invoiceId}` : ''}. Remaining stock: ${Math.max(0, item.currentStock - quantity)}.`
    });
    this.notify();
    return entry;
  }

  // --- Laboratory Investigations CRUD ---
  public addLabInvestigation(def: Omit<LabInvestigationDefinition, 'id'>, user: User): LabInvestigationDefinition {
    const id = `LAB-${def.category.substring(0, 3)}-${String(this.labDefs.length + 1).padStart(2, '0')}`;
    const newDef: LabInvestigationDefinition = { ...def, id };
    this.labDefs = [...this.labDefs, newDef];
    saveStorage(STORAGE_KEYS.LAB_DEFS, this.labDefs);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'ADD_LAB_INVESTIGATION',
      category: 'ADMIN',
      details: `Created new laboratory test: ${newDef.name} (${newDef.category}). Fee: ${this.settings.currency}${newDef.price}.`
    });
    this.notify();
    return newDef;
  }

  public updateLabInvestigation(updated: LabInvestigationDefinition, user: User): void {
    this.labDefs = this.labDefs.map(d => d.id === updated.id ? updated : d);
    saveStorage(STORAGE_KEYS.LAB_DEFS, this.labDefs);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_LAB_INVESTIGATION',
      category: 'ADMIN',
      details: `Updated lab investigation: ${updated.name}. Price: ${this.settings.currency}${updated.price}.`
    });
    this.notify();
  }

  public deleteLabInvestigation(id: string, user: User): void {
    const target = this.labDefs.find(d => d.id === id);
    this.labDefs = this.labDefs.filter(d => d.id !== id);
    saveStorage(STORAGE_KEYS.LAB_DEFS, this.labDefs);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'DELETE_LAB_INVESTIGATION',
      category: 'ADMIN',
      details: `Deleted lab investigation: ${target ? target.name : id}.`
    });
    this.notify();
  }

  // --- Pharmacy Medications CRUD ---
  public addMedication(med: Omit<Medication, 'id'>, user: User): Medication {
    const id = `MED-${String(this.medications.length + 1).padStart(3, '0')}`;
    const newMed: Medication = { ...med, id };
    this.medications = [...this.medications, newMed];
    saveStorage(STORAGE_KEYS.MEDICATIONS, this.medications);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'ADD_MEDICATION',
      category: 'ADMIN',
      details: `Registered new drug to formulary: ${newMed.name} (${newMed.strength}). Unit Price: ${this.settings.currency}${newMed.unitPrice}.`
    });
    this.notify();
    return newMed;
  }

  public updateMedication(updated: Medication, user: User): void {
    this.medications = this.medications.map(m => m.id === updated.id ? updated : m);
    saveStorage(STORAGE_KEYS.MEDICATIONS, this.medications);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_MEDICATION',
      category: 'ADMIN',
      details: `Updated medication: ${updated.name}. Price: ${this.settings.currency}${updated.unitPrice}, Stock: ${updated.currentStock}.`
    });
    this.notify();
  }

  public deleteMedication(id: string, user: User): void {
    const target = this.medications.find(m => m.id === id);
    this.medications = this.medications.filter(m => m.id !== id);
    saveStorage(STORAGE_KEYS.MEDICATIONS, this.medications);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'DELETE_MEDICATION',
      category: 'ADMIN',
      details: `Removed medication: ${target ? target.name : id} from pharmacy inventory.`
    });
    this.notify();
  }

  // --- Pharmacy stock (reorder) requests ---
  public getMedicationRequests(): MedicationRequest[] {
    return [...this.medicationRequests].sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );
  }

  public requestMedicationRestock(
    medicationId: string,
    quantity: number,
    urgency: 'Routine' | 'Urgent',
    user: User
  ): MedicationRequest {
    const med = this.medications.find(m => m.id === medicationId);
    if (!med) throw new Error(`Medication ${medicationId} not found`);
    if (quantity <= 0) throw new Error('Quantity must be greater than zero');
    const req: MedicationRequest = {
      id: `MREQ-${Date.now()}`,
      medicationId,
      medicationName: `${med.name} (${med.strength})`,
      quantityRequested: quantity,
      requestedBy: `${user.name} (${user.role})`,
      requestedAt: new Date().toISOString(),
      status: 'Pending',
      urgency
    };
    this.medicationRequests = [req, ...this.medicationRequests];
    saveStorage(STORAGE_KEYS.MEDICATION_REQUESTS, this.medicationRequests);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'SUBMIT_MEDICATION_REQUEST',
      category: 'PHARMACY',
      details: `Submitted drug restock request: ${quantity} x ${req.medicationName} (${urgency}).`
    });
    this.notify();
    return req;
  }

  public updateMedicationRequestStatus(requestId: string, status: MedicationRequest['status'], user: User): void {
    this.medicationRequests = this.medicationRequests.map(r => {
      if (r.id !== requestId) return r;
      if (status === 'Dispatched') {
        this.medications = this.medications.map(m =>
          m.id === r.medicationId ? { ...m, currentStock: m.currentStock + r.quantityRequested } : m
        );
        saveStorage(STORAGE_KEYS.MEDICATIONS, this.medications);
      }
      return { ...r, status };
    });
    saveStorage(STORAGE_KEYS.MEDICATION_REQUESTS, this.medicationRequests);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'UPDATE_MEDICATION_REQUEST',
      category: 'PHARMACY',
      details: `Updated drug restock request ${requestId} to ${status}.`
    });
    this.notify();
  }

  // --- Service Prices CRUD ---
  public addServicePrice(item: Omit<ServicePriceItem, 'id'>, user: User): ServicePriceItem {
    const id = `SVC-${String(this.services.length + 1).padStart(3, '0')}`;
    const newItem: ServicePriceItem = { ...item, id };
    this.services = [...this.services, newItem];
    saveStorage(STORAGE_KEYS.SERVICES, this.services);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'ADD_SERVICE_PRICE',
      category: 'ADMIN',
      details: `Added service price: ${newItem.name} (${newItem.category}) - ${this.settings.currency}${newItem.price}.`
    });
    this.notify();
    return newItem;
  }

  public deleteServicePrice(id: string, user: User): void {
    const target = this.services.find(s => s.id === id);
    this.services = this.services.filter(s => s.id !== id);
    saveStorage(STORAGE_KEYS.SERVICES, this.services);
    this.log({
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'DELETE_SERVICE_PRICE',
      category: 'ADMIN',
      details: `Removed service price item: ${target ? target.name : id}.`
    });
    this.notify();
  }

  // --- Custom Roles ---
  public getCustomRoles(): CustomRole[] {
    return [...this.customRoles];
  }

  public getCustomRoleById(id: string): CustomRole | undefined {
    return this.customRoles.find(r => r.id === id);
  }

  public addCustomRole(name: string, description: string, permissions: string[], creator: User): CustomRole {
    const role: CustomRole = {
      id: `ROLE-${Date.now()}`,
      name,
      description,
      permissions,
      createdAt: new Date().toISOString(),
      createdBy: creator.id
    };
    this.customRoles = [role, ...this.customRoles];
    saveStorage(STORAGE_KEYS.CUSTOM_ROLES, this.customRoles);
    this.log({
      userId: creator.id,
      userName: creator.name,
      userRole: creator.role,
      action: 'CREATE_CUSTOM_ROLE',
      category: 'ADMIN',
      details: `Created custom role: ${name} with ${permissions.length} permission(s).`
    });
    this.notify();
    return role;
  }

  public updateCustomRole(id: string, name: string, description: string, permissions: string[], updater: User): void {
    this.customRoles = this.customRoles.map(r => r.id === id ? { ...r, name, description, permissions } : r);
    saveStorage(STORAGE_KEYS.CUSTOM_ROLES, this.customRoles);
    this.log({
      userId: updater.id,
      userName: updater.name,
      userRole: updater.role,
      action: 'UPDATE_CUSTOM_ROLE',
      category: 'ADMIN',
      details: `Updated custom role: ${name}.`
    });
    this.notify();
  }

  public deleteCustomRole(id: string, deleter: User): void {
    const target = this.customRoles.find(r => r.id === id);
    this.customRoles = this.customRoles.filter(r => r.id !== id);
    saveStorage(STORAGE_KEYS.CUSTOM_ROLES, this.customRoles);
    this.log({
      userId: deleter.id,
      userName: deleter.name,
      userRole: deleter.role,
      action: 'DELETE_CUSTOM_ROLE',
      category: 'ADMIN',
      details: `Deleted custom role: ${target ? target.name : id}.`
    });
    this.notify();
  }

  // --- Reset to Demo Data ---
  public resetToFactoryDemo(): void {
    localStorage.clear();
    this.settings = initialSettings;
    this.users = initialUsers;
    this.patients = initialPatients;
    this.visits = initialVisits;
    this.vitals = initialVitals;
    this.consultations = initialConsultations;
    this.labDefs = initialLabInvestigations;
    this.labRequests = initialLabRequests;
    this.prescriptions = initialPrescriptions;
    this.medications = initialMedications;
    this.services = initialServicePrices;
    this.invoices = initialInvoices;
    this.auditLogs = initialAuditLogs;
    this.onlineBookings = initialOnlineBookings;
    this.labStock = initialLabStock;
    this.labStockRequests = initialLabStockRequests;
    this.radiologyOrders = initialRadiologyOrders;
    this.physiotherapyOrders = initialPhysiotherapyOrders;
    this.clinicalConsumables = initialClinicalConsumables;
    this.consumableRequests = [];
    this.consumableUsage = [];
    this.medicationRequests = [];
    this.receiptSettings = { ...initialReceiptSettings };
    this.customRoles = [];
    this.notify();
  }
}

export const db = new FatClinicDatabase();
