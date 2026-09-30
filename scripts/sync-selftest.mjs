// Self-test for the Postgres sync layer in src/services/sync.ts.
//
// The diff engine decides which clinical rows are inserted, updated and deleted.
// A mistake there does not throw - it silently drops a lab result, or reverts a
// prescription, or bills a patient twice. So this test drives the real row
// mappers against an in-memory server and checks the resulting database state,
// rather than asserting on which functions were called.
//
// Three things are proven:
//
//   1. CONFORMANCE - every key a mapper produces is a real column, and every
//      column the database requires is always produced. 24 hand-written mappers
//      against a 34-table schema is exactly the kind of pairing that rots. The
//      row checked is the one that goes on the wire, after the omit list.
//   2. FIDELITY - a model survives model -> row -> model unchanged, so a round
//      trip through Postgres loses nothing, and an absent field comes back absent
//      rather than as "undefined" or a stray zero.
//   3. SEMANTICS - inserts, updates, deletes, nested children, grandchildren,
//      append-only tables and database-owned columns all behave as documented,
//      no child row is ever written before the parent it references, and the
//      write queue coalesces a burst without losing the state to diff against.
//
// The fake server enforces every foreign key parsed from the SQL, so test 3 also
// proves write ordering without the test hard-coding any relationship.
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// The sources are TypeScript with extensionless relative imports, which plain
// Node cannot resolve on its own. Node strips the types; this supplies the
// extension, so the test exercises the real module rather than a copy.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      // A directory import means an index file: `../types` is types/index.ts.
      // Vite and tsc both resolve this; plain Node does not.
      const fromDir = context.parentURL
        ? path.dirname(fileURLToPath(context.parentURL))
        : ROOT;
      if (fs.existsSync(path.join(fromDir, specifier, 'index.ts'))) {
        return nextResolve(`${specifier}/index.ts`, context);
      }
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Not a .ts file. Fall through to normal resolution.
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  TABLES,
  TABLE_BY_KEY,
  USERS_STORAGE_KEY,
  pushDiff,
  queueDiff,
  whenDrained,
  pendingKeys,
  isInFlight,
  syncFailures,
  clearSyncFailures,
  recordPersisted,
  persistedBefore,
  forgetPersisted,
  COLUMN_RANGES,
} = await import('../src/services/sync.ts');

// Imported here rather than alongside the rest of the laboratory rules further
// down, because the diff test below composes the two: `applyStatusChange` decides
// what a workflow move writes and `pushDiff` has to actually send it.
const { applyStatusChange } = await import('../src/services/labResults.ts');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let failures = 0;
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log(`  ${name.padEnd(56)} : ok`);
  } else {
    failures++;
    console.log(`  ${name.padEnd(56)} : FAILED`);
    if (detail) for (const line of [].concat(detail)) console.log(`      ${line}`);
  }
}

function section(title) {
  console.log('');
  console.log(`  ${title}`);
}

/**
 * Run one section, turning a thrown error into a reported failure.
 *
 * The fake server raises on a foreign key violation, which is how a write-order
 * or empty-string defect surfaces. An uncaught throw would end the run at the
 * first one and hide every later problem behind it, so the throw becomes a
 * failed check instead. The count stays honest either way: an aborted section
 * is one failure, not a partial pass.
 */
