import { CustomRole, User, UserRole } from '../types';

export interface PermissionNode {
  key: string;
  label: string;
  hint?: string;
  children?: PermissionNode[];
}

/**
 * Hierarchical access-control tree.
 * Checking a parent grants everything below it; unchecking a single leaf
 * (e.g. LABORATORY.HISTOPATHOLOGY.ENTER_RESULT) keeps every sibling granted.
 */
const labActions = (prefix: string): PermissionNode[] => [
  { key: `${prefix}.VIEW`, label: 'View orders & results' },
  { key: `${prefix}.PROCESS`, label: 'Collect sample / start processing', hint: 'Advance Requested → Sample Collected → Processing' },
  { key: `${prefix}.ENTER_RESULT`, label: 'Enter result', hint: 'Fill result values & save draft' },
  { key: `${prefix}.VERIFY_RELEASE`, label: 'Verify & release report' },
  { key: `${prefix}.LOG_USAGE`, label: 'Log stock usage', hint: 'Subtract reagents / consumables' },
  { key: `${prefix}.REQUEST_STOCK`, label: 'Request restock' },
];

const deptConsumables = (prefix: string): PermissionNode => ({
  key: `${prefix}.CONSUMABLES`,
  label: 'Department consumables',
  children: [
    { key: `${prefix}.CONSUMABLES.VIEW`, label: 'View' },
    { key: `${prefix}.CONSUMABLES.LOG_USAGE`, label: 'Log usage (bills patient)' },
    { key: `${prefix}.CONSUMABLES.REQUEST_STOCK`, label: 'Request restock' },
  ],
});

