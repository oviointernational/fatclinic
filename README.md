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

   Afterwards you can create and reset colleague accounts **from the app's admin
   screen**, with a real password field, once the Edge Function below is
   deployed. The `staff:add` script stays available for break-glass use.
6. Deploy the `staff-accounts` Edge Function, so administrators can create
   accounts and reset passwords from inside the app:
   ```bash
   npx supabase login                                    # once
   npx supabase functions deploy staff-accounts
   ```
   See "Staff accounts" below for why this exists and what it does.
7. Prove the whole path works, with a real sign-in:
   ```bash
   STAFF_PASSWORD='the-generated-password' \
     npm run db:check-signin -- you@fatclinic.health
   ```
   This signs in for real, reads through the live API, and asserts that the SQL
   helpers resolve, that an admin may write to configuration, that a
   **non-administrator cannot delete a staff row**, and that deactivating a
   profile revokes access without touching the auth account. Every write is
   rolled back.

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

### Staff accounts

Three things, and one small server-side function:

| Who | What | How |
|---|---|---|
| Staff member | Change their own password | **My Account → Password**. No server component. |
| Administrator | Create a colleague's account with a password | **Admin → Staff → Add Staff Account** |
| Administrator | Set a new password for someone who forgot theirs | **Admin → Staff → Reset Password** |

The first has no privileged component at all: `changePassword` in
`src/services/auth.ts` is a signed-in user writing their own credential, which
needs no key that is not already in the browser.

The other two do, and that is the whole reason `supabase/functions/staff-accounts`
exists. Creating or resetting a Supabase Auth account requires the
`service_role` key, which **bypasses every row-level security policy in the
database**. Shipping it to the browser would hand the patient table to anyone who
opened devtools — so the key lives in the function's server-side secrets and
never crosses the wire toward the client. The function is not a backend and is
not in the path of clinic data: ordinary records still go straight from the
browser to Postgres through RLS, exactly as before.

**Deploy it.** The function cannot be deployed from this repository without a
Supabase personal access token, which is an account credential, not a project one:

```bash
npx supabase login                                     # dashboard → account → access tokens
npx supabase functions deploy staff-accounts
```

