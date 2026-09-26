/**
 * Static checks on database/fatclinic.sql that need no database connection.
 *
 *   npm run db:lint
 *
 * Catches the class of mistake that is expensive to find at apply time:
 *   - a column inserted in a seed that no CREATE TABLE declares
 *   - a foreign key or index pointing at a table that does not exist
 *   - unbalanced parentheses or dollar-quoted function bodies
 *   - a table named in the RLS lists that is missing from the schema
 *
 * This is a lint, not a substitute for `npm run db:apply`. It cannot type-check
 * expressions or prove a trigger fires, so run both.
 */
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// An optional argument lets the self-test (and CI) lint a candidate file.
const FILE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'database', 'fatclinic.sql');
const LABEL = path.relative(ROOT, FILE).split(path.sep).join('/');

const raw = fs.readFileSync(FILE, 'utf8');
const errors = [];
const notes = [];

/**
 * Blank out comments while preserving byte offsets, so line numbers stay
 * accurate. String literals and dollar-quoted bodies are preserved verbatim
 * because they can legally contain "--" and "/*".
 */
function stripComments(sql) {
  const out = sql.split('');
  let i = 0;
  let inSingle = false;
  let dollarTag = null;

  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (!inSingle && !dollarTag && two === '--') {
      while (i < sql.length && sql[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    if (!inSingle && !dollarTag && two === '/*') {
      while (i < sql.length && sql.slice(i, i + 2) !== '*/') {
        if (sql[i] !== '\n') out[i] = ' ';
        i++;
      }
      out[i] = ' ';
      if (sql[i + 1]) out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (!dollarTag && sql[i] === "'") {
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (!inSingle) {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 16));
      if (m) {
        if (!dollarTag) {
          dollarTag = m[0];
        } else if (m[0] === dollarTag) {
          dollarTag = null;
        }
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return out.join('');
}

const sql = stripComments(raw);
const lineAt = (index) => raw.slice(0, index).split('\n').length;

// --- balance checks ---------------------------------------------------------

const parens = (sql.match(/\(/g) || []).length - (sql.match(/\)/g) || []).length;
if (parens !== 0) errors.push(`unbalanced parentheses: ${parens > 0 ? `${parens} unclosed (` : `${-parens} extra )`}`);

const dollarOpen = (raw.match(/\$\$/g) || []).length;
if (dollarOpen % 2 !== 0) {
  errors.push(`unbalanced $$ delimiters (${dollarOpen} occurrences; a function body is not closed)`);
}

const tagOpen = (raw.match(/\$[A-Za-z_]+\$/g) || []).length;
if (tagOpen % 2 !== 0) errors.push(`unbalanced named dollar-quote tags (${tagOpen} found)`);

// --- tables and their columns ----------------------------------------------

/** @type {Map<string, {line:number, columns:Set<string>}>} */
const tables = new Map();

const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;
let m;
while ((m = tableRe.exec(sql))) {
  const name = m[1].toLowerCase();
  if (tables.has(name)) {
    errors.push(`table "${name}" is created more than once (line ${lineAt(m.index)})`);
  }
  const bodyStart = m.index + m[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < sql.length && depth > 0) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') depth--;
    i++;
  }
  const body = sql.slice(bodyStart, i - 1);

  // Split on top-level commas only.
  const parts = [];
  let d = 0;
  let start = 0;
  let inStr = false;
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (inStr) {
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === '(') d++;
    else if (ch === ')') d--;
    else if (ch === ',' && d === 0) {
      parts.push(body.slice(start, k));
      start = k + 1;
    }
  }
  parts.push(body.slice(start));

  const columns = new Set();
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|LIKE)\b/i.test(t)) continue;
    const col = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(t);
    if (col) columns.add(col[1].toLowerCase());
  }
  tables.set(name, { line: lineAt(m.index), columns });
}

if (!tables.size) errors.push('no CREATE TABLE statements found - is the file empty?');

// --- foreign keys -----------------------------------------------------------

const refRe = /REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
while ((m = refRe.exec(sql))) {
  const target = m[1].toLowerCase();
  if (!tables.has(target)) {
    errors.push(`line ${lineAt(m.index)}: REFERENCES ${m[1]}, which is not created by this file`);
  }
}

