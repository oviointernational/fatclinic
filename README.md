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

1. Supabase dashboard → your project → **Project Settings → Database**. Copy
   `.env.example` to `.env` and fill in the **separate** `PGHOST` / `PGPASSWORD`
   values rather than a `postgresql://` URL, and wrap the password in single
   quotes. A generated password usually contains `@` or `#`; in a URI the `#`
   truncates the string and the `@` invents a phantom host, so the failure looks
   like a DNS error for a nonsense name. Unquoted in `.env`, dotenv also treats
   `#` as a comment and silently truncates. See `scripts/db-config.mjs`.

   The host you want is the **Session pooler**, not the direct connection. A
   direct host is very often IPv6-only, and a machine without an IPv6 route cannot
   reach it — that surfaces as `connect ENETUNREACH`, which reads like a
   credentials problem and is not one. Rather than go and look the string up:

   ```bash
   npm run db:fix-connection   # probes the regions and rewrites PGHOST/PGPORT/PGUSER
   ```

   This concerns the admin scripts only. The deployed website never opens a
   Postgres connection — see "How the app talks to the database" below.
2. Apply and verify the schema:
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
   npm run db:check-rls      # the anon key is blocked, and email self-signup is off
   npm run db:check-orphan   # a valid session with no staff profile reads nothing
   ```
   Both call the public API exactly as a browser would. `check-rls` also reads
   `/auth/v1/settings` and **fails** if email self-signup is enabled, so the one
   setting that would expose every patient record is a test result rather than
   something to remember to check.
5. Create the first administrator. There are **no seeded accounts**, on purpose: a
   seeded account is a credential that ships to production, and a literal password
   in a source file also ships in the JavaScript bundle, readable by anyone who
   loads the page.

   Add `SUPABASE_SERVICE_ROLE_KEY` to `.env` (Project Settings → API → service_role
   → Reveal; keep it out of git), then:

   ```bash
   npm run staff:list                       # who exists, and who can sign in
   npm run staff:add -- --dry-run \
     --name "Dr. Sarah Alabi" --email you@fatclinic.health --role ADMINISTRATOR
   npm run staff:add -- \
     --name "Dr. Sarah Alabi" --email you@fatclinic.health --role ADMINISTRATOR
   ```

   Omit `--password` and one is generated and printed once. Never paste that key
   into chat or commit it: it bypasses every access rule in the database.

   Adding a colleague from the app's admin screen creates their **profile** only.
   The password cannot be set from a browser — it needs the service_role key — so
   the screen prints the command to run:
   `npm run staff:add -- --link USR-003`. Use `--link` with a new `--password` to
   reset a forgotten one, and `--disable USR-003` to revoke access.
6. Prove the whole path works, with a real sign-in:
   ```bash
   STAFF_PASSWORD='the-generated-password' \
     npm run db:check-signin -- you@fatclinic.health
   ```
   This signs in for real, reads through the live API, and asserts that the SQL
   helpers resolve, that an admin may write to configuration, that a `DELETE` on
   the staff table is refused, and that deactivating a profile revokes access
   without touching the auth account. Every write is rolled back.

SSL is automatic for public hosts. `database/fatclinic.sql` creates 34 tables
(`users`, `patients`, `visits`, `invoices`, `payments`, `audit_logs`, …) and
7 operational views, with Row Level Security enabled **and forced** on every
table. There is deliberately no `users.password` column: credentials belong to
Supabase Auth, and nothing in this repository ever stores one.

### How the app talks to the database

The browser talks to Supabase directly over HTTPS. There is no application
server, no API to deploy, and no proxy — `src/services/supabase.ts` creates the
client and `src/services/sync.ts` reconciles localStorage against Postgres.
`wrangler deploy` publishes static files only.

Sign-in is `supabase.auth.signInWithPassword` (`src/services/auth.ts`). A valid
session is not on its own enough: the app also requires an `active` row in
`public.users` and destroys the session when there is not one, and RLS resolves
the caller with `app_user_role()`, which returns NULL for an unrecognised or
disabled account. Both halves matter — the browser check is what keeps a stale
account out of the UI, and the SQL helper is what keeps it out of the data.

The header badge reports the truth about saving: it queries the database rather
than a local endpoint, and shows outstanding unsaved changes in preference to the
connection colour, so it cannot show a green light over unsaved work.

### Database checks

| Command | What it does | Needs a database |
|---|---|---|
| `npm run db:lint` | Static checks on the SQL: every seed column, foreign key, index and view target exists, seed values satisfy their own CHECK constraints, ward codes match the TypeScript model, no credential column | no |
| `npm run db:lint:test` | Injects known defects to prove `db:lint` actually catches them | no |
| `npm run db:config:test` | Proves the `.env` password guards and the host resolver behave correctly, including the dotenv `#` truncation trap | no |
| `npm run db:sync:test` | Proves the sync layer against the schema: mappers emit only real columns, every required column is always sent, values survive a round trip, and inserts/updates/deletes/children/grandchildren/append-only tables/queue coalescing all behave as documented | no |
| `npm run db:sync:defects` | Breaks `sync.ts` ten ways and requires the self-test to fail each time | no |
| `npm run db:test` | All five of the above | no |
| `npm run db:apply` | Applies the schema in a transaction, then verifies RLS, grants, triggers, invoice math and seeds. Fails if a retired demo profile is still present, or if a verification probe leaked a row | yes |
| `npm run db:find-region` | Finds which IPv4 pooler region the project is in, by handshaking | yes |
| `npm run db:fix-connection` | The same, and writes the answer to `.env` | yes |
| `npm run db:check-rls` | Proves the anon key is blocked by RLS over the public API, and that email self-signup is off | no (HTTP) |
| `npm run db:check-orphan` | Creates a throwaway auth account with no staff profile, signs in for real, and proves it reads and writes nothing | yes (service_role) |
| `npm run db:check-signin` | Signs in as a real staff member: proves RLS admits them, role gating works, and a deactivated profile loses access | yes + a password |
| `npm run db:check-api` | Proves every table and view in the SQL file is actually live and in the PostgREST schema cache | no (HTTP) |
| `npm run db:verify` | Lint, sync self-test, RLS, orphan and live API in one pass | yes (service_role) |
| `npm run staff:list` | Every staff profile, and whether each one can actually sign in | yes (service_role) |
| `npm run staff:add` | Create a staff sign-in account, or reset one with `--link` | yes (service_role) |
| `npm run staff:clean-demo` | Deletes the nine demo profiles a previous schema version seeded. `--dry-run` first | yes (service_role) |

