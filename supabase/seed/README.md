# Demo data

`demo.sql` fills the CivPMS database with realistic demo accounts, companies and projects, so you can
click through the app and run browser tests against real data. `demo-cleanup.sql` removes all of it
again. **Remove the demo data before real users arrive** (see [Removing the demo data](#removing-the-demo-data)).

- **Idempotent.** Run `demo.sql` as often as you like. It reuses existing accounts, companies,
  projects, members, codes and WBS trees, adds only what's missing, and resets the demo password.
- **Built through the app's own RPCs.** Only the five sign-in accounts are inserted directly into
  `auth.users` / `auth.identities` (confirmed email + password). Everything else is created by
  calling the same RPCs the app uses, while impersonating each user. So permissions, activity logs,
  notifications, Baseline v1 and budget alerts are exactly what real use would produce.
- **No real email.** Every address is on `@civpms.test`, a reserved top-level domain that can't
  receive mail. The app's mailer skips reserved domains (`.test`, `.example`, `.invalid`, `.localhost`),
  so notification emails for these accounts end up `skipped` and are never sent.
- **The password is not in the repository.** It lives in `.env.local` as `DEMO_PASSWORD`, which
  is git-ignored. The script reads it from the session setting `civpms.demo_password`.

## Accounts

All accounts use the same password: `DEMO_PASSWORD` from `.env.local`.

| Email | Name | Role | Company | Sees |
|---|---|---|---|---|
| `owner@civpms.test` | Juan Dela Cruz | Owner PM | Dela Cruz Builders | All 4 Dela Cruz projects |
| `pm@civpms.test` | Maria Santos | PM (joined by email invitation) | Dela Cruz Builders | Cebu (PM), Davao (PM) |
| `inspector@civpms.test` | Paolo Reyes | Inspector (joined with the company invite code) | Dela Cruz Builders | Cebu (inspector) |
| `rival@civpms.test` | Ana Villanueva | Owner PM | Bayanihan Construction | Her 1 project only (tenant isolation) |
| `newbie@civpms.test` | (none) | Signed up and confirmed, **not onboarded** | none | Lands on onboarding |

There is also one pending email invitation, to `invitee@civpms.test` (no account) for Cebu as
inspector. Dela Cruz Builders has a company-wide inspector invite code, with no expiry or use limit.
Paolo has used it once.

## Projects

| Project | Company | Status | Budget | Allocated | What it shows |
|---|---|---|---:|---:|---|
| Cebu Coastal Road Widening | Dela Cruz | Active (Baseline v1) | ₱190,000,000.00 | ₱134,050,150.50 (71%) | Full 3-level WBS: 4 deliverables, 8 sub-deliverables, 16 work packages. Maria (PM) and Paolo (inspector) are members. |
| Iloilo Riverside Mixed-Use Tower | Dela Cruz | Planning | ₱450,000,000.00 | ₱427,500,000.00 (95%) | **Near Budget Limit**. Has a level-2 milestone (0 h). |
| Davao Drainage Rehabilitation, Phase 2 | Dela Cruz | Active (Baseline v1) | ₱48,500,000.00 | ₱53,990,500.00 (111%) | **Delayed** (ended 30 Sep 2026) and **Budget Exceeded**. The budget alert notified Juan and Maria. |
| Laguna Warehouse Expansion | Dela Cruz | Planning | ₱72,000,000.00 | ₱0.00 | No activities, for testing empty states. |
| Pampanga Farm-to-Market Road, Package 1 | Bayanihan | Planning | ₱24,500,000.00 | ₱21,580,000.00 (88%) | Ana's project. Dela Cruz users must never see it. |

Work packages carry a start date, a duration in working hours, an end date and a cost. Parents carry
no values of their own (D21). End dates follow D20 on the default calendar: Mon–Fri, 8 h/day, with
Philippine holidays non-working. For example, Cebu 1.1.1 (80 h from Mon 26 Oct 2026) skips All
Souls' Day and ends Mon 9 Nov. The same dates come out of `computeEndDate()` in `src/lib/domain`.

Things to know when testing:

- **Dates are fixed.** Progress updates come in a later phase, so every activity stays Not Started.
  Once an activity's start date has passed, the app may show it as derived-Delayed. Cebu starts on
  26 Oct 2026.
- **Invitation tokens are shown only once.** Only a hash is stored. To open the invitation landing
  page for `invitee@civpms.test`, sign in as Juan and **Resend** the invitation: `resend_invitation`
  returns a fresh token.
- **`newbie@civpms.test` is single-use for onboarding tests.** Once someone completes onboarding with
  it, it stays onboarded, and re-running the seed does not undo that. For more fresh accounts, sign up in
  the app with an address on `@civpms.test` that carries your tag (e.g. `f3-tester@civpms.test`), then
  confirm it in the SQL editor:
  `update auth.users set email_confirmed_at = now() where email = 'f3-tester@civpms.test';`
- **Re-running doesn't undo test changes.** The seed only adds what's missing: renamed projects stay
  renamed, and a project whose WBS still has activities isn't touched. Status changes are kept too,
  except that a project back in Planning is moved to Active again (Cebu and Davao only).

## Running the seed

Get the password from `.env.local` (`DEMO_PASSWORD=…`). On a fresh PC, choose any password of at
least 10 characters, add it to `.env.local` as `DEMO_PASSWORD=…`, and run the seed. Re-running it
**changes the password of every demo account** to the one you pass, so keep a single shared value.

### Supabase SQL editor (easiest)

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Type this first line, using your password:

   ```sql
   select set_config('civpms.demo_password', 'YOUR-DEMO-PASSWORD', false);
   ```

3. Below it, paste the whole content of `supabase/seed/demo.sql` and click **Run**. The result
   lists the five projects with their budget state and Delayed flag.
4. Remove the first line before saving the snippet (or don't save it), so the password isn't stored
   in the dashboard.

### psql (PowerShell)

Use the **Session pooler** connection string from Dashboard → **Connect**, as in
[`docs/DATABASE.md`](../../docs/DATABASE.md#sql-tests). psql runs `-c` and `-f` in order, in one session:

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres.bxfohhwvzbvmyokcsmwq:<db-password>@<pooler-host>:5432/postgres"
$demo = (Select-String -Path .env.local -Pattern '^DEMO_PASSWORD=(.*)$').Matches[0].Groups[1].Value
psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -c "select set_config('civpms.demo_password', '$demo', false)" -f supabase/seed/demo.sql
```

### Agents (Supabase MCP `execute_sql`)

Send `select set_config('civpms.demo_password', '<DEMO_PASSWORD>', false);` followed by the content
of `demo.sql` in **one** `execute_sql` call. Never write the password into a committed file or a report.

## Checking sign-in

`scripts/verify-demo-accounts.mjs` signs in as each account with the publishable key, checks
onboarding, company and the projects that account can see (tenant isolation), and checks the badges
(`budget_state`, `is_delayed`):

```powershell
node --env-file=.env.local scripts/verify-demo-accounts.mjs
```

Behind an HTTP proxy, as in agent containers, prefix it with `NODE_USE_ENV_PROXY=1`. It exits with
code 1 if any check fails, and never prints the password.

## E2E accounts (`found-e2e.sql`)

The app-foundation specs (`e2e/found-*.spec.ts`) never change the demo company. They use their own
tenant:

| Email | Role |
|---|---|
| `found-owner@civpms.test` | Owner PM of "[FOUND] QA Builders" with the project "[FOUND] Bell Test Project" |
| `found-inspector@civpms.test` | Inspector in the "No company yet" state; the specs make it join and leave again |

`found-e2e.sql` creates only the two confirmed accounts (same password as the demo accounts, set the same
way as for `demo.sql`). `e2e/helpers/found-tenant.ts` creates the company and project through the app's
RPCs on first use and resets the inspector before each spec. `demo-cleanup.sql` removes them too.

## Removing the demo data

`demo-cleanup.sql` deletes every `@civpms.test` account, the companies they own with everything
under them, invitations addressed to `@civpms.test`, and their activity-log rows. It runs in one
transaction. The log is append-only, so the script briefly disables the log's delete guard
inside that transaction. Set `c_purge_logs` to `false` at the top to keep those log rows; they then
stay as invisible, orphaned snapshots. Avatar files are not deleted: the notices list any to remove
by hand in **Storage → avatars**.

Run it in the SQL editor (no password needed) **only when the demo data is no longer needed**,
typically right before inviting real users. The final query must return `0` and `0`. Also remove
`DEMO_PASSWORD` from `.env.local`, and never set it on Vercel.
