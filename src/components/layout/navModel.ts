/**
 * The navigation, as data, with the permission that admits you to each item.
 *
 * WHY IT IS NOT IN THE SIDEBAR COMPONENTS
 * --------------------------------------
 * This used to live inside `Sidebar1`/`Sidebar2` as JSX arrays, and every item
 * carried an optional `roles?: string[]` field that nothing ever read. Role-based
 * navigation was designed, typed, and then never built: every staff member saw
 * every department, and a doctor could walk into Pharmacy by typing at it.
 *
 * Moving the menu out of the markup is what makes it enforceable. The permission
 * on each item is REQUIRED, not optional, so the compiler refuses any menu entry
 * added without one - an item cannot be shipped invisible to the review that
 * would have caught it, because the build stops. And because this is a `.ts`
 * module with no React and no icon library, the whole menu can be imported by the
 * self-test and checked against `src/services/permissions.ts` directly, rather
 * than being trusted.
 *
 * ICONS ARE NAMES, NOT COMPONENTS
 * -------------------------------
 * `icon` is a string that `navIcons.ts` resolves to a lucide component. Storing
 * the component here would work in the browser but would pull `lucide-react` -
 * and through it React - into any script that imports the menu, which is exactly
 * what the self-test does. A menu is data; the components render it.
 */
import type { MainNavId } from '../../types';

export type { MainNavId };
export type SubNavId = string;

/** The five laboratory departments, which share one shape of permission. */
export const LAB_DEPARTMENTS = [
  'HEMATOLOGY', 'MICROBIOLOGY', 'CHEMICAL_PATHOLOGY', 'HISTOPATHOLOGY', 'MOLECULAR',
] as const;

export type LabDepartment = (typeof LAB_DEPARTMENTS)[number];

/** `LABORATORY.HEMATOLOGY.VIEW` etc. — the key each department's screens hang off. */
export const labKey = (dept: string, action: string): string => `LABORATORY.${dept}.${action}`;

export const LAB_VIEW_KEYS: string[] = LAB_DEPARTMENTS.map(d => labKey(d, 'VIEW'));
export const LAB_STOCK_KEYS: string[] = LAB_DEPARTMENTS.flatMap(d => [
  labKey(d, 'LOG_USAGE'),
  labKey(d, 'REQUEST_STOCK'),
]);

/** Every billing permission, in one list, for "has any billing access" questions. */
export const BILLING_KEYS: string[] = [
  'BILLING.INVOICES', 'BILLING.ADD_BILL', 'BILLING.RECEIVE_PAYMENT', 'BILLING.PRICE_SCHEDULE',
];

export const ADMIN_KEYS: string[] = [
  'ADMIN.USERS.VIEW', 'ADMIN.ROLES.VIEW', 'ADMIN.CONSUMABLES.VIEW', 'ADMIN.TARIFFS.MANAGE',
  'ADMIN.SETTINGS.MANAGE', 'LABORATORY.INVENTORY.MANAGE', 'PHARMACY.INVENTORY.MANAGE_STOCK',
];

/**
 * The permission each department's screens hang off.
 *
 * A laboratory scientist with no custom role is granted every department by
 * `BASE_ROLE_PERMISSIONS`, because that table predates custom roles and granting
 * the department was the whole job. An administrator who wants someone to run
 * haematology only now can, and the other four disappear from their menu.
 */