export const PERMISSION_TREE: PermissionNode[] = [
  {
    key: 'DASHBOARD', label: 'Executive Dashboard',
    children: [{ key: 'DASHBOARD.VIEW', label: 'View' }],
  },
  {
    key: 'PATIENTS', label: 'Patients & Front Desk',
    children: [
      { key: 'PATIENTS.VIEW', label: 'View patient directory' },
      { key: 'PATIENTS.REGISTER', label: 'Register patient' },
      { key: 'PATIENTS.EDIT', label: 'Edit patient records' },
      { key: 'PATIENTS.CREATE_VISIT', label: 'Create visit / encounter tabs', hint: 'Front Desk is denied this by default' },
      { key: 'PATIENTS.BOOKINGS', label: 'Manage online bookings' },
    ],
  },
  {
    key: 'CLINICAL', label: 'Clinical Care & Triage',
    children: [
      {
        key: 'CLINICAL.PHYSICIAN', label: 'Physician Consultation',
        children: [
          { key: 'CLINICAL.PHYSICIAN.VIEW', label: 'View queue & dashboard' },
          { key: 'CLINICAL.PHYSICIAN.CONSULT', label: 'Consult & save notes' },
          { key: 'CLINICAL.PHYSICIAN.ORDER_LAB', label: 'Order lab tests' },
          { key: 'CLINICAL.PHYSICIAN.ORDER_PHARMACY', label: 'Prescribe medication' },
          { key: 'CLINICAL.PHYSICIAN.ORDER_RADIOLOGY', label: 'Order radiology' },
          { key: 'CLINICAL.PHYSICIAN.ORDER_PHYSIO', label: 'Order physiotherapy' },
          { key: 'CLINICAL.PHYSICIAN.ADMIT', label: 'Admit (specify ward)' },
          { key: 'CLINICAL.PHYSICIAN.DISCHARGE', label: 'Discharge' },
        ],
      },
      {
        key: 'CLINICAL.NURSING', label: 'Nursing Station & Triage',
        children: [
          { key: 'CLINICAL.NURSING.VIEW', label: 'View queue & dashboard' },
          { key: 'CLINICAL.NURSING.RECORD_VITALS', label: 'Record vitals' },
          { key: 'CLINICAL.NURSING.CARE_PLAN', label: 'Assessment & care plan' },
          { key: 'CLINICAL.NURSING.ADMIT', label: 'Admit (specify ward)' },
          { key: 'CLINICAL.NURSING.DISCHARGE', label: 'Discharge' },
          { key: 'CLINICAL.NURSING.USE_CONSUMABLES', label: 'Use nursing consumables' },
        ],
      },
      {
        key: 'CLINICAL.ALERTS', label: 'Diagnostic Alerts',
        children: [{ key: 'CLINICAL.ALERTS.VIEW', label: 'View' }],
      },
    ],
  },
  {
    key: 'LABORATORY', label: 'Laboratory',
    children: [
      { key: 'LABORATORY.HEMATOLOGY', label: 'Hematology', children: labActions('LABORATORY.HEMATOLOGY') },
      { key: 'LABORATORY.MICROBIOLOGY', label: 'Microbiology', children: labActions('LABORATORY.MICROBIOLOGY') },
      { key: 'LABORATORY.CHEMICAL_PATHOLOGY', label: 'Chemical Pathology', children: labActions('LABORATORY.CHEMICAL_PATHOLOGY') },
      { key: 'LABORATORY.HISTOPATHOLOGY', label: 'Histopathology', children: labActions('LABORATORY.HISTOPATHOLOGY') },
      { key: 'LABORATORY.MOLECULAR', label: 'Molecular', children: labActions('LABORATORY.MOLECULAR') },
      {
        key: 'LABORATORY.INVENTORY', label: 'Test catalogue & prices (Admin)',
        children: [
          { key: 'LABORATORY.INVENTORY.VIEW', label: 'View' },
          { key: 'LABORATORY.INVENTORY.MANAGE', label: 'Add / edit investigations' },
          { key: 'LABORATORY.INVENTORY.MANAGE_PRICES', label: 'Change prices' },
        ],
      },
    ],
  },
  {
    key: 'PHARMACY', label: 'Pharmacy',
    children: [
      {
        key: 'PHARMACY.QUEUE', label: 'Prescription queue',
        children: [
          { key: 'PHARMACY.QUEUE.VIEW', label: 'View' },
          { key: 'PHARMACY.QUEUE.DISPENSE', label: 'Dispense drugs' },
        ],
      },
      {
        key: 'PHARMACY.INVENTORY', label: 'Medication inventory',
        children: [
          { key: 'PHARMACY.INVENTORY.VIEW', label: 'View' },
          { key: 'PHARMACY.INVENTORY.MANAGE_STOCK', label: 'Adjust stock' },
          { key: 'PHARMACY.INVENTORY.MANAGE_PRICES', label: 'Change prices (Admin)' },
        ],
      },
      deptConsumables('PHARMACY'),
    ],
  },
  {
    key: 'RADIOLOGY', label: 'Radiology',
    children: [
      {
        key: 'RADIOLOGY.QUEUE', label: 'Imaging queue',
        children: [
          { key: 'RADIOLOGY.QUEUE.VIEW', label: 'View' },
          { key: 'RADIOLOGY.QUEUE.REPORT', label: 'File / view reports' },
        ],
      },
      deptConsumables('RADIOLOGY'),
      { key: 'RADIOLOGY.TARIFFS', label: 'View tariffs' },
    ],
  },
  {
    key: 'PHYSIOTHERAPY', label: 'Physiotherapy',
    children: [
      {
        key: 'PHYSIOTHERAPY.QUEUE', label: 'Therapy queue',
        children: [
          { key: 'PHYSIOTHERAPY.QUEUE.VIEW', label: 'View' },
          { key: 'PHYSIOTHERAPY.QUEUE.TREAT', label: 'Log sessions' },
        ],
      },
      deptConsumables('PHYSIOTHERAPY'),
      { key: 'PHYSIOTHERAPY.TARIFFS', label: 'View tariffs' },
    ],
  },
  {
    key: 'BILLING', label: 'Billing & Cashier',
    children: [
      { key: 'BILLING.INVOICES', label: 'View invoices' },
      { key: 'BILLING.ADD_BILL', label: 'Add bill items' },
      { key: 'BILLING.RECEIVE_PAYMENT', label: 'Receive / part payment' },
      { key: 'BILLING.PRICE_SCHEDULE', label: 'View price schedule' },
    ],
  },
  {
    key: 'ADMIN', label: 'Administration',
    children: [
      {
        key: 'ADMIN.USERS', label: 'Staff accounts',
        children: [
          { key: 'ADMIN.USERS.VIEW', label: 'View' },
          { key: 'ADMIN.USERS.CREATE', label: 'Create accounts' },
          { key: 'ADMIN.USERS.EDIT', label: 'Edit accounts' },
          { key: 'ADMIN.USERS.ASSIGN_ROLES', label: 'Assign roles' },
          { key: 'ADMIN.USERS.REGENERATE_PASSWORD', label: 'Assign new passwords' },
          { key: 'ADMIN.USERS.DELETE', label: 'Delete accounts' },
        ],
      },
      {
        key: 'ADMIN.CONSUMABLES', label: 'Clinical consumables',
        children: [
          { key: 'ADMIN.CONSUMABLES.VIEW', label: 'View' },
          { key: 'ADMIN.CONSUMABLES.MANAGE', label: 'Add / edit / stock' },
          { key: 'ADMIN.CONSUMABLES.MANAGE_PRICES', label: 'Change prices' },
          { key: 'ADMIN.CONSUMABLES.APPROVE_REQUESTS', label: 'Approve / dispatch requests' },
        ],
      },
      { key: 'ADMIN.TARIFFS', label: 'Radiology & physio tariffs', children: [{ key: 'ADMIN.TARIFFS.MANAGE', label: 'Change tariffs' }] },
      { key: 'ADMIN.SETTINGS', label: 'Hospital parameters', children: [{ key: 'ADMIN.SETTINGS.MANAGE', label: 'Edit settings' }] },
      {
        key: 'ADMIN.ROLES', label: 'Roles & permissions',
        children: [
          { key: 'ADMIN.ROLES.VIEW', label: 'View' },
          { key: 'ADMIN.ROLES.MANAGE', label: 'Create / edit roles' },
        ],
      },
    ],
  },
];