// --- indexes ----------------------------------------------------------------

const idxRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z_][A-Za-z0-9_]*\s+ON\s+([A-Za-z_][A-Za-z0-9_.]*)/gi;
while ((m = idxRe.exec(sql))) {
  const target = m[1].toLowerCase().replace(/^public\./, '');
  if (!tables.has(target)) {
    errors.push(`line ${lineAt(m.index)}: index on ${m[1]}, which is not created by this file`);
  }
}

// --- views ------------------------------------------------------------------

const viewRe = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
const views = new Set();
while ((m = viewRe.exec(sql))) views.add(m[1].toLowerCase());

// --- grant targets ----------------------------------------------------------

const grantRe = /GRANT\s+[^;]*?\bON\s+(?:TABLE\s+)?([A-Za-z_][A-Za-z0-9_,\s]+?)\s+TO\s/gi;
const SCALAR_TARGETS = new Set(['all', 'tables', 'sequences', 'functions', 'table']);
while ((m = grantRe.exec(sql))) {
  const target = m[1].trim();
  // "ALL TABLES IN SCHEMA public" and bare "TABLES" (default privileges) are
  // schema-wide, not a single object.
  if (/\bIN\s+SCHEMA\b/i.test(target)) continue;
  for (const name of target.split(',')) {
    const t = name.trim().replace(/^public\./, '').toLowerCase();
    if (!t || SCALAR_TARGETS.has(t)) continue;
    if (!tables.has(t) && !views.has(t)) {
      errors.push(`line ${lineAt(m.index)}: GRANT on ${name.trim()}, which is neither a table nor a view here`);
    }
  }
}

// --- seed inserts -----------------------------------------------------------

const insertRe = /INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*VALUES/gi;
let seeded = 0;
while ((m = insertRe.exec(sql))) {
  const table = m[1].toLowerCase();
  const def = tables.get(table);
  if (!def) {
    errors.push(`line ${lineAt(m.index)}: INSERT INTO ${m[1]}, which is not created by this file`);
    continue;
  }
  seeded++;
  for (const col of m[2].split(',')) {
    const c = col.trim().toLowerCase();
    if (!c) continue;
    if (!def.columns.has(c)) {
      errors.push(`line ${lineAt(m.index)}: INSERT INTO ${table} names column "${c}", which the table does not declare`);
    }
  }
}

// --- seed values vs the CHECK constraints that police them -----------------
//
// A seed can name a valid column and still be rejected by the database, which
// is exactly what happened with permission keys containing an underscore. There
// is no local Postgres to try these against, so read the constraint and apply it.

const keyCheck = /CHECK\s*\(\s*key\s*~\s*'([^']+)'\s*\)/i.exec(sql);
if (!keyCheck) {
  errors.push('could not locate the permission_nodes key CHECK constraint to validate seeds against');
} else {
  const pattern = new RegExp(`^(?:${keyCheck[1].slice(1, -1)})$`);
  // The seed block is terminated by ON CONFLICT, not by the first semicolon:
  // the value list legitimately contains ')' and the semicolon only comes
  // after DO NOTHING.
  const nodesRe = /INSERT\s+INTO\s+permission_nodes\s*\([^)]*\)\s*VALUES\s*([\s\S]*?)\s+ON\s+CONFLICT/gi;
  const seen = new Set();
  let nodeCount = 0;

  while ((m = nodesRe.exec(sql))) {
    for (const literal of m[1].matchAll(/\(\s*'([^']*)'\s*,\s*(NULL|'([^']*)')/g)) {
      const key = literal[1];
      const parent = literal[3];
      nodeCount++;
      if (!pattern.test(key)) {
        errors.push(
          `line ${lineAt(m.index)}: permission_nodes key "${key}" violates its own CHECK constraint ${keyCheck[1]}`,
        );
      }
      if (parent && !seen.has(parent)) {
        errors.push(
          `line ${lineAt(m.index)}: permission_nodes key "${key}" references parent "${parent}", which is not inserted before it`,
        );
      }
      seen.add(key);
    }
  }
  if (nodeCount === 0) errors.push('no permission_nodes seed rows found');
}