export interface MainNavItem {
  id: MainNavId;
  label: string;
  sublabel: string;
  /** A key from `navIcons.ts`. */
  icon: string;
  /** Tailwind gradient classes. Literal, so the scanner finds them here too. */
  color: string;
  /**
   * Permissions that admit you to this destination. ANY of them is enough.
   *
   * More than one because a department is reachable by several kinds of person:
   * `clinical` is one door that a physician, a nurse and anyone watching
   * diagnostic alerts all legitimately walk through.
   */
  anyOf: string[];
  /** Only these roles may see money anywhere in this destination. */
  revenue?: 'anyOfBilling';
  /**
   * Whether this destination is offered as a row in the first column.
   *
   * `false` means it is a real, gated destination - it has a submenu, a
   * `MainContainer` case and its own permission checks - but it is reached from
   * somewhere else, and offering it in the menu as well shows the same screens
   * twice over.
   *
   * Two destinations are like this, and both got into the menu by accident. This
   * list was rebuilt from the old sidebar, and these two were added because the
   * rest of the application already navigated to them:
   *
   *   - `billing` is what the dashboard's Billing card and the Front Desk's four
   *     billing rows (`central_billing`, `front_desk_billing`, `pay_bills`,
   *     `price_schedule`) all point at. A separate Billing column repeated those
   *     same screens under a second name.
   *   - `analytics` is `dashboard -> analytics`, which renders the identical
   *     component. Two entries, one screen.
   *
   * So they stay in `MAIN_NAV` and stay in `SUB_NAV` - `MainContainer` dispatches
   * on the id, and `renderContent`'s guard asks `canOpenSubNav` about it, so
   * removing either would turn a valid destination into "Access denied". They are
   * simply not offered as a row.
   *
   * The permission gate is untouched by this: they are refused exactly as
   * strictly as before, and `firstPermittedNav` cannot land anybody here, because
   * a screen with no menu row has no way back out of it.
   */
  inMenu?: boolean;
}

export interface SubNavItem {
  id: SubNavId;
  label: string;
  icon: string;
  badge?: string;
  hasSubmenu?: boolean;
  subItems?: SubNavItem[];
  /** Same rule as the main nav: ANY of these is enough. Required, always. */
  anyOf: string[];
  /**
   * Marks a destination whose contents are money - invoices, cashier takings,
   * revenue analytics. Used for the role gate, independently of the permission
   * above, because "may see revenue" is a question about who someone is, not
   * about what an administrator happened to tick.
   */
  revenue?: boolean;
}

export interface SubNavGroup {
  title: string;
  items: SubNavItem[];
}

// ---------------------------------------------------------------------------
// The main menu, in the order it is shown
// ---------------------------------------------------------------------------

export const MAIN_NAV: MainNavItem[] = [
  {
    id: 'dashboard', label: 'Dashboard', sublabel: 'Workstation overview',
    icon: 'LayoutDashboard', color: 'from-emerald-500 to-teal-600', anyOf: ['DASHBOARD.VIEW'],
  },
  {
    // The door admits every key its own rooms need. Someone granted only
    // `PATIENTS.REGISTER` can register a patient even though they may not browse
    // the directory, and someone granted only `BILLING.RECEIVE_PAYMENT` can take
    // money even though they may not open an invoice. Gating the door on
    // `PATIENTS.VIEW` alone would leave both of them unable to do their job.
    id: 'patients', label: 'Front Desk', sublabel: 'Reception & Cashier',
    icon: 'Users', color: 'from-blue-500 to-indigo-600',
    anyOf: ['PATIENTS.VIEW', 'PATIENTS.REGISTER', 'PATIENTS.EDIT', 'PATIENTS.BOOKINGS', ...BILLING_KEYS],
  },
  {
    id: 'clinical', label: 'Clinical', sublabel: 'Consultation & Nursing',
    icon: 'Stethoscope', color: 'from-rose-500 to-pink-600',
    anyOf: [
      'CLINICAL.PHYSICIAN.VIEW', 'CLINICAL.NURSING.VIEW', 'CLINICAL.ALERTS.VIEW',
      'CLINICAL.NURSING.USE_CONSUMABLES',
    ],
  },
  {
    id: 'laboratory', label: 'Laboratory', sublabel: '5 Pathology Fields',
    icon: 'FlaskConical', color: 'from-amber-500 to-orange-600',
    // The department door opens for stock handling and inventory management as
    // well as for viewing results. A scientist granted only
    // `LABORATORY.HEMATOLOGY.LOG_USAGE` cannot read a single result, but they
    // still have a job in that department and its Stock screen lives behind this
    // door - listing the department without the stock keys would put a wall in
    // front of somebody who is allowed in.
    anyOf: [
      ...LAB_VIEW_KEYS,
      ...LAB_STOCK_KEYS,
      'LABORATORY.INVENTORY.VIEW',
      'LABORATORY.INVENTORY.MANAGE',
    ],
  },
  {
    id: 'pharmacy', label: 'Pharmacy', sublabel: 'Prescription & Drugs',
    icon: 'Pill', color: 'from-purple-500 to-violet-600',
    anyOf: [
      'PHARMACY.QUEUE.VIEW', 'PHARMACY.INVENTORY.VIEW', 'PHARMACY.CONSUMABLES.VIEW',
      'PHARMACY.CONSUMABLES.REQUEST_STOCK',
    ],
  },
  {
    id: 'radiology', label: 'Radiology', sublabel: 'Imaging & Scans',
    icon: 'Radio', color: 'from-indigo-600 to-blue-700',
    anyOf: ['RADIOLOGY.QUEUE.VIEW', 'RADIOLOGY.CONSUMABLES.VIEW', 'RADIOLOGY.TARIFFS'],
  },
  {
    id: 'physiotherapy', label: 'Physiotherapy', sublabel: 'Rehab & Therapy',
    icon: 'Activity', color: 'from-teal-600 to-emerald-700',
    anyOf: ['PHYSIOTHERAPY.QUEUE.VIEW', 'PHYSIOTHERAPY.CONSUMABLES.VIEW', 'PHYSIOTHERAPY.TARIFFS'],
  },
  {
    // Not a menu row - see `inMenu`. The Billing screens are the Front Desk's
    // four billing rows, and the dashboard's Billing card lands here too.
    id: 'billing', label: 'Billing', sublabel: 'Invoices & Payments',
    icon: 'Receipt', color: 'from-cyan-600 to-sky-700',
    anyOf: BILLING_KEYS, revenue: 'anyOfBilling', inMenu: false,
  },
  {
    // Not a menu row - see `inMenu`. This is `dashboard -> analytics`, rendering
    // the same component.
    id: 'analytics', label: 'Analytics', sublabel: 'Statistics & Reports',
    icon: 'PieChart', color: 'from-teal-500 to-emerald-600',
    anyOf: ['DASHBOARD.VIEW'], revenue: 'anyOfBilling', inMenu: false,
  },
  {
    id: 'ai', label: 'AI Assistant', sublabel: 'Query & Summaries',
    icon: 'Bot', color: 'from-fuchsia-500 to-pink-600',
    anyOf: ['AI.QUERY', 'AI.SUMMARIZE', 'AI.SAFEGUARDS'],
  },
  {
    id: 'admin', label: 'Administration', sublabel: 'Users & Setup',
    icon: 'Settings', color: 'from-slate-600 to-slate-800', anyOf: ADMIN_KEYS,
  },
];

