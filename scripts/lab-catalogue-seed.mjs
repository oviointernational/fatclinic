/**
 * Read the laboratory catalogue seed out of database/fatclinic.sql.
 *
 * The catalogue - the investigations and the analyte panel of each - is declared
 * once, in the schema file, because that is what a fresh install runs. Two other
 * things need to read it rather than keep their own copy:
 *
 *   - scripts/generate-lab-catalogue.mjs, which writes the browser's copy of the
 *     catalogue into src/services/seedData.ts.
 *   - scripts/sync-selftest.mjs, which fails if that generated copy has drifted
 *     from the seed, and which checks the panel is complete.
 *
 * Both had a reason to hand-roll this and both were wrong in a different way, so
 * the parser lives here. It is deliberately not a SQL parser: it reads the tuple
 * lists of the two INSERT statements this file is written in, and it fails
 * loudly rather than guessing if they stop looking like that.
 */

/** Tokens of one `('a','b',1,NULL,'{}')` tuple: strings unquoted, arrays as JSON. */
function fields(text) {
  const out = [];
  let i = 0;
  const body = text.trim().replace(/^\(/, '').replace(/\)$/, '');
  while (i < body.length) {
    const ch = body[i];
    if (ch === ',' || /\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let value = '';
      i += 1;
      while (i < body.length) {
        if (body[i] === "'" && body[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        if (body[i] === "'") break;
        value += body[i];
        i += 1;
      }
      i += 1;
      // A Postgres array literal is itself quoted ('{a,b}'), so it arrives here
      // as a string. Hand it back as JSON, so an option containing a comma
      // survives the trip and the quote marks are not carried into the output.
      if (value.startsWith('{') && value.endsWith('}')) {
        out.push(JSON.stringify(value.slice(1, -1).split(',').filter((v) => v !== '')));
        continue;
      }
      out.push(value);
      continue;
    }
    // A bare token: a number, NULL. Commas and runs of whitespace separate them
    // rather than belonging to one.
    let token = '';
    while (i < body.length && body[i] !== ',' && !/\s/.test(body[i])) {
      token += body[i];
      i += 1;
    }
    out.push(token);
  }
  return out;
}

/** Every top-level tuple of a VALUES list, in order. */
function tuplesOf(chunk) {
  const out = [];
  let i = 0;
  let depth = 0;
  let inString = false;
  let current = '';
  while (i < chunk.length) {
    const ch = chunk[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (chunk[i + 1] === "'") {
          current += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
      i += 1;
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      if (depth === 1) {
        current = '';
        i += 1;
        continue;
      }
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        out.push(current);
        current = '';
        i += 1;
        continue;
      }
    }
    current += ch;
    i += 1;
  }
  return out.map(fields);
}

/** The VALUES lists of every INSERT INTO `table` in the file. */
function statements(sql, table) {
  const re = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\([^)]*\\)\\s*VALUES`, 'gi');
  const found = [];
  let m;
  while ((m = re.exec(sql))) {
    const start = m.index + m[0].length;
    const end = sql.indexOf('ON CONFLICT', start);
    if (end === -1) throw new Error(`no ON CONFLICT after the ${table} seed`);
    found.push(sql.slice(start, end));
  }
  return found;
}

const asNumber = (v) => (v === 'NULL' || v === '' ? null : Number(v));

/**
 * The catalogue as the seed declares it.
 *
 * Investigations come back with `parameters` in panel order, because the
 * generator writes that array out in this order and the self-test compares it.
 */
export function readCatalogueSeed(sql) {
  const investigations = statements(sql, 'lab_investigations').flatMap(tuplesOf).map((r) => ({
    id: r[0],
    code: r[1],
    name: r[2],
    category: r[3],
    price: Number(r[4]),
    sampleType: r[5],
    turnaroundTime: r[6],
    description: r[7] ?? '',
    parameters: [],
  }));

  const byId = new Map(investigations.map((i) => [i.id, i]));
  for (const r of statements(sql, 'lab_parameters').flatMap(tuplesOf)) {
    const [id, investigationId, name, unit, referenceRange, refLow, refHigh, sortOrder, resultType, options] = r;
    const investigation = byId.get(investigationId);
    if (!investigation) {
      throw new Error(`lab_parameters seeds ${id} for ${investigationId}, which the investigation seed does not declare`);
    }
    investigation.parameters.push({
      id,
      name,
      unit,
      referenceRange,
      refLow: asNumber(refLow),
      refHigh: asNumber(refHigh),
      sortOrder: Number(sortOrder),
      resultType,
      options: JSON.parse(options),
    });
  }

  for (const investigation of investigations) {
    investigation.parameters.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return investigations;
}

/**
 * The bounds a printed range states, or null when it states none.
 *
 * Only the three shapes a laboratory actually prints a number in are read: an
 * interval, an upper limit and a lower limit. Anything else is prose - "None
 * Seen", "Normochromic normocytes", "4.0 - 5.6 (Non-Diabetic)" - and gets no
 * bounds, because guessing at one would put a fabricated Normal on a result
 * nobody measured against an interval.
 */
export function boundsIn(referenceRange) {
  const range = (referenceRange ?? '').trim();
  const interval = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/.exec(range);
  if (interval) return { low: Number(interval[1]), high: Number(interval[2]) };
  const below = /^<\s*(-?\d+(?:\.\d+)?)$/.exec(range);
  if (below) return { low: null, high: Number(below[1]) };
  const above = /^>\s*(-?\d+(?:\.\d+)?)$/.exec(range);
  if (above) return { low: Number(above[1]), high: null };
  return null;
}