async function block(name, fn) {
  section(name);
  try {
    await fn();
  } catch (err) {
    check(
      `${name} [aborted]`,
      false,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Read the schema
// ---------------------------------------------------------------------------

const sql = fs.readFileSync(path.join(ROOT, 'database', 'fatclinic.sql'), 'utf8');

/**
 * Remove `--` line comments, ignoring any inside a single-quoted literal.
 *
 * Only applied to extracted CREATE TABLE bodies, where no literal contains `--`.
 * It has to run before splitting: a trailing comment sits after the comma, so
 * `id TEXT PRIMARY KEY,   -- 'USR-001'` would otherwise glue the comment onto
 * the next column and make the parser miss it.
 */
function stripLineComments(body) {
  let out = '';
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      out += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") { inString = true; out += ch; continue; }
    if (ch === '-' && body[i + 1] === '-') {
      while (i < body.length && body[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

/** Split a comma-separated SQL fragment, ignoring commas inside brackets. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      current += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const columns = new Map(); // table -> [{ name, type, required }]
const fks = new Map(); // table -> [{ column, table, refColumn }]

for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g)) {
  const [, table, body] = match;
  const cols = [];
  for (const line of splitTopLevel(stripLineComments(body))) {
    if (/^(CONSTRAINT|PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK)\b/i.test(line)) {
      // Table-level constraints. Foreign keys are picked up below.
      const fk = line.match(/FOREIGN KEY\s*\((\w+)\)\s*REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)/i);
      if (fk) {
        if (!fks.has(table)) fks.set(table, []);
        fks.get(table).push({ column: fk[1], table: fk[2], refColumn: fk[3] });
      }
      continue;
    }
    // Column name, then exactly one type token. Greedier patterns swallow the
    // constraints that follow - "TEXT NOT NULL REFERENCES PATIENTS" is not a
    // type - which then leaks into the synthetic values as a foreign key.
    const col = line.match(/^(\w+)\s+(\w+)(\s*\([^)]*\))?(\s*\[\])?/);
    if (!col) continue;
    const type = `${col[2]}${col[3] ?? ''}${col[4] ?? ''}`.replace(/\s+/g, '').toUpperCase();
    // A primary key is required even when the column is not marked NOT NULL.
    const isPk = new RegExp(`PRIMARY KEY`, 'i').test(line);
    const required =
      isPk || (/\bNOT NULL\b/i.test(line) && !/\bDEFAULT\b/i.test(line));
    cols.push({ name: col[1], type, required });
    const inlineFk = line.match(
      /REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)/i,
    );
    if (inlineFk) {
      if (!fks.has(table)) fks.set(table, []);
      fks.get(table).push({ column: col[1], table: inlineFk[1], refColumn: inlineFk[2] });
    }
  }
  columns.set(table, cols);
}

// Foreign keys added later, because of a cycle.
for (const match of sql.matchAll(
  /ALTER TABLE\s+(\w+)\s+ADD CONSTRAINT\s+\w+\s*FOREIGN KEY\s*\((\w+)\)\s*REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)/gi,
)) {
  const [, table, column, parent, refColumn] = match;
  if (!columns.has(table)) continue; // an ALTER inside a dynamic DO block
  if (!fks.has(table)) fks.set(table, []);
  fks.get(table).push({ column, table: parent, refColumn });
}

section('schema read from database/fatclinic.sql');
check(
  'found the 34 tables the schema declares',
  columns.size === 34,
  `found ${columns.size}`,
);

// ---------------------------------------------------------------------------
// 2. A synthetic row that satisfies every column
// ---------------------------------------------------------------------------

/**
 * A value the mapper must be able to read back, chosen to be hostile where the
 * database would be. `NUMERIC` is a string on purpose: PostgREST sends it that
 * way to avoid float64 precision loss, so a mapper that forgot `Number()` would
 * pass a hand-written test and put "37.5" into a numeric field on screen.
 */
function valueFor(type) {
  if (type.startsWith('NUMERIC') || type.startsWith('DECIMAL')) return '1234.50';
  if (type.startsWith('DOUBLE') || type.startsWith('REAL')) return 1234.5;
  if (type.startsWith('INT') || type.startsWith('SERIAL')) return 7;
  if (type.startsWith('BOOLEAN')) return true;
  if (type.startsWith('UUID')) return '11111111-2222-3333-4444-555555555555';
  if (type.startsWith('JSONB') || type.startsWith('JSON')) return { probe: true };
  if (type.startsWith('TIMESTAMPTZ') || type.startsWith('TIMESTAMP')) {
    return '2026-03-04T09:30:00.000Z';
  }
  if (type.startsWith('DATE')) return '2026-03-04';
  if (type.startsWith('TIME')) return '09:30';
  if (type.endsWith('[]')) return ['PROBE_A', 'PROBE_B'];
  return `PROBE_${type}`;
}

function syntheticRow(table) {
  const cols = columns.get(table);
  if (!cols) throw new Error(`no such table in the schema: ${table}`);
  const row = {};
  for (const col of cols) {
    if (col.name === 'id') {
      row.id = 'PROBE_ID';
      continue;
    }
    row[col.name] = valueFor(col.type);
  }
  return row;
}

/**
 * A synthetic row with every foreign key blanked.
 *
 * A fixture that has to satisfy all thirty-odd relationships is a fixture that
 * breaks every time a foreign key is added. This leaves the test to declare only
 * the relationships it is about, and it also proves the optional-FK path: a null
 * reference must be sent as null, not as a stray placeholder string that would
 * fail the constraint on the real database.
 */
function rowWithoutForeignKeys(table) {
  const row = syntheticRow(table);
  for (const ref of fks.get(table) ?? []) row[ref.column] = null;
  return row;
}

// ---------------------------------------------------------------------------
// 3. An in-memory server that enforces every foreign key
// ---------------------------------------------------------------------------

/**
 * A stand-in for PostgREST that keeps rows in memory and refuses to store a row
 * whose foreign key is not already present. That refusal is what turns write
 * ordering into a testable property: if the sync layer sent a lab result before
 * its test order, this throws instead of passing silently.
 */
function fakeServer() {
  const state = new Map(); // table -> Map<keyString, row>
  const ops = [];
  // When set, every write waits on it. Used to hold the queue open long enough
  // to queue a burst behind an in-progress write, which is the only situation
  // the coalescing path exists for.
  let gate = null;

  const table = (name) => {
    if (!state.has(name)) state.set(name, new Map());
    return state.get(name);
  };

  const waitForGate = async () => {
    if (!gate) return;
    await gate.promise;
  };

  const client = {
    from(name) {
      return {
        select: () => ({
          range: async () => ({ data: [...table(name).values()], error: null }),
        }),
        upsert: async (rows, options) => {
          await waitForGate();
          const conflict = (options?.onConflict ?? 'id').split(',').map((c) => c.trim());
          for (const row of rows) {
            for (const ref of fks.get(name) ?? []) {
              const value = row[ref.column];
              if (value === null || value === undefined) continue;
              const parents = [...table(ref.table).values()];
              const found = parents.some(
                (p) => String(p[ref.refColumn]) === String(value),
              );
              if (!found) {
                throw new Error(
                  `foreign key violation: ${name}.${ref.column}='${value}' ` +
                    `has no matching ${ref.table}.${ref.refColumn}`,
                );
              }
            }
            const key = conflict.map((c) => String(row[c])).join('\u0000');
            table(name).set(key, row);
            ops.push({ op: 'upsert', table: name, row });
          }
          return { error: null };
        },
        update: (values) => ({
          eq: async (column, value) => {
            await waitForGate();
            for (const [key, existing] of table(name)) {
              if (String(existing[column]) === String(value)) {
                // A real UPDATE touches only the named columns; the row keeps
                // its other values. This is exactly the property the settle
                // pass relies on - and why it is an UPDATE and not an upsert,
                // whose partial row would erase the NOT NULL foreign keys.
                table(name).set(key, { ...existing, ...values });
                ops.push({ op: 'update', table: name, key, values });
                break;
              }
            }
            return { error: null };
          },
        }),
        delete: () => ({
          in: async (column, values) => {
            await waitForGate();
            for (const value of values) {
              for (const [key, row] of table(name)) {
                if (String(row[column]) === String(value)) {
                  table(name).delete(key);
                  ops.push({ op: 'delete', table: name, key: row.id ?? value });
                }
              }
            }
            return { error: null };
          },
        }),
      };
    },
  };

  return {
    client,
    ops,
    rows: (name) => [...table(name).values()],
    find: (name, id) => [...table(name).values()].find((r) => String(r.id) === String(id)),
    count: (name) => table(name).size,
    /** Hold every subsequent write until the returned function is called. */
    block() {
      let release;
      gate = { promise: new Promise((r) => (release = r)) };
      return () => {
        gate = null;
        release();
      };
    },
  };
}

/**
 * Put a visit in place, creating the patient it belongs to first.
 *
 * Necessary because the fake server enforces foreign keys, which is the whole
 * point of it: a fixture that skipped the parent would be rejected, the same way
 * the database would reject it.
 */
async function seedVisit(server, visitId, patientId) {
  await server.client
    .from('patients')
    .upsert([{ id: patientId, first_name: 'Probe', last_name: 'Patient' }], { onConflict: 'id' });
  await server.client
    .from('visits')
    .upsert([{ id: visitId, patient_id: patientId }], { onConflict: 'id' });
}

// ---------------------------------------------------------------------------
// 4. Conformance: mappers agree with the schema
// ---------------------------------------------------------------------------

section('mapper conformance (model -> row)');

/**
 * Every map and child, flattened, each with a probe model built by reading a
 * synthetic row. The grandchild level is reached too, so lab_results and
 * role_permissions are checked against the schema like everything else.
 */
function allMaps() {
  const out = [];
  const walk = (children, map, prefix) => {
    for (const child of children ?? []) {
      out.push({
        label: `${prefix}.${child.table}`,
        table: child.table,
        map,
        child,
        model: child.rowToModel(syntheticRow(child.table)),
      });
      walk(child.children, map, `${prefix}.${child.table}`);
    }
  };
  for (const map of TABLES) {
    out.push({
      label: map.table,
      table: map.table,
      map,
      model: map.rowToModel(syntheticRow(map.table)),
    });
    walk(map.children, map, map.table);
  }
  return out;
}

for (const { label, table, map, child, model } of allMaps()) {
  const cols = columns.get(table);
  if (!cols) {
    check(`${label}: table exists in the schema`, false, `unknown table ${table}`);
    continue;
  }
  const real = new Set(cols.map((c) => c.name));

  // The row that actually goes on the wire: modelToRow, then the omit list, then
  // the undefined strip. Checking modelToRow alone would miss a column that the
  // mapper sends and applyOmit then removes - which is exactly how the
  // single-row tables were shipping an insert with no primary key.
  const raw = child
    ? child.modelToRow(model, 'PROBE_PARENT')
    : map.modelToRow(model);
  const omit = child ? (child.omit ?? []) : (map.omit ?? []);
  const row = Object.fromEntries(
    Object.entries(raw).filter(
      ([k, v]) => !omit.includes(k) && v !== undefined,
    ),
  );

  const invented = Object.keys(row).filter((k) => !real.has(k));
  check(
    `${label}: no column invented`,
    invented.length === 0,
    invented.length ? `not in ${table}: ${invented.join(', ')}` : undefined,
  );

  // The database rejects a row missing a NOT NULL column with no default, and a
  // browser that sent one would fail at runtime, on one device, at 2am.
  const omitted = cols.filter((c) => c.required && !(c.name in row)).map((c) => c.name);
  check(
    `${label}: every required column is sent`,
    omitted.length === 0,
    omitted.length ? `${table} requires: ${omitted.join(', ')}` : undefined,
  );

  // `undefined` in a PostgREST body is not "absent"; it serialises as null and
  // would overwrite a good value with nothing.
  const undef = Object.keys(row).filter((k) => row[k] === undefined);
  check(
    `${label}: no undefined values reach the wire`,
    undef.length === 0,
    undef.length ? `undefined: ${undef.join(', ')}` : undefined,
  );
}

section('mapper conformance (read direction)');

/**
 * PostgREST sends every NUMERIC as a JSON string so it does not lose precision
 * to a float64 round trip. A mapper that forgets to convert it leaves the model
 * holding "1234.50", and everything downstream then concatenates instead of
 * adding - a total of 1000 + 200 comes out as "1000200". The check round-trips
 * the string through the mapper and looks for a non-numeric back on the wire.
 */
function numericLeftAsString(map, row) {
  const back = map.modelToRow(map.rowToModel(row));
  const bad = [];
  for (const col of columns.get(map.table) ?? []) {
    if (!col.type.startsWith('NUMERIC')) continue;
    if (typeof row[col.name] !== 'string') continue;
    const sent = back[col.name];
    if (typeof sent === 'string' && sent !== String(row[col.name])) {
      bad.push(`${col.name} stayed "${sent}"`);
    }
  }
  return bad;
}

for (const map of TABLES) {
  const row = syntheticRow(map.table);
  let threw = null;
  try {
    map.rowToModel(row);
  } catch (err) {
    threw = err.message;
  }
  check(`${map.table}: rowToModel reads a full row`, !threw, threw);

  if (threw) continue;
  const bad = numericLeftAsString(map, row);
  check(
    `${map.table}: no NUMERIC column is left as a string`,
    bad.length === 0,
    bad,
  );
}

await block('credentials never leave the browser', async () => {
  const users = TABLE_BY_KEY.get(USERS_STORAGE_KEY);
  // Asserted before use, and with a message that says what breaks. auth.ts
  // resolves a session through this same lookup, so a map filed under any other
  // key means every sign-in reports "no staff profile" and every staff change is
  // silently never synced - while the app looks entirely healthy.
  check('the users table map exists under USERS_STORAGE_KEY', Boolean(users));
  check(
    'the users map is filed under the key db.ts persists it under',
    users?.key === USERS_STORAGE_KEY,
    users ? `map is filed under ${JSON.stringify(users.key)}` : 'map not found',
  );
  if (!users) throw new Error('users map missing; the checks below cannot run');

  const row = users.modelToRow(users.rowToModel(syntheticRow('users')));
  check(
    'users row carries no password column',
    !('password' in row),
    Object.keys(row).filter((k) => /pass/i.test(k)).join(', ') || undefined,
  );
  check(
    'users row carries no auth_user_id (Supabase owns it)',
    !('auth_user_id' in row),
  );
  // The self-service reset grant, the same way. It is a permission, granted with
  // `npm run staff:self-reset` and read back by the admin list; nothing the
  // browser does may write it. Checked on the row that goes on the wire rather
  // than on the model, because a model field is harmless on its own - it is the
  // push that would change a locked-out clinician's ability to reset their own
  // password without anybody deciding to.
  check(
    'users row carries no allow_password_reset_email (the database decides it)',
    !('allow_password_reset_email' in row),
  );
  check(
    'and a model that sets it still cannot put it on the wire',
    !('allow_password_reset_email' in users.modelToRow({
      ...users.rowToModel(syntheticRow('users')),
      allowPasswordResetEmail: true,
    })),
  );
  check(
    'while the value is still read back, so the admin list can show who has it',
    users.rowToModel({ ...syntheticRow('users'), allow_password_reset_email: true })
      .allowPasswordResetEmail === true,
  );
  // And it must be dropped by the omit list, not merely absent from modelToRow:
  // a later edit that added it back to the mapper would otherwise ship a grant.
  check(
    'the column is named in the users omit list, so a later mapper cannot ship it',
    (users.omit ?? []).includes('allow_password_reset_email'),
    (users.omit ?? []).join(', ') || 'omit list is empty',
  );

  // Stronger than "the value is blank". The previous build carried
  // `password: ''` on the model, which meant a field existed that any later
  // screen could assign a real password to - and localStorage would keep it.
  // The type no longer has the field, so hydration must not reintroduce it.
  const hydrated = users.rowToModel({ ...syntheticRow('users'), password: 'hunter2' });
  check(
    'a stored password is dropped entirely, not blanked',
    !('password' in hydrated),
    Object.keys(hydrated).filter((k) => /pass/i.test(k)).join(', ') || undefined,
  );

  // The sign-in lookup is an exact, case-insensitive match against this column,
  // and uq_users_email_lower is unique on lower(email). A row written with
  // mixed case would be one the clinician can authenticate as but never find.
  const cases = ['Dr@SolaceMedicares.Com', '  Ngozi@SolaceMedicares.Com  ', 'ALABI@SOLACEMEDICARES.COM'];
  const written = cases.map((e) => users.modelToRow({ ...users.rowToModel(syntheticRow('users')), email: e }).email);
  check(
    'every written staff email is trimmed and lowercased',
    written.every((e) => e === e.trim() && e === e.toLowerCase() && e.length > 0),
    written.join(' | '),
  );
  check(
    'the lowercased form is what the self-test expects to look up',
    written[0] === 'dr@solacemedicares.com' && written[1] === 'ngozi@solacemedicares.com',
    written.join(' | '),
  );
  check(
    'a model with no email does not throw on save',
    users.modelToRow({ ...users.rowToModel(syntheticRow('users')), email: undefined }).email === '',
  );
});

await block('database-owned columns are never sent by the client', async () => {
  const invoices = TABLE_BY_KEY.get('fatclinic_invoices');
  const row = invoices.modelToRow(invoices.rowToModel(syntheticRow('invoices')));
  const leaked = (invoices.dbOwned ?? []).filter((c) => c in row);
  check(
    'invoices row omits subtotal, total, paid_amount, balance, payment_status',
    leaked.length === 0,
    leaked.join(', ') || undefined,
  );
  check('invoices row does send discount', 'discount' in row);

  // The guard must actually fire, not just be present.
  const leaky = {
    ...invoices,
    modelToRow: () => ({ id: 'X', total: 1 }),
  };
  let threw = null;
  try {
    await pushDiff(leaky, [], [{ id: 'X' }], fakeServer().client);
  } catch (err) {
    threw = err.message;
  }
  check(
    'a mapper that sends a database-owned column is rejected',
    !!threw && /recalculated by the database/.test(threw),
    threw ?? 'no error was raised',
  );
});

// ---------------------------------------------------------------------------
// 5. Fidelity: values survive a round trip
// ---------------------------------------------------------------------------

section('fidelity: a model survives model -> row -> model');

/**
 * The model field that a given SQL column feeds.
 *
 * Found by giving the column a different value and seeing which field moves.
 * That keeps the "this field is meant to be dropped" list self-maintaining: a
 * column listed in `omit` or `dbOwned` does not need naming its model field by
 * hand, so adding one cannot make this test drift.
 *
 * The probe value has to suit the column type, or the comparison proves nothing:
 * Number('x') is NaN, which serialises as null, so a numeric column handed a
 * string still registers as a change - but only because the coercion also
 * failed, which is not what is being measured here.
 */
function probeValueFor(type) {
  if (type.startsWith('NUMERIC') || type.startsWith('DOUBLE') || type.startsWith('REAL')) {
    return -987654.321;
  }
  if (type.startsWith('INT') || type.startsWith('SERIAL')) return 4242;
  // FALSE, and not a truthy string. `valueFor` gives every boolean column TRUE,
  // so a truthy probe would coerce back to the same value, the comparison would
  // see no change, and the field would never make it into the skip list below -
  // which would then fail the round trip for any boolean column listed in
  // `omit`. Latent until the first such column existed: users.allow_password_
  // reset_email. A probe has to differ from the value it is probing.
  if (type.startsWith('BOOLEAN')) return false;
  if (type.endsWith('[]')) return ['PROBE_SENTINEL'];
  return 'PROBE_SENTINEL';
}

function modelFieldForColumn(read, table, column) {
  const before = read(syntheticRow(table));
  const row = syntheticRow(table);
  row[column] = probeValueFor(columns.get(table).find((c) => c.name === column).type);
  const after = read(row);
  return Object.keys(after).filter(
    (f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]),
  );
}

for (const { label, table, map, child } of allMaps()) {
  const read = child ? child.rowToModel : map.rowToModel;
  const write = child
    ? (m) => child.modelToRow(m, 'PROBE_PARENT')
    : (m) => map.modelToRow(m);

  const model = read(syntheticRow(table));
  const row = write(model);
  const back = read(row);

  // Fields the database owns, or that are server-managed, are not sent and so
  // cannot come back. Excluding them here is the point: the check that they are
  // never sent is the "no client-computed money column" assertion below.
  // A child's omit list belongs to the child's own table, not the parent's.
  const skip = new Set();
  const dropped = child ? (child.omit ?? []) : [...(map.omit ?? []), ...(map.dbOwned ?? [])];
  for (const column of dropped) {
    // A column can be listed defensively for a table that does not have it; the
    // mapper's applyOmit tolerates that, so this check does too.
    if (!columns.get(table)?.some((c) => c.name === column)) continue;
    for (const field of modelFieldForColumn(read, table, column)) skip.add(field);
  }
  // Nested arrays are the parent's business, not this row's; they are covered by
  // the diff tests below, which write them for real.
  for (const c of child?.children ?? []) skip.add(c.property);
  for (const c of map?.children ?? []) skip.add(c.property);

  // A field the mapper declares it canonicalises is exempt from byte-identity -
  // but only if it actually normalises, which is asserted separately below, so a
  // mapper cannot claim the exemption to silence a real round-trip failure.
  for (const field of map?.normalises ?? []) skip.add(field);

  const lost = [];
  for (const [field, value] of Object.entries(model)) {
    if (skip.has(field) || value === undefined) continue;
    if (typeof value === 'object' && value !== null) continue; // checked below
    const a = JSON.stringify(value);
    const b = JSON.stringify(back[field]);
    if (a !== b) lost.push(`${field}: ${a} -> ${b}`);
  }
  check(`${label}: every scalar field round trips`, lost.length === 0, lost.slice(0, 6));

  // Optional fields are where a round trip usually leaks. A field absent on the
  // way out must not come back as the string "undefined" or a stray 0, which is
  // what `String(undefined)` and a bare `Number(null)` would produce.
  const blank = { ...model };
  for (const field of Object.keys(blank)) {
    if (skip.has(field)) continue;
    if (blank[field] !== undefined && blank[field] !== null) blank[field] = undefined;
  }
  const backAgain = read(write(blank));
  const leaked = Object.entries(backAgain)
    .filter(([f, v]) => v === 'undefined' || v === 'NaN' || v === '[object Object]')
    .map(([f, v]) => `${f} = ${JSON.stringify(v)}`);
  check(`${label}: absent fields do not leak placeholders`, leaked.length === 0, leaked.slice(0, 6));
}

// A `normalises` entry buys a field an exemption from the round-trip check, so
// it has to earn it: the declared field must actually change when given a value
// that needs canonicalising. Otherwise a mapper could list every field it likes
// and the round-trip guarantee would quietly stop existing.
await block('declared normalisers really normalise', async () => {
  const declared = allMaps().filter((m) => !m.child && m.map.normalises?.length);
  check(
    'at least one mapper declares a normaliser (the check is not vacuous)',
    declared.length > 0,
    'if this is genuinely empty, delete this block rather than leave it passing',
  );

  for (const { label, table, map } of declared) {
    const model = map.rowToModel(syntheticRow(table));
    for (const field of map.normalises) {
      // Uppercase and pad, which is enough to trip trim() or toLowerCase().
      const dirty = { ...model, [field]: `  ${String(model[field]).toUpperCase()}  ` };
      const written = map.modelToRow(dirty)[field];
      const isText = typeof written === 'string';
      check(
        `${label}: ${field} is canonicalised on write`,
        isText ? written !== dirty[field] && written === written.trim() : false,
        isText ? `"${dirty[field]}" -> "${written}"` : `wrote ${typeof written}`,
      );
    }
  }

  // And a field the mapper does NOT declare must survive untouched, or the
  // round-trip check would be the only thing noticing clinical text being
  // rewritten.
  const clinical = TABLE_BY_KEY.get('fatclinic_patients');
  const patient = clinical.rowToModel(syntheticRow('patients'));
  const shouted = { ...patient, firstName: '  ada  ', lastName: 'LOVELACE ' };
  const row = clinical.modelToRow(shouted);
  check(
    'patient names are sent exactly as typed, spaces and all',
    row.first_name === '  ada  ' && row.last_name === 'LOVELACE ',
    `first_name=${JSON.stringify(row.first_name)} last_name=${JSON.stringify(row.last_name)}`,
  );
});

await block('fidelity: nested objects are rebuilt, not flattened away', async () => {
  // Consultation.physicalExamination is one nested object in the model and seven
  // columns in the table. If the read side ever stops rebuilding it, every
  // examination on screen silently becomes seven empty strings.
  const map = TABLE_BY_KEY.get('fatclinic_consultations');
  const row = syntheticRow('consultations');
  const model = map.rowToModel(row);
  const exam = model.physicalExamination;
  check(
    'physicalExamination comes back as a nested object',
    !!exam && typeof exam === 'object' && !Array.isArray(exam),
  );
  check(
    'all seven examination fields survive',
    !!exam &&
      exam.general === row.exam_general &&
      exam.cardiovascular === row.exam_cardiovascular &&
      exam.respiratory === row.exam_respiratory &&
      exam.abdomen === row.exam_abdomen &&
      exam.neurological === row.exam_neurological &&
      exam.musculoskeletal === row.exam_musculoskeletal &&
      exam.other === row.exam_other,
    exam,
  );
  check(
    'a missing examination reads as empty strings, not undefined',
    Object.values(map.rowToModel({ ...row, exam_general: null }).physicalExamination).every(
      (v) => typeof v === 'string',
    ),
  );

  // And the unit-suffixed vital signs, which is where a name mismatch would show.
  const vitals = TABLE_BY_KEY.get('fatclinic_vitals');
  const vr = syntheticRow('vitals');
  const v = vitals.rowToModel(vr);
  check(
    'vitals map onto the model field names',
    v.temperature === Number(vr.temperature_c) &&
      v.pulse === Number(vr.pulse_bpm) &&
      v.spo2 === Number(vr.spo2_pct) &&
      v.weight === Number(vr.weight_kg) &&
      v.height === Number(vr.height_m),
    { temperature: v.temperature, pulse: v.pulse, spo2: v.spo2 },
  );

  // Text[] columns must arrive as arrays, not as a Postgres array literal.
  const patients = TABLE_BY_KEY.get('fatclinic_patients');
  check(
    'TEXT[] columns read as arrays',
    Array.isArray(patients.rowToModel(syntheticRow('patients')).allergies) &&
      Array.isArray(patients.rowToModel(syntheticRow('patients')).alerts),
  );
});

// ---------------------------------------------------------------------------
// 6. Diff semantics
// ---------------------------------------------------------------------------

await block('diff: an unchanged save writes nothing', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_patients');
  const patients = [map.rowToModel(rowWithoutForeignKeys('patients'))];
  const server = fakeServer();
  await pushDiff(map, patients, structuredClone(patients), server.client);
  check('no request is issued', server.ops.length === 0, server.ops.slice(0, 3));
});

await block('diff: insert, update and delete are told apart', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_patients');
  const make = (id, firstName) => ({
    ...map.rowToModel(rowWithoutForeignKeys('patients')),
    id,
    firstName,
  });

  const before = [make('P-1', 'Ada'), make('P-2', 'Bo'), make('P-3', 'Cy')];
  const after = [
    make('P-1', 'Ada'), // unchanged
    make('P-2', 'Bohdan'), // updated
    make('P-4', 'Dee'), // inserted
    // P-3 removed
  ];

  const server = fakeServer();
  // The diff premise is that `before` is what the server already holds, so the
  // server is seeded with it. P-1 is unchanged and so is never written - which
  // is the behaviour under test, and the reason it has to be pre-seeded.
  for (const patient of before) {
    await server.client.from('patients').upsert([map.modelToRow(patient)], { onConflict: 'id' });
  }
  server.ops.length = 0;
  await pushDiff(map, before, after, server.client);

  const ids = server.rows('patients').map((r) => String(r.id)).sort();
  check('server ends with P-1, P-2 and P-4', JSON.stringify(ids) === '["P-1","P-2","P-4"]', ids);
  check('P-2 has the new name', server.find('patients', 'P-2')?.first_name === 'Bohdan');
  check('P-3 was deleted', server.count('patients') === 3);
  const written = server.ops.filter((o) => o.op === 'upsert').flatMap((o) => [String(o.row.id)]);
  check('only the changed and new rows are written', JSON.stringify(written.sort()) === '["P-2","P-4"]', written);
});

await block('diff: nested children follow their parent', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_consultations');
  const consultation = map.rowToModel(rowWithoutForeignKeys('consultations'));
  consultation.id = 'CON-1';
  consultation.diagnoses = [
    { id: 'D-1', code: 'A00', description: 'Cholera', type: 'Primary' },
  ];
  const before = [];
  const after = [consultation];

  const server = fakeServer();
  // A visit must exist for the consultation's foreign key.
  await seedVisit(server, 'VISIT-1', 'P-1');

  consultation.visitId = 'VISIT-1';
  consultation.patientId = 'P-1';
  await pushDiff(map, before, after, server.client);

  check('the consultation row was written', server.count('consultations') === 1);
  check('the diagnosis was written', server.count('clinical_diagnoses') === 1);
  check(
    'the diagnosis points at its consultation',
    server.rows('clinical_diagnoses')[0]?.consultation_id === 'CON-1',
  );
  check(
    'diag_type carries the model field `type`',
    server.rows('clinical_diagnoses')[0]?.diag_type === 'Primary',
  );
});

await block('diff: a child that changed but kept its id is still written', async () => {
  // THE DEFECT THIS EXISTS TO CATCH
  // -------------------------------
  // A child was skipped whenever its id was already present on both sides of the
  // diff. Ids do not change when a laboratory test moves along its workflow, so
  // "Sample Collected", "Processing", "Result Entered" and "Released" all saved
  // the request, updated localStorage, showed the new status on screen - and sent
  // no UPDATE. The row in the database kept saying "Requested", with no draw time,
  // no critical-alert flag and no releaser, until the page was reloaded.
  //
  // Everything above it was right: the mapper sent `status`, the column existed,
  // the policy admitted the write. The write simply was not sent, so no amount of
  // checking a mapper or a schema would have found it. This is the check that
  // fails if the comparison goes back to comparing identities.
  const map = TABLE_BY_KEY.get('fatclinic_lab_requests');
  const child = map.children[0];

  const order = (over = {}) => ({
    id: 'LTO-CHILDDIFF',
    requestId: 'LRQ-CHILDDIFF',
    testDefinitionId: 'LAB-HEM-01',
    testName: 'Full Blood Count',
    category: 'HEMATOLOGY',
    price: 15000,
    sampleType: 'EDTA Whole Blood',
    status: 'Requested',
    results: [],
    ...over,
  });
  const request = (tests) => ({
    id: 'LRQ-CHILDDIFF',
    visitId: 'VISIT-1',
    patientId: 'P-1',
    requestedAt: '2026-09-30T07:00:00.000Z',
    priority: 'Routine',
    paymentStatus: 'Paid',
    totalPrice: 15000,
    tests,
  });

  const server = fakeServer();
  await seedVisit(server, 'VISIT-1', 'P-1');
  // The order's foreign key into the catalogue, which the fake server enforces
  // like Postgres does. Seeding the row by hand rather than through pushDiff also
  // keeps the "before" side honest: it is the persisted state, not something this
  // test just wrote.
  await server.client.from('lab_investigations').upsert(
    [{ id: 'LAB-HEM-01', code: 'FBC', name: 'Full Blood Count', category: 'HEMATOLOGY', price: 15000 }],
    { onConflict: 'id' },
  );
  // The scientist, for the same reason: `scientist_id` references `users`, and the
  // fake server would refuse the whole upsert for a foreign key that is a fixture's
  // fault rather than the code under test's.
  await server.client.from('users').upsert(
    [{ id: 'USR-1', name: 'Amaka Obi', email: 'amaka.obi@clinic.test', role: 'LAB_SCIENTIST', active: true }],
    { onConflict: 'id' },
  );
  await server.client.from('lab_requests').upsert(
    [map.modelToRow(request([order()]))],
    { onConflict: 'id' },
  );
  await server.client.from('lab_test_orders').upsert(
    [{ ...child.modelToRow(order(), 'LRQ-CHILDDIFF') }],
    { onConflict: 'id' },
  );
  const before = [request([order()])];

  // Four workflow moves, each with the same order id as the last, driven through
  // `applyStatusChange` exactly as the dashboard drives them - so this covers the
  // composition of the two halves: the rule that decides what a move writes, and
  // the diff that writes it. A move replaces the whole order, so a rule that failed
  // to carry `collectedAt` forward would show up here as a cleared draw time.
  let current = order();
  const moves = [
    ['Sample Collected', {}],
    ['Processing', {}],
    ['Result Entered', { criticalAlert: true }],
    ['Released', { comments: 'Called the physician.' }],
  ];
  let drawnAt = null;
  for (const [status, extra] of moves) {
    const now = `2026-09-30T0${moves.findIndex((m) => m[0] === status) + 8}:15:00.000Z`;
    const next = applyStatusChange(current, status, { user: { id: 'USR-1', name: 'Amaka Obi' }, now, ...extra });
    await pushDiff(map, [request([current])], [request([next])], server.client);
    const row = server.rows('lab_test_orders').find((r) => r.id === 'LTO-CHILDDIFF');
    check(`"${status}" reaches the database`, row?.status === status, String(row?.status));
    if (status === 'Sample Collected') drawnAt = row?.collected_at;
    // The draw time is stamped once. If a later move cleared it, the specimen
    // would have no recorded draw time at the moment the report was released.
    check(`and "${status}" leaves the draw time alone`, row?.collected_at === drawnAt, String(row?.collected_at));
    current = next;
  }

  const final = server.rows('lab_test_orders').find((r) => r.id === 'LTO-CHILDDIFF');
  check('the draw time is recorded', !!final?.collected_at, String(final?.collected_at));
  check('the scientist who took it is on the row', final?.scientist_name === 'Amaka Obi', String(final?.scientist_name));
  check('the critical alert the checkbox raised is on the row', final?.critical_alert === true, String(final?.critical_alert));
  check('the release stamp is there', !!final?.released_at, String(final?.released_at));
  check('the releaser is named', final?.verified_by === 'Amaka Obi', String(final?.verified_by));
  check('the comment is stored', final?.comments === 'Called the physician.', String(final?.comments));
  check('and the order was not duplicated', server.rows('lab_test_orders').length === 1, `${server.rows('lab_test_orders').length} rows`);

  // A save that changes nothing still writes nothing, or every keystroke would
  // become an UPDATE.
  let wrote = 0;
  const spy = async (table) => {
    if (table === 'lab_test_orders') wrote += 1;
    return { error: null };
  };
  const settled = [request([current])];
  await pushDiff(map, settled, settled, { ...server.client, from: spy });
  check('and a save that changes nothing sends no statement', wrote === 0, `${wrote} statements`);
});

await block('diff: a child removed from the model is deleted', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_consultations');
  const base = map.rowToModel(rowWithoutForeignKeys('consultations'));
  base.id = 'CON-2';
  base.visitId = 'VISIT-1';
  base.patientId = 'P-1';
  base.diagnoses = [{ id: 'D-1', code: 'A00', description: 'Cholera', type: 'Primary' }];

  const server = fakeServer();
  await seedVisit(server, 'VISIT-1', 'P-1');
  await pushDiff(map, [], [base], server.client);
  check('diagnosis present after the insert', server.count('clinical_diagnoses') === 1);

  const cleared = { ...base, diagnoses: [] };
  await pushDiff(map, [base], [cleared], server.client);
  check('diagnosis removed when cleared', server.count('clinical_diagnoses') === 0);
  check('the consultation itself is untouched', server.count('consultations') === 1);
});

await block('diff: grandchildren (lab results) insert and delete', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_lab_requests');
  const request = map.rowToModel(rowWithoutForeignKeys('lab_requests'));
  request.id = 'LAB-1';
  request.visitId = 'VISIT-1';
  request.patientId = 'P-1';
  const order = {
    ...map.children[0].rowToModel(rowWithoutForeignKeys('lab_test_orders')),
    id: 'TO-1',
    results: [
      { parameterId: 'PARAM-A', parameterName: 'Haemoglobin', value: '13.4', unit: 'g/dL', referenceRange: '12-16', flag: 'Normal' },
    ],
  };
  request.tests = [order];

  const server = fakeServer();
  await seedVisit(server, 'VISIT-1', 'P-1');
  await pushDiff(map, [], [request], server.client);

  check('the lab request was written', server.count('lab_requests') === 1);
  check('the test order was written', server.count('lab_test_orders') === 1);
  check('the result was written', server.count('lab_results') === 1);
  check(
    'the result id is the composite <test_order_id>::<parameter_id>',
    server.rows('lab_results')[0]?.id === 'TO-1::PARAM-A',
    server.rows('lab_results')[0]?.id,
  );
  check(
    'the result points at its test order',
    server.rows('lab_results')[0]?.test_order_id === 'TO-1',
  );

  // This is the case a grandchild diff gets wrong when it is handed `undefined`
  // as the prior state: the cleared result silently stays on the server.
  const cleared = { ...request, tests: [{ ...order, results: [] }] };
  await pushDiff(map, [request], [cleared], server.client);
  check('a cleared result is deleted', server.count('lab_results') === 0);
  check('the test order survives', server.count('lab_test_orders') === 1);
});

await block('diff: append-only tables are never rewritten or pruned', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_audit_logs');
  const make = (id, details) => ({ ...map.rowToModel(rowWithoutForeignKeys('audit_logs')), id, details });

  const server = fakeServer();
  const before = [make('LOG-1', 'original')];
  const after = [
    make('LOG-1', 'rewritten by a tamper attempt'),
    make('LOG-2', 'a new entry'),
  ];
  // The entry has to be on the server already, because the only way in is the
  // same append-only path being tested. Seeding it directly is the honest setup:
  // the claim under test is what a *second* save does to it.
  await server.client
    .from('audit_logs')
    .upsert([map.modelToRow(before[0])], { onConflict: 'id' });
  server.ops.length = 0;
  await pushDiff(map, before, after, server.client);

  check('the new entry is written', server.count('audit_logs') === 2);
  check(
    'an existing entry is not modified',
    server.find('audit_logs', 'LOG-1')?.details === 'original',
    server.find('audit_logs', 'LOG-1')?.details,
  );
  check(
    'no update reaches the append-only table',
    server.ops.filter((o) => o.table === 'audit_logs').length === 1,
  );

  // And a removal is ignored rather than attempted: there is no policy for it
  // and trg_audit_immutable would raise.
  const opsBefore = server.ops.length;
  await pushDiff(map, after, [make('LOG-2', 'a new entry')], server.client);
  check(
    'a removal is not attempted',
    server.ops.length === opsBefore && server.count('audit_logs') === 2,
    server.ops.slice(opsBefore),
  );
});