// ---------------------------------------------------------------------------
// The submenus
// ---------------------------------------------------------------------------

const physicianSubmenu: SubNavItem[] = [
  { id: 'consultations_all', label: 'All Patients', icon: 'Users', anyOf: ['CLINICAL.PHYSICIAN.VIEW'] },
  { id: 'consultations_awaiting', label: 'Awaiting', icon: 'Clock', anyOf: ['CLINICAL.PHYSICIAN.VIEW'] },
  { id: 'consultations_consulted', label: 'Consulted', icon: 'UserCheck', anyOf: ['CLINICAL.PHYSICIAN.VIEW'] },
  { id: 'consultations_incoming', label: 'Incoming', icon: 'Bell', anyOf: ['CLINICAL.PHYSICIAN.VIEW'] },
];

const nursingSubmenu: SubNavItem[] = [
  { id: 'nursing_all', label: 'All Patients', icon: 'Users', anyOf: ['CLINICAL.NURSING.VIEW'] },
  { id: 'nursing_awaiting', label: 'Awaiting', icon: 'Clock', anyOf: ['CLINICAL.NURSING.VIEW'] },
  { id: 'nursing_consulting', label: 'Consulting', icon: 'UserCheck', anyOf: ['CLINICAL.NURSING.VIEW'] },
  { id: 'nursing_with_doctor', label: 'With Doctor', icon: 'Stethoscope', anyOf: ['CLINICAL.NURSING.VIEW'] },
  { id: 'nursing_incoming', label: 'Incoming', icon: 'Bell', anyOf: ['CLINICAL.NURSING.VIEW'] },
];