// ---------- tree helpers ----------

const nodeIndex = new Map<string, PermissionNode>();
const parentOf = new Map<string, string>();
(function index(nodes: PermissionNode[], parent?: string) {
  nodes.forEach(n => {
    nodeIndex.set(n.key, n);
    if (parent) parentOf.set(n.key, parent);
    if (n.children) index(n.children, n.key);
  });
})(PERMISSION_TREE);

export function directChildren(key: string): string[] {
  return nodeIndex.get(key)?.children?.map(c => c.key) || [];
}

export function allDescendants(key: string): string[] {
  const out: string[] = [];
  const walk = (k: string) => {
    directChildren(k).forEach(c => {
      out.push(c);
      walk(c);
    });
  };
  walk(key);
  return out;
}

export function ancestorsOf(key: string): string[] {
  const out: string[] = [];
  let cur = parentOf.get(key);
  while (cur) {
    out.push(cur);
    cur = parentOf.get(cur);
  }
  return out;
}

export function isEffectivelyGranted(selected: string[], key: string): boolean {
  const set = new Set(selected);
  if (set.has(key)) return true;
  return ancestorsOf(key).some(a => set.has(a));
}

function isFullyCovered(set: Set<string>, key: string): boolean {
  if (set.has(key)) return true;
  const kids = directChildren(key);
  if (kids.length === 0) return false;
  return kids.every(k => isFullyCovered(set, k));
}

/** Toggle a node; cascades down, rolls up, keeps the stored set minimal. */
export function togglePermission(selected: string[], key: string): string[] {
  const set = new Set(selected);
  const effective = (k: string) => set.has(k) || ancestorsOf(k).some(a => set.has(a));
  if (effective(key)) {
    // Expand any inherited ancestor grants, excluding the toggled branch.
    ancestorsOf(key).forEach(anc => {
      if (set.has(anc)) {
        set.delete(anc);
        allDescendants(anc).forEach(d => {
          if (d === key || d.startsWith(key + '.')) return;
          set.add(d);
        });
      }
    });
    set.delete(key);
    allDescendants(key).forEach(d => set.delete(d));
  } else {
    set.add(key);
    // Roll up: a parent with all children covered collapses into one grant.
    ancestorsOf(key).forEach(anc => {
      const kids = directChildren(anc);
      if (kids.length > 0 && kids.every(k => isFullyCovered(set, k))) {
        allDescendants(anc).forEach(d => set.delete(d));
        set.add(anc);
      }
    });
  }
  return [...set].sort();
}