await block('diff: invoices leave the arithmetic to the database', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_invoices');
  const make = (discount) => {
    const invoice = map.rowToModel(rowWithoutForeignKeys('invoices'));
    invoice.id = 'INV-1';
    invoice.visitId = 'VISIT-1';
    invoice.patientId = 'P-1';
    invoice.discount = discount;
    invoice.items = [
      { id: 'IT-1', serviceCategory: 'Laboratory', description: 'PCV', quantity: 1, unitPrice: 1000, totalPrice: 1000 },
    ];
    invoice.payments = [
      { id: 'PAY-1', receiptNumber: 'RCP-1', paidAt: '2026-03-04T09:30:00.000Z', amount: 400, paymentMethod: 'Cash', receivedBy: 'Cashier' },
    ];
    return invoice;
  };

  const server = fakeServer();
  await seedVisit(server, 'VISIT-1', 'P-1');

  await pushDiff(map, [], [make(0)], server.client);
  const row = server.find('invoices', 'INV-1');
  check('the invoice row was written', !!row);
  check('line items were written', server.count('invoice_items') === 1);
  check('the payment was written', server.count('payments') === 1);
  check(
    'no client-computed money column is sent',
    !('total' in row) && !('subtotal' in row) && !('balance' in row) && !('paid_amount' in row) && !('payment_status' in row),
    Object.keys(row).join(', '),
  );
  check('the item points at its invoice', server.rows('invoice_items')[0]?.invoice_id === 'INV-1');
  check('the payment points at its invoice', server.rows('payments')[0]?.invoice_id === 'INV-1');

  // A discount is clamped to the subtotal by the trigger, so it has to be
  // re-asserted after the line items land. Without the settle pass the discount
  // is clamped away and never comes back.
  //
  // Every write is counted, not only the upserts. The settle pass is a plain
  // UPDATE by design - see the block below - so an extra settle on insert shows
  // up as an `update` and was invisible to a count that looked only at `upsert`.
  // That made the defect "the settle pass also runs on insert" undetectable: it
  // was declared in scripts/sync-defects.mjs, injected on every run, and nothing
  // failed. The gap was in the assertion, not in the code.
  const writes = server.ops.filter((o) => o.table === 'invoices');
  check(
    'the invoice is written once on insert, with no settle pass behind it',
    writes.length === 1,
    `${writes.length}: ${writes.map((o) => o.op).join(', ')}`,
  );
  check('and the one write is the insert', writes.length === 1 && writes[0].op === 'upsert', writes[0]?.op);
});

