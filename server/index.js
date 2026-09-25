/**
 * FatClinic EHR — Node service entry point.
 *
 * Single service that:
 *  1. Connects to external Postgres (Supabase) using DATABASE_URL
 *     (also accepts DATABASE_PUBLIC_URL / DATABASE_PRIVATE_URL),
 *     falling back to local defaults.
 *  2. Auto-applies database/fatclinic.sql (idempotent) on boot.
 *  3. Exposes a generic /api REST layer over the allow-listed tables.
 *  4. Serves the Vite production build (dist/) + SPA fallback.
 *
 * Local dev:  npm run dev          (Vite on :5173, /api proxied to :3001)
 * Local API:  node server/index.js (API + dist on $PORT or 3001)
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const PORT = Number(process.env.PORT || 3001);

// External Postgres (Supabase): DATABASE_URL first, then alternates,
// then local defaults.
const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  process.env.DATABASE_PRIVATE_URL ||
  'postgresql://postgres:postgres@localhost:5432/fatclinic';

// SSL: public hosts (Supabase, etc.) require it; private/internal and
// localhost do not. Override explicitly with PG_SSL=true/false.
const _isPrivateHost = /railway\.internal|localhost|127\.0\.0\.1/.test(CONNECTION_STRING);
const _sslEnv = String(process.env.PG_SSL || '').toLowerCase();
const USE_SSL = _sslEnv === 'true' || (_sslEnv !== 'false' && !_isPrivateHost);

const pool = new pg.Pool({
  connectionString: CONNECTION_STRING,
  ssl: USE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

let dbReady = false;
let dbError = null;

async function applySchema() {
  const schemaPath = path.join(ROOT, 'database', 'fatclinic.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    dbReady = true;
    dbError = null;
    console.log('[fatclinic] Postgres schema applied.');
  } finally {
    client.release();
  }
}

async function initDb(retries = 12) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      await applySchema();
      return;
    } catch (err) {
      dbError = String((err && err.message) || err);
      console.error(`[fatclinic] Postgres not ready (attempt ${attempt}/${retries}): ${dbError}`);
      if (attempt === retries) {
        console.error('[fatclinic] API running in DEGRADED mode (no database). Frontend still served.');
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Allow-listed tables + primary keys exposed over /api.
const TABLES = {
  wards: 'code',
  permission_nodes: 'key',
  custom_roles: 'id',
  role_permissions: null, // composite key
  users: 'id',
  patients: 'id',
  visits: 'id',
  vitals: 'id',
  consultations: 'id',
  clinical_diagnoses: 'id',
  lab_investigations: 'id',
  lab_parameters: 'id',
  lab_requests: 'id',
  lab_test_orders: 'id',
  lab_results: 'id',
  medications: 'id',
  prescriptions: 'id',
  prescription_items: 'id',
  service_prices: 'id',
  invoices: 'id',
  invoice_items: 'id',
  payments: 'id',
  online_bookings: 'id',
  lab_stock_items: 'id',
  lab_stock_requests: 'id',
  radiology_orders: 'id',
  physiotherapy_orders: 'id',
  clinical_consumables: 'id',
  consumable_requests: 'id',
  consumable_usage: 'id',
  medication_requests: 'id',
  audit_logs: 'id',
  system_settings: 'id',
  receipt_settings: 'id',
};

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function requireDb(_req, res, next) {
  if (!dbReady) {
    return res.status(503).json({ ok: false, error: 'Database unavailable', detail: dbError });
  }
  return next();
}

app.get('/api/health', async (_req, res) => {
  if (!dbReady) return res.status(503).json({ ok: false, db: false, error: dbError });
  try {
    const [{ rows: tables }] = [await pool.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    )];
    const counts = {};
    for (const t of ['patients', 'visits', 'invoices', 'audit_logs']) {
      try {
        const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
        counts[t] = r.rows[0].n;
      } catch { counts[t] = null; }
    }
    return res.json({ ok: true, db: true, time: new Date().toISOString(), tables: tables[0].n, counts });
  } catch (err) {
    return res.status(500).json({ ok: false, db: false, error: String((err && err.message) || err) });
  }
});

// Re-apply schema on demand (idempotent).
app.post('/api/init', requireDb, async (_req, res) => {
  try {
    await applySchema();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

// ---- generic CRUD ----
app.get('/api/:table', requireDb, async (req, res) => {
  const { table } = req.params;
  if (!Object.hasOwn(TABLES, table)) return res.status(404).json({ ok: false, error: 'Unknown table' });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  try {
    const rows = await pool.query(`SELECT * FROM ${table} ORDER BY 1 DESC LIMIT $1`, [limit]);
    return res.json({ ok: true, rows: rows.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

app.get('/api/:table/:id', requireDb, async (req, res) => {
  const { table, id } = req.params;
  const pk = TABLES[table];
  if (!pk) return res.status(404).json({ ok: false, error: 'Unknown table or no single PK' });
  try {
    const rows = await pool.query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [id]);
    if (!rows.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, row: rows.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

app.post('/api/:table', requireDb, async (req, res) => {
  const { table } = req.params;
  if (!Object.hasOwn(TABLES, table)) return res.status(404).json({ ok: false, error: 'Unknown table' });
  const data = { ...(req.body || {}) };
  try {
    const cols = Object.keys(data);
    if (!cols.length) return res.status(400).json({ ok: false, error: 'Empty body' });
    const vals = cols.map((c) => {
      const v = data[c];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await pool.query(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    return res.status(201).json({ ok: true, row: rows.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

app.put('/api/:table/:id', requireDb, async (req, res) => {
  const { table, id } = req.params;
  const pk = TABLES[table];
  if (!pk) return res.status(404).json({ ok: false, error: 'Unknown table or no single PK' });
  const data = { ...(req.body || {}) };
  delete data[pk];
  try {
    const cols = Object.keys(data);
    if (!cols.length) return res.status(400).json({ ok: false, error: 'Empty body' });
    const vals = cols.map((c) => {
      const v = data[c];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const rows = await pool.query(`UPDATE ${table} SET ${sets} WHERE ${pk} = $${cols.length + 1} RETURNING *`, [...vals, id]);
    if (!rows.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, row: rows.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

app.delete('/api/:table/:id', requireDb, async (req, res) => {
  const { table, id } = req.params;
  const pk = TABLES[table];
  if (!pk) return res.status(404).json({ ok: false, error: 'Unknown table or no single PK' });
  try {
    await pool.query(`DELETE FROM ${table} WHERE ${pk} = $1`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

// ---- static frontend + SPA fallback ----
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.json({ ok: true, service: 'fatclinic-ehr', dist: false }));
}

app.listen(PORT, () => {
  console.log(`[fatclinic] listening on :${PORT} (dist: ${fs.existsSync(DIST) ? 'yes' : 'not built'})`);
  void initDb();
});
