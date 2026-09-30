/**
 * Regenerate src/services/seedData.ts's `initialLabInvestigations` from the
 * catalogue seed in database/fatclinic.sql.
 *
 * WHY A GENERATOR AND NOT A HAND-MAINTAINED COPY
 * ---------------------------------------------
 * The catalogue is declared once, in the schema file, because that is what a
 * fresh install runs. The browser needs the same list to have something to show
 * before it has ever signed in, which is what `initialLabInvestigations` is. Those
 * two copies drifted, and that drift is the reason this bug existed: five
 * investigations were seeded from SQL and nine from TypeScript, and the three ids
 * they shared were won by whichever arrived first - so Full Blood Count existed in
 * the database with no panel at all, and its panel sat in a browser cache.
 *
 * So the TypeScript side is generated. Run this after changing the seed, and the
 * copy cannot be wrong:
 *
 *   node scripts/generate-lab-catalogue.mjs
 *
 * scripts/sync-selftest.mjs fails if the two ever disagree, so a hand-edit to the
 * generated block is caught as well as overwritten.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCatalogueSeed } from './lab-catalogue-seed.mjs';

const seedPath = fileURLToPath(new URL('../database/fatclinic.sql', import.meta.url));
const investigations = readCatalogueSeed(readFileSync(seedPath, 'utf8'));

const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const numOrNull = (v) => (v === null ? 'null' : String(v));

let out = '';
for (const inv of investigations) {
  out += `  {\n`;
  out += `    id: ${q(inv.id)},\n`;
  out += `    code: ${q(inv.code)},\n`;
  out += `    name: ${q(inv.name)},\n`;
  out += `    category: ${q(inv.category)},\n`;
  out += `    price: ${inv.price},\n`;
  out += `    sampleType: ${q(inv.sampleType)},\n`;
  out += `    turnaroundTime: ${q(inv.turnaroundTime)},\n`;
  out += `    description: ${q(inv.description)},\n`;
  out += `    parameters: [\n`;
  inv.parameters.forEach((p, i) => {
    out += `      { id: ${q(p.id)}, name: ${q(p.name)}, unit: ${q(p.unit)}, referenceRange: ${q(p.referenceRange)}, `;
    out += `refLow: ${numOrNull(p.refLow)}, refHigh: ${numOrNull(p.refHigh)}, sortOrder: ${p.sortOrder}, `;
    out += `resultType: ${q(p.resultType)}`;
    out += p.options.length
      ? `, options: [${p.options.map(q).join(', ')}] }`
      : ' }';
    out += i === inv.parameters.length - 1 ? '\n' : ',\n';
  });
  out += `    ]\n`;
  out += `  },\n`;
}

const target = fileURLToPath(new URL('../src/services/seedData.ts', import.meta.url));
const existing = readFileSync(target, 'utf8');
const start = existing.indexOf('export const initialLabInvestigations: LabInvestigationDefinition[] = [');
const end = existing.indexOf('\n];', start);
if (start === -1 || end === -1) throw new Error('could not find initialLabInvestigations in seedData.ts');

const next = `${existing.slice(0, start)}export const initialLabInvestigations: LabInvestigationDefinition[] = [\n${out}${existing.slice(end + 1)}`;
writeFileSync(target, next);

const parameters = investigations.reduce((n, i) => n + i.parameters.length, 0);
console.log(
  `${investigations.length} investigations, ${parameters} parameters written to src/services/seedData.ts`,
);