await block('diff: settle re-asserts discount on UPDATE, never an upsert', async () => {
  // Regression: the settle pass used to send `{id, discount}` through an upsert.
  // `INSERT ... ON CONFLICT (id) DO UPDATE` checks every NOT NULL column on the
  // insert branch, so the row was rejected with `null value in column
  // "visit_id"` - even though the invoice already existed. The doctor's save was
  // refused on every visit that had an invoice, and the header badge lit up.
  //
  // The settle pass must be a plain UPDATE: it touches only discount, leaves
  // visit_id/patient_id intact, and cannot clobber a concurrent edit.
  const map = TABLE_BY_KEY.get('fatclinic_invoices');
  const make = (discount, totalLine) => {
    const invoice = map.rowToModel(rowWithoutForeignKeys('invoices'));
    invoice.id = 'INV-S1';
    invoice.visitId = 'VISIT-S1';
    invoice.patientId = 'P-S1';
    invoice.discount = discount;
    invoice.items = [
      { id: 'IT-S1', serviceCategory: 'Laboratory', description: 'PCV', quantity: 1, unitPrice: 1000, totalPrice: totalLine },
    ];
    invoice.payments = [];
    return invoice;
  };

  const server = fakeServer();
  await seedVisit(server, 'VISIT-S1', 'P-S1');

  await pushDiff(map, [], [make(0, 1000)], server.client);
  check('the invoice exists after insert', !!server.find('invoices', 'INV-S1'));

  // Now the line item changes (say, a price correction) and the discount is
  // non-zero, so a settle is required. The invoice already exists, so this is
  // the update path the old code broke.
  await pushDiff(map, [make(0, 1000)], [make(200, 1500)], server.client);

  const ops = server.ops.filter((o) => o.table === 'invoices');
  const upserts = ops.filter((o) => o.op === 'upsert');
  const updates = ops.filter((o) => o.op === 'update');
  check('the second write is an UPDATE', updates.length >= 1, ops.map((o) => o.op).join(','));
  check('no partial-row upsert follows the update', upserts.every((o) => o.row.visit_id && o.row.patient_id));
  const finalRow = server.find('invoices', 'INV-S1');
  check('the settle keeps the foreign keys', finalRow.visit_id === 'VISIT-S1' && finalRow.patient_id === 'P-S1', JSON.stringify(finalRow));
  check('the discount was re-asserted', finalRow.discount === 200, finalRow.discount);
});

// ---------------------------------------------------------------------------
// 7. Write ordering
// ---------------------------------------------------------------------------

await block('write ordering satisfies every foreign key', async () => {
  // The fake server raises on a dangling reference, so a run that completes has
  // proven the ordering for all 34 tables it touched. Driven with a full lab
  // request, which spans visits -> requests -> test orders -> results.
  const map = TABLE_BY_KEY.get('fatclinic_lab_requests');
  const request = map.rowToModel(rowWithoutForeignKeys('lab_requests'));
  request.id = 'LAB-9';
  request.visitId = 'VISIT-9';
  request.patientId = 'P-9';
  const order = {
    ...map.children[0].rowToModel(rowWithoutForeignKeys('lab_test_orders')),
    id: 'TO-9',
    results: [
      { parameterId: 'P1', parameterName: 'a', value: '1', unit: 'u', referenceRange: 'r', flag: 'Normal' },
    ],
  };
  request.tests = [order];

  const server = fakeServer();
  await seedVisit(server, 'VISIT-9', 'P-9');
  let threw = null;
  try {
    await pushDiff(map, [], [request], server.client);
  } catch (err) {
    threw = err.message;
  }
  check('a nested insert never dangles', !threw, threw);
  check('all four levels landed', server.count('lab_results') === 1 && server.count('lab_test_orders') === 1 && server.count('lab_requests') === 1);
});

// ---------------------------------------------------------------------------
// 8. Single-row tables
// ---------------------------------------------------------------------------