`db:lint` is not a substitute for `db:apply` — it cannot type-check expressions or
prove a trigger fires. It exists because a seed that names a valid column can
still be rejected by a CHECK constraint, and that is not obvious until the
database says so.

The `:test` scripts exist because a linter that silently checks nothing
looks exactly like a linter that passes. Each one injects a defect and requires
the linter to name it.

`db:check-api` and `db:check-rls` need no Postgres connection — only the project
URL and the anon key, over HTTPS. That matters because a machine that cannot
route to the IPv6-only direct host can still be fully checked: a table can be
created and still be absent from the PostgREST schema cache, and the app's first
query against it then fails at runtime. A `404 PGRST205` means the name is not in
the cache; a `401` means it is in the cache and the anon role has no grant, so
the script verifies that split with a control name rather than assuming it.

### If the connection times out

A Supabase **direct** database host is very often IPv6-only — `Resolve-DnsName`
will show an `AAAA` record and no `A` record. A machine with no usable IPv6 route
gets `connect ENETUNREACH`, which is a routing problem, not a credentials
problem. Run `npm run db:fix-connection` and it will find the region and rewrite
`.env` for you.

This is worth being precise about, because it is easy to misread: **the IPv6 host
has nothing to do with hosting the website.** The browser talks to
`https://<ref>.supabase.co/rest/v1`, which is IPv4 and fronted by Cloudflare, and
works from any machine. A direct Postgres socket is only ever opened by the
`db:*` and `staff:*` scripts, on an administrator's machine. A project can be
live on the web while `db:apply` is unreachable, and that is not a contradiction.

`scripts/find-region.mjs` cannot narrow the field with DNS, because
`aws-0-<region>.pooler.supabase.com` is a wildcard: every region name resolves
over IPv4 whether or not it is yours. It has to handshake each candidate, and
Supavisor answers "tenant/user not found" for the ones that are not — a clean
negative, so a wrong guess costs one connection attempt and never a wrong answer.

`scripts/db-config.mjs` also falls back to a direct DNS query when the OS
resolver returns `ENOENT` for a name that PowerShell resolves fine, and retries
transient failures a few times. It only substitutes an IP address when there is
no alternative, so TLS SNI and `pg_hba` matching normally still see the
hostname.

## Deploying

`npm run deploy` builds and publishes the static bundle to Cloudflare Pages.
There is nothing to run server-side. Run `npx wrangler login` once.

Set these as build-time variables on the Pages project (**Settings → Environment
variables**), not in a committed file:

| Variable | Where to get it |
|---|---|
| `VITE_SUPABASE_URL` | Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Project Settings → API → anon public |

The anon key is designed to be public, so it is safe in the bundle **only**
because Row Level Security is enabled and forced on all 34 tables. Do not set
`SUPABASE_SERVICE_ROLE_KEY` here — it bypasses RLS entirely, and a build variable
ends up in the published JavaScript.

`SUPABASE_SERVICE_ROLE_KEY` belongs in `.env` on an administrator's machine, for
the `staff:*` and `db:check-orphan` commands only. It is gitignored and must
never be pasted into chat, committed, or added to the Pages project. Note that
`wrangler dev` reads `.env` and exposes every value in it as an environment
binding, so if a Worker is ever added to this project, that key becomes
reachable from server-side code by accident. `wrangler deploy` publishes only the
`dist` assets, so nothing in `.env` is uploaded today.

To test the built bundle exactly as it will be served — same SPA fallback, same
headers, no dev server in the way:

```bash
npm run build
npx wrangler dev          # serves dist on a local port
```

## Upgrading from the version that shipped demo accounts

A previous schema seeded nine fictional clinicians (`USR-001` … `USR-009`) and the
frontend shipped the password `FatClinic123` in the JavaScript bundle. Both are
gone from this repository, and `db:apply` now fails if those profiles reappear. If
your project was applied from the old file, those rows are still in the database:

```bash
npm run staff:clean-demo -- --dry-run
npm run staff:clean-demo
```

They cannot sign in — none has an auth account — but they are invented people in a
database of real records, and their names will appear in audit trails. The script
deletes only those nine exact addresses and stops rather than guessing if the
list does not match what it expects.

