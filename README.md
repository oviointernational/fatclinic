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
   `PGPASSWORD` values rather than a `postgresql://` URL, and wrap the password
   in single quotes. A generated password usually contains `@` or `#`; in a URI
   the `#` truncates the string and the `@` invents a phantom host, so the
   failure looks like a DNS error for a nonsense name. Unquoted in `.env`, dotenv
   also treats `#` as a comment and silently truncates. See `scripts/db-config.mjs`.
3. Apply and verify the schema:
   ```bash
   npm run db:apply
   ```
   This runs the whole file in one transaction, rolls back on any error, prints
   the offending line if one fails, and then checks RLS coverage, the `anon`
   grants, audit immutability, invoice arithmetic, the `updated_at` triggers, the
   seed rows and the absence of credential columns. It exits non-zero if anything
   is wrong. Transaction failures roll back, so a bad run leaves nothing behind.
4. Confirm the policies are enforced from outside, not just present in the
   catalog:
   ```bash
   npm run db:check-rls
   ```
   This calls the public PostgREST endpoint as a browser would and asserts that
   the anon key can read and write nothing.
5. **Turn OFF "Enable email signup"** in **Authentication → Providers → Email**.
   This is not optional: the policies grant every authenticated session full
   clinical access, so open signup means public patient data. `db:check-rls`
   cannot verify this setting — it is the one thing to confirm by hand.
6. Create a Supabase Auth account for each seeded staff email
   (`USR-001` … `USR-009`; see the `users` table).
7. Or let the Node service do steps 1–3 on boot:
   ```bash
   npm run build
   npm start        # API + app on $PORT (local default 3001)
   ```
   It auto-applies `database/fatclinic.sql`; look for
   `[fatclinic] Postgres schema applied.`

SSL is automatic for public hosts. `database/fatclinic.sql` creates 34 tables
(`users`, `patients`, `visits`, `invoices`, `payments`, `audit_logs`, …) and
7 operational views, with Row Level Security enabled **and forced** on every
table. There is deliberately no `users.password` column: credentials belong to
Supabase Auth.

### Database checks

| Command | What it does | Needs a database |
|---|---|---|
| `npm run db:lint` | Static checks on the SQL: every seed column, foreign key, index and view target exists, seed values satisfy their own CHECK constraints, ward codes match the TypeScript model, no credential column | no |
| `npm run db:lint:test` | Injects known defects to prove `db:lint` actually catches them | no |
| `npm run db:config:test` | Proves the `.env` password guards and the host resolver behave correctly, including the dotenv `#` truncation trap | no |
| `npm run db:sync:test` | Proves the sync layer against the schema: mappers emit only real columns, every required column is always sent, values survive a round trip, and inserts/updates/deletes/children/grandchildren/append-only tables/queue coalescing all behave as documented | no |
| `npm run db:sync:defects` | Breaks `sync.ts` six ways and requires the self-test to fail each time | no |
| `npm run db:test` | All five of the above | no |
| `npm run db:apply` | Applies the schema in a transaction, then verifies RLS, grants, triggers, invoice math and seeds | yes |
| `npm run db:check-rls` | Proves the anon key is blocked by RLS over the public API | no (HTTP) |
| `npm run db:check-api` | Proves every table and view in the SQL file is actually live and in the PostgREST schema cache | no (HTTP) |
| `npm run db:verify` | Lint, sync self-test, RLS and live API in one pass | no (HTTP) |

`db:lint` is not a substitute for `db:apply` — it cannot type-check expressions or
prove a trigger fires. It exists because a seed that names a valid column can
still be rejected by a CHECK constraint, and that is not obvious until the
database says so.

The `:test` scripts exist because a linter that silently checks nothing
looks exactly like a linter that passes. Each one injects a defect and requires
the linter to name it.

`db:check-api` and `db:check-rls` need no Postgres connection — only the project
URL and the anon key, over HTTPS. That matters on a machine that cannot route to
the IPv6-only database host, where `db:apply` cannot run at all: a table can be
created and still be absent from the PostgREST schema cache, and the app's first
query against it then fails at runtime. A `404 PGRST205` means the name is not in
the cache; a `401` means it is in the cache and the anon role has no grant, so
the script verifies that split with a control name rather than assuming it.

### If the connection times out

A Supabase **direct** database host is often IPv6-only — `Resolve-DnsName` will
show an `AAAA` record and no `A` record. If the machine has no usable IPv6 route
you will get `connect ENETUNREACH`, which is a routing problem, not a
credentials problem. Switch `PGHOST` / `PGUSER` / `PGPORT` in `.env` to the
**Session pooler** row from Project Settings → Database → Connection string: it
serves IPv4, and the username becomes `postgres.<project-ref>`. Both forms apply
the schema correctly.

`scripts/db-config.mjs` also falls back to a direct DNS query when the OS
resolver returns `ENOENT` for a name that PowerShell resolves fine, and retries
transient failures a few times. It only substitutes an IP address when there is
no alternative, so TLS SNI and `pg_hba` matching normally still see the
hostname.

API: `GET /api/health`, `POST /api/init`, generic CRUD at
`/api/:table` and `/api/:table/:id` over the allow-listed tables.