await block('single-row tables are written as one row', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_receipt_settings');
  const settings = map.rowToModel(rowWithoutForeignKeys('receipt_settings'));
  const server = fakeServer();
  await pushDiff(map, { ...settings, hospitalName: 'Old' }, settings, server.client);
  check('exactly one row is written', server.count('receipt_settings') === 1);
  check('it is pinned to id 1', server.rows('receipt_settings')[0]?.id === 1);
  check('the new value is stored', server.rows('receipt_settings')[0]?.hospital_name === settings.hospitalName);
});

// ---------------------------------------------------------------------------
// 9. The write queue
// ---------------------------------------------------------------------------

await block('write queue: a burst behind an in-progress write coalesces into one', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_patients');
  const make = (id, firstName) => ({
    ...map.rowToModel(rowWithoutForeignKeys('patients')),
    id,
    firstName,
  });

  // The server holds P-1 and P-2. A clinician edits P-1 on a slow connection and
  // saves, then edits again and saves before the first write has come back.
  const server = fakeServer();
  for (const p of [make('P-1', 'Original'), make('P-2', 'Untouched')]) {
    await server.client.from('patients').upsert([map.modelToRow(p)], { onConflict: 'id' });
  }
  server.ops.length = 0;

  const release = server.block();
  queueDiff(map, [make('P-1', 'Original'), make('P-2', 'Untouched')], [make('P-1', 'First edit'), make('P-2', 'Untouched')], server.client);
  // Let the drain start and block inside the first upsert.
  await Promise.resolve();
  queueDiff(map, [make('P-1', 'First edit'), make('P-2', 'Untouched')], [make('P-1', 'Second edit'), make('P-2', 'Untouched')], server.client);
  queueDiff(map, [make('P-1', 'Second edit'), make('P-2', 'Untouched')], [make('P-1', 'Third edit'), make('P-2', 'Untouched')], server.client);
  release();

  await whenDrained();

  // One write for the save already in progress, one for the burst of two behind
  // it. The point is that the second write is not repeated once per keystroke-
  // interrupted save.
  const writes = server.ops.filter((o) => o.table === 'patients' && o.op === 'upsert');
  check('three saves produce two writes, not three', writes.length === 2, writes.length);
  check(
    'the final value is the one stored',
    server.find('patients', 'P-1')?.first_name === 'Third edit',
    server.find('patients', 'P-1')?.first_name,
  );
  check(
    'the untouched row is not re-sent by the coalesced write',
    writes[1] && writes[1].row.id === 'P-1',
    writes.map((w) => w.row.id),
  );
  check('nothing is left pending', pendingKeys().length === 0, pendingKeys());
});

await block('write queue: a row in flight is protected from being overwritten', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_patients');
  const patient = {
    ...map.rowToModel(rowWithoutForeignKeys('patients')),
    id: 'P-77',
    firstName: 'Saved While Offline',
  };

  const server = fakeServer();
  queueDiff(map, [], [patient], server.client);

  // db.ts asks this before adopting a server value, precisely so a clinician's
  // unsaved entry is not replaced the moment connectivity returns.
  check('the row is reported as in flight immediately', isInFlight(map.key, 'P-77'));
  check(
    'a different row in the same collection is not',
    !isInFlight(map.key, 'P-78'),
  );

  await whenDrained();
  check('the row is released once written', !isInFlight(map.key, 'P-77'));
  check('the row reached the server', server.find('patients', 'P-77') !== undefined);
});

await block('write queue: a rejected write is logged, not thrown into the UI', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_patients');
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const server = fakeServer();
    // A constraint violation is what the real database returns for a bad value.
    server.client.from = () => ({
      select: () => ({ range: async () => ({ data: [], error: null }) }),
      upsert: async () => ({ error: { message: 'violates not-null constraint' } }),
      delete: () => ({ in: async () => ({ error: null }) }),
    });
    queueDiff(map, [], [{ id: 'P-88', firstName: 'Rejected' }], server.client);
    await whenDrained();
  } finally {
    console.error = original;
  }
  check('the failure was reported', logged.length > 0, logged);
  check(
    'a permanent failure says retrying will not help',
    logged.some((l) => /retrying will not help/.test(l)),
    logged,
  );
  check('the queue is empty afterwards', pendingKeys().length === 0);
});

await block('a blank optional value reaches Postgres as NULL, never as ""', async () => {
  // The consultation that could not be saved. The form only sets a follow-up
  // date if the doctor fills the box in, so '' is the ordinary case, and an
  // upsert is one request: sending it as '' voided the complaint, the
  // examination, the diagnoses and the plan along with it.
  const map = TABLE_BY_KEY.get('fatclinic_consultations');
  const sent = [];
  const client = {
    from: () => ({
      select: () => ({ range: async () => ({ data: [], error: null }) }),
      upsert: async (rows) => {
        sent.push(...rows);
        return { error: null };
      },
      delete: () => ({ in: async () => ({ error: null }) }),
    }),
  };
  const model = {
    id: 'C-1',
    visitId: 'V-1',
    patientId: 'P-1',
    physicianId: 'U-1',
    physicianName: 'Dr Test',
    consultationDate: '2026-01-02T03:04:05.000Z',
    presentingComplaint: 'Fever',
    physicalExamination: { general: 'g' },
    diagnoses: [],
    followUpDate: '',
    plan: '',
  };
  await pushDiff(map, [], [model], client);
  const row = sent.find((r) => r.id === 'C-1');
  check('the row was written', !!row, sent);
  check(
    'an unset follow-up date is NULL, not an empty string',
    row?.follow_up_date === null,
    `follow_up_date = ${JSON.stringify(row?.follow_up_date)}`,
  );
  check(
    'a NOT NULL text column the model leaves blank is still an empty string',
    row?.plan === '' && row?.assessment === '',
    `plan = ${JSON.stringify(row?.plan)}, assessment = ${JSON.stringify(row?.assessment)}`,
  );
  check(
    'a blank exam section is still an empty string, because that column is NOT NULL',
    row?.exam_general === 'g' && row?.exam_cardiovascular === '',
    `exam_general = ${JSON.stringify(row?.exam_general)}, exam_cardiovascular = ${JSON.stringify(row?.exam_cardiovascular)}`,
  );
  check(
    'a real follow-up date is still sent as written',
    (await (async () => {
      sent.length = 0;
      await pushDiff(map, [], [{ ...model, id: 'C-2', followUpDate: '2026-03-04' }], client);
      return sent.find((r) => r.id === 'C-2')?.follow_up_date;
    })()) === '2026-03-04',
  );
});

await block('a value Postgres cannot parse is refused here, by name', async () => {
  // 47 numeric columns are NOT NULL and written straight from the model, so a
  // cleared box reaches them as NaN. The database's own complaint names neither
  // the column nor the screen, which is how a lost record went unreported.
  const map = TABLE_BY_KEY.get('fatclinic_vitals');
  const client = { from: () => { throw new Error('the request must never be built'); } };
  let threw = null;
  try {
    await pushDiff(map, [], [{ id: 'V-9', visitId: 'V-1', patientId: 'P-1', weight: NaN }], client);
  } catch (err) {
    threw = err.message;
  }
  check(
    'a non-finite number is refused before the request is built',
    !!threw && /vitals\.weight/.test(threw),
    threw ?? 'no error was raised',
  );
  check(
    'the refusal says what to do about it',
    !!threw && /fill the field in and save again/.test(threw),
    threw ?? 'no error was raised',
  );
});

await block('a refused write is visible to the clinician, not just the console', async () => {
  // The header's "unsaved" badge counts the queue, and the queue is drained by
  // shifting an entry off it before the request is awaited. So a write in flight
  // and a write the database has already refused both read as "nothing
  // pending", and the badge stayed green over a record that did not exist.
  const map = TABLE_BY_KEY.get('fatclinic_patients');
  const original = console.error;
  console.error = () => {};
  // An earlier block deliberately provokes a refusal on this same collection, and
  // a refusal is recorded per collection with the newest winning, so the count
  // is cleared here rather than reasoned about.
  clearSyncFailures();
  try {
    const server = fakeServer();
    server.client.from = () => ({
      select: () => ({ range: async () => ({ data: [], error: null }) }),
      upsert: async () => ({ error: { message: 'violates not-null constraint' } }),
      delete: () => ({ in: async () => ({ error: null }) }),
    });
    queueDiff(map, [], [{ id: 'P-91', firstName: 'Refused' }], server.client);
    await whenDrained();
  } finally {
    console.error = original;
  }
  const failures = syncFailures();
  check('the refusal is recorded', failures.length === 1, failures.map((f) => f.key));
  const mine = failures.find((f) => f.key === 'fatclinic_patients');
  check('it names the table a clinician would recognise', mine?.table === 'patients', mine);
  check('it keeps the database message verbatim', /not-null/.test(mine?.message ?? ''), mine?.message);
  check('it is marked as not worth retrying', mine?.permanent === true, mine);

  // A later success on the same collection clears it, so the warning cannot
  // outlive its cause and train a clinician to ignore the badge.
  const original2 = console.error;
  console.error = () => {};
  try {
    queueDiff(map, [], [{ id: 'P-92', firstName: 'Accepted' }], fakeServer().client);
    await whenDrained();
  } finally {
    console.error = original2;
  }
  check(
    'a successful retry clears the warning',
    !syncFailures().some((f) => f.key === 'fatclinic_patients'),
    syncFailures().map((f) => f.key),
  );
});

await block('write queue: nothing is queued without a client', async () => {
  const map = TABLE_BY_KEY.get('fatclinic_patients');
  const before = pendingKeys().length;
  queueDiff(map, [], [{ id: 'P-99' }], null);
  check('a null client is a no-op, for local-only mode', pendingKeys().length === before);
});

// ---------------------------------------------------------------------------
// 16. The remembered past has to be a copy
// ---------------------------------------------------------------------------
//
// The worst bug in this file, and it produced no error of any kind.
//
// A save is handed a collection, and the sync layer needs to know what that
// collection looked like before the change in order to work out what to send. So
// the layer above remembers it. It used to remember the caller's own array, and
// `db.saveConsultation` updates an existing consultation with
// `this.consultations[i] = updated` - mutating that very array.
//
// So the second save of a consultation compared the new value against itself,
// found no change, and sent nothing. Not a rejected row, not a slow network: no
// request at all. The form reported "Saved!", the entry stayed in the list, and
// the record kept the first version for good. A doctor who corrected a
// complaint after the first save had no way to learn that their correction went
// nowhere.
//
// The first save worked, which is what made it so hard to see: a new consultation
// replaces the array (`this.consultations = [result, ...]`), so the remembered
// past stayed intact. Only the second and later saves were lost.

await block('editing a row in place is still a change', async () => {
  const server = fakeServer();
  const map = TABLE_BY_KEY.get('fatclinic_consultations');
  const KEY = 'fatclinic_consultations';
  forgetPersisted(KEY);

  // The live array the app holds, exactly as `db` holds it: a real array of real
  // objects, mutated in place.
  await seedVisit(server, 'VIS-ALIAS', 'PAT-ALIAS');
  const original = map.rowToModel(rowWithoutForeignKeys('consultations'));
  original.id = 'CON-ALIAS';
  original.visitId = 'VIS-ALIAS';
  original.patientId = 'PAT-ALIAS';
  original.presentingComplaint = 'the first version';
  const held = [original];

  // The first save, on a visit with no consultation yet: a brand new row. This
  // is `saveStorage`: persist to disk, read the past, diff, then record the
  // collection as the new past. The order matters - without that last
  // `recordPersisted`, the second save below has no past to compare against and
  // the aliasing never gets the chance to show itself.
  recordPersisted(KEY, []);
  await pushDiff(map, [], held, server.client);
  recordPersisted(KEY, held);
  check('the first save reaches the server', server.find('consultations', 'CON-ALIAS')?.presenting_complaint === 'the first version');

  // The second save, and this is the line that matters: an in-place assignment on
  // the array `recordPersisted` was just handed. `saveConsultation` writes
  // `this.consultations[existingIndex] = result`, which is this.
  held[0] = { ...held[0], presentingComplaint: 'the corrected version' };
  const before = persistedBefore(KEY);
  recordPersisted(KEY, held);
  await pushDiff(map, before, held, server.client);

  check(
    'the corrected text reaches the server',
    server.find('consultations', 'CON-ALIAS')?.presenting_complaint === 'the corrected version',
    `server holds ${JSON.stringify(server.find('consultations', 'CON-ALIAS')?.presenting_complaint)}`,
  );

  // The remembered past is re-recorded by the save, so it is the corrected text
  // once the save has happened. What matters is the diff *above*, which read the
  // past as it was before the save.
  check(
    'and the past is re-recorded to the text just saved',
    persistedBefore(KEY)?.[0]?.presentingComplaint === 'the corrected version',
    JSON.stringify(persistedBefore(KEY)),
  );
  forgetPersisted(KEY);
});

