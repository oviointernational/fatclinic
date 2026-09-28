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

### Two faces of one app: the public site and the workstation

The app has two audiences and two routes, split in `src/Root.tsx` by a hand-rolled
router (`src/router.ts` — no react-router dependency):

- **`/` is the public landing page** (`src/components/landing/LandingPage.tsx`):
  who the clinic is, what it does, how booking works, and contact details. No
  staff chrome, no patient data, nothing that requires a session.
- **`/staff` is the workstation** — the sign-in gate, then the dashboard. The
  `wrangler.jsonc` SPA fallback sends every other path there, so a deep link or a
  bookmark onto an old route still lands in the app.

A password-reset link lives in the URL **fragment** (`#access_token=…`) so it is
never sent to a server or logged. It arrives at the root path, so `Root` renders
the workstation whenever `hasResetLink()` is true **at any path** — otherwise a
reset email would open the public page and the link would silently die. A
signed-in staff member visiting `/` is redirected to `/staff` instead of being
shown the visitor page.

Visitors book without ever holding a session: the landing page's booking modal
(`OnlineBookingModal` with a pluggable `submit` prop) calls the anon-callable RPC
`app_submit_online_booking`, which validates the payload in the database, derives
the age from the date of birth (a client-supplied age is never trusted), issues
the `REG-####` patient code, and refuses a duplicate phone on the same pending
date. The visitor's row lands in `online_bookings` with status `Pending Arrival`
and surfaces in the front desk's Online Bookings lookup exactly like one created
on a workstation — same table, same sync, same check-in flow.

Sign-in is `supabase.auth.signInWithPassword` (`src/services/auth.ts`). A valid
session is not on its own enough: the app also requires an `active` row in
`public.users` and destroys the session when there is not one, and RLS resolves
the caller with `app_user_role()`, which returns NULL for an unrecognised or
disabled account. Both halves matter — the browser check is what keeps a stale
account out of the UI, and the SQL helper is what keeps it out of the data.

The header badge reports the truth about saving: it queries the database rather
than a local endpoint, and shows outstanding unsaved changes in preference to the
connection colour, so it cannot show a green light over unsaved work. A write the
database **refuses** is reported separately from one that is merely pending, with
the database's own message, and the count only falls when the refused write has
actually succeeded — the badge used to read "nothing pending" the whole time,
because the queue entry was removed before the request was sent.

#### A blank field, and what happens to it

This is the bug that emptied the consultations table, so the rule is written down.

A controlled input the clinician left empty holds `''`. `''` is a legal value for
a text column and illegal for everything else. So in the mappers:

- a field the clinician may leave empty is wrapped in `orNull()`, which sends
  `''` as SQL NULL. This is the *only* place that translation happens, and it is
  opt-in per field rather than a blanket rule, because about twenty `NOT NULL
  TEXT` columns legitimately receive `''` and a blanket rule would trade one lost
  consultation for another;
- a numeric field is sent as it stands, and `forPostgres()` — the one chokepoint
  every row passes through — refuses a non-finite number, naming the table and
  column, instead of letting Postgres reject the request with a message that
  names neither;
- an array field goes through `list()`, and a jsonb field through a `typeof`
  check, so a value of the wrong shape becomes *no entries* rather than a
  malformed literal that voids the record.

The two halves are not symmetric, and the asymmetry is deliberate. A blank sent to
a **nullable** column is a defect: the mapper knew the field was optional, so it
had every chance to send NULL. A blank sent to a **NOT NULL** column is not the
same thing — the mapper cannot send NULL there without inventing data, and for a
clinical value inventing data is worse than refusing the write, because a recorded
temperature of 0 is a falsehood in a patient's chart while a refused save leaves
the chart true. `npm run db:crud` fails on the first and lists the second, by
table and column, so the count is known rather than guessed.

#### A value the column must have, and the form that asks for it

The second kind has to be closed somewhere, and it cannot be closed in the data
layer — that is the whole reason it is separated out above. The place that can
ask for the number a second time is the form.

`vitals` is where this actually bit. Its table carries a CHECK constraint per
measurement, and the nursing form checked only whether a box was **empty**. A
nurse who typed a temperature of 22 °C, a blood pressure of 22/111 and a pulse
of 11 was told *Recorded!*, the app wrote an audit row saying the vitals were
recorded, and Postgres refused the insert outright — `bmi` is `NUMERIC(4,1)` and
cannot hold the 22400 the arithmetic produced from those numbers. The table held
nothing, the chart said the reading was on file, and the audit trail — which is
append-only, so it cannot be corrected — said it permanently. It was found by
reading a database that had two `RECORD_VITALS` audit rows and no vitals.

`src/services/vitalsLimits.ts` now owns those bounds. Three things are deliberate
about it:

- **the ranges are transcribed from the CHECK constraints, and two checks hold
  them to that.** `db:consultation-test` parses `database/fatclinic.sql` and fails
  if a range is not declared there; `db:crud` reads the **live** constraints out
  of `information_schema` and fails in both directions — every value the form
  accepts must actually store, and every value it refuses must actually be
  refused. A range widened in TypeScript without the schema cannot pass both.
  Tightening one is a clinical decision, so it is made deliberately or not at all.
