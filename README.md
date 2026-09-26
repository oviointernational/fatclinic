# FatClinic EHR

Hospital information system: dashboard, front desk, clinical care & triage,
laboratory, pharmacy, radiology, physiotherapy, billing, AI assistant, admin.

## Run locally

```bash
npm install
npm run dev        # frontend on http://localhost:5173
```

## Connect Supabase (external Postgres)

`database/fatclinic.sql` is the single source of truth for the database: tables,
indexes, triggers, Row Level Security, views and seed data. It is idempotent, so
re-running it is safe.

1. Supabase dashboard → your project → **Project Settings → Database**. Use the
   **Direct** connection (port **5432**), not the pooler, so the schema can apply.
2. Copy `.env.example` to `.env` and fill in the **separate** `PGHOST` /
   `PGPASSWORD` values rather than a `postgresql://` URL. A generated password
   usually contains `@` or `#`, which corrupts a connection string and surfaces as
   a bogus DNS error. See `scripts/db-config.mjs`.
3. Apply and verify the schema:
   ```bash
   npm run db:apply
   ```
   This runs the whole file in one transaction, rolls back on any error, and then
   checks RLS coverage, the `anon` grants, audit immutability, invoice arithmetic,
   the `updated_at` triggers and the seed rows. It exits non-zero if anything is
   wrong, and the apply log is safe to paste back for debugging.
4. **Turn OFF "Enable email signup"** in **Authentication → Providers → Email**.
   This is not optional: the policies grant every authenticated session full
   clinical access, so open signup means public patient data.
5. Create a Supabase Auth account for each seeded staff email
   (`USR-001` … `USR-009`; see the `users` table).
6. Or let the Node service do steps 1–3 on boot:
   ```bash
   npm run build
   npm start        # API + app on $PORT (local default 3001)
   ```
   It auto-applies `database/fatclinic.sql`; look for
   `[fatclinic] Postgres schema applied.`

SSL is automatic for public hosts. `database/fatclinic.sql` creates 34 tables
(`users`, `patients`, `visits`, `invoices`, `payments`, `audit_logs`, …) and
7 operational views, with Row Level Security on every table. To check the file
without a database connection: `npm run db:lint`.

API: `GET /api/health`, `POST /api/init`, generic CRUD at
`/api/:table` and `/api/:table/:id` over the allow-listed tables.