await block('the remembered past survives an in-place edit', async () => {
  const KEY = 'probe-collection';
  forgetPersisted(KEY);
  const arr = [{ id: 'a', value: 'before' }];
  recordPersisted(KEY, arr);
  arr[0].value = 'after';
  arr.push({ id: 'b', value: 'new' });
  check('an edit to a remembered row does not rewrite the past', persistedBefore(KEY)?.[0]?.value === 'before', JSON.stringify(persistedBefore(KEY)));
  check('a row appended afterwards is not in the past either', (persistedBefore(KEY) ?? []).length === 1, JSON.stringify(persistedBefore(KEY)));

  // The mutation that a shallow copy would miss: a nested object, edited in place.
  const nested = [{ id: 'a', physicalExamination: { general: 'Febrile' } }];
  recordPersisted(KEY, nested);
  nested[0].physicalExamination.general = 'Afebrile';
  check(
    'a nested value edited in place does not rewrite the past',
    persistedBefore(KEY)?.[0]?.physicalExamination?.general === 'Febrile',
    JSON.stringify(persistedBefore(KEY)),
  );
  forgetPersisted(KEY);
});

await block('a collection that was never persisted has no past', async () => {
  const KEY = 'never-seen';
  forgetPersisted(KEY);
  check('an unknown key reads as undefined, not as an empty collection', persistedBefore(KEY) === undefined, String(persistedBefore(KEY)));
  // The value itself is handed back untouched, so a caller still gets the object
  // it just gave us.
  const arr = [{ id: 'x' }];
  recordPersisted(KEY, arr);
  check('but recording and reading back the same key works', persistedBefore(KEY)?.[0]?.id === 'x');
  check('and it is a copy, so the caller\'s object is not what comes back', persistedBefore(KEY) !== arr);
  forgetPersisted(KEY);
});

await block('a number the column\'s own CHECK would reject is refused here, by name', async () => {
  // `quantity > 0` and `price >= 0` are declared on invoice lines, prescription
  // items, payments and stock requests. An insert is one request, so a single
  // zero voided the whole row while the screen reported success - the same
  // mechanism as the NaN refusal above, one step further out. The form that
  // collects these figures does not range-check them, so this is the only guard.
  const patients = TABLE_BY_KEY.get('fatclinic_patients');
  const invoices = TABLE_BY_KEY.get('fatclinic_invoices');
  const patientOf = (age) => ({ ...patients.rowToModel(rowWithoutForeignKeys('patients')), id: 'P-90', age });
  const invoiceOf = (quantity, unitPrice = 1000) => {
    const invoice = invoices.rowToModel(rowWithoutForeignKeys('invoices'));
    invoice.id = 'INV-90';
    invoice.visitId = 'V-90';
    invoice.patientId = 'P-90';
    invoice.items = [
      { id: 'IT-90', serviceCategory: 'Laboratory', description: 'PCV', quantity, unitPrice, totalPrice: unitPrice * quantity },
    ];
    return invoice;
  };
  /** Refuses at the first network call, so a refusal cannot be an aborted send. */
  const noRequests = { from: () => { throw new Error('the request must never be built'); } };
  const refuse = async (fn) => { try { await fn(); return null; } catch (err) { return err.message; } };

  const tooOld = await refuse(() => pushDiff(patients, [], [patientOf(131)], noRequests));
  check('a figure past the column\'s range is refused before the request is built', !!tooOld && /patients\.age/.test(tooOld), tooOld ?? 'no error was raised');
  check('the refusal states the range the column accepts', !!tooOld && /\b0 to 130\b/.test(tooOld), tooOld ?? 'no error was raised');
  const negative = await refuse(() => pushDiff(patients, [], [patientOf(-1)], noRequests));
  check('and the same for the other end of it', !!negative && /patients\.age/.test(negative), negative ?? 'no error was raised');

  // A child is written after its parent, so the parent has to be allowed through
  // for the line to be reached. Refusing every table here would prove nothing
  // about the child: the parent upsert would fail first, for the wrong reason.
  const beforeChild = {
    from: (table) => {
      if (table === 'invoice_items') throw new Error('the request must never be built');
      const ok = async () => ({ data: null, error: null });
      return { upsert: ok, delete: ok, select: ok };
    },
  };
  const noQuantity = await refuse(() => pushDiff(invoices, [], [invoiceOf(0)], beforeChild));
  check('a zero-quantity line refuses the invoice it belongs to', !!noQuantity && /invoice_items\.quantity/.test(noQuantity), noQuantity ?? 'no error was raised');
  check('and says what the column accepts', !!noQuantity && /greater than 0/.test(noQuantity), noQuantity ?? 'no error was raised');

  // The bound is quoted the way the constraint states it, and a one-sided range
  // has to say so. Printing both fields unconditionally produces "0 to undefined"
  // for every `price >= 0` in the schema, which reads as a broken app rather than
  // as a wrong figure - the one thing the message must not do.
  const negativePrice = await refuse(() => pushDiff(invoices, [], [invoiceOf(1, -50)], beforeChild));
  check(
    'a one-sided range is quoted as one-sided, not as "0 to undefined"',
    !!negativePrice && /invoice_items\.unit_price is -50, and that column accepts 0 or more/.test(negativePrice),
    negativePrice ?? 'no error was raised',
  );
  check('and never names a bound the schema does not have', !/undefined/.test(negativePrice ?? ''), negativePrice ?? 'no error was raised');

  // The other direction: a figure at the boundary is legitimate and must go
  // through, or the guard is refusing a patient rather than a mistake.
  const server = fakeServer();
  await pushDiff(patients, [], [patientOf(0)], server.client);
  await pushDiff(patients, [], [patientOf(130)], server.client);
  check('a figure at each end of the range is written', server.find('patients', 'P-90')?.age === 130, server.find('patients', 'P-90')?.age);
  await seedVisit(server, 'V-90', 'P-90');
  await pushDiff(invoices, [], [invoiceOf(1)], server.client);
  check('and a line at the lowest allowed quantity is written', server.count('invoice_items') === 1, server.count('invoice_items'));
});

await block('every guarded range is a range the schema states', async () => {
  // The boundary guard and the schema are two transcriptions of the same CHECK
  // constraints, which is exactly the setup where a quiet drift hides: a bound
  // widened here stops the database refusing a row, and a bound narrowed here
  // starts refusing a legitimate one, with the schema able to prove neither.
  const numericChecks = new Map(); // 'table.column' -> { min?, max?, positiveOnly? }
  let tablesRead = 0;
  for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const [, table, body] = match;
    tablesRead++;
    for (const line of splitTopLevel(stripLineComments(body))) {
      // Table-level constraints, and the `IN (...)` picklists the forms feed from
      // a <select> - both are constrained by something other than a number typed.
      if (/^CONSTRAINT\b/i.test(line)) continue;
      const between = line.match(/^(\w+)\s+.*?\bCHECK\s*\(\s*\w+\s+BETWEEN\s+(\S+)\s+AND\s+(\S+)\s*\)\s*$/i);
      if (between) {
        numericChecks.set(`${table}.${between[1]}`, { min: Number(between[2]), max: Number(between[3]) });
        continue;
      }
      const bound = line.match(/^(\w+)\s+.*?\bCHECK\s*\(\s*\w+\s*(>=|>)\s*(\S+?)\s*\)\s*$/i);
      if (bound) {
        numericChecks.set(
          `${table}.${bound[1]}`,
          bound[2] === '>' ? { positiveOnly: true } : { min: Number(bound[3]) },
        );
      }
    }
  }
  // A canary against a silently-empty extractor, which would otherwise make every
  // check below pass for the wrong reason. The count is deliberately not pinned to
  // a number: a CHECK added to the schema is meant to fail the completeness check
  // with a message that names the column, not a total that does not.
  check(
    'the whole schema was scanned for numeric CHECK constraints',
    tablesRead === 34 && numericChecks.size > 40,
    `${tablesRead} tables, ${numericChecks.size} constraints`,
  );

  for (const [key, rule] of Object.entries(COLUMN_RANGES)) {
    const declared = numericChecks.get(key);
    check(`the schema states a numeric CHECK for ${key}`, declared !== undefined, `no numeric CHECK found for ${key}`);
    if (!declared) continue;
    const same = rule.positiveOnly
      ? declared.positiveOnly === true
      : declared.min === rule.min && declared.max === rule.max;
    check(`${key} is guarded by exactly the range the schema states`, same, `guard ${JSON.stringify(rule)}, schema ${JSON.stringify(declared)}`);
  }

  // Completeness is the half a per-entry check cannot give: a new CHECK added to
  // the schema with no matching guard is a column the boundary passes straight on
  // to a rejection nobody can read. The two exemptions are derived from the code,
  // not restated - a third list of "these are the ones I skipped" is how this rots.
  const dbOwned = new Set();
  for (const map of TABLES) {
    for (const column of map.dbOwned ?? []) dbOwned.add(`${map.table}.${column}`);
    for (const child of map.children ?? []) {
      for (const column of child.dbOwned ?? []) dbOwned.add(`${child.table}.${column}`);
    }
  }
  const exempt = (key) => key.startsWith('vitals.') || dbOwned.has(key);
  const unguarded = [...numericChecks.keys()].filter((key) => !(key in COLUMN_RANGES) && !exempt(key));
  check('every numeric CHECK that can reach the client is guarded at the boundary', unguarded.length === 0, unguarded.join(', '));
  check(
    'and nothing is guarded that the schema does not constrain',
    Object.keys(COLUMN_RANGES).every((key) => numericChecks.has(key)),
    Object.keys(COLUMN_RANGES).filter((key) => !numericChecks.has(key)).join(', '),
  );

  // The exemption is deliberate and stated in the source: vitals is checked in the
  // nursing form, where the refusal can name the field and ask for it again.
  const { checkVitals } = await import('../src/services/vitalsLimits.ts');
  check('vitals is left to the form, which is the only place that can re-ask', !Object.keys(COLUMN_RANGES).some((key) => key.startsWith('vitals.')));
  check(
    'and the form really does check it',
    checkVitals({ temperature: 22, systolicBp: 120, diastolicBp: 80, pulse: 72, respiratoryRate: 16, spo2: 98, weight: 70, height: 1.7 }).length > 0,
  );
});

// ---------------------------------------------------------------------------
// 18. The laboratory catalogue
// ---------------------------------------------------------------------------
//
// A Full Blood Count is sixteen analytes. It was being recorded in one free-text
// box, and the reason was not in the screen: the panel it should have been
// recorded against was empty in the database, while a different copy of the panel
// sat in src/services/seedData.ts. Nine investigations were seeded from that file
// and five from the schema, and where both claimed the same id the first to arrive
// won - so FBC was in the database with no parameters at all.
//
// The screen could only offer what it had, so it offered one box. Nothing
// complained: no error, no rejected row, a clean "Result Entered". An empty panel
// is invisible, which is what makes it dangerous.
//
// So the catalogue is checked like everything else here, against the same rule -
// the schema file is the truth, and the browser's copy has to match it.

const { readCatalogueSeed, boundsIn } = await import('./lab-catalogue-seed.mjs');
const { initialLabInvestigations } = await import('../src/services/seedData.ts');
const {
  buildRows,
  canRelease,
  criticalRows,
  enteredCount,
  enteredRows,
  flagForValue,
  panelFor,
  statusAuditDetail,
} = await import('../src/services/labResults.ts');

const catalogue = readCatalogueSeed(sql);