- **the derived values are checked too.** BMI is computed, not typed, so the nurse
  cannot be blamed for it — but it still has to fit `NUMERIC(4,1)`, and that is a
  consequence of the weight and the height. A weight and a height that each pass
  on their own can still overflow it, which is precisely how the original reading
  was voided by a number nobody typed. `computeBmi()` returns a refusal rather
  than a value the column will not take.
- **one calculation, three former copies.** BMI and its category were computed in
  the live banner, in `recordVitals` and in the audit message, and each could
  round or categorise differently — so the banner could show *Obese Class I* above
  a value the record filed under something else. The same reasoning as `entryText`
  in the consultation: one function, called by the display and by the save.

The refusal is a message, not a clamp. It names the field, the value typed and the
range the column accepts, so a nurse can correct the reading; and the form says
*Not recorded* rather than *Recorded!*, because nothing was recorded. The reason
is shown on the form as well as in the alert — an alert is dismissed, and the
reading still has to be fixed.

Because an upsert is a single request, any one of these refusals used to void
*every* field on the record while the form said "Saved!". That is why the refusals
are surfaced, and why the audit exists.

#### The other forty columns with the same problem

`vitals` is where this was found, and it is the one table where a nurse types a
number into a box on a form that can be made to explain itself. The schema carries
**53 numeric CHECK constraints**, and they are the same defect everywhere: one
figure outside its range voided the whole row, and the complaint came back as
`new row for relation "invoice_items" violates check constraint
"invoice_items_quantity_check"` — the constraint, not the figure, and not the box.
A cashier's invoice with a zero-quantity line, a stock request for zero, a payment
of zero: all lost, all reported as saved.

No form range-checks any of them, so the guard belongs at the boundary, in the same
function that already refuses a `NaN` before the request is built. `COLUMN_RANGES`
in `src/services/sync.ts` transcribes all **39** of those columns that the client
can actually send. The other fourteen are excluded for reasons that are stated
rather than assumed, and the test derives both exclusions from the code instead of
restating them in a third list:

- **vitals** (12) is checked in the nursing form, as above.
- **the four money columns the database recalculates** (`invoices.subtotal`,
  `total`, `paid_amount`, `balance`) are refused by `assertNoDbOwnedColumns`, which
  runs *after* the range check. A range message about a column that must not be
  sent at all would explain the wrong problem, so the guard stays out of the way.

What this buys is not the refusal — the database was already refusing — it is a
refusal that can be acted on, before the write, naming the column and the figure and
the range. And it is *both* directions: the same table proves that a legitimate
figure at the edge of the range still goes through, because a guard that refuses a
valid payment is worse than no guard at all.

Three checks hold the transcription to reality, because a transcription is only as
good as its agreement with what it was copied from:

| | what it proves |
|---|---|
| `db:sync:test` | every guarded range is the range `database/fatclinic.sql` states, and every numeric CHECK that can reach the client is guarded |
| `db:sync:defects` | the guard is reachable (deleting the call fails 6 checks) and correct (widening `payments.amount` fails 2 more) |
| `db:crud` | the schema file and the **deployed** database agree, and the real write path refuses a zero-quantity line by name without writing anything |

That last one is the one that matters most, because it is the only one that can
catch the file being wrong. The other two would happily pass forever against a
schema the app no longer matches.

#### A test that creates a credential has to prove it removed it

The live checks sign in as throwaway clinicians, with real roles, against a
database of patient records. That is the only way to prove the RLS policies and
the write path are what they claim — and it means every one of them creates a
working credential that must not survive the run.

Two did. `db:crud` reported `removed the throwaway sign-in account (200)` and
the accounts were still there an hour later, found by a *different* check that
counted auth accounts and expected two. The lesson is not "use a better delete" —
the delete worked when it was actually issued. It is that **a `200` is not
evidence of an effect**, and a cleanup that prints success on a status code alone
is a false all-clear, which is worse than no cleanup at all because it stops
anyone looking.

So every live script now confirms by listing: `db:crud` and
`db:check-profile-lookup` already did, `db:check-forced-password-change` and
`db:check-deployed` now do, and `db:check-forgot-password` is the backstop that
notices a probe account left by *any* of them — matched on the prefix of the
local part, never the domain, because the probes deliberately live on the
clinic's own `@fatclinic.health`.

The one subtlety: a just-created account does not show up in the admin listing
straight away, so "look for it by email and see it is absent" is satisfied by an
account that was never listed either. `db:check-deployed` therefore looks by
**id** — absence of an id that came from the create response means absence — and
asserts separately that the listing was readable at all, because a `401` there
would otherwise read as a clean sweep. That is the same "assert the thing the
answer depends on" rule the rest of this suite is built on, applied to the test
itself — and it is only worth anything because it was checked: run against the
live API, the predicate does find a live account, does report a never-existed id
as gone, and does flip from present to absent across a real create-and-delete. A
predicate that can only ever answer "gone" would have passed every run.

`db:crud` also has a `finally` that cannot cover a process that has died, and the
direct-Postgres connection to Supabase does intermittently drop mid-run, so the
credential is removed from a process-level handler as well. `CRUD_AUDIT_DIE=now`
makes it die on purpose, and `CRUD_AUDIT_DIE=signin` takes the earlier exit, so
both are proven rather than asserted.