const clinicalItems: SubNavItem[] = [
  {
    id: 'clinical_dashboard', label: 'Clinical Dashboard', icon: 'LayoutGrid',
    anyOf: ['CLINICAL.PHYSICIAN.VIEW', 'CLINICAL.NURSING.VIEW'],
  },
  {
    id: 'consultations', label: 'Physician Consultation', icon: 'Stethoscope',
    anyOf: ['CLINICAL.PHYSICIAN.VIEW'], hasSubmenu: true, subItems: physicianSubmenu,
  },
  {
    id: 'nursing_station', label: 'Nursing Station & Triage', icon: 'Activity',
    anyOf: ['CLINICAL.NURSING.VIEW'], hasSubmenu: true, subItems: nursingSubmenu,
  },
  { id: 'lab_alerts', label: 'Diagnostic Alerts', icon: 'TestTube', anyOf: ['CLINICAL.ALERTS.VIEW'] },
  {
    id: 'nursing_consumables', label: 'Nursing Consumables', icon: 'Package',
    anyOf: ['CLINICAL.NURSING.USE_CONSUMABLES'],
  },
];

/** The laboratory submenu is written out, because five near-identical blocks of
 *  copy-paste are five chances to give two departments different permissions. */
const labItems: SubNavItem[] = [
  { id: 'lab_overview', label: 'Overview', icon: 'TrendingUp', badge: 'Live', anyOf: [...LAB_VIEW_KEYS] },
  { id: 'lab_all', label: 'All Departments', icon: 'Inbox', anyOf: [...LAB_VIEW_KEYS] },
  { id: 'hematology', label: 'Hematology', icon: 'TestTube', anyOf: [labKey('HEMATOLOGY', 'VIEW')] },
  { id: 'chemical_pathology', label: 'Chem Pathology', icon: 'Dna', anyOf: [labKey('CHEMICAL_PATHOLOGY', 'VIEW')] },
  { id: 'microbiology', label: 'Microbiology', icon: 'Bug', anyOf: [labKey('MICROBIOLOGY', 'VIEW')] },
  { id: 'histopathology', label: 'Histopathology', icon: 'Microscope', anyOf: [labKey('HISTOPATHOLOGY', 'VIEW')] },
  { id: 'molecular', label: 'Molecular', icon: 'Dna', anyOf: [labKey('MOLECULAR', 'VIEW')] },
  { id: 'lab_released', label: 'Released Reports', icon: 'FileCheck2', anyOf: [...LAB_VIEW_KEYS] },
  { id: 'lab_stock', label: 'Stock', icon: 'Boxes', anyOf: [...LAB_STOCK_KEYS] },
  {
    id: 'lab_inventory', label: 'Test Inventory', icon: 'FileSpreadsheet',
    anyOf: ['LABORATORY.INVENTORY.VIEW'],
  },
];

const radiologyModalities: Array<[SubNavId, string, string]> = [
  ['xray', 'Digital X-Ray', 'FileCheck2'],
  ['ultrasound', 'Ultrasound Scan (USS)', 'Activity'],
  ['ct_scan', 'CT Scan', 'Microscope'],
  ['mri', 'Magnetic Resonance (MRI)', 'Dna'],
];

const physioCategories: Array<[SubNavId, string, string]> = [
  ['musculoskeletal', 'Musculoskeletal & Ortho', 'Sparkles'],
  ['neuro_rehab', 'Neurological Rehab', 'Dna'],
  ['sports_physio', 'Sports Injury Therapy', 'TrendingUp'],
  ['pediatric_physio', 'Pediatric Physical Care', 'Users'],
];