There is no third step and no secret to paste. Supabase injects
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` into every
Edge Function automatically, so the privileged key is already present server-side
after the deploy. It cannot be set by hand either: the `SUPABASE_` prefix is
reserved, and both the Dashboard and the Management API reject it.

Until it is deployed, the admin screens say exactly that rather than failing
vaguely, and the CLI (`npm run staff:add -- --link USR-003`) still works.

**Confirm it is live.** `npm run db:check-function-live` needs no password and no
service_role key, so it is safe to run any time:

```bash
npm run db:check-function-live
```

It distinguishes *deployed* from *not deployed* (an undeployed function answers
404 `Edge Function "staff-accounts" not found`, which is easy to mistake for
something else) and then checks the property that actually matters: that the
gateway refuses an unauthenticated POST **before** the handler runs, so the
service_role key is not one request away from the public internet. Both the
gateway and the handler answer with a `code`; the gateway's are always
`UNAUTHORIZED_*` and the handler's are lowercase, which is how the two are told
apart.

**What it checks.** The request body is a request, not a claim. The handler
resolves the caller from the email inside their own verified JWT, requires an
`active` `ADMINISTRATOR` row in `public.users`, and ignores any `role`,
`user_id` or `is_admin` the browser sent. A valid session is not an
administrator, and a disabled administrator is refused. There are two checks
because the gateway's `verify_jwt` only proves the caller signed in.

**Nothing is registered unless the details are right.** The Add Staff dialog writes
the staff profile *before* it calls the function, because the function needs a
profile to link the credential to. So the dialog checks first, and a rejected
submission leaves no trace at all — no profile, no account:

| Rejected in the form | Why |
|---|---|
| the address is already used | a second profile for one person splits their record in two |
| the address is not an email | refused before anything is written |
| passwords do not match | the handover password has to be typed twice |
| the password breaks a rule below | listed all at once, not one per attempt |

**Password rules, enforced server-side.** At least 8 characters, no spaces, no
leading or trailing whitespace, not a short list of common passwords, not the
email address, **not the staff member's own name**, not one repeated character.

The rules are duplicated in the form for a faster answer, and only the server-side
copy counts — client validation of a secret can be skipped from the console. The
two are pinned to each other by a test that imports both and requires an
identical verdict and an identical message for 19 inputs, so they cannot drift:
`npm run db:check-staff-accounts`. Duplicating rather than sharing is deliberate;
sharing the file would mean bundling the privileged handler into the browser,
which is the one thing it exists to keep out of there.

Name words shorter than four characters are ignored, or "Ana" and "Obi" would
reject a great many reasonable passwords and teach people to ignore the rule.

**A password you issue is not theirs to keep.** Both operations set
`users.must_change_password`, and `App.tsx` then refuses to render the
workstation until it is replaced — the credential you read out over a ward
telephone is a handover password. `My Account → Password` clears the flag itself.
The gate always offers **Sign out instead**: someone who cannot get in must still
be able to leave.

**Creating is two writes, in a fixed order.** The profile is written first
through the ordinary RLS-protected path, then the account is created. If the
second step fails the leftover is a profile with no sign-in account, which is
inert and retried by the same button. The other order would leave a live
credential that no profile exists for.

**Every privileged action is audited** into `audit_logs` under the `SEC-` prefix,
attributed to the acting administrator, and never containing the password. The
table is append-only, so those rows cannot be edited afterwards — including by
this test suite, which is why `db:check-staff-accounts` has to disable the
immutability trigger for one statement in order to clean up after itself.

### Database checks

| Command | What it does | Needs a database |
|---|---|---|
| `npm run db:lint` | Static checks on the SQL: every seed column, foreign key, index and view target exists, seed values satisfy their own CHECK constraints, ward codes match the TypeScript model, no credential column | no |
| `npm run db:lint:test` | Injects known defects to prove `db:lint` actually catches them | no |
| `npm run db:config:test` | Proves the `.env` password guards and the host resolver behave correctly, including the dotenv `#` truncation trap | no |
| `npm run db:sync:test` | Proves the sync layer against the schema: mappers emit only real columns, every required column is always sent, values survive a round trip, and inserts/updates/deletes/children/grandchildren/append-only tables/queue coalescing all behave as documented | no |
| `npm run db:sync:defects` | Breaks `sync.ts` ten ways and requires the self-test to fail each time | no |
| `npm run db:test` | All five of the above | no |
| `npm run db:apply` | Applies the schema in a transaction, then verifies RLS, grants, triggers, invoice math and seeds. Fails if a retired demo profile is still present, if a verification probe leaked a row, or if a live policy is not declared in `database/fatclinic.sql` (or vice versa) | yes |
| `npm run db:find-region` | Finds which IPv4 pooler region the project is in, by handshaking | yes |
| `npm run db:fix-connection` | The same, and writes the answer to `.env` | yes |
| `npm run db:check-rls` | Proves the anon key is blocked by RLS over the public API, and that email self-signup is off | no (HTTP) |
| `npm run db:check-orphan` | Creates a throwaway auth account with no staff profile, signs in for real, and proves it reads and writes nothing | yes (service_role) |
| `npm run db:check-signin` | Signs in as a real staff member: proves RLS admits them, role gating works, a non-admin cannot delete a staff row, and a deactivated profile loses access | yes + a password |
| `npm run db:check-password` | Proves a signed-in user can rotate their own password with no one-time code, that the new one works, the old one stops working, and the account is restored afterwards | yes + a password |
| `npm run db:check-staff-accounts` | Runs the real `supabase/functions/staff-accounts/handler.ts` under Node against the live project: create and reset succeed, the passwords really authenticate, the profile is linked, refusals hold for a clinician / a disabled admin / a forged token / a weak password, the browser and the function agree on every password rule, and everything it created is removed | yes + a password |
| `npm run db:check-email` | Inserts a real staff row and proves the live database refuses a second one for the same address, including when only the case differs. The form's message is help; this is the guarantee | yes (service_role) |
| `npm run db:probe-auth-admin` | Pins the Auth admin API shapes the function depends on (`PUT` is the only update verb, `?filter=` is ignored so an email lookup must page), then deletes the account it made | yes (service_role) |
| `npm run db:check-function-live` | Tells a deployed `staff-accounts` apart from an undeployed one, and proves the gateway refuses an unauthenticated POST before the handler runs | no (HTTP) |
| `npm run db:check-api` | Proves every table and view in the SQL file is actually live and in the PostgREST schema cache | no (HTTP) |
| `npm run db:purge-test-audit` | Deletes `SEC-` audit rows the checks left behind. `--dry-run` first | yes |
| `npm run db:verify` | Lint, sync self-test, RLS, orphan, live API and the Auth admin probe in one pass | yes (service_role) |
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

**Push to `main`. That is the whole procedure.** Cloudflare builds and deploys
it. There is nothing to configure in the dashboard, no variables to set, and no
secret to paste anywhere.

The two values the bundle needs are committed in `.env.production`:

| Variable | What it is | Where it is used |
|---|---|---|
| `VITE_SUPABASE_URL` | the project hostname | inlined into the bundle at build time |
| `VITE_SUPABASE_ANON_KEY` | the public anon key | inlined into the bundle at build time |

Neither is a secret. The URL is a hostname, and the anon key is designed to be
public — it already ships inside the JavaScript that every browser downloads. It
cannot read or write a patient record on its own, because RLS is enabled and
forced on every table. Committing them is what removes the setup step: a CI
machine has no `.env` (that file is gitignored, because it holds the
service_role key) but it does have the repository, so the values are already
there.

To deploy from this machine instead, run `npx wrangler login` once and then
`npm run deploy`.

`SUPABASE_SERVICE_ROLE_KEY` must never go in `.env.production` or in any
Cloudflare setting. It bypasses RLS entirely, and every `VITE_` value is inlined
into published JavaScript. It belongs in `.env` on an administrator's machine,
for the `staff:*` and `db:check-*` commands only.

Because those values are baked in at build time, `npm run build` **fails** if
they are missing or still contain a `[YOUR-…]` placeholder. Without that check a
build without them would deploy cleanly, render the sign-in screen, and be
unable to authenticate — with nothing in the logs to explain it. `npm run dev`
stays permissive and falls back to local-only mode.

One trap worth knowing: `wrangler dev` reads `.env` and exposes every value in it
as an environment binding, so if a Worker is ever added to this project the
service_role key becomes reachable from server-side code by accident.
`wrangler deploy` publishes only the `dist` assets, so nothing in `.env` is
uploaded.

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

