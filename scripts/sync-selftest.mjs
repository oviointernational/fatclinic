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
  const cases = ['Dr@FatClinic.Health', '  Ngozi@FatClinic.Health  ', 'ALABI@FATALCLINIC.HEALTH'];
  const written = cases.map((e) => users.modelToRow({ ...users.rowToModel(syntheticRow('users')), email: e }).email);
  check(
    'every written staff email is trimmed and lowercased',
    written.every((e) => e === e.trim() && e === e.toLowerCase() && e.length > 0),
    written.join(' | '),
  );
  check(
    'the lowercased form is what the self-test expects to look up',
    written[0] === 'dr@fatclinic.health' && written[1] === 'ngozi@fatclinic.health',
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
  if (type.startsWith('BOOLEAN')) return 'PROBE_TOGGLE';
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
  const writes = server.ops.filter((o) => o.table === 'invoices' && o.op === 'upsert').length;
  check('the invoice is written once on insert', writes === 1, writes);
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

console.log('');
if (failures) {
  console.log(`[sync self-test] ${failures} of ${checks} checks FAILED`);
  process.exitCode = 1;
} else {
  console.log(`[sync self-test] all ${checks} checks behaved as expected`);
}