export const SUB_NAV: Record<MainNavId, SubNavGroup> = {
  dashboard: {
    title: 'Executive Dashboard',
    items: [
      { id: 'overview', label: 'Executive Overview', icon: 'TrendingUp', anyOf: ['DASHBOARD.VIEW'] },
      { id: 'analytics', label: 'Analytics & Reports', icon: 'BarChart3', anyOf: ['DASHBOARD.VIEW'] },
    ],
  },
  patients: {
    title: 'Front Desk Operations',
    items: [
      { id: 'all_patients', label: 'Patient Directory & Queue', icon: 'Users', anyOf: ['PATIENTS.VIEW'] },
      { id: 'register_patient', label: 'Register Patient', icon: 'UserPlus', anyOf: ['PATIENTS.REGISTER'] },
      { id: 'online_bookings', label: 'Online Bookings & Code', icon: 'Globe', anyOf: ['PATIENTS.BOOKINGS'], badge: 'New' },
      { id: 'patient_timeline', label: 'Patient Timeline', icon: 'Clock', anyOf: ['PATIENTS.VIEW'] },
      // Money from here down. A doctor holds PATIENTS.VIEW and BILLING.INVOICES,
      // so these three are the ones a clinical role must not be able to reach.
      { id: 'pay_bills', label: 'Pay Bill / Cashier', icon: 'CreditCard', anyOf: ['BILLING.RECEIVE_PAYMENT'], revenue: true },
      { id: 'central_billing', label: 'Central Billing', icon: 'Receipt', anyOf: ['BILLING.INVOICES'], badge: 'Synced', revenue: true },
      { id: 'front_desk_billing', label: 'Front Desk Billing', icon: 'CreditCard', anyOf: ['BILLING.INVOICES'], revenue: true },
      { id: 'price_schedule', label: 'Master Price Schedule', icon: 'Coins', anyOf: ['BILLING.PRICE_SCHEDULE'], revenue: true },
    ],
  },
  clinical: { title: 'Clinical Care & Triage', items: clinicalItems },
  laboratory: { title: 'Diagnostic Laboratory', items: labItems },
  pharmacy: {
    title: 'Pharmacy & Therapeutics',
    items: [
      { id: 'pharmacy_overview', label: 'Overview', icon: 'TrendingUp', badge: 'Stats', anyOf: ['PHARMACY.QUEUE.VIEW', 'PHARMACY.INVENTORY.VIEW'] },
      { id: 'rx_queue', label: 'Prescription Queue', icon: 'Inbox', badge: 'Orders', anyOf: ['PHARMACY.QUEUE.VIEW'] },
      { id: 'dispensed', label: 'Dispensed', icon: 'CheckCircle2', anyOf: ['PHARMACY.QUEUE.VIEW'] },
      { id: 'inventory', label: 'Medication Inventory', icon: 'Coins', anyOf: ['PHARMACY.INVENTORY.VIEW'] },
      { id: 'pharmacy_inventory', label: 'Medication Inventory', icon: 'Coins', anyOf: ['PHARMACY.INVENTORY.VIEW'] },
      { id: 'pharmacy_consumables', label: 'Pharmacy Consumables', icon: 'Boxes', anyOf: ['PHARMACY.CONSUMABLES.VIEW'] },
      { id: 'pharmacy_stock_requests', label: 'Stock Requests', icon: 'Package', anyOf: ['PHARMACY.CONSUMABLES.REQUEST_STOCK'] },
    ],
  },
  radiology: {
    title: 'Radiology & Medical Imaging',
    items: [
      { id: 'radiology_overview', label: 'Overview', icon: 'TrendingUp', badge: 'Live', anyOf: ['RADIOLOGY.QUEUE.VIEW'] },
      { id: 'radiology_all', label: 'All Scan Orders', icon: 'Radio', anyOf: ['RADIOLOGY.QUEUE.VIEW'] },
      ...radiologyModalities.map(([id, label, icon]): SubNavItem => ({ id, label, icon, anyOf: ['RADIOLOGY.QUEUE.VIEW'] })),
      { id: 'radiology_reports', label: 'Completed PACS Reports', icon: 'FileSpreadsheet', anyOf: ['RADIOLOGY.QUEUE.VIEW', 'RADIOLOGY.QUEUE.REPORT'] },
      { id: 'radiology_stock', label: 'Imaging Consumables', icon: 'Boxes', anyOf: ['RADIOLOGY.CONSUMABLES.VIEW'] },
      { id: 'radiology_pricing', label: 'Tariff & Scan Directory', icon: 'Coins', anyOf: ['RADIOLOGY.TARIFFS'], revenue: true },
    ],
  },
  physiotherapy: {
    title: 'Physiotherapy & Rehabilitation',
    items: [
      { id: 'physio_overview', label: 'Overview', icon: 'TrendingUp', badge: 'Live', anyOf: ['PHYSIOTHERAPY.QUEUE.VIEW'] },
      { id: 'physio_all', label: 'All Therapy Orders', icon: 'Activity', anyOf: ['PHYSIOTHERAPY.QUEUE.VIEW'] },
      ...physioCategories.map(([id, label, icon]): SubNavItem => ({ id, label, icon, anyOf: ['PHYSIOTHERAPY.QUEUE.VIEW'] })),
      { id: 'physio_sessions', label: 'Ongoing Therapy Sessions', icon: 'Clock', anyOf: ['PHYSIOTHERAPY.QUEUE.VIEW'] },
      { id: 'physio_equipment', label: 'Rehab Supplies & Equipment', icon: 'Boxes', anyOf: ['PHYSIOTHERAPY.CONSUMABLES.VIEW'] },
      { id: 'physio_pricing', label: 'Session Tariffs', icon: 'Coins', anyOf: ['PHYSIOTHERAPY.TARIFFS'], revenue: true },
    ],
  },
  billing: {
    title: 'Central Billing & Cashier',
    items: [
      { id: 'all_invoices', label: 'All Invoices', icon: 'Receipt', anyOf: ['BILLING.INVOICES'], revenue: true },
      { id: 'process_payment', label: 'Receive Payment / Cashier', icon: 'CreditCard', anyOf: ['BILLING.RECEIVE_PAYMENT'], revenue: true },
      { id: 'price_schedule', label: 'Master Price Schedule', icon: 'Coins', anyOf: ['BILLING.PRICE_SCHEDULE'], revenue: true },
    ],
  },
  analytics: {
    title: 'Clinical Analytics',
    items: [
      { id: 'patient_stats', label: 'Patient Statistics', icon: 'TrendingUp', anyOf: ['DASHBOARD.VIEW'] },
      { id: 'lab_stats', label: 'Laboratory Workload', icon: 'PieChart', anyOf: ['DASHBOARD.VIEW'] },
      { id: 'financial_stats', label: 'Revenue Analytics', icon: 'DollarSign', anyOf: ['DASHBOARD.VIEW'], revenue: true },
    ],
  },
  ai: {
    title: 'Clinical AI Assistant',
    items: [
      { id: 'nl_query', label: 'Natural Language Query', icon: 'Sparkles', anyOf: ['AI.QUERY'] },
      { id: 'ai_summarizer', label: 'Patient Summarizer', icon: 'Bot', anyOf: ['AI.SUMMARIZE'] },
      { id: 'ai_safety', label: 'Clinical AI Safeguards', icon: 'ShieldCheck', anyOf: ['AI.SAFEGUARDS'] },
    ],
  },
  admin: {
    title: 'System Administration',
    items: [
      // Roles & Permissions are edited inside this screen (the "Custom Roles"
      // section), so there is deliberately no separate entry for them: a menu
      // row that opens the users tab under a different name is a small lie that
      // makes the person look twice.
      { id: 'users_mgmt', label: 'Staff Accounts & Roles', icon: 'UserCog', anyOf: ['ADMIN.USERS.VIEW'] },
      { id: 'consumables_mgmt', label: 'Clinical Consumables', icon: 'Boxes', anyOf: ['ADMIN.CONSUMABLES.VIEW'] },
      { id: 'lab_mgmt', label: 'Laboratory Investigations', icon: 'TestTube', anyOf: ['LABORATORY.INVENTORY.MANAGE'] },
      { id: 'pharmacy_mgmt', label: 'Pharmacy Formulary & Stocks', icon: 'Package', anyOf: ['PHARMACY.INVENTORY.MANAGE_STOCK'] },
      { id: 'radiology_physio_mgmt', label: 'Radiology & Physio Tariffs', icon: 'Radio', anyOf: ['ADMIN.TARIFFS.MANAGE'], revenue: true },
      { id: 'pricing_config', label: 'Master Pricing Matrix', icon: 'Sliders', anyOf: ['ADMIN.SETTINGS.MANAGE'], revenue: true },
      { id: 'receipt_settings', label: 'Receipt Settings', icon: 'Receipt', anyOf: ['ADMIN.SETTINGS.MANAGE'] },
      { id: 'system_settings', label: 'Hospital Parameters', icon: 'Building', anyOf: ['ADMIN.SETTINGS.MANAGE'] },
    ],
  },
};

/**
 * Every submenu id under `nav`, flattened, including the nested lists.
 *
 * Used to build the id lookup in `accessControl.ts`, so a submenu item added to
 * `SUB_NAV` is reachable by id without a second edit somewhere else.
 */
export function allSubNavItems(nav: MainNavId): SubNavItem[] {
  const group = SUB_NAV[nav];
  if (!group) return [];
  const out: SubNavItem[] = [];
  const walk = (items: SubNavItem[]) => {
    for (const item of items) {
      out.push(item);
      if (item.subItems) walk(item.subItems);
    }
  };
  walk(group.items);
  return out;
}