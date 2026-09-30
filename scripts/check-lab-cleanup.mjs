/**
 * Did the live lab workflow check leave anything behind?
 *
 * scripts/check-lab-workflow.mjs creates a patient, a visit, a request, a test
 * order, fourteen results and a throwaway sign-in account, then deletes them.
 * Nothing asserted that the deletion worked, so a cleanup that quietly failed
 * would leave a real patient's worth of junk in a live clinic database, and no
 * test would say so.
 *
 * Counts what a previous run may have left, and the throwaway auth accounts,
 * which live in a different system entirely.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return i === -1
        ? [l.trim(), '']
        : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const BASE = env.VITE_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

const PATTERNS = {
  patients: 'FC-PANEL-%',
  visits: 'VIS-PANEL-%',
  lab_requests: 'LRQ-PANEL-%',
  lab_test_orders: 'LTO-PANEL-%',
  lab_results: 'LTO-PANEL-%',
  users: 'USR-L%',
};

let bad = 0;

for (const [table, pattern] of Object.entries(PATTERNS)) {
  const r = await fetch(
    `${BASE}/rest/v1/${table}?id=like.${encodeURIComponent(pattern)}&select=id`,
    { headers },
  );
  const rows = await r.json();
  if (!Array.isArray(rows)) {
    console.error(`  !! ${table}: ${JSON.stringify(rows)}`);
    bad++;
    continue;
  }
  console.log(`  ${rows.length === 0 ? 'clean' : 'LEFTOVERS'}  ${table} (${pattern})`);
  for (const row of rows) console.log(`      ${row.id}`);
  if (rows.length) bad++;
}

const auth = await createClient(BASE, SVC, { auth: { persistSession: false } });
const { data: list, error } = await auth.auth.admin.listUsers({ page: 1, perPage: 200 });
if (error) {
  console.error(`  !! could not list auth users: ${error.message}`);
  bad++;
} else {
  const probes = (list?.users ?? []).filter((u) => /^labflow-\d+@solacemedicares\.com$/.test(u.email ?? ''));
  console.log(`  ${probes.length === 0 ? 'clean' : 'LEFTOVERS'}  throwaway sign-in accounts`);
  for (const p of probes) console.log(`      ${p.email} (${p.id})`);
  if (probes.length) bad++;
}

console.log('');
if (bad) {
  console.error(`${bad} table(s) still hold rows from a lab workflow check.`);
  console.error('These are not patients. They can be deleted, but a cleanup that');
  console.error('leaves rows behind is a cleanup that has not been proven to work.');
  process.exitCode = 1;
} else {
  console.log('The live database holds nothing left over from a lab workflow check.');
}