// Ward codes must agree with the TypeScript model, because visits.ward is a
// foreign key to wards(code): a code present in only one place breaks admissions.
const wardSeed = /INSERT\s+INTO\s+wards\s*\([^)]*\)\s*VALUES\s*([\s\S]*?)\s+ON\s+CONFLICT/i.exec(sql);
if (!wardSeed) {
  errors.push('no wards seed found, but visits.ward is a foreign key to wards(code)');
} else {
  const seededCodes = new Set([...wardSeed[1].matchAll(/\(\s*'([A-Z][A-Z0-9-]*)'/g)].map((x) => x[1]));
  let tsCodes = null;
  try {
    const ts = readFileSync(path.join(ROOT, 'src', 'types', 'index.ts'), 'utf8');
    const block = /WARD_OPTIONS[^=]*=\s*\[([\s\S]*?)\];/.exec(ts);
    if (block) {
      tsCodes = new Set([...block[1].matchAll(/code:\s*'([^']+)'/g)].map((x) => x[1]));
    }
  } catch {
    notes.push('src/types/index.ts not readable; ward cross-check skipped');
  }

  if (tsCodes) {
    for (const code of seededCodes) {
      if (!tsCodes.has(code)) {
        errors.push(
          `wards seed has code "${code}", which is absent from WARD_OPTIONS in src/types/index.ts; ` +
            'an admission to it would fail the visits.ward foreign key',
        );
      }
    }
    for (const code of tsCodes) {
      if (!seededCodes.has(code)) {
        errors.push(
          `WARD_OPTIONS in src/types/index.ts has code "${code}", which the wards seed does not create; ` +
            'admitting to it would fail the visits.ward foreign key',
        );
      }
    }
  }
}

// --- RLS table lists --------------------------------------------------------

const arrayRe = /(staff_tables|admin_tables)\s+TEXT\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/gi;
while ((m = arrayRe.exec(sql))) {
  for (const name of m[2].match(/'([A-Za-z_][A-Za-z0-9_]*)'/g) || []) {
    const t = name.slice(1, -1).toLowerCase();
    if (!tables.has(t)) {
      errors.push(`RLS list ${m[1]} includes "${t}", which is not created by this file`);
    }
  }
}

// --- views read tables that must exist -------------------------------------

// A view body ends at the first semicolon that is not inside parentheses, which
// a regex cannot do reliably because the bodies contain no nested parens beyond
// the function-call level.
const viewStartRe = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([A-Za-z_][A-Za-z0-9_]*)\s+AS\s/gi;
while ((m = viewStartRe.exec(sql))) {
  let i = m.index + m[0].length;
  let depth = 0;
  while (i < sql.length) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') depth--;
    else if (sql[i] === ';' && depth === 0) break;
    i++;
  }
  const body = sql.slice(m.index + m[0].length, i);

  const fromRe = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let f;
  while ((f = fromRe.exec(body))) {
    const t = f[1].toLowerCase();
    if (t === 'select' || views.has(t)) continue;
    if (!tables.has(t)) {
      errors.push(`line ${lineAt(m.index)}: view ${m[1]} reads ${f[1]}, which is not created by this file`);
    }
  }
}

// --- sensitive data ---------------------------------------------------------

if (/\bpassword_hash\b|\bpassword_digest\b/i.test(raw)) {
  errors.push('a password hash column is present; credentials belong to Supabase Auth');
}
for (const t of ['users']) {
  const def = tables.get(t);
  if (def && def.columns.has('password')) {
    errors.push('users.password exists; the schema must not store staff passwords');
  }
}

// --- report -----------------------------------------------------------------

console.log(`\n[db:lint] ${LABEL}`);
console.log(`  tables declared : ${tables.size}`);
console.log(`  views declared  : ${views.size}`);
console.log(`  seed inserts    : ${seeded}`);
console.log(`  size            : ${raw.split('\n').length} lines\n`);

if (notes.length) {
  for (const n of notes) console.log(`  note: ${n}`);
  console.log('');
}

if (errors.length) {
  console.log(`[db:lint] ${errors.length} problem(s)\n`);
  for (const e of errors) console.log(`  - ${e}`);
  console.log('');
  process.exit(1);
}

console.log('[db:lint] no structural problems found.');
console.log('[db:lint] This does not validate SQL semantics - run `npm run db:apply` for that.\n');