await block('every investigation in the catalogue has a panel', () => {
  const bare = catalogue.filter((i) => i.parameters.length === 0).map((i) => i.id);
  check('no investigation is left without a panel', bare.length === 0, bare.join(', '));
  check(
    'a Full Blood Count is a full blood count',
    (catalogue.find((i) => i.code === 'FBC')?.parameters.length ?? 0) >= 14,
    `FBC has ${catalogue.find((i) => i.code === 'FBC')?.parameters.length ?? 0} analytes`,
  );
  const categories = new Set(catalogue.map((i) => i.category));
  check(
    'every department the schema allows is represented',
    ['HEMATOLOGY', 'MICROBIOLOGY', 'CHEMICAL_PATHOLOGY', 'HISTOPATHOLOGY', 'MOLECULAR'].every((c) => categories.has(c)),
    [...categories].join(', '),
  );
});

await block('a parameter is identified by the panel it belongs to', () => {
  // lab_parameters.id is the primary key, so a bare `p_sodium` could belong to
  // exactly one investigation - which would mean serum creatinine could not
  // appear on both the renal profile and the electrolytes panel. Prefixing each id
  // with its investigation is what makes one analyte reusable.
  const misfiled = catalogue
    .flatMap((i) => i.parameters.map((p) => ({ id: p.id, of: i.id })))
    .filter((p) => !p.id.startsWith(`${p.of}.`));
  check('every parameter id is namespaced by its investigation', misfiled.length === 0, misfile(misfiled));

  const seen = new Map();
  const clashes = [];
  for (const inv of catalogue) {
    for (const p of inv.parameters) {
      if (seen.has(p.id)) clashes.push(`${p.id}: ${seen.get(p.id)} and ${inv.id}`);
      seen.set(p.id, inv.id);
    }
  }
  check('and no two panels claim the same parameter id', clashes.length === 0, clashes.join(', '));

  const disordered = catalogue.filter(
    (i) => new Set(i.parameters.map((p) => p.sortOrder)).size !== i.parameters.length,
  );
  check('every panel has a distinct position per analyte', disordered.length === 0, disordered.map((i) => i.id).join(', '));
});

function misfile(rows) {
  return rows.map((r) => `${r.id} (panel ${r.of})`).join(', ');
}

await block('a printed range and the bounds behind it agree', () => {
  const wrong = [];
  const missing = [];
  for (const inv of catalogue) {
    for (const p of inv.parameters) {
      if (p.resultType !== 'numeric') {
        if (p.refLow !== null || p.refHigh !== null) wrong.push(`${p.id} is not numeric but carries bounds`);
        continue;
      }
      const stated = boundsIn(p.referenceRange);
      if (!stated) {
        if (p.refLow !== null || p.refHigh !== null) {
          wrong.push(`${p.id} prints "${p.referenceRange}" but carries bounds`);
        }
        // Prose is a legitimate printed range for an analyte with no interval -
        // "Not applicable" against a polymerase chain reaction's cycle threshold -
        // but prose that CONTAINS NUMBERS is a number the flag could not read.
        // "4.0 - 5.6 (Non-Diabetic)" was in this seed until a panel was rebuilt, and
        // it passed this rule: two numbers and a gloss, which `boundsIn` returns
        // nothing for, so a diabetic HbA1c was flagged Normal against it forever.
        // The digit is the tell, and a rule that cannot see it is not a rule.
        if (/\d/.test(p.referenceRange) && p.refLow === null && p.refHigh === null) {
          missing.push(`${p.id} prints "${p.referenceRange}", which no bound can read`);
        }
        continue;
      }
      // A one-sided interval carries one bound and that is correct: "< 200" has no
      // lower limit. What must never happen is a printed interval with no bounds
      // behind it at all, because then nothing is ever flagged against it.
      if (p.refLow === null && p.refHigh === null) {
        missing.push(`${p.id} prints "${p.referenceRange}" but no bound decides it`);
      }
      if (p.refLow !== stated.low || p.refHigh !== stated.high) {
        wrong.push(`${p.id} prints "${p.referenceRange}" (${stated.low}..${stated.high}) but carries ${p.refLow}..${p.refHigh}`);
      }
      if (!p.unit) missing.push(`${p.id} is numeric with no unit`);
    }
  }
  check('no parameter prints a range its bounds contradict', wrong.length === 0, wrong.join('; '));
  check('and no numeric analyte lacks its interval or its unit', missing.length === 0, missing.join('; '));
});

await block('a parameter that offers a choice offers a normal one', () => {
  // The first option is what the screen compares the rest against to decide the
  // flag, so a list starting with a positive result would report every normal
  // specimen abnormal.
  const choosers = catalogue.flatMap((i) => i.parameters).filter((p) => p.resultType === 'select' || p.resultType === 'reactive');
  const noOptions = choosers.filter((p) => p.options.length === 0).map((p) => p.id);
  const wrongType = choosers.filter((p) => p.options.length > 0 && p.resultType !== 'select' && p.resultType !== 'reactive').map((p) => p.id);
  check('every dropdown parameter has options to choose from', noOptions.length === 0, noOptions.join(', '));
  check('and no free-text parameter is pretending to be a dropdown', wrongType.length === 0, wrongType.join(', '));
});

await block('the browser catalogue is the seeded catalogue', () => {
  const byId = new Map(catalogue.map((i) => [i.id, i]));
  const browserIds = initialLabInvestigations.map((i) => i.id).sort();
  check(
    'the same investigations',
    JSON.stringify(browserIds) === JSON.stringify([...byId.keys()].sort()),
    `seed ${byId.size}, browser ${initialLabInvestigations.length}`,
  );

  const problems = [];
  for (const inv of initialLabInvestigations) {
    const seeded = byId.get(inv.id);
    if (!seeded) {
      problems.push(`${inv.id} is in the browser only - it has no panel in the database`);
      continue;
    }
    for (const field of ['code', 'name', 'category', 'sampleType', 'turnaroundTime', 'description']) {
      if ((inv[field] ?? '') !== seeded[field]) {
        problems.push(`${inv.id}.${field}: browser "${inv[field]}" vs seed "${seeded[field]}"`);
      }
    }
    if (inv.price !== seeded.price) problems.push(`${inv.id}.price: browser ${inv.price} vs seed ${seeded.price}`);
    if ((inv.parameters ?? []).length !== seeded.parameters.length) {
      problems.push(`${inv.id}: browser has ${(inv.parameters ?? []).length} analytes, seed has ${seeded.parameters.length}`);
      continue;
    }
    inv.parameters.forEach((p, i) => {
      const s = seeded.parameters[i];
      const same =
        p.id === s.id &&
        p.name === s.name &&
        p.unit === s.unit &&
        p.referenceRange === s.referenceRange &&
        p.resultType === s.resultType &&
        p.sortOrder === s.sortOrder &&
        (p.refLow ?? null) === s.refLow &&
        (p.refHigh ?? null) === s.refHigh &&
        JSON.stringify(p.options ?? []) === JSON.stringify(s.options);
      if (!same) {
        problems.push(`${inv.id} analyte ${i + 1}: browser ${p.id} vs seed ${s.id} (${p.name} / ${s.name})`);
      }
    });
  }
  check(
    'and the same analytes, in the same order, with the same ranges',
    problems.length === 0,
    problems.slice(0, 4).join('; '),
  );
});

await block('a value is flagged from its own reference interval', () => {
  const fbc = catalogue.find((i) => i.code === 'FBC');
  const byId = new Map(fbc.parameters.map((p) => [p.id, p]));
  const flag = (id, value, current = 'Normal') => flagForValue(byId.get(id), value, current);
  const renal = new Map(catalogue.find((i) => i.code === 'UE_CREAT').parameters.map((p) => [p.id, p]));

  // The case that made this a clinical defect rather than a cosmetic one: a
  // potassium of 6.4 used to be released as a normal potassium, because the flag
  // was a dropdown that started on Normal and nothing recomputed it.
  check('a potassium above the interval is High', flagForValue(renal.get('LAB-CHE-02.p_potassium'), '6.4', 'Normal') === 'High');
  check('a potassium inside the interval is Normal', flagForValue(renal.get('LAB-CHE-02.p_potassium'), '4.1', 'Normal') === 'Normal');
  check('a potassium below the interval is Low', flagForValue(renal.get('LAB-CHE-02.p_potassium'), '2.8', 'Normal') === 'Low');
  check('a haemoglobin of 7.9 is Low, not normal', flag('LAB-HEM-01.p_hb', '7.9') === 'Low');
  check('a haemoglobin of 14.2 is Normal', flag('LAB-HEM-01.p_hb', '14.2') === 'Normal');
  check('a platelet count of 42 is Low', flag('LAB-HEM-01.p_plt', '42') === 'Low');
  check('an MCV of 104 is High (macrocytosis)', flag('LAB-HEM-01.p_mcv', '104') === 'High');
  check('the boundary itself is inside the interval', flag('LAB-HEM-01.p_hb', '12.0') === 'Normal');
  check('just outside it is not', flag('LAB-HEM-01.p_hb', '11.9') === 'Low');

  // A one-sided interval only judges its own side: eGFR is "> 90" and a value of
  // 120 is not a high eGFR.
  check('a one-sided interval judges only its own side', flagForValue(renal.get('LAB-CHE-02.p_egfr'), '45', 'Normal') === 'Low');
  check('and a good value on the open side stays Normal', flagForValue(renal.get('LAB-CHE-02.p_egfr'), '120', 'Normal') === 'Normal');

  // Parasite density is "0 - 0": not detected is a number, and any count is high.
  const malaria = new Map(catalogue.find((i) => i.code === 'MAL_TEST').parameters.map((p) => [p.id, p]));
  check('a negative parasite density is Normal', flagForValue(malaria.get('LAB-MIC-04.p_mp_density'), '0', 'Normal') === 'Normal');
  check('any parasites at all is High', flagForValue(malaria.get('LAB-MIC-04.p_mp_density'), '250', 'Normal') === 'High');

  // A value that is not a number cannot be compared to an interval, so the
  // scientist's own flag stands rather than being overwritten with Normal.
  check('a non-numeric value leaves the flag alone', flagForValue(byId.get('LAB-HEM-01.p_hb'), 'Trace', 'Abnormal') === 'Abnormal');
  check('and an emptied field leaves it alone too', flagForValue(byId.get('LAB-HEM-01.p_hb'), '', 'Low') === 'Low');

  // Nothing is flagged Critical automatically. A critical result is a judgement
  // about the patient, not a comparison with two numbers.
  const flags = ['-1', '0', '12', '17.5', '200'];
  check('no value is ever automatically Critical', flags.every((v) => flag('LAB-HEM-01.p_hb', v) !== 'Critical'));
});

await block('a chosen option decides the flag', () => {
  const sens = catalogue
    .find((i) => i.code === 'URC')
    .parameters.find((p) => p.id.endsWith('p_sens_interp'));
  check('the first option, the sensitive one, is Normal', flagForValue(sens, 'Sensitive (S)', 'Normal') === 'Normal');
  check('an intermediate result is Abnormal', flagForValue(sens, 'Intermediate (I)', 'Normal') === 'Abnormal');
  check('resistance is Abnormal', flagForValue(sens, 'Resistant (R)', 'Normal') === 'Abnormal');

  const fob = catalogue
    .find((i) => i.code === 'STOOL_TEST')
    .parameters.find((p) => p.id.endsWith('p_fob'));
  check('a negative occult blood is Normal', flagForValue(fob, 'Negative', 'Normal') === 'Normal');
  check('a positive occult blood is Abnormal', flagForValue(fob, 'Positive', 'Normal') === 'Abnormal');
});

await block('only the analytes that were filled in are saved', () => {
  const fbc = catalogue.find((i) => i.code === 'FBC');
  const rows = buildRows(panelFor({ ...fbc }), []);
  check('the panel is offered in panel order, not database order', rows.map((r) => r.parameterId).join() ===
    fbc.parameters.map((p) => p.id).join());
  check('an untouched analyte has no value', rows.every((r) => r.value === ''));
  check('and the count of recorded analytes starts at zero', enteredCount(rows) === 0);

  const typed = rows.map((r, i) => (i < 4 ? { ...r, value: i === 0 ? ' 7.9 ' : '13.1', flag: flagForValue(panelFor({ ...fbc })[i], i === 0 ? '7.9' : '13.1', 'Normal') } : r));
  const saved = enteredRows(typed);
  check('the four that were filled in are saved', saved.length === 4, `saved ${saved.length}`);
  check('and the value is trimmed', saved[0].value === '7.9', saved[0].value);
  check('with the flag the interval gave it', saved[0].flag === 'Low', saved[0].flag);
  check('nothing is released from an empty panel', canRelease(rows) === false);
  check('but a partial panel is', canRelease(typed) === true);
  check('critical analytes are found by flag, not by value', criticalRows(typed).length === 0);

  const critical = typed.map((r, i) => (i === 0 ? { ...r, flag: 'Critical' } : r));
  check('and a critical one is', criticalRows(critical).length === 1);
  check('an untouched row cannot be critical', criticalRows([{ ...rows[0], flag: 'Critical' }]).length === 0);
});

await block('a result already recorded keeps its value when the panel is reloaded', () => {
  const fbc = catalogue.find((i) => i.code === 'FBC');
  const panel = panelFor({ ...fbc });
  const saved = [
    { parameterId: 'LAB-HEM-01.p_hb', parameterName: 'Haemoglobin (Hb)', value: '9.4', unit: 'g/dL', referenceRange: '12.0 - 17.5', flag: 'Low' },
    // A result whose parameter has since been removed from the panel. Dropping it
    // would hide a finding that was actually observed.
    { parameterId: 'LAB-HEM-01.p_retired', parameterName: 'Formerly reported analyte', value: 'seen', unit: '', referenceRange: '', flag: 'Abnormal' },
  ];
  const rows = buildRows(panel, saved);
  const hb = rows.find((r) => r.parameterId === 'LAB-HEM-01.p_hb');
  check('the recorded value comes back', hb.value === '9.4');
  check('with the flag it was given', hb.flag === 'Low');
  check('and the panel is the authority on the unit and the range', hb.unit === 'g/dL' && hb.referenceRange === '12.0 - 17.5');
  check('every analyte is still offered for entry', rows.length === panel.length + 1, `${rows.length} rows for ${panel.length} analytes`);
  check('and the retired result is still on the report', rows.some((r) => r.parameterId === 'LAB-HEM-01.p_retired'));
});

await block('a workflow change records who did it, and when the blood was drawn', () => {
  // "Collect sample", the critical-result tick and "release" were the three
  // workflow changes reported as not sticking. They did not fail loudly: the
  // status advanced in the browser and the derived columns were never written at
  // all, so nothing looked wrong until a report came back with no draw time on it.
  const scientist = { id: 'USR-SCIENTIST', name: 'Amaka Obi' };
  const requested = {
    id: 'LTO-TEST',
    testName: 'Full Blood Count',
    status: 'Requested',
    results: [],
  };
  const drawn = { ...requested, status: 'Requested' };

  // 1. The draw time. `lab_test_orders.collected_at` has been in the schema since
  //    the beginning and, before this, no code path anywhere wrote it.
  const collected = applyStatusChange(requested, 'Sample Collected', { user: scientist, now: '2026-09-30T08:15:00.000Z' });
  check('collecting the specimen records when it was drawn', collected.collectedAt === '2026-09-30T08:15:00.000Z', String(collected.collectedAt));
  check('and records who took it', collected.scientistName === 'Amaka Obi' && collected.scientistId === 'USR-SCIENTIST');

  // Not overwritten: a test that is sent back to processing must still show the
  // moment the blood was drawn, not the moment somebody reopened the record.
  const reopened = applyStatusChange(collected, 'Processing', { user: scientist, now: '2026-09-30T11:40:00.000Z' });
  check('reopening the record does not move the draw time', reopened.collectedAt === '2026-09-30T08:15:00.000Z', String(reopened.collectedAt));
  check('but processing is still stamped as reached', reopened.status === 'Processing');
  check('and the second person is the one on the record now', reopened.scientistName === 'Amaka Obi');

  // A second collector is a different person and must say so.
  const second = applyStatusChange(requested, 'Sample Collected', { user: { id: 'USR-NURSE', name: 'Bola Ade' }, now: '2026-09-30T08:20:00.000Z' });
  check('a specimen collected by anyone is attributed to them', second.scientistId === 'USR-NURSE' && second.scientistName === 'Bola Ade');

  // A transition that is not about the specimen must not invent a draw time.
  check('nothing else stamps a draw time', applyStatusChange(requested, 'Paid', { user: scientist }).collectedAt === undefined);
  check('and a release of an uncollected test is not stamped either', applyStatusChange(requested, 'Released', { user: scientist }).collectedAt === undefined);

  // 2. The critical alert. This was a checkbox that set a state and dropped it.
  const renal = catalogue.find((i) => i.code === 'UE_CREAT');
  const k = renal.parameters.find((p) => p.id.endsWith('p_potassium'));
  const criticalValue = { parameterId: k.id, parameterName: k.name, value: '6.4', unit: k.unit, referenceRange: k.referenceRange, flag: 'Critical' };
  const alerted = applyStatusChange(reopened, 'Result Entered', { user: scientist, results: [criticalValue], criticalAlert: true, now: '2026-09-30T11:55:00.000Z' });
  check('a critical result is saved with the alert raised', alerted.criticalAlert === true);
  check('and the result itself is stored', alerted.results.length === 1 && alerted.results[0].value === '6.4');

  // The alert is a parameter, not a derivation, so a normal panel leaves it as it
  // was rather than quietly clearing a flag somebody set earlier in the session.
  const routine = applyStatusChange(reopened, 'Result Entered', { user: scientist, results: [criticalValue], now: '2026-09-30T11:55:00.000Z' });
  check('an unraised alert is not cleared on the way through', routine.criticalAlert === undefined);

  // 3. The release. `released_at` and `verified_by` are what tell a physician that
  //    somebody signed this off, and by whom.
  const released = applyStatusChange(alerted, 'Released', { user: scientist, now: '2026-09-30T12:30:00.000Z' });
  check('release stamps the release time', released.releasedAt === '2026-09-30T12:30:00.000Z', String(released.releasedAt));
  check('and names who released it', released.verifiedBy === 'Amaka Obi');
  check('the critical alert survives the release', released.criticalAlert === true);
  check('and the release does not move the draw time', released.collectedAt === '2026-09-30T08:15:00.000Z');

  // 4. Omitted means "leave it alone", not "clear it". A modal that saves the
  //    status without sending the results would otherwise blank a recorded panel.
  const kept = applyStatusChange(released, 'Verified', { user: scientist });
  check('omitting results leaves the recorded ones alone', kept.results.length === 1 && kept.results[0].value === '6.4');
  check('omitting the alert leaves it alone', kept.criticalAlert === true);
  check('omitting comments leaves them alone', kept.comments === released.comments);
  check('and a test that is only verified does not get a release time again', kept.releasedAt === released.releasedAt);
  check('but verifying does not claim to be a release', kept.verifiedBy === 'Amaka Obi');

  // 5. The audit sentence has to be checkable against the report it describes.
  const detail = statusAuditDetail(
    { ...released, testName: 'Urea, Electrolytes & Serum Creatinine' },
    'Released',
  );
  check('the audit names the investigation', detail.startsWith('Investigation Urea, Electrolytes & Serum Creatinine'), detail);
  check('says how many analytes were released', detail.includes('1 analyte recorded'), detail);
  check('names the flagged one with its flag', detail.includes(`${k.name} Critical`), detail);
  check('and states the alert was raised', detail.includes('Critical result alert raised'), detail);
  check('a normal release names no flags', statusAuditDetail({ testName: 'Full Blood Count', results: [{ ...criticalValue, flag: 'Normal' }] }, 'Released').includes('Flagged') === false);
  check('an unentered panel releases nothing to describe', statusAuditDetail({ testName: 'Full Blood Count', results: [] }, 'Released').includes('analyte') === false);
});

await block('a panel is read from the database and never written back to it', async () => {
  // The whole failure this file's section 18 is about, replayed as a write.
  //
  // A device holds the catalogue as it was at sign-in. Later that day the panel
  // changes in the database - a migration adds the red-cell indices to a blood
  // count. In the evening the same administrator corrects a price from their
  // browser, which is a legitimate action, and the diff for that one investigation
  // carries the nested array along with it. If panels were writable, the stale
  // copy would delete the four analytes the server had gained and re-insert the
  // six it had before, and every screen would say the price was saved.
  const map = TABLE_BY_KEY.get('fatclinic_lab_defs');
  const server = fakeServer();

  const seeded = map.rowToModel({ ...rowWithoutForeignKeys('lab_investigations'), id: 'LAB-HEM-01' });
  seeded.price = 5000;
  // The server is ahead: sixteen analytes, with the indices this device has
  // never heard of.
  const serverPanel = catalogue
    .find((i) => i.id === 'LAB-HEM-01')
    .parameters.map((p) => map.children[0].rowToModel({
      id: p.id,
      investigation_id: 'LAB-HEM-01',
      name: p.name,
      unit: p.unit,
      reference_range: p.referenceRange,
      ref_low: p.refLow,
      ref_high: p.refHigh,
      sort_order: p.sortOrder,
      result_type: p.resultType,
      options: p.options,
    }));
  await server.client.from('lab_investigations').upsert([map.modelToRow({ ...seeded, parameters: serverPanel })], { onConflict: 'id' });
  for (const p of serverPanel) {
    await server.client.from('lab_parameters').upsert([map.children[0].modelToRow(p, 'LAB-HEM-01')], { onConflict: 'id' });
  }
  const before = server.count('lab_parameters');
  check('the server holds the full panel', before === 16, `${before} analytes`);

  // What this device still believes: the six-analyte panel from before, and a
  // price it is correcting now.
  const stalePanel = [
    { id: 'LAB-HEM-01.p_hb', name: 'Hemoglobin (Hb)', unit: 'g/dL', referenceRange: '12.0 - 17.5', refLow: 12, refHigh: 17.5, sortOrder: 10, resultType: 'numeric', options: [] },
    { id: 'LAB-HEM-01.p_pcv', name: 'Packed Cell Volume (PCV)', unit: '%', referenceRange: '36.0 - 52.0', refLow: 36, refHigh: 52, sortOrder: 20, resultType: 'numeric', options: [] },
    { id: 'LAB-HEM-01.p_wbc', name: 'Total White Blood Cell Count (WBC)', unit: 'x10^9/L', referenceRange: '4.0 - 11.0', refLow: 4, refHigh: 11, sortOrder: 30, resultType: 'numeric', options: [] },
    { id: 'LAB-HEM-01.p_neut', name: 'Neutrophils (Neutrophil %)', unit: '%', referenceRange: '40 - 75', refLow: 40, refHigh: 75, sortOrder: 40, resultType: 'numeric', options: [] },
    { id: 'LAB-HEM-01.p_lymph', name: 'Lymphocytes (Lymphocyte %)', unit: '%', referenceRange: '20 - 45', refLow: 20, refHigh: 45, sortOrder: 50, resultType: 'numeric', options: [] },
    { id: 'LAB-HEM-01.p_plt', name: 'Platelet Count', unit: 'x10^9/L', referenceRange: '150 - 450', refLow: 150, refHigh: 450, sortOrder: 60, resultType: 'numeric', options: [] },
  ];
  const after = [{ ...seeded, price: 7500, parameters: stalePanel }];

  let threw = null;
  try {
    await pushDiff(map, [{ ...seeded, price: 5000, parameters: stalePanel }], after, server.client);
  } catch (err) {
    threw = err.message;
  }
  check('the price correction is not refused', !threw, threw);
  check('and the price really is saved', server.find('lab_investigations', 'LAB-HEM-01')?.price === 7500, String(server.find('lab_investigations', 'LAB-HEM-01')?.price));
  check('not one analyte was deleted', server.count('lab_parameters') === before, `${server.count('lab_parameters')} of ${before}`);
  check('and none was rewritten by the stale copy', server.find('lab_parameters', 'LAB-HEM-01.p_mcv')?.name === 'Mean Corpuscular Volume (MCV)');
});

// ---------------------------------------------------------------------------

console.log('');
if (failures) {
  console.log(`[sync self-test] ${failures} of ${checks} checks FAILED`);
  process.exitCode = 1;
} else {
  console.log(`[sync self-test] all ${checks} checks behaved as expected`);
}
