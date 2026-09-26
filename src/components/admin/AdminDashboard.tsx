import React, { useState } from 'react';
import { db } from '../../services/db';
import { useSyncDb } from '../../hooks/useSyncDb';
import { useAuth, useCurrentUser } from '../../context/AuthContext';
import { 
  User, 
  UserRole, 
  SystemSettings, 
  ClinicalConsumable, 
  LabInvestigationDefinition, 
  Medication, 
  ServicePriceItem,
  LabCategory,
  CustomRole
} from '../../types';
import {
  KeyRound,
  CheckCircle2,
  Save,
  Edit2,
  Plus,
  Trash2,
  UserPlus,
  Boxes,
  Radio,
  Activity,
  Search,
  AlertTriangle,
  X
} from 'lucide-react';
import { PermissionTreeEditor } from './PermissionTreeEditor';
import { countGranted } from '../../services/permissions';

export type AdminTab = 'users' | 'consumables' | 'lab' | 'pharmacy' | 'radiology_physio' | 'pricing' | 'receipts' | 'settings';

interface AdminDashboardProps {
  initialTab?: AdminTab;
}

const AVAILABLE_ROLES: UserRole[] = [
  'ADMINISTRATOR',
  'PHYSICIAN',
  'NURSE',
  'LAB_SCIENTIST',
  'PHARMACIST',
  'RADIOLOGIST',
  'PHYSIOTHERAPIST',
  'FRONT_DESK',
  'BILLING_OFFICER'
];

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ initialTab = 'users' }) => {
  const { allUsers } = useAuth();
  const currentUser = useCurrentUser();
  useSyncDb();

  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);

  // Sync with initialTab prop when it changes
  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // System Settings State
  const [settingsForm, setSettingsForm] = useState<SystemSettings>(() => db.getSettings());
  const [receiptForm, setReceiptForm] = useState(() => db.getReceiptSettings());
  const [savedAlert, setSavedAlert] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setSavedAlert(msg);
    setTimeout(() => setSavedAlert(null), 3000);
  };

  // Data Sources
  const consumables = db.getClinicalConsumables();
  const labDefs = db.getLabInvestigations();
  const medications = db.getMedications();
  const services = db.getServicePrices();
  const consumableRequests = db.getConsumableRequests();
  const consumableUsageLogs = db.getConsumableUsageLogs();
  const lowStockConsumables = consumables.filter(c => c.currentStock <= c.minAlertLevel);
  const pendingConsumableRequests = consumableRequests.filter(r => r.status === 'Pending');

  // Search & Filter States
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');

  const [consumableSearch, setConsumableSearch] = useState('');
  const [consumableCategoryFilter, setConsumableCategoryFilter] = useState<string>('ALL');

  const [labSearch, setLabSearch] = useState('');
  const [labCategoryFilter, setLabCategoryFilter] = useState<string>('ALL');

  const [pharmacySearch, setPharmacySearch] = useState('');

  // Quick Inline Price Editing
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editPriceVal, setEditPriceVal] = useState<number>(0);
  const [editType, setEditType] = useState<'service' | 'lab' | 'drug' | 'consumable'>('service');

  // Modal States: User
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    role: 'PHYSICIAN' as UserRole,
    department: 'General Medicine',
    avatar: '👨‍⚕️',
    pin: '1234',
    customRoleId: '',
    active: true
  });

  // Modal States: Consumable
  const [isAddConsumableOpen, setIsAddConsumableOpen] = useState(false);
  const [editingConsumable, setEditingConsumable] = useState<ClinicalConsumable | null>(null);
  const [consumableForm, setConsumableForm] = useState({
    name: '',
    category: 'Nursing' as ClinicalConsumable['category'],
    unit: 'Pieces',
    currentStock: 50,
    minAlertLevel: 10,
    unitPrice: 500,
    costPrice: 350
  });

  // Modal States: Lab Investigation
  const [isAddLabOpen, setIsAddLabOpen] = useState(false);
  const [editingLab, setEditingLab] = useState<LabInvestigationDefinition | null>(null);
  const [labForm, setLabForm] = useState({
    code: 'LB-01',
    name: '',
    category: 'HEMATOLOGY' as LabCategory,
    price: 3500,
    sampleType: 'Whole Blood (EDTA)',
    turnaroundTime: '2-4 hours',
    normalRange: 'Within clinical reference',
    instructions: 'Standard aseptic sample collection.'
  });

  // Modal States: Medication
  const [isAddMedOpen, setIsAddMedOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [medForm, setMedForm] = useState({
    name: '',
    genericName: '',
    category: 'Analgesics / Antipyretics',
    dosageForm: 'Tablet',
    strength: '500 mg',
    unitPrice: 100,
    currentStock: 200,
    minStockAlert: 30,
    dispensingUnit: 'Tablet'
  });

  // Modal States: Assign staff password (Administration sets a new password)
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);

  // Modal States: Custom Role
  const [showCustomRoleModal, setShowCustomRoleModal] = useState(false);
  const [editingCustomRole, setEditingCustomRole] = useState<CustomRole | null>(null);
  const [customRoleForm, setCustomRoleForm] = useState<{ name: string; description: string; permissions: string[] }>({ name: '', description: '', permissions: [] });

  const handleSaveCustomRole = () => {
    if (!customRoleForm.name.trim()) return;
    if (editingCustomRole) {
      db.updateCustomRole(editingCustomRole.id, customRoleForm.name, customRoleForm.description, customRoleForm.permissions, currentUser);
    } else {
      db.addCustomRole(customRoleForm.name, customRoleForm.description, customRoleForm.permissions, currentUser);
    }
    setShowCustomRoleModal(false);
    setEditingCustomRole(null);
    setCustomRoleForm({ name: '', description: '', permissions: [] });
  };

  // --- Handlers: Settings ---
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    db.updateSettings(settingsForm, currentUser);
    showNotification('System Settings updated successfully!');
  };

  const handleSaveReceipts = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    db.updateReceiptSettings(receiptForm, currentUser);
    showNotification('Receipt details updated — all new prints use them!');
  };

  // --- Handlers: Users ---
  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!userForm.name || !userForm.email) {
      alert('Please provide name and email');
      return;
    }
    const created = db.addUser({
      name: userForm.name,
      email: userForm.email,
      role: userForm.role,
      department: userForm.department,
      avatar: userForm.avatar,
      pin: userForm.pin || '1234',
      customRoleId: userForm.customRoleId || undefined,
      active: userForm.active
    }, currentUser);
    if (userForm.customRoleId) db.assignCustomRole(created.id, userForm.customRoleId, currentUser);
    setIsAddUserOpen(false);
    setUserForm({
      name: '',
      email: '',
      role: 'PHYSICIAN',
      department: 'General Medicine',
      avatar: '👨‍⚕️',
      pin: '1234',
      customRoleId: '',
      active: true
    });
    // The profile is saved and synced, but the account cannot sign in yet: the
    // password lives in Supabase Auth, and creating an auth user needs the
    // service_role key, which must never be in a browser. So the one remaining
    // step is a command on the machine that holds that key, and the exact
    // command is shown rather than described - an administrator should not have
    // to work out the flags.
    showNotification(
      `Staff profile created for ${created.name}. ` +
        `They cannot sign in until you run: node scripts/provision-staff.mjs --link ${created.id}`
    );
  };

  const handleUpdateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !editingUser) return;
    db.updateUser(editingUser, currentUser);
    setEditingUser(null);
    showNotification('Staff profile & role updated!');
  };

  const handleDeleteUser = (userId: string, userName: string) => {
    if (!currentUser) return;
    if (userId === currentUser.id) {
      alert('You cannot delete your own logged-in account!');
      return;
    }
    if (window.confirm(`Delete staff account for "${userName}"?`)) {
      db.deleteUser(userId, currentUser);
      showNotification(`Deleted staff account for ${userName}`);
    }
  };

  // --- Handlers: Consumables ---
  const handleCreateConsumable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!consumableForm.name) {
      alert('Please provide item name');
      return;
    }
    db.addClinicalConsumable({
      name: consumableForm.name,
      category: consumableForm.category,
      unit: consumableForm.unit,
      currentStock: Number(consumableForm.currentStock),
      minAlertLevel: Number(consumableForm.minAlertLevel),
      unitPrice: Number(consumableForm.unitPrice),
      costPrice: Number(consumableForm.costPrice)
    }, currentUser);
    setIsAddConsumableOpen(false);
    setConsumableForm({
      name: '',
      category: 'Nursing',
      unit: 'Pieces',
      currentStock: 50,
      minAlertLevel: 10,
      unitPrice: 500,
      costPrice: 350
    });
    showNotification('Clinical consumable registered!');
  };

  const handleUpdateConsumable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !editingConsumable) return;
    db.updateClinicalConsumable(editingConsumable, currentUser);
    setEditingConsumable(null);
    showNotification('Consumable details updated!');
  };

  const handleDeleteConsumable = (id: string, name: string) => {
    if (!currentUser) return;
    if (window.confirm(`Delete consumable item "${name}"?`)) {
      db.deleteClinicalConsumable(id, currentUser);
      showNotification(`Removed consumable ${name}`);
    }
  };

  // --- Handlers: Lab Investigations ---
  const handleCreateLab = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!labForm.name) return;
    db.addLabInvestigation({
      code: labForm.code || `LB-${Math.floor(100 + Math.random() * 900)}`,
      name: labForm.name,
      category: labForm.category,
      price: Number(labForm.price),
      sampleType: labForm.sampleType,
      turnaroundTime: labForm.turnaroundTime,
      parameters: [],
      description: labForm.instructions
    }, currentUser);
    setIsAddLabOpen(false);
    setLabForm({
      code: 'LB-01',
      name: '',
      category: 'HEMATOLOGY',
      price: 3500,
      sampleType: 'Whole Blood (EDTA)',
      turnaroundTime: '2-4 hours',
      normalRange: 'Within clinical reference',
      instructions: 'Standard aseptic sample collection.'
    });
    showNotification('Laboratory investigation test added!');
  };

  const handleUpdateLab = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !editingLab) return;
    db.updateLabInvestigation(editingLab, currentUser);
    setEditingLab(null);
    showNotification('Investigation tariff and details saved!');
  };

  const handleDeleteLab = (id: string, name: string) => {
    if (!currentUser) return;
    if (window.confirm(`Delete lab investigation "${name}"?`)) {
      db.deleteLabInvestigation(id, currentUser);
      showNotification(`Deleted test ${name}`);
    }
  };

  // --- Handlers: Pharmacy Medications ---
  const handleCreateMed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!medForm.name) return;
    db.addMedication({
      name: medForm.name,
      genericName: medForm.genericName || medForm.name,
      category: medForm.category,
      dosageForm: medForm.dosageForm,
      strength: medForm.strength,
      unitPrice: Number(medForm.unitPrice),
      currentStock: Number(medForm.currentStock),
      minStockAlert: Number(medForm.minStockAlert),
      dispensingUnit: medForm.dispensingUnit
    }, currentUser);
    setIsAddMedOpen(false);
    setMedForm({
      name: '',
      genericName: '',
      category: 'Analgesics / Antipyretics',
      dosageForm: 'Tablet',
      strength: '500 mg',
      unitPrice: 100,
      currentStock: 200,
      minStockAlert: 30,
      dispensingUnit: 'Tablet'
    });
    showNotification('Drug added to Pharmacy formulary!');
  };

  const handleUpdateMed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !editingMed) return;
    db.updateMedication(editingMed, currentUser);
    setEditingMed(null);
    showNotification('Medication updated!');
  };

  const handleDeleteMed = (id: string, name: string) => {
    if (!currentUser) return;
    if (window.confirm(`Delete medication "${name}" from pharmacy?`)) {
      db.deleteMedication(id, currentUser);
      showNotification(`Removed drug ${name}`);
    }
  };

  // Quick price editor
  const handleStartEditPrice = (id: string, currentPrice: number, type: 'service' | 'lab' | 'drug' | 'consumable') => {
    setEditingItemId(id);
    setEditPriceVal(currentPrice);
    setEditType(type);
  };

  const handleConfirmPriceUpdate = () => {
    if (!editingItemId || !currentUser) return;
    if (editType === 'service') {
      db.updateServicePrice(editingItemId, editPriceVal, currentUser);
    } else if (editType === 'lab') {
      db.updateLabPrice(editingItemId, editPriceVal, currentUser);
    } else if (editType === 'drug') {
      db.updateMedicationPrice(editingItemId, editPriceVal, currentUser);
    } else if (editType === 'consumable') {
      const c = consumables.find(item => item.id === editingItemId);
      if (c) {
        db.updateClinicalConsumable({ ...c, unitPrice: editPriceVal }, currentUser);
      }
    }
    setEditingItemId(null);
    showNotification('Price updated successfully!');
  };

  // Filtered lists
  const filteredUsers = allUsers.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.department.toLowerCase().includes(userSearch.toLowerCase());
    const matchesRole = userRoleFilter === 'ALL' || u.role === userRoleFilter;
    return matchesSearch && matchesRole;
  });

  const filteredConsumables = consumables.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(consumableSearch.toLowerCase()) ||
      c.id.toLowerCase().includes(consumableSearch.toLowerCase());
    const matchesCat = consumableCategoryFilter === 'ALL' || c.category === consumableCategoryFilter;
    return matchesSearch && matchesCat;
  });

  const filteredLab = labDefs.filter(l => {
    const matchesSearch = l.name.toLowerCase().includes(labSearch.toLowerCase()) ||
      l.sampleType.toLowerCase().includes(labSearch.toLowerCase());
    const matchesCat = labCategoryFilter === 'ALL' || l.category === labCategoryFilter;
    return matchesSearch && matchesCat;
  });

  const filteredMeds = medications.filter(m => {
    return m.name.toLowerCase().includes(pharmacySearch.toLowerCase()) ||
      m.genericName.toLowerCase().includes(pharmacySearch.toLowerCase()) ||
      m.category.toLowerCase().includes(pharmacySearch.toLowerCase());
  });

  const radiologyServices = services.filter(s => s.id.startsWith('SVC-RAD') || s.name.toLowerCase().includes('x-ray') || s.name.toLowerCase().includes('ultrasound') || s.name.toLowerCase().includes('ct scan') || s.name.toLowerCase().includes('mri'));
  const physioServices = services.filter(s => s.id.startsWith('SVC-PT') || s.name.toLowerCase().includes('physio') || s.name.toLowerCase().includes('rehabilitation'));
  const generalServices = services.filter(s => !s.id.startsWith('SVC-RAD') && !s.id.startsWith('SVC-PT'));

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto px-4 md:px-6 pb-4 md:pb-6 space-y-5 bg-light-bg dark:bg-dark-bg">
      {/* Notification Bar */}
      {savedAlert && (
        <div className="mt-4 md:mt-6 flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold animate-in fade-in flex-shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{savedAlert}</span>
        </div>
      )}

      {/* TAB 1: USERS & ROLES */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-dark-card p-4 rounded-2xl border border-light-border dark:border-dark-border shadow-sm">
            <div className="flex items-center space-x-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff by name, email, department..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="w-full text-xs bg-transparent focus:outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400"
              />
            </div>

            <div className="flex items-center space-x-2">
              <select
                value={userRoleFilter}
                onChange={e => setUserRoleFilter(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-xl border border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface font-semibold text-slate-700 dark:text-slate-200"
              >
                <option value="ALL">All Roles</option>
                {AVAILABLE_ROLES.map(r => (
                  <option key={r} value={r}>{r.replace('_', ' ')}</option>
                ))}
              </select>

              <button
                onClick={() => setIsAddUserOpen(true)}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Staff Account</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredUsers.map(user => (
              <div
                key={user.id}
                className="p-4 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex flex-col justify-between hover:border-blue-400 transition-all space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-3xl">{user.avatar}</span>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                        {user.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                    user.active 
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                  }`}>
                    {user.active ? 'Active' : 'Disabled'}
                  </span>
                </div>

                <div className="pt-2 border-t border-light-border dark:border-dark-border text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col space-y-0.5">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                        {user.role.replace('_', ' ')}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Dept: {user.department}
                      </span>
                      {user.mustChangePassword && (
                        <span className="text-[10px] font-bold text-amber-600">Must change password on next sign-in</span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-600 dark:text-slate-300"
                        title="Edit Staff Details"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setPasswordTarget(user)}
                        className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-600"
                        title="Assign a new login password to this staff member"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id, user.name)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600"
                        title="Delete User"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Access-control role</label>
                    <select
                      value={user.customRoleId || ''}
                      onChange={e => {
                        db.assignCustomRole(user.id, e.target.value || null, currentUser);
                        showNotification(e.target.value ? `Assigned "${db.getCustomRoleById(e.target.value)?.name}" to ${user.name}` : `Removed custom role from ${user.name}`);
                      }}
                      className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface font-semibold"
                    >
                      <option value="">Base {user.role.replace('_', ' ')} permissions</option>
                      {db.getCustomRoles().map(r => (
                        <option key={r.id} value={r.id}>{r.name} ({r.permissions.length} grants)</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Custom Roles Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Custom Roles</h3>
              <button onClick={() => { setEditingCustomRole(null); setShowCustomRoleModal(true); setCustomRoleForm({ name: '', description: '', permissions: [] }); }} className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
                <Plus className="w-3.5 h-3.5" /><span>Create Role</span>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {db.getCustomRoles().map(role => (
                <div key={role.id} className="p-4 rounded-2xl bg-white dark:bg-dark-card border shadow-sm flex flex-col justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white">{role.name}</h4>
                    <p className="text-[11px] text-slate-500 mt-1">{role.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">{countGranted(role.permissions)} permissions granted</span>
                      {role.permissions.slice(0, 4).map(p => (
                        <span key={p} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-50 text-slate-500 border border-slate-200">{p}</span>
                      ))}
                      {role.permissions.length > 4 && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500">+{role.permissions.length - 4} more</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-1 mt-3 pt-2 border-t">
                    <button onClick={() => { setEditingCustomRole(role); setCustomRoleForm({ name: role.name, description: role.description, permissions: role.permissions }); setShowCustomRoleModal(true); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => { if (confirm('Delete this role?')) db.deleteCustomRole(role.id, currentUser); }} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
              {db.getCustomRoles().length === 0 && <div className="col-span-3 text-center text-xs text-slate-400 py-6">No custom roles yet. Create one to define custom permissions.</div>}
            </div>
          </div>
        </div>
      )}
      {activeTab === 'consumables' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-dark-card p-4 rounded-2xl border border-light-border dark:border-dark-border shadow-sm">
            <div className="flex items-center space-x-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search consumables (Gloves, Syringes, Cannula, Catheters, Bandages)..."
                value={consumableSearch}
                onChange={e => setConsumableSearch(e.target.value)}
                className="w-full text-xs bg-transparent focus:outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400"
              />
            </div>

            <div className="flex items-center space-x-2">
              <select
                value={consumableCategoryFilter}
                onChange={e => setConsumableCategoryFilter(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-xl border border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface font-semibold text-slate-700 dark:text-slate-200"
              >
                <option value="ALL">All Categories</option>
                <option value="Nursing">Nursing</option>
                <option value="Consultation">Consultation</option>
                <option value="Surgical">Surgical</option>
                <option value="Emergency">Emergency</option>
                <option value="Laboratory">Laboratory</option>
                <option value="Pharmacy">Pharmacy</option>
                <option value="Radiology">Radiology</option>
                <option value="Physiotherapy">Physiotherapy</option>
                <option value="General">General</option>
              </select>

              <button
                onClick={() => setIsAddConsumableOpen(true)}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Consumable</span>
              </button>
            </div>
          </div>

          {/* Depleting-stock alert: administration sees every section's low stock */}
          {lowStockConsumables.length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 flex items-start space-x-3 animate-in fade-in">
              <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-xs font-extrabold text-rose-800 dark:text-rose-200">
                  Depleting Stock Alert — {lowStockConsumables.length} item(s) at or below minimum
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {lowStockConsumables.map(c => (
                    <span key={c.id} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white dark:bg-dark-card border border-rose-300 text-rose-700 dark:text-rose-300">
                      {c.name} [{c.category}] — {c.currentStock}/{c.minAlertLevel} {c.unit}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Section restock requests + usage log (harmonized, admin-managed) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/60 flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Section Restock Requests ({consumableRequests.length})</span>
                {pendingConsumableRequests.length > 0 && (
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{pendingConsumableRequests.length} Pending</span>
                )}
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-light-border/60 dark:divide-dark-border/60">
                {consumableRequests.length === 0 && (
                  <div className="p-4 text-center text-[11px] text-slate-400">No section requests yet. Pharmacy, Laboratory, Nursing, Radiology & Physiotherapy requests appear here.</div>
                )}
                {consumableRequests.map(r => (
                  <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">{r.consumableName}</div>
                      <div className="text-[10px] text-slate-500">{r.section} • {r.quantityRequested} requested • {r.requestedBy} • {new Date(r.requestedAt).toLocaleDateString()} • {r.urgency}</div>
                    </div>
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.status === 'Pending' ? 'bg-amber-100 text-amber-800' : r.status === 'Approved' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>{r.status}</span>
                      {r.status === 'Pending' && (
                        <button onClick={() => { db.updateConsumableRequestStatus(r.id, 'Approved', currentUser); showNotification(`Approved request for ${r.consumableName}`); }} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-600 text-white">Approve</button>
                      )}
                      {r.status !== 'Dispatched' && (
                        <button onClick={() => { db.updateConsumableRequestStatus(r.id, 'Dispatched', currentUser); showNotification(`Dispatched ${r.quantityRequested} x ${r.consumableName} — stock updated`); }} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-600 text-white">Dispatch</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface/60">
                <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Section Usage Log — billed to patients ({consumableUsageLogs.length})</span>
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-light-border/60 dark:divide-dark-border/60">
                {consumableUsageLogs.length === 0 && (
                  <div className="p-4 text-center text-[11px] text-slate-400">No usage logged yet. When a section logs usage (optionally for a patient visit), stock is subtracted and the charge posts to that visit invoice.</div>
                )}
                {consumableUsageLogs.slice(0, 30).map(l => (
                  <div key={l.id} className="px-4 py-2 text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">{l.quantityUsed} x {l.consumableName} <span className="font-normal text-slate-500">[{l.section}]</span></div>
                    <div className="text-[10px] text-slate-500">{l.usedBy} • {new Date(l.usedAt).toLocaleString()} • {settingsForm.currency}{l.totalCharge.toLocaleString()}{l.invoiceId ? ` • Invoice ${l.invoiceId}` : ' • ward/internal use'}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-dark-surface border-b border-light-border dark:border-dark-border text-slate-500 font-extrabold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Item Description</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3 text-right">Stock Count</th>
                  <th className="px-4 py-3 text-right">Patient Charge (₦)</th>
                  <th className="px-4 py-3 text-right">Cost (₦)</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border dark:divide-dark-border">
                {filteredConsumables.map(c => {
                  const isLow = c.currentStock <= c.minAlertLevel;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-dark-surface/40 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-500 text-[11px]">{c.id}</td>
                      <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">{c.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                          {c.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.unit}</td>
                      <td className="px-4 py-3 text-right font-bold">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          isLow 
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 animate-pulse'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}>
                          {c.currentStock}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-extrabold text-emerald-700 dark:text-emerald-400">
                        {settingsForm.currency}{c.unitPrice.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {settingsForm.currency}{c.costPrice.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            onClick={() => setEditingConsumable(c)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500 hover:text-slate-800"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteConsumable(c.id, c.name)}
                            className="p-1 rounded hover:bg-rose-50 text-rose-600"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: LABORATORY INVESTIGATIONS */}
      {activeTab === 'lab' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-dark-card p-4 rounded-2xl border border-light-border dark:border-dark-border shadow-sm">
            <div className="flex items-center space-x-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search laboratory investigation tests..."
                value={labSearch}
                onChange={e => setLabSearch(e.target.value)}
                className="w-full text-xs bg-transparent focus:outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400"
              />
            </div>

            <div className="flex items-center space-x-2">
              <select
                value={labCategoryFilter}
                onChange={e => setLabCategoryFilter(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-xl border border-light-border dark:border-dark-border bg-slate-50 dark:bg-dark-surface font-semibold text-slate-700 dark:text-slate-200"
              >
                <option value="ALL">All Departments</option>
                <option value="HEMATOLOGY">Hematology</option>
                <option value="CHEMICAL_PATHOLOGY">Chem Pathology</option>
                <option value="MICROBIOLOGY">Microbiology</option>
                <option value="HISTOPATHOLOGY">Histopathology</option>
                <option value="MOLECULAR">Molecular Biology</option>
              </select>

              <button
                onClick={() => setIsAddLabOpen(true)}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Lab Test</span>
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-dark-surface border-b border-light-border dark:border-dark-border text-slate-500 font-extrabold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">Test Code</th>
                  <th className="px-4 py-3">Investigation Name</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Sample Type</th>
                  <th className="px-4 py-3">Turnaround (Hrs)</th>
                  <th className="px-4 py-3 text-right">Fee ({settingsForm.currency})</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border dark:divide-dark-border">
                {filteredLab.map(l => (
                  <tr key={l.id} className="hover:bg-slate-50/50 dark:hover:bg-dark-surface/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-slate-500 text-[11px]">{l.id}</td>
                    <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">{l.name}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                        {l.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.sampleType}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-semibold">{l.turnaroundTime}</td>
                    <td className="px-4 py-3 text-right font-extrabold text-rose-700 dark:text-rose-400">
                      {settingsForm.currency}{l.price.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <button
                          onClick={() => setEditingLab(l)}
                          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500 hover:text-slate-800"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteLab(l.id, l.name)}
                          className="p-1 rounded hover:bg-rose-50 text-rose-600"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: PHARMACY FORMULARY & STOCKS */}
      {activeTab === 'pharmacy' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-dark-card p-4 rounded-2xl border border-light-border dark:border-dark-border shadow-sm">
            <div className="flex items-center space-x-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search drug by brand name, generic name, category..."
                value={pharmacySearch}
                onChange={e => setPharmacySearch(e.target.value)}
                className="w-full text-xs bg-transparent focus:outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400"
              />
            </div>

            <button
              onClick={() => setIsAddMedOpen(true)}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Medication</span>
            </button>
          </div>

          <div className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-dark-surface border-b border-light-border dark:border-dark-border text-slate-500 font-extrabold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Brand & Generic</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Strength & Form</th>
                  <th className="px-4 py-3 text-right">In Stock</th>
                  <th className="px-4 py-3 text-right">Unit Price ({settingsForm.currency})</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border dark:divide-dark-border">
                {filteredMeds.map(m => {
                  const isLow = m.currentStock <= m.minStockAlert;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/50 dark:hover:bg-dark-surface/40 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-500 text-[11px]">{m.id}</td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800 dark:text-slate-100">{m.name}</div>
                        <div className="text-[10px] text-slate-400 italic">{m.genericName}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.category}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-semibold">{m.strength} • {m.dosageForm}</td>
                      <td className="px-4 py-3 text-right font-bold">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          isLow 
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}>
                          {m.currentStock} {m.dispensingUnit}s
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-extrabold text-purple-700 dark:text-purple-400">
                        {settingsForm.currency}{m.unitPrice.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            onClick={() => setEditingMed(m)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-dark-surface text-slate-500 hover:text-slate-800"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteMed(m.id, m.name)}
                            className="p-1 rounded hover:bg-rose-50 text-rose-600"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: RADIOLOGY & PHYSIOTHERAPY TARIFFS & CONSUMABLES */}
      {activeTab === 'radiology_physio' && (
        <div className="space-y-6">
          {/* Radiology Scans */}
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2.5">
              <div className="flex items-center space-x-2">
                <Radio className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                  Radiology & Medical Imaging Scans Tariffs
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-semibold">{radiologyServices.length} Imaging Services</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {radiologyServices.map(s => (
                <div key={s.id} className="p-3.5 rounded-xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                    <span className="text-[10px] text-slate-400 font-mono">{s.id}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-indigo-700 dark:text-indigo-400">
                      {settingsForm.currency}{s.price.toLocaleString()}
                    </span>
                    <button
                      onClick={() => handleStartEditPrice(s.id, s.price, 'service')}
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Physiotherapy Services */}
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2.5">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-teal-600" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                  Physiotherapy & Rehabilitation Session Tariffs
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-semibold">{physioServices.length} Rehab Services</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {physioServices.map(s => (
                <div key={s.id} className="p-3.5 rounded-xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                    <span className="text-[10px] text-slate-400 font-mono">{s.id}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-teal-700 dark:text-teal-400">
                      {settingsForm.currency}{s.price.toLocaleString()}
                    </span>
                    <button
                      onClick={() => handleStartEditPrice(s.id, s.price, 'service')}
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Imaging & Rehab Consumables Quick View */}
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2.5">
              <div className="flex items-center space-x-2">
                <Boxes className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                  Imaging & Rehab Specialized Consumables
                </h3>
              </div>
              <button
                onClick={() => setActiveTab('consumables')}
                className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline"
              >
                View in Consumables Table →
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {consumables.filter(c => c.category === 'Radiology' || c.category === 'Physiotherapy').map(c => (
                <div key={c.id} className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{c.name}</div>
                    <span className="text-[10px] text-slate-500">Stock: <strong>{c.currentStock} {c.unit}</strong> • Cat: {c.category}</span>
                  </div>
                  <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                    {settingsForm.currency}{c.unitPrice.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: MASTER PRICING MATRIX */}
      {activeTab === 'pricing' && (
        <div className="space-y-6">
          {/* Quick Price Editor Bar if active */}
          {editingItemId && (
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 flex items-center justify-between animate-in fade-in">
              <div className="flex items-center space-x-3 text-xs">
                <span className="font-bold text-emerald-900 dark:text-emerald-200">
                  Update Item Price ({editingItemId}):
                </span>
                <div className="flex items-center space-x-1">
                  <span className="font-bold text-slate-600 dark:text-slate-300">{settingsForm.currency}</span>
                  <input
                    type="number"
                    value={editPriceVal}
                    onChange={e => setEditPriceVal(Number(e.target.value))}
                    className="w-28 px-2 py-1 rounded-lg border font-bold text-xs bg-white dark:bg-dark-card"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleConfirmPriceUpdate}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm"
                >
                  Save Price
                </button>
                <button
                  onClick={() => setEditingItemId(null)}
                  className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-dark-surface text-slate-700 dark:text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Clinical & General Consultations */}
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white border-b border-light-border dark:border-dark-border pb-2">
              1. Clinical Consultations & General Procedures ({generalServices.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {generalServices.map(s => (
                <div key={s.id} className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-100">{s.name}</div>
                    <span className="text-[10px] text-slate-400">Category: {s.category}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                      {settingsForm.currency}{s.price.toLocaleString()}
                    </span>
                    <button
                      onClick={() => handleStartEditPrice(s.id, s.price, 'service')}
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Laboratory Tests */}
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white border-b border-light-border dark:border-dark-border pb-2">
              2. Laboratory Diagnostic Investigations ({labDefs.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {labDefs.map(l => (
                <div key={l.id} className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-100">{l.name}</div>
                    <span className="text-[10px] text-slate-400">{l.category.replace('_', ' ')} • {l.sampleType}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-rose-700 dark:text-rose-400">
                      {settingsForm.currency}{l.price.toLocaleString()}
                    </span>
                    <button
                      onClick={() => handleStartEditPrice(l.id, l.price, 'lab')}
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pharmacy Formulary */}
          <div className="p-5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white border-b border-light-border dark:border-dark-border pb-2">
              3. Pharmacy Medications Formulary ({medications.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {medications.map(m => (
                <div key={m.id} className="p-3 rounded-xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-100">{m.name}</div>
                    <span className="text-[10px] text-slate-400">{m.strength} • Unit: {m.dispensingUnit}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-purple-700 dark:text-purple-400">
                      {settingsForm.currency}{m.unitPrice.toLocaleString()}
                    </span>
                    <button
                      onClick={() => handleStartEditPrice(m.id, m.unitPrice, 'drug')}
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: HOSPITAL PARAMETERS & SETTINGS */}
      {activeTab === 'receipts' && (
        <form onSubmit={handleSaveReceipts} className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-5 text-xs">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                Company Receipt Details — prints on every receipt, invoice & statement
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Edit the header, footer, receipt numbering and which sections appear. Applies to A4 and thermal POS prints instantly.</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300">
              Prefix: {receiptForm.receiptPrefix || 'RCP'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Hospital / Company Name:</label>
              <input type="text" value={receiptForm.hospitalName} onChange={e => setReceiptForm({ ...receiptForm, hospitalName: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border font-bold" />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tagline / Motto:</label>
              <input type="text" value={receiptForm.tagline} onChange={e => setReceiptForm({ ...receiptForm, tagline: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border" />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Address:</label>
              <input type="text" value={receiptForm.address} onChange={e => setReceiptForm({ ...receiptForm, address: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phone:</label>
                <input type="text" value={receiptForm.phone} onChange={e => setReceiptForm({ ...receiptForm, phone: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border" />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Email:</label>
                <input type="email" value={receiptForm.email} onChange={e => setReceiptForm({ ...receiptForm, email: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border" />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Footer / Thank-You Message:</label>
              <textarea rows={2} value={receiptForm.footerMessage} onChange={e => setReceiptForm({ ...receiptForm, footerMessage: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border" />
            </div>
            <div className="md:col-span-2">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Terms Line:</label>
              <input type="text" value={receiptForm.termsLine} onChange={e => setReceiptForm({ ...receiptForm, termsLine: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border" />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Receipt Number Prefix:</label>
              <input type="text" value={receiptForm.receiptPrefix} onChange={e => setReceiptForm({ ...receiptForm, receiptPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'RCP' })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border font-mono font-bold" />
              <p className="text-[10px] text-slate-400 mt-1">New receipts number as e.g. {receiptForm.receiptPrefix || 'RCP'}-2026-1001</p>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-2">Sections shown on receipts:</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {([
                ['showReceiptCount', 'Receipt count (1 of N)'],
                ['showPaymentMethod', 'Means of payment'],
                ['showReceivedBy', 'Received-by officer'],
                ['showBankDetails', 'Bank name & reference'],
                ['showInvoicePosition', 'Invoice position (total/paid/balance)'],
                ['showThankYou', 'Thank-you footer block'],
              ] as Array<[keyof typeof receiptForm, string]>).map(([key, label]) => (
                <label key={key} className={`px-3 py-2.5 rounded-xl border flex items-center space-x-2 cursor-pointer transition-all ${receiptForm[key] ? 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-300 dark:border-cyan-800 font-bold text-cyan-800 dark:text-cyan-200' : 'bg-slate-50 dark:bg-dark-surface/40 border-light-border dark:border-dark-border text-slate-500'}`}>
                  <input type="checkbox" checked={!!receiptForm[key]} onChange={() => setReceiptForm({ ...receiptForm, [key]: !receiptForm[key] })} className="rounded text-cyan-600 focus:ring-cyan-500" />
                  <span className="text-[11px]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-light-border dark:border-dark-border">
            <button type="submit" className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white shadow-md transition-all">
              <Save className="w-4 h-4" />
              <span>Save Receipt Settings</span>
            </button>
          </div>
        </form>
      )}

      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-5 text-xs">
          <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-3">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                Global Facility Parameters & Device Rules
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Zero hard-coded values — customize clinic branding and security intervals</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Facility Name:</label>
              <input
                type="text"
                value={settingsForm.hospitalName}
                onChange={e => setSettingsForm({ ...settingsForm, hospitalName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tagline / Motto:</label>
              <input
                type="text"
                value={settingsForm.tagline}
                onChange={e => setSettingsForm({ ...settingsForm, tagline: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Billing Currency Symbol:</label>
              <select
                value={settingsForm.currency}
                onChange={e => setSettingsForm({ ...settingsForm, currency: e.target.value, currencyCode: e.target.value === '₦' ? 'NGN' : 'USD' })}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-bold"
              >
                <option value="₦">₦ (Nigerian Naira - NGN)</option>
                <option value="$">$ (US Dollar - USD)</option>
                <option value="£">£ (British Pound - GBP)</option>
                <option value="€">€ (Euro - EUR)</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Patient ID Prefix:</label>
              <input
                type="text"
                value={settingsForm.patientPrefix}
                onChange={e => setSettingsForm({ ...settingsForm, patientPrefix: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Inactivity Timeout (Minutes):</label>
              <input
                type="number"
                min={1}
                max={60}
                value={settingsForm.inactivityTimeoutMinutes}
                onChange={e => setSettingsForm({ ...settingsForm, inactivityTimeoutMinutes: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex justify-end items-center pt-4 border-t border-light-border dark:border-dark-border">
            <button
              type="submit"
              className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all"
            >
              <Save className="w-4 h-4" />
              <span>Save System Settings</span>
            </button>
          </div>
        </form>
      )}

      {/* --- MODALS --- */}

      {/* 1. Add User Modal */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <form onSubmit={handleCreateUser} className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Add New Staff Account</h3>
              <button type="button" onClick={() => setIsAddUserOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">Full Name & Title:</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Ngozi Adebayo"
                  value={userForm.name}
                  onChange={e => setUserForm({ ...userForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Email Address:</label>
                <input
                  type="email"
                  required
                  placeholder="ngozi@fatclinic.org"
                  value={userForm.email}
                  onChange={e => setUserForm({ ...userForm, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Role:</label>
                  <select
                    value={userForm.role}
                    onChange={e => setUserForm({ ...userForm, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  >
                    {AVAILABLE_ROLES.map(r => (
                      <option key={r} value={r}>{r.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Department:</label>
                  <input
                    type="text"
                    value={userForm.department}
                    onChange={e => setUserForm({ ...userForm, department: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-dark-surface border border-dashed border-slate-300 dark:border-dark-border text-[11px] text-slate-500 leading-relaxed">
                No sign-in password is set here. Passwords belong to Supabase Auth and cannot be
                written from a browser, so once this profile is saved you run{' '}
                <code className="font-mono text-slate-600 dark:text-slate-300">
                  node scripts/provision-staff.mjs --link &lt;id&gt;
                </code>{' '}
                to create the account they sign in with. The exact command, with the real id
                filled in, is shown when the profile is saved.
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">4-Digit Device PIN:</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={userForm.pin}
                    onChange={e => setUserForm({ ...userForm, pin: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-mono"
                  />
                </div>
                <div />
              </div>

              <div>
                <label className="block font-bold mb-1">Access-Control Role (granular):</label>
                <select
                  value={userForm.customRoleId}
                  onChange={e => setUserForm({ ...userForm, customRoleId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                >
                  <option value="">Base {userForm.role.replace('_', ' ')} permissions</option>
                  {db.getCustomRoles().map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Avatar Emoji:</label>
                  <select
                    value={userForm.avatar}
                    onChange={e => setUserForm({ ...userForm, avatar: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface text-lg"
                  >
                    <option value="👨‍⚕️">👨‍⚕️ Male Doctor</option>
                    <option value="👩‍⚕️">👩‍⚕️ Female Doctor</option>
                    <option value="🧑‍⚕️">🧑‍⚕️ Health Specialist</option>
                    <option value="👨‍🔬">👨‍🔬 Lab Scientist</option>
                    <option value="👩‍🔬">👩‍🔬 Lab Scientist (F)</option>
                    <option value="💊">💊 Pharmacist</option>
                    <option value="🏃‍♂️">🏃‍♂️ Physiotherapist</option>
                    <option value="🩻">🩻 Radiologist</option>
                    <option value="💼">💼 Front Desk</option>
                    <option value="🛡️">🛡️ Administrator</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsAddUserOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-dark-surface font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm"
              >
                Create Account
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 2. Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <form onSubmit={handleUpdateUser} className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Edit Staff Account: {editingUser.name}</h3>
              <button type="button" onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">Full Name:</label>
                <input
                  type="text"
                  required
                  value={editingUser.name}
                  onChange={e => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Email:</label>
                <input
                  type="email"
                  required
                  value={editingUser.email}
                  onChange={e => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Role:</label>
                  <select
                    value={editingUser.role}
                    onChange={e => setEditingUser({ ...editingUser, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  >
                    {AVAILABLE_ROLES.map(r => (
                      <option key={r} value={r}>{r.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Department:</label>
                  <input
                    type="text"
                    value={editingUser.department}
                    onChange={e => setEditingUser({ ...editingUser, department: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">4-Digit PIN:</label>
                  <input
                    type="text"
                    maxLength={4}
                    value={editingUser.pin}
                    onChange={e => setEditingUser({ ...editingUser, pin: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Account Status:</label>
                  <select
                    value={editingUser.active ? 'active' : 'disabled'}
                    onChange={e => setEditingUser({ ...editingUser, active: e.target.value === 'active' })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  >
                    <option value="active">Active (Enabled)</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-dark-surface font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 3. Add Consumable Modal */}
      {isAddConsumableOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <form onSubmit={handleCreateConsumable} className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Add Clinical Consumable</h3>
              <button type="button" onClick={() => setIsAddConsumableOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">Item Name:</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sterile Latex Surgical Gloves (Size 7.5)"
                  value={consumableForm.name}
                  onChange={e => setConsumableForm({ ...consumableForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Category:</label>
                  <select
                    value={consumableForm.category}
                    onChange={e => setConsumableForm({ ...consumableForm, category: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  >
                    <option value="Nursing">Nursing</option>
                    <option value="Consultation">Consultation</option>
                    <option value="Surgical">Surgical</option>
                    <option value="Emergency">Emergency</option>
                    <option value="Laboratory">Laboratory</option>
                    <option value="Pharmacy">Pharmacy</option>
                    <option value="Radiology">Radiology</option>
                    <option value="Physiotherapy">Physiotherapy</option>
                    <option value="General">General</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Unit of Measure:</label>
                  <input
                    type="text"
                    placeholder="Pieces, Boxes, Rolls, Packs"
                    value={consumableForm.unit}
                    onChange={e => setConsumableForm({ ...consumableForm, unit: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Initial Stock Count:</label>
                  <input
                    type="number"
                    min={0}
                    value={consumableForm.currentStock}
                    onChange={e => setConsumableForm({ ...consumableForm, currentStock: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Min Alert Level:</label>
                  <input
                    type="number"
                    min={0}
                    value={consumableForm.minAlertLevel}
                    onChange={e => setConsumableForm({ ...consumableForm, minAlertLevel: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Patient Price ({settingsForm.currency}):</label>
                  <input
                    type="number"
                    min={0}
                    value={consumableForm.unitPrice}
                    onChange={e => setConsumableForm({ ...consumableForm, unitPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-extrabold text-emerald-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Hospital Cost Price ({settingsForm.currency}):</label>
                  <input
                    type="number"
                    min={0}
                    value={consumableForm.costPrice}
                    onChange={e => setConsumableForm({ ...consumableForm, costPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsAddConsumableOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-dark-surface font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm"
              >
                Register Consumable
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. Edit Consumable Modal */}
      {editingConsumable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <form onSubmit={handleUpdateConsumable} className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Edit Consumable: {editingConsumable.name}</h3>
              <button type="button" onClick={() => setEditingConsumable(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">Item Name:</label>
                <input
                  type="text"
                  required
                  value={editingConsumable.name}
                  onChange={e => setEditingConsumable({ ...editingConsumable, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Unit:</label>
                  <input
                    type="text"
                    value={editingConsumable.unit}
                    onChange={e => setEditingConsumable({ ...editingConsumable, unit: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Current Stock:</label>
                  <input
                    type="number"
                    value={editingConsumable.currentStock}
                    onChange={e => setEditingConsumable({ ...editingConsumable, currentStock: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Patient Unit Price ({settingsForm.currency}):</label>
                  <input
                    type="number"
                    value={editingConsumable.unitPrice}
                    onChange={e => setEditingConsumable({ ...editingConsumable, unitPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-extrabold text-emerald-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Min Alert Level:</label>
                  <input
                    type="number"
                    value={editingConsumable.minAlertLevel}
                    onChange={e => setEditingConsumable({ ...editingConsumable, minAlertLevel: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setEditingConsumable(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-dark-surface font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm"
              >
                Save Consumable
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 5. Add Lab Modal */}
      {isAddLabOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <form onSubmit={handleCreateLab} className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Add Lab Investigation</h3>
              <button type="button" onClick={() => setIsAddLabOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">Test Name:</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Full Blood Count (FBC + Diff)"
                  value={labForm.name}
                  onChange={e => setLabForm({ ...labForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Department:</label>
                  <select
                    value={labForm.category}
                    onChange={e => setLabForm({ ...labForm, category: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  >
                    <option value="HEMATOLOGY">Hematology</option>
                    <option value="CHEMICAL_PATHOLOGY">Chem Pathology</option>
                    <option value="MICROBIOLOGY">Microbiology</option>
                    <option value="HISTOPATHOLOGY">Histopathology</option>
                    <option value="MOLECULAR">Molecular Biology</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Fee ({settingsForm.currency}):</label>
                  <input
                    type="number"
                    min={0}
                    value={labForm.price}
                    onChange={e => setLabForm({ ...labForm, price: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-extrabold text-rose-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Sample Type:</label>
                  <input
                    type="text"
                    value={labForm.sampleType}
                    onChange={e => setLabForm({ ...labForm, sampleType: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Turnaround Time:</label>
                  <input
                    type="text"
                    placeholder="e.g. 2-4 hours"
                    value={labForm.turnaroundTime}
                    onChange={e => setLabForm({ ...labForm, turnaroundTime: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsAddLabOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-dark-surface font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-sm"
              >
                Add Test
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 6. Edit Lab Modal */}
      {editingLab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <form onSubmit={handleUpdateLab} className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Edit Test: {editingLab.name}</h3>
              <button type="button" onClick={() => setEditingLab(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">Test Name:</label>
                <input
                  type="text"
                  required
                  value={editingLab.name}
                  onChange={e => setEditingLab({ ...editingLab, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Sample Type:</label>
                  <input
                    type="text"
                    value={editingLab.sampleType}
                    onChange={e => setEditingLab({ ...editingLab, sampleType: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Fee ({settingsForm.currency}):</label>
                  <input
                    type="number"
                    value={editingLab.price}
                    onChange={e => setEditingLab({ ...editingLab, price: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-extrabold text-rose-700"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setEditingLab(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-dark-surface font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-sm"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 7. Add Medication Modal */}
      {isAddMedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <form onSubmit={handleCreateMed} className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Add Medication to Formulary</h3>
              <button type="button" onClick={() => setIsAddMedOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">Brand Name:</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Augmentin"
                  value={medForm.name}
                  onChange={e => setMedForm({ ...medForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Generic Chemical Name:</label>
                <input
                  type="text"
                  placeholder="e.g. Amoxicillin / Clavulanate"
                  value={medForm.genericName}
                  onChange={e => setMedForm({ ...medForm, genericName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Category:</label>
                  <input
                    type="text"
                    value={medForm.category}
                    onChange={e => setMedForm({ ...medForm, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Strength:</label>
                  <input
                    type="text"
                    placeholder="e.g. 625 mg"
                    value={medForm.strength}
                    onChange={e => setMedForm({ ...medForm, strength: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold mb-1">Unit Price ({settingsForm.currency}):</label>
                  <input
                    type="number"
                    min={0}
                    value={medForm.unitPrice}
                    onChange={e => setMedForm({ ...medForm, unitPrice: Number(e.target.value) })}
                    className="w-full px-2 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold text-purple-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Stock Count:</label>
                  <input
                    type="number"
                    min={0}
                    value={medForm.currentStock}
                    onChange={e => setMedForm({ ...medForm, currentStock: Number(e.target.value) })}
                    className="w-full px-2 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Min Alert:</label>
                  <input
                    type="number"
                    min={0}
                    value={medForm.minStockAlert}
                    onChange={e => setMedForm({ ...medForm, minStockAlert: Number(e.target.value) })}
                    className="w-full px-2 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsAddMedOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-dark-surface font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-sm"
              >
                Add Drug
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 8. Edit Medication Modal */}
      {editingMed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <form onSubmit={handleUpdateMed} className="bg-white dark:bg-dark-card rounded-2xl border border-light-border dark:border-dark-border shadow-2xl p-6 w-full max-w-md space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Edit Drug: {editingMed.name}</h3>
              <button type="button" onClick={() => setEditingMed(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">Drug Name:</label>
                <input
                  type="text"
                  required
                  value={editingMed.name}
                  onChange={e => setEditingMed({ ...editingMed, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Unit Price ({settingsForm.currency}):</label>
                  <input
                    type="number"
                    value={editingMed.unitPrice}
                    onChange={e => setEditingMed({ ...editingMed, unitPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-extrabold text-purple-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Current Stock:</label>
                  <input
                    type="number"
                    value={editingMed.currentStock}
                    onChange={e => setEditingMed({ ...editingMed, currentStock: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-dark-surface font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setEditingMed(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-dark-surface font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-sm"
              >
                Save Medication
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reset Staff Password — instructs, does not collect */}
      {passwordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setPasswordTarget(null)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-lg border p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-sm">Set a sign-in password — {passwordTarget.name}</h3>
              <button type="button" onClick={() => setPasswordTarget(null)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>

            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Passwords are held by Supabase Auth, not by this application, and they cannot be
              set from a browser: doing so needs the <code className="font-mono">service_role</code>{' '}
              key, which would then be readable in the page by anyone who opened devtools.
              So this screen cannot do it, and showing a field here that quietly saved a
              local password is exactly the bug this replaced.
            </p>

            <div className="p-3 rounded-xl bg-slate-900 text-emerald-300 font-mono text-[11px] break-all select-text">
              node scripts/provision-staff.mjs --link {passwordTarget.id} --password &lt;new-password&gt;
            </div>

            <p className="text-slate-500 leading-relaxed">
              Run it on a machine whose <code className="font-mono">.env</code> holds{' '}
              <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>. The password is
              read from the command you typed, not stored on disk by this script. The staff
              member is then asked to change it themselves on first sign-in.
            </p>

            <div className="flex justify-end">
              <button type="button" onClick={() => setPasswordTarget(null)} className="px-4 py-2 rounded-xl border font-bold">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Role Modal — nested access-control tree */}
      {showCustomRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowCustomRoleModal(false)} />
          <div className="relative bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl border max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-extrabold text-sm">{editingCustomRole ? 'Edit Role' : 'Create Custom Role'}</h3>
                <p className="text-[11px] text-slate-500">Tick modules, departments and actions. Assign the role to staff from their account card.</p>
              </div>
              <button onClick={() => setShowCustomRoleModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Role Name</label>
                  <input value={customRoleForm.name} onChange={e => setCustomRoleForm({ ...customRoleForm, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-slate-50 text-sm font-bold" placeholder="e.g. Histopathology Scientist" />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Description</label>
                  <input value={customRoleForm.description} onChange={e => setCustomRoleForm({ ...customRoleForm, description: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-slate-50 text-xs" placeholder="Brief description of this role" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold mb-2">Granular Permissions</label>
                <PermissionTreeEditor
                  selected={customRoleForm.permissions}
                  onChange={perms => setCustomRoleForm({ ...customRoleForm, permissions: perms })}
                />
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 rounded-b-2xl flex justify-end space-x-2 flex-shrink-0">
              <button onClick={() => setShowCustomRoleModal(false)} className="px-4 py-2 rounded-xl text-xs font-bold border">Cancel</button>
              <button onClick={handleSaveCustomRole} className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white">{editingCustomRole ? 'Update Role' : 'Create Role'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};