That fix found a second bug in the same file. All three of the audit's early
exits did `failures++` and `return`, and the summary that sets the exit code sat
*after* them — so a run that could not even create its throwaway clinician
printed nothing and **exited 0**. The gate reported success because the audit had
not run. The summary now sits in a `finally` those returns cannot step over, and
a run that completes zero checks fails rather than reporting "all 0 checks behaved
as expected".

#### The schema file has to be the whole database

`database/fatclinic.sql` is meant to be a complete description of the database,
and the checks that make that true were only ever applied to tables and views.
Functions were the hole, and it had already swallowed something.

`db:apply` compared the policies the file declares against the policies the
database has, in both directions, because `CREATE POLICY IF NOT EXISTS` can only
add — a policy added straight to the database outlives every apply and a rebuild
loses it. It does the same thing for nothing else. Extending it to functions
immediately found `app_own_account_id()`: live, written on purpose alongside
`app_current_staff_id()`, and in no file, so a rebuild would have dropped it with
nothing to notice. It is now declared, with a note that nothing calls it.

The parallel check that caught the other half — a function the file *uses* but
never creates, which is a rebuild that dies on the policy naming a function that
is nowhere in the file you would be reading to fix it — belongs in `db:lint`,
and it scans only the `USING`/`WITH CHECK` predicates and `EXECUTE FUNCTION`.
That is deliberate: those are the only places a project function is called from
policy and trigger wiring, and there are no Postgres built-ins there to confuse a
name-based check, so the rule needs no allow-list to stay honest. Calls inside a
function *body* are not scanned, because those do need one; that gap is covered
instead by applying the file to an empty database, where Postgres refuses the
body itself.

Both sides of both comparisons drop a `public.` qualifier, because the file
declares some functions qualified and some bare. Comparing them as written would
report every policy call in the file as missing.

#### The remembered past has to be a copy

This is the bug that lost a doctor's corrections without a trace, and it is the
one rule here that is enforced by the *shape* of an API rather than by
discipline.

`saveStorage` is handed a whole collection and works out what changed by
comparing it with what the collection looked like before. So something has to
remember that "before" — and if it holds the caller's own object, the caller's
next in-place edit rewrites the memory. `arr[0].field = x`, and the past becomes
the present: the diff finds nothing changed, the write is dropped, and nothing at
all happens. No request, no error, no failure badge, and the form says "Saved!".

This was not theoretical. `db.saveConsultation` updates an existing consultation
with `this.consultations[i] = updated`, mutating the array it was given, so the
**first** save of a consultation reached the database and the second and every
later one did not. A doctor who corrected a typo, or added the complaint they had
left out of a previous visit, saw no error, no loss of the entry, and a record
that kept the first version forever. It was found by reading the browser's network
log: the Save produced an `audit_logs` POST and nothing else.

So the map lives in `sync.ts` as `recordPersisted` / `persistedBefore`, and
`recordPersisted` **always copies**. Deliberately, the copy is the only available
way in — there is no function that accepts a caller's object as the remembered
past, so no caller can forget to copy and no future caller can reintroduce the
bug. `db:test` asserts it both ways: an in-place edit of a remembered row, of a
row appended afterwards, and of a nested value, and the past is unchanged.

The same self-test also pins the two properties this depends on: an unchanged
save issues no request at all, and a collection that was never persisted has no
past (`undefined`, not an empty collection — otherwise the first save of every
row would look like a change to nothing).

#### When a doctor may write

A doctor's queue is built by nurses: a patient arrives, a nurse records vitals and
sends the patient to a doctor. Until that happens the doctor has nothing to
consult, and until the visit moves on they have no reason to reopen it. So the
consultation is view-only for `Awaiting Vitals` and `With Nurse`, writable from
`With Doctor` through `Admitted`, and view-only again once the visit is `Treated`,
`Discharged` or `Completed` — a closed visit is amended by a new visit, not by
editing a finished one.

The rule lives in one place, `src/services/consultationAccess.ts`, and it is
keyed on the **selected** visit rather than the patient's latest, because the
visit dropdown lists every visit that patient has ever had and the two are not
always the same. `ConsultationForm.tsx` and `NursingStation.tsx` both ask it, so
the doctor's screen and the nurse's queue cannot disagree.

It is enforced on the **handlers**, not on the buttons. A button is presentation
and can be bypassed by a keyboard shortcut, a stale dialog or a queued click; a
handler is the point where the mutation happens. The thirteen open handlers call
`refuseIfReadOnly()` first, and the Save button, the read-only banner and any open
dialog are all consequences of the same answer rather than separate
implementations of it.

This gate is in the client, so it is a **workflow** rule, not a security rule: the
database admits any signed-in staff member to `consultations`, because a nurse, a
doctor and an administrator all write there and they do not write the same rows.
Protecting the *record* is RLS's job; protecting the *workflow* is this gate's
job. `npm run db:crud` states that distinction rather than pretending the gate is
a database constraint.

#### The consultation's lists, and what they are allowed to say