export function countGranted(selected: string[]): number {
  const set = new Set(selected);
  let n = 0;
  const walk = (nodes: PermissionNode[]) => {
    nodes.forEach(node => {
      if (set.has(node.key) || ancestorsOf(node.key).some(a => set.has(a))) n++;
      if (node.children) walk(node.children);
    });
  };
  walk(PERMISSION_TREE);
  return n;
}

export function totalPermissionCount(): number {
  let n = 0;
  const walk = (nodes: PermissionNode[]) => {
    nodes.forEach(node => {
      n++;
      if (node.children) walk(node.children);
    });
  };
  walk(PERMISSION_TREE);
  return n;
}

// ---------- evaluation ----------

/** Default grants per base role (used when a user has no custom role assigned). */
export const BASE_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  ADMINISTRATOR: ['DASHBOARD', 'PATIENTS', 'CLINICAL', 'LABORATORY', 'PHARMACY', 'RADIOLOGY', 'PHYSIOTHERAPY', 'BILLING', 'ADMIN'],
  PHYSICIAN: ['DASHBOARD.VIEW', 'PATIENTS.VIEW', 'CLINICAL.PHYSICIAN', 'CLINICAL.ALERTS.VIEW', 'BILLING.INVOICES'],
  NURSE: ['DASHBOARD.VIEW', 'PATIENTS.VIEW', 'CLINICAL.NURSING', 'CLINICAL.ALERTS.VIEW'],
  LAB_SCIENTIST: ['DASHBOARD.VIEW', 'CLINICAL.ALERTS.VIEW', 'LABORATORY.HEMATOLOGY', 'LABORATORY.MICROBIOLOGY', 'LABORATORY.CHEMICAL_PATHOLOGY', 'LABORATORY.HISTOPATHOLOGY', 'LABORATORY.MOLECULAR', 'LABORATORY.INVENTORY.VIEW'],
  PHARMACIST: ['DASHBOARD.VIEW', 'PHARMACY', 'CLINICAL.ALERTS.VIEW'],
  RADIOLOGIST: ['DASHBOARD.VIEW', 'RADIOLOGY', 'CLINICAL.ALERTS.VIEW'],
  PHYSIOTHERAPIST: ['DASHBOARD.VIEW', 'PHYSIOTHERAPY', 'CLINICAL.ALERTS.VIEW'],
  FRONT_DESK: ['DASHBOARD.VIEW', 'PATIENTS.VIEW', 'PATIENTS.REGISTER', 'PATIENTS.EDIT', 'PATIENTS.BOOKINGS', 'BILLING'],
  BILLING_OFFICER: ['DASHBOARD.VIEW', 'PATIENTS.VIEW', 'BILLING', 'BILLING.PRICE_SCHEDULE'],
};

export function effectivePermissions(user: User, customRole?: CustomRole): string[] {
  if (user.role === 'ADMINISTRATOR') return ['DASHBOARD', 'PATIENTS', 'CLINICAL', 'LABORATORY', 'PHARMACY', 'RADIOLOGY', 'PHYSIOTHERAPY', 'BILLING', 'ADMIN'];
  if (customRole) return customRole.permissions;
  return BASE_ROLE_PERMISSIONS[user.role] || [];
}

export function hasPermission(user: User, key: string, customRole?: CustomRole): boolean {
  return isEffectivelyGranted(effectivePermissions(user, customRole), key);
}

/** Lab gate: which workflow actions may this user perform on a department's tests? */
export function labCapabilities(user: User, category: string, customRole?: CustomRole) {
  const dept = `LABORATORY.${category}`;
  const can = (action: string) => hasPermission(user, `${dept}.${action}`, customRole);
  return {
    canView: can('VIEW') || hasPermission(user, 'CLINICAL.ALERTS.VIEW', customRole),
    canProcess: can('PROCESS'),
    canEnterResult: can('ENTER_RESULT'),
    canVerify: can('VERIFY_RELEASE'),
  };
}