Four of the six Patient's Info tabs are not columns. They are lists of entries
that get **folded** into a handful of free-text columns when the doctor saves, and
**seeded** back out of those columns when the tab is opened. That is a lossy
shape, and it is where this app lost clinical text three separate times. All of it
now lives in `src/services/consultationSeed.ts` rather than in
`ConsultationForm.tsx`, because logic a component owns is logic no test can check
— and every one of these bugs was found in a component.

Four rules, and each one has a test that fails if it is broken:

**A list describes what was recorded. It never invents anything.** When a visit
has no consultation, every list starts empty. The diagnosis list used to start with
a worked example — `Plasmodium falciparum malaria / B50.9 / Primary` — so a
doctor who opened a patient they had never consulted and pressed Save wrote
invented clinical data into that patient's record. `seededLists()` returns all
five lists at once, so one assertion covers the whole rule.

**One function decides what an entry's text is, and it serves both the screen and
the save.** The entry dialog has a *Complaint* box and a *Details* box; the save
folded only `body`, so the complaint — the reason the patient came in — was
discarded while appearing on screen the whole time. `entryText()` joins both boxes
and is called by the list renderer *and* by the fold. Two code paths that each
choose their own subset of what was typed are two chances to show a clinician
something different from what gets stored, and the one that shows more than it
stores is the one that loses the text.

**A round trip has to settle, not merely arrive.** The plan and the impression are
folded as `"<title>: <text>"` so that several items stay distinguishable in one
column. The seed then read that column back with its own title still attached, so
every save added another: `"Treatment Plan: Treatment Plan: Appendicectomy..."`.
`stripTitlePrefix()` removes one leading title on the way in, and
`db:consultation-test` asserts **stability** — five save-and-reload cycles leave
the column byte-identical. A one-time-correctness check would not have caught this
class of bug, because the value is briefly right before it starts to grow.

**A note is not a plan.** The plan fold covered every management entry, so a
clinician's note was written into the treatment plan as well as into the notes —
twice on the record, once in a column where it reads as part of the treatment.
`isNotesEntry()` is the single substring test both folds use, so they cannot
disagree about which entry is which, and `splitStoredPlan()` lifts the note lines
back out of records already written that way. Only the module's own notes title is
lifted: a plan can contain a line beginning with anything at all, and treating an
arbitrary "something: text" as a heading would break a clinician's prose into
pieces that were not headings.

`npm run db:consultation-test` runs 197 checks over this module, the doctor's gate,
the examination column mapping, the surgery list and the vitals limits, and
`db:consultation:defects` breaks it twenty-three ways to prove those checks are
real; `db:crud` then proves the six sections against the live database as a
signed-in clinician and reads every value back with SQL rather than with the app's
own reader.

### Staff accounts

Four things, and one small server-side function:

| Who | What | How |
|---|---|---|
| Staff member | Change their own password | **My Account → Password**. No server component. |
| Administrator | Create a colleague's account with a password | **Admin → Staff → Add Staff Account** |
| Administrator | Set a new password for a colleague who forgot theirs | **Admin → Staff → Reset Password** |
| Administrator | Reset their **own** forgotten password, by email | **Sign-in screen → "Forgotten your password?"** — see [Forgotten password](#forgotten-password) |
| Anyone else, locked out | Ask their administrator. There is no email route for them, and the app says so rather than sending a mail that will not arrive | — |

If someone is suddenly told their password is wrong when it is not, read
[Locked out, but the password is right](#locked-out-but-the-password-is-right)
first. It is the single most confusing thing that can happen at this screen, and
the answer is not what the message says.

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

**Confirm the deploy has the rules you think it has.** The suites above import
`handler.ts` and run it locally, which proves the code is correct and says
nothing about what Supabase is serving. Those two come apart in the ordinary
way: the function is edited, the tests stay green, and production keeps running
the version from the last deploy. `npm run db:check-deployed` calls the real URL
and checks the behaviour end to end, which is the only check that can tell the
two apart:

```bash
npm run db:check-deployed
```

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
telephone is a handover password. The gate always offers **Sign out instead**:
someone who cannot get in must still be able to leave.

#### The person who was issued the password clears the flag, not the app

This is the one thing in the account model that has to work for *everybody*, and
it was broken for anyone who is not an administrator. `public.users` is an admin
table, so its `UPDATE` policy requires `app_is_admin()`: a clinician writing
their own row matches no policy and **the write does nothing** — silently,
returning zero rows and no error. The offline store's own push is an `upsert`,
which RLS refuses outright with `42501`. So `must_change_password` could not be
cleared by the only person who was ever going to clear it.

The result looked like a network fault, and every layer above the database
reported success:

1. The person signed in with the issued password and chose their own.
2. Supabase **stored the new credential.** The change had worked.
3. The flag never cleared, so the "choose your password" screen stayed up.
4. They tried again, naturally, with the same password. Supabase refused it —
   *New password should be different from the old password* — and because that
   did not match the re-authentication pattern it was reported as
   **"The password could not be changed. Contact Administration."**

So they were sent to an administrator to report a fault with a password that had
in fact just been set correctly, by a workstation that could not be unlocked at
all. There was a second, independent cause: the forced screen is reachable
*before* the local store has been reconciled, and `setCurrentUser` discarded
the update when the profile was not in the local list yet — a silent no-op
behind the same symptom.

Clearing the flag is therefore a function in the database,
`app_clear_own_must_change_password()`. It is not a widened policy because RLS is
row-level: "your own row" would also hand over `role`, `active` and `pin`, which
is self-promotion to administrator. The function takes no arguments, writes one
boolean on the one row that is the caller's, resolves the row with
`app_current_staff_id()` (so an orphaned token matches nothing), and is
`anon`-proof. `db:apply` re-creates and re-grants it every run.

`db:check-forced-password-change` pins all of it against the live project,
including that a clinician still **cannot** write `users` by any other route —
asserted on purpose, because that is the condition which made the function
necessary, and a future policy change that removed it should fail a test rather
than pass quietly.

**A refusal that is the user's own fault is named, not escalated.** "You already
have that password", a password in the leaked-password list, and "too short" are
each reported as what they are. They used to fall through to *Contact
Administration*, which is both untrue and — for the first of them — the reason
somebody was permanently locked out.

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

**Known blocker: a staff profile that appears in the audit log cannot be
deleted at all.** The trigger refuses `UPDATE` *and* `DELETE`, and
`audit_logs.user_id` is `ON DELETE SET NULL` — so deleting a profile makes
Postgres fire an `UPDATE` the trigger rejects, and the delete fails with
`audit_logs is append-only; UPDATE is not permitted`. In a clinic that means any
clinician who has ever touched a patient record can never be removed by an
administrator, which is the opposite of what an offboarding screen promises.
Undecided: the honest options are to make the FK `ON DELETE RESTRICT` and have
the app *deactivate* rather than delete (the audit trail keeps its attribution,
which is the point of an audit trail), or to narrow the trigger to refuse
`UPDATE` of recorded values while permitting an `ON DELETE SET NULL` attribution
rewrite. The first preserves more; the second is a smaller change. Not decided
here, and it needs a decision before delete-staff ships.

### Locked out, but the password is right

Supabase refuses a sign-in after roughly **15–18 failed attempts on one account**,
and from then on it answers the **correct** password with the same
`invalid_credentials` a wrong one gets. It looks exactly like a forgotten
password. It is not one.

Measured against this project, on throwaway accounts:

| | |
|---|---|
| Trigger | ~15–18 failed attempts on that one account |
| The limit is | **per account**, not per address — one person's typos do not lock out the rest of the clinic |
| Correct password while locked | refused, `429 over_request_rate_limit` |
| Retyping the correct password | **does not help** — every retry re-arms the lock |
| Left alone | clears itself in **under a minute** |
| Password re-set by an administrator | clears it immediately |

That combination is what makes it so confusing. The natural response to "your
password is wrong" is to type it again, and typing it again is the one thing
guaranteed to keep the account locked. Someone can be certain their password is
right, watch it be rejected all afternoon, and conclude the credential has broken.

**What to do.** Stop trying and wait a minute. If it keeps happening, an
administrator can clear it at once with **Admin → Staff → Reset Password**.

The app now says so rather than claiming the password is wrong
(`src/services/authFailure.ts`, pinned by `npm run db:check-signin-locked`):

> Too many failed sign-in attempts for this account. Your password is not the
> problem. Wait a minute without trying, then sign in once.

Distinguishing the two is safe to do — a rate limit says nothing about whether an
address exists, so it leaks no more than a wrong password does. The two are told
apart on the shape of the refusal, and the test pins **both** directions, because
the expensive mistake is the one that shows a wrong-password warning to a
locked-out colleague.

### Forgotten password

**Sign-in screen → "Forgotten your password?"** Enter your email address.

| Whose address you type | What happens |
|---|---|
| A **clinic administrator** | Supabase emails a reset link to that address. Open it, choose a new password, then sign in as normal. |
| Anyone else, including an address that has never heard of the clinic | Nothing is sent. The screen reads **"Contact Clinic Administrator for reset"**, and the administrator can set a new password from **Admin → Staff → Reset Password**. |

The form carries no notice about who this route is for. The rule is stated in the
outcome and nowhere else, so the only person who reads "administrators only" is one
whose address turns out not to qualify — which is the person who needed to know it.
That outcome is shown in a neutral panel rather than the red error box: the
request succeeded, the answer is simply that this route is closed to the address
typed, and red would say something is broken when nothing is.

The refusal is a single fixed sentence, and that is load-bearing rather than lazy.
It is the same for a clinician, for a disabled administrator's address, and for an
address that has never heard of the clinic, so the endpoint cannot be used to
discover who works here.

**Delivery is not guaranteed on this project.** No SMTP is configured, so
reset links go out through Supabase's built-in mailer, which is rate-limited
(one message per minute, per the project's own `max_frequency`) and on many
projects only delivers to team members' addresses. If an administrator waits a few
minutes and nothing arrives, use the terminal route below rather than assuming the
address is wrong. `db:check-forgot-password` proves a link is *generated* and
correctly addressed; only the recipient can confirm arrival, and that limit is why
no check claims otherwise.

**A reset link does not sign anybody in.** The link carries a recovery token, and
the app deliberately handles it with a separate Supabase client created with
`persistSession: false`, held in one closure and never shared
(`src/services/passwordReset.ts`). Nothing is written to localStorage. On a shared
clinic workstation this is the difference between "someone followed a link and
walked away" and "the next person at this desk has a live administrator session
nobody noticed". The person who follows the link still signs in normally with the
password they just chose, and the token is spent and discarded once it is set.

`detectSessionInUrl` stays **off** in `src/services/supabase.ts` for the same
reason: the shared client would parse the link and persist the token before any of
this ran.

#### Why the decision is made server-side, and not in the browser

The obvious implementation is one line: `supabase.auth.resetPasswordForEmail(email)`
from the sign-in form. It needs no function and no privileged key, and it is wrong
here. GoTrue will mail a working reset link to **any** registered address, so a
clinician who typed their own email would get one and reset their own password
without involving anyone — which is exactly what the rule above exists to prevent.

Deciding who gets a link means reading `public.users`, and RLS refuses every read
of that table without a session. So the decision happens in the
`staff-accounts` Edge Function, which holds `service_role` and never returns it.
The mail itself is sent with the **anon** key, not the privileged one: sending
mail is not a privileged operation, and only the role check is. Keeping the
capability this narrowly used means widening the endpoint later cannot silently
widen this too.

#### The one thing this gives away, and the two it does not

The reply is *not* uniform, and that is a knowing trade. It reveals whether an
address belongs to a clinic administrator, and this endpoint is reachable with no
session, so it can be used to confirm that a guessed address is senior staff. It
is accepted because what it exposes is not secret — any signed-in member of staff
can already read the whole staff list with roles — and because the alternative
strands a clinician who has just been told to wait for a mail that will never
arrive. The refusal that results names only the next step: **"Contact Clinic
Administrator for reset"**.

Two things stay hidden, and both matter more:

- **An address with no staff profile gets the byte-identical reply a clinician
  gets** — both are exactly `Contact Clinic Administrator for reset`. Otherwise the
  endpoint is a way to discover who works at the clinic, one guess at a time.
  `db:check-forgot-password` asserts the two replies are equal, not merely similar,
  and pins the wording itself so the sentence cannot drift into explaining the rule
  at the reader instead of telling them where to go.
- **Nothing about the sign-in account is revealed.** The decision is made on the
  staff profile, never on whether GoTrue happens to hold a matching auth user, and
  the reply carries only `{ ok, sent, message }` — no profile id, no auth UUID.

#### Why the function answers callers who are not signed in

`[functions.staff-accounts] verify_jwt` is `false` in `supabase/config.toml`, and
it was `true` until the email flow was added. The reason is not convenience: the
gateway rejects any request whose bearer token is not a valid JWT, and
"forgot password" exists for the person who *cannot* sign in, so a gateway that
demands a token refuses to answer the one request it was built for. The need and
the check are directly opposed.

What replaces it is strictly more, not less. `requireAdmin()` exchanges the
caller's own token for an identity, resolves that address against `public.users`,
and requires an active `ADMINISTRATOR` — so `create` and `reset` are still refused
for a stranger, a clinician, and a disabled account. The gateway check was never
more than "is this a valid JWT", a subset of what the handler enforces. `forgot` is
dispatched **before** the session check, and `create`/`reset` fall straight through
to it unchanged. An unrecognised action from a signed-out caller still gets the
same 401, so the endpoint cannot be used to probe which action names exist.

The genuinely lost thing is early rejection: an unauthenticated request now costs
one function invocation before the handler refuses it. That is a cost and an
availability question, not an authorisation one. **Read the comment in
`supabase/config.toml` before changing it back.**

#### The redirect allow-list is in the repo, not in the dashboard

A reset link only works if its destination is allow-listed, and that is a project
setting rather than part of the schema. It is declared in `supabase/config.toml`
(`site_url` and `additional_redirect_urls`) and applied with:

```bash
npx supabase config push
```

so a link can never land on a blank page because of a setting somebody changed in
a dashboard and forgot. `db:check-forgot-password` asserts a generated link comes
back to the deployed app rather than to `localhost`, and arrives in the URL
**fragment** (`#access_token=…`), which is the shape `passwordReset.ts` parses. A
Supabase upgrade that switched it to a `?code=` query would fail that check and
name the change, instead of leaving the reset screen quietly unreachable.

#### What the audit trail records, and why it has no actor

Every request writes an `audit_logs` row, including refusals. A reset is
attributed to nobody, and says so: `user_id` null, `user_name` `''`, `user_role`
`NONE`, and `metadata.session = 'none'`.

This is deliberate and it is the honest answer. The person asking cannot sign in,
so there is no identity to attribute the request to. Reusing the address they typed
as though it were an authenticated caller would put a false actor in the very log
an auditor reads to answer "who asked for this?" — and an unattributed entry is
visible, while a misattributed one is worse than nothing. `audit_logs` is
append-only, so these rows cannot be quietly tidied up afterwards either, which is
also asserted by the check.

The browser-side password rules (`src/services/passwordPolicy.ts`) are applied
here as an **advisory** check, not as enforcement: this path sets the password with
`auth.updateUser`, which talks straight to GoTrue and never reaches the handler, so
the only rule actually applied server-side is GoTrue's own configured minimum. The
handler's copy remains the one that counts for `create` and `reset`.

#### Still the way back in when no email is coming

The terminal route below needs no mail at all, and does not depend on the mailer,
the rate limit, or the address being one the built-in service will deliver to:

```bash
npm run staff:list                 # find your own id, USR-001 for the first admin
npm run staff:add -- --link USR-001 --password 'a-new-password-you-choose'
```

`--link` works on an account that already exists, so this both sets a new
password and re-links the profile. Verified end to end on a throwaway account: the
old password is refused and the new one signs in. The profile row, and its audit
history, are untouched — resetting a password is not a new account.

**Then change it again from inside the app.** That command sets a password you
type on a shared machine, so treat it as a way back in rather than a way to live.
Once you are in, **My Account → Password** sets one only you know.

Two things that make this easier to get wrong than they look:

- **Stop after a few tries and wait.** Around 15–18 wrong attempts locks the
  account for about a minute, and every retry during that window re-arms it. See
  [Locked out, but the password is right](#locked-out-but-the-password-is-right).
- **The admin reset button is inside the workstation you are locked out of.** It
  is for a signed-in administrator resetting a colleague, not for getting yourself
  back in.

### Database checks

| Command | What it does | Needs a database |
|---|---|---|
| `npm run db:lint` | Static checks on the SQL: every seed column, foreign key, index and view target exists, every function a **policy or trigger calls** is created by the file, seed values satisfy their own CHECK constraints, ward codes match the TypeScript model, no credential column | no |
| `npm run db:lint:test` | Injects 15 known defects to prove `db:lint` actually catches them, including a policy and a trigger calling a function the file never creates | no |
| `npm run db:config:test` | Proves the `.env` password guards and the host resolver behave correctly, including the dotenv `#` truncation trap | no |
| `npm run db:sync:test` | 388 checks against the schema: mappers emit only real columns, every required column is always sent, values survive a round trip, and inserts/updates/deletes/children/grandchildren/append-only tables/queue coalescing all behave as documented. Includes the rule that the remembered past is a **copy**, so an in-place edit cannot make a save vanish without a word, and that every guarded numeric range is the range the schema declares, in both directions | no |
| `npm run db:sync:defects` | Breaks `sync.ts` fourteen ways — the last two removing the boundary range guard and widening one of its bounds — and requires the self-test to fail each time | no |
| `npm run db:consultation-test` | 197 checks on the clinical logic, off-database: every visit status is either writable or explained, the doctor's read-only gate names the reason, a visit with no consultation seeds no invented diagnosis, one function decides an entry's text for both the screen and the save, an examination finding lands in the column its dialog title named (all eleven systems), a surgery entry survives the round trip through the one text column including notes containing the separator, the plan and impression **settle** over five save-and-reload cycles instead of growing a prefix, and every vitals range matches the CHECK constraint the schema declares for it | no |
| `npm run db:consultation:defects` | Breaks the clinical logic twenty-three ways across the five modules — gate, examination mapping, surgery list, seeding/folding and the vitals limits — and requires the self-test to fail each time | no |
| `npm run typecheck:functions` | Type-checks `supabase/functions/staff-accounts/handler.ts`, which the root `tsconfig.json` does not reach — its `include` is `src` only, so both `tsc --noEmit` and `npm run build` report a clean tree while the one file holding the privileged key's only caller goes unchecked | no |
| `npm run db:test` | All nine of the above | no |
| `npm run db:apply` | Applies the schema in a transaction, then verifies RLS, grants, triggers, invoice math and seeds. Fails if a retired demo profile is still present, if a verification probe leaked a row, or if a live **policy or function** is not declared in `database/fatclinic.sql` (or vice versa) | yes |
| `npm run db:reload-schema` | Reloads the PostgREST schema cache after a schema change, so the API answers the definitions `db:apply` just created rather than a stale copy | yes |
| `npm run db:find-region` | Finds which IPv4 pooler region the project is in, by handshaking | yes |
| `npm run db:fix-connection` | The same, and writes the answer to `.env` | yes |
| `npm run db:check-rls` | Proves the anon key is blocked by RLS over the public API, and that email self-signup is off | no (HTTP) |
| `npm run db:check-orphan` | Creates a throwaway auth account with no staff profile, signs in for real, and proves it reads and writes nothing | yes (service_role) |
| `npm run db:check-signin` | Signs in as a real staff member: proves RLS admits them, role gating works, a non-admin cannot delete a staff row, and a deactivated profile loses access | yes + a password |
| `npm run db:check-signin-locked` | Proves a rate-limited account is not reported as a wrong password, in both directions, from every shape the error arrives in. See [Locked out but the password is right](#locked-out-but-the-password-is-right) | no |
| `npm run db:check-password` | Proves a signed-in user can rotate their own password with no one-time code, that the new one works, the old one stops working, and the account is restored afterwards | yes + a password |
| `npm run db:check-staff-accounts` | Runs the real `supabase/functions/staff-accounts/handler.ts` under Node against the live project: create and reset succeed, the passwords really authenticate, the profile is linked, refusals hold for a clinician / a disabled admin / a forged token / a weak password, the browser and the function agree on every password rule, and everything it created is removed | yes + a password |
| `npm run db:check-email` | Inserts a real staff row and proves the live database refuses a second one for the same address, including when only the case differs. The form's message is help; this is the guarantee | yes (service_role) |
| `npm run db:probe-auth-admin` | Pins the Auth admin API shapes the function depends on (`PUT` is the only update verb, `?filter=` is ignored so an email lookup must page), then deletes the account it made | yes (service_role) |
| `npm run db:check-profile-lookup` | Signs in for real as a throwaway clinician and runs the exact `select *` on `users` that sign-in depends on. A column-level grant change once made that query fail, and `fetchProfile` reported it as "Could not reach the sign-in service" — so this pins the query login cannot do without | yes (service_role) |
| `npm run db:check-forgot-password` | The administrator-only reset link, end to end: the function answers a caller with **no session**, a clinician / a disabled admin / an admin with no sign-in account are all refused, an unknown address gets the byte-identical reply a clinician gets, the reply carries no profile id or auth UUID, a real administrator does get a link, the generated link comes back to the deployed app in the URL fragment the app parses, and every request is audited with no actor. It is also the check that notices a **probe account left behind** by any of the live scripts, matched on the prefix of the local part rather than the domain — the probes live on the clinic's own `@fatclinic.health` so they exercise the real uniqueness and rate-limit paths, so a domain match would also match every member of staff. Proves a link is *generated* — only the recipient can confirm it *arrives* | yes (service_role) |
| `npm run db:check-forced-password-change` | The first sign-in after an administrator has issued a password, end to end: the function exists, takes no argument, runs as the definer with a pinned search_path, and only `authenticated` can execute it; a clinician can clear **their own** flag and the database records it; nobody else's row is touched; it cannot grant a role, deactivate an account, or reach a colleague; `anon` cannot call it; a clinician still **cannot** write `users` by any other route (asserted on purpose - it is why the function exists); and Supabase's "you already have that password" refusal is refused, recognised, and not sent to an administrator. This is the check for the lockout where the change *succeeded*, the screen stayed, and the retry was reported as a fault. Its throwaway account is confirmed gone by listing, because this is the script that hands a real role to a fake clinician and drives sign-in end to end | yes (service_role) |
| `npm run db:check-function-live` | Tells a deployed `staff-accounts` apart from an undeployed one, proves the **handler** (not the gateway - `verify_jwt` is off) refuses `create` without a session and to a forged token, and proves the same caller is still *answered* for `forgot` | no (HTTP) |
| `npm run db:check-deployed` | Tests the function **Supabase is actually serving**, not the file on disk: a password containing the staff name is refused, an older rule is still refused, a good password really authenticates, a clinician is refused, and it deletes what it created — then confirms the account is absent from a fresh listing rather than trusting the `200` | yes + a password |
| `npm run db:check-api` | Proves every table and view in the SQL file is actually live and in the PostgREST schema cache | no (HTTP) |
| `npm run db:check-public-booking` | The landing page's booking path, end to end, as a caller with **no session**: the anon role has EXECUTE only by name and cannot read the table or touch another function; a happy-path booking returns a `REG-####` code and really lands in `online_bookings`; a client that lies about its age is stored with the age the database derives from the date of birth; nine malformed payloads are refused, a duplicate phone on the same pending date is refused, and every probe row is swept and confirmed gone | no (HTTP) |
| `npm run db:crud` | 62 checks against the live database, as a real signed-in clinician, through the real write path. Sweeps all 350 columns of all 24 tables for a blank value sent where the column could have taken NULL, then creates, edits and deletes the chain a doctor writes — patient, visit, vitals, consultation, both diagnoses, lab request with its test, prescription with its item — and reads every assertion back with SQL rather than with the app's own reader. It has a dedicated section for all six Patient's Info sections, because a whole tab failing to save is the bug this app actually had: each section is written and read back individually, an unfilled box must land as empty rather than missing, and a removed diagnosis must be gone from the server. It also holds the vitals ranges and the boundary range guard to the **deployed** constraints, in both directions. Everything it creates, including the throwaway account, it removes — and confirms the account is gone rather than trusting the `200`. `CRUD_AUDIT_DIE=now` makes it die on purpose to prove that too | yes (service_role) |
| `npm run db:purge-test-audit` | Deletes `SEC-` audit rows the checks left behind. `--dry-run` first | yes |
| `npm run db:verify` | The live gate, in one pass: lint, the sync self-test, RLS, the orphan account, the live API surface, the **public booking surface**, the clinical CRUD audit, the Auth admin probe, the reset link, and the forced password change. Pair it with `npm run db:test`, which is the off-database gate and covers the consultation suites `db:verify` does not | yes (service_role) |
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

There are two gates, and the split is deliberate. `npm run db:test` needs no
database: it proves the *logic* against the schema file, so it runs on a laptop
on a train and it runs on every save. `npm run db:verify` needs the live project
and proves the *record*: that the columns really exist, that RLS really refuses,
and that a signed-in clinician's save really lands — read back with SQL, not with
the app's own reader. The consultation suites are in the first gate only, because
the folding and seeding bugs they cover were all reproducible without a database.
`db:crud` is in the second because the symptom only exists in the column.

Adding a rule to this table without adding a check that fails when the rule is
broken is how this app ended up with a consultation screen that said "Saved!" six
times over. The count in each row is the count the suite actually runs, and it is
there so that a check quietly shrinking back is visible.

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

