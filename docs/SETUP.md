# CivPMS setup guide (Windows)

How to run CivPMS on your PC, connect it to Supabase, Brevo and Google, and deploy it on Vercel.
All commands are for **Windows PowerShell**. Lines starting with `#` are comments; you don't type them.

**Contents:** [1. Install the tools](#1-install-the-tools) · [2. Get the code](#2-get-the-code) ·
[3. Install packages](#3-install-packages) · [4. Fill in .env.local](#4-fill-in-envlocal) ·
[5. Run the app](#5-run-the-app) · [6. Configure Supabase](#6-configure-supabase) ·
[7. Google sign-in](#7-google-sign-in) · [8. Deploy on Vercel](#8-deploy-on-vercel) ·
[9. Demo accounts](#9-demo-accounts) · [10. Troubleshooting](#10-troubleshooting)

Related: [`docs/DATABASE.md`](DATABASE.md) (database, migrations from Windows, SQL tests) ·
[`docs/DECISIONS.md`](DECISIONS.md) · [`CLAUDE.md`](../CLAUDE.md) (engineering rules).

> **Keep secrets secret.** The Supabase secret key, Brevo keys, SMTP key, Google client secret and
> `CRON_SECRET` go only into `.env.local` (on your PC) and the Vercel / Supabase dashboards. Never
> commit them, paste them into chats or screenshots, or put them in a `NEXT_PUBLIC_*` variable.
> `.env.local` is already ignored by git.

---

## 1. Install the tools

| Tool | Version | Get it |
|---|---|---|
| Node.js | **20.9 or newer** (22 LTS recommended) | <https://nodejs.org> → "LTS" installer. Keep "npm" ticked. |
| Git for Windows | any recent | <https://git-scm.com/download/win> |
| A code editor | | VS Code is a good choice: <https://code.visualstudio.com> |

Close and reopen PowerShell after installing, then check:

```powershell
node --version    # v20.9.0 or higher
npm --version
git --version
```

If PowerShell refuses to run `npm` with "running scripts is disabled on this system", allow scripts
for your user once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2. Get the code

Your folder `C:\Users\HP\Project Management System` is already a git repository linked to
`github.com/Prannsss/CivPMS`. The work lives on the branch **`claude/exciting-sagan-7valgn`**.
The folder name has spaces, so keep the quotes.

```powershell
cd "C:\Users\HP\Project Management System"
git status                                  # check for local changes you want to keep
git fetch origin
git checkout claude/exciting-sagan-7valgn
git pull                                    # get the newest commits on that branch
```

- If `git checkout` says your local changes would be overwritten, save them first with
  `git stash` (bring them back later with `git stash pop`), or discard them if you don't need them.
- Your own files `favicon.ico`, `public/logo.svg` and `public/3.png` … `public/8.png` are kept as they are.

## 3. Install packages

```powershell
npm ci
```

`npm ci` installs the exact versions from `package-lock.json`. Run it again whenever you pull new
commits that change `package.json`. Don't run `npm audit fix` or `npm update`: they change versions.

## 4. Fill in `.env.local`

Create your private settings file from the template and open it:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Fill in each line as follows, save, and close Notepad.

| Variable | What to put | Where to find it |
|---|---|---|
| `APP_URL` | `http://localhost:3000` on your PC | The address you open in the browser. Used in email links. On Vercel it's your site address (step 8). |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://bxfohhwvzbvmyokcsmwq.supabase.co` | Supabase dashboard → **Project Settings → Data API** (Project URL). Already filled in. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Supabase dashboard → **Project Settings → API Keys** → *Publishable key*. Safe for the browser. |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | Same page → *Secret keys* → create one (name it e.g. `civpms-server`) and click the eye icon to copy it. **Server only.** Without it, notification emails stay queued. |
| `BREVO_API_KEY` | `xkeysib-…` | Brevo → your name (top right) → **SMTP & API** → **API Keys** tab → *Generate a new API key*. Copy the key that starts with `xkeysib-`. If Brevo offers an "MCP" / AI-tool key (a long base64 string), that is not the one. |
| `BREVO_SENDER_EMAIL` | e.g. `notifications@yourcompany.ph` | Must be a **verified sender** in Brevo → **Senders, Domains & Dedicated IPs** (see the note below). |
| `BREVO_SENDER_NAME` | `CivPMS` | The "from" name people see. |
| `BREVO_SANDBOX` | `true` on your PC, `false` on Vercel | `true` makes Brevo accept and then **drop** every email, so testing never emails real people. |
| `CRON_SECRET` | a long random string | Generate one (below). Protects `/api/cron/*`. |
| `DEMO_PASSWORD` | the demo accounts' password (step 9) | Only for the seeded demo/test accounts. Never set it on Vercel; production deployments ignore it. |

Generate a `CRON_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**About the sender address.** Use an address on a domain you own (for example
`notifications@yourcompany.ph`) and authenticate that domain in Brevo: **Senders, Domains &
Dedicated IPs → Domains → Add a domain**, then add the SPF, DKIM (and DMARC) DNS records Brevo shows
you at your DNS provider and click *Verify*. A `@gmail.com` sender works for quick tests but is a bad
idea for real use: Gmail's DMARC policy tells inboxes to distrust Gmail addresses sent through other
services, so emails land in spam or are rejected.

Restart `npm run dev` after every change to `.env.local`; Next.js reads it only at startup.

## 5. Run the app

```powershell
npm run dev
```

Open <http://localhost:3000>. You land on the sign-in page. Stop the server with **Ctrl+C**.

Useful checks (they must pass before you push or deploy):

```powershell
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm test             # unit tests (Vitest)
npm run build        # production build, the same thing Vercel runs
```

## 6. Configure Supabase

Open the project at <https://supabase.com/dashboard/project/bxfohhwvzbvmyokcsmwq>. The database
tables, security rules and jobs are already installed (see [`DATABASE.md`](DATABASE.md); it also
explains how to apply future migrations from Windows). What's left are the **Authentication**
settings.

### 6.1 URL configuration

**Authentication → URL Configuration**

- **Site URL**: the address your users use, e.g. `https://civpms.vercel.app` (or your own domain)
  once deployed. Until then, `http://localhost:3000`. The sign-up, password-reset and other auth
  emails build their links from this address.
- **Redirect URLs**: add each address the app runs on, with `/**` at the end:
  - `http://localhost:3000/**`
  - `https://civpms.vercel.app/**` (your production address; add your custom domain too if you use one)
  - optional, for Vercel preview deployments: `https://*-<your-vercel-team>.vercel.app/**`

### 6.2 Email templates

**Authentication → Emails → Templates.** For each template, set the subject and replace the
message body with the full contents of the matching file in `supabase/templates/` (open it in VS Code
or Notepad, select all, copy, paste), then **Save**.

| Template | Subject | File |
|---|---|---|
| Confirm sign up | `Confirm your email for CivPMS` | `supabase/templates/confirm-signup.html` |
| Invite user | `You've been invited to CivPMS` | `supabase/templates/invite.html` |
| Magic link | `Your CivPMS sign-in link` | `supabase/templates/magic-link.html` |
| Change email address | `Confirm your new email for CivPMS` | `supabase/templates/email-change.html` |
| Reset password | `Reset your CivPMS password` | `supabase/templates/reset-password.html` |

These templates send people to `/auth/confirm` on your site (the "token hash" flow), so links work
even when opened on a different device or browser from the one used to sign up.

### 6.3 Custom SMTP through Brevo (required for real users)

Without custom SMTP, Supabase's built-in mailer **only emails the members of your Supabase
organization** and allows just a few emails per hour, so real users would never receive their
confirmation emails. Connect Brevo:

1. In Brevo: **SMTP & API → SMTP** tab. Note the **SMTP server**, **Port** and **Login** (it looks
   like `xxxxxx@smtp-brevo.com`), and click **Generate a new SMTP key**. The SMTP key is **not** the
   `xkeysib-` API key from step 4.
2. In Supabase: **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**:

   | Field | Value |
   |---|---|
   | Sender email | your verified Brevo sender, e.g. `notifications@yourcompany.ph` |
   | Sender name | `CivPMS` |
   | Host | `smtp-relay.brevo.com` |
   | Port | `587` |
   | Username | the Brevo SMTP **login** |
   | Password | the Brevo **SMTP key** |

3. **Authentication → Rate Limits**: raise "Rate limit for sending emails" from the default to
   something like 100 per hour.

Until this is done, sign-up mostly fails, and the app says so in plain language instead of crashing.
Observed on 13 Oct 2026: addresses on reserved domains (`@example.com`, `@civpms.test`) are rejected
as `email_address_invalid` ("This email address can't receive mail"). Real addresses hit the built-in
mailer's hourly cap (`over_email_send_rate_limit`, shown as "We couldn't send your confirmation
email just now, so your account wasn't created"). Addresses outside your Supabase organization get
`email_address_not_authorized` ("email delivery is still being set up"). In every case no account is
created. "Forgot password" behaves the same way.

### 6.4 Email and password rules

**Authentication → Sign In / Providers → Email**: keep **Enable Email provider** and **Confirm
email** on, and set **Minimum password length** to **10** (the app also checks this).

## 7. Google sign-in

Until this is done, the Google button tells people "Google sign-in isn't set up yet" and email
sign-in keeps working.

1. Go to <https://console.cloud.google.com>, create (or pick) a project, e.g. **CivPMS**.
2. **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**):
   - *Branding*: app name `CivPMS`, your support email, and your developer contact email.
     Add your site's home page and privacy policy links when you have them.
   - *Audience*: **External**. While the app is in *Testing*, only the test users you list can sign
     in; click **Publish app** when you go live.
   - *Data access*: the default `email`, `profile` and `openid` scopes are all CivPMS needs.
3. **Clients** (older: **APIs & Services → Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**, name `CivPMS (Supabase)`.
   - **Authorized JavaScript origins**: `http://localhost:3000` and `https://civpms.vercel.app`
     (plus any custom domain).
   - **Authorized redirect URIs**: exactly
     `https://bxfohhwvzbvmyokcsmwq.supabase.co/auth/v1/callback`
   - Create, then copy the **Client ID** and **Client secret**.
4. In Supabase: **Authentication → Sign In / Providers → Google** → enable, paste the Client ID and
   Client secret, **Save**.

## 8. Deploy on Vercel

1. <https://vercel.com> → **Add New… → Project** → import the GitHub repository `Prannsss/CivPMS`.
   The framework preset is detected as **Next.js**; leave the build settings as they are.
2. **Production branch.** Vercel deploys `main` to production by default. Either merge
   `claude/exciting-sagan-7valgn` into `main`, or point production at that branch (project
   **Settings → Environments → Production → Branch Tracking**).
3. **Environment variables** (project **Settings → Environment Variables**). Add every variable from
   your `.env.local` **except** `DEMO_PASSWORD`, with these differences:

   | Variable | Vercel value |
   |---|---|
   | `APP_URL` | your production address, e.g. `https://civpms.vercel.app`. Set it for the **Production** environment only; previews then use their own address automatically. |
   | `BREVO_SANDBOX` | `false` (real emails) |
   | `CRON_SECRET` | a **new** random string (don't reuse your PC's one) |
   | `SUPABASE_SECRET_KEY` | required here: it sends the notification emails |

4. **Deploy.** When it's live, go back to Supabase **Authentication → URL Configuration** and set
   the **Site URL** to the production address and add it to **Redirect URLs** (step 6.1). Add the
   address to Google's **Authorized JavaScript origins** as well (step 7).
5. **Custom domain (optional):** Vercel **Settings → Domains**. Then repeat step 4 with the new domain
   and set `APP_URL` to it.
6. **Before inviting real users, remove the demo accounts** (step 9). They share one password and
   can see the sample companies.

### Scheduled jobs

- The **database** runs its own daily check at 00:05 Philippine time (`pg_cron` job
  `civpms-daily-checks`): it flags delayed projects, expires old invitations and empties the trash
  after 30 days. Nothing to set up.
- Most emails are sent right after the action that causes them. `vercel.json` adds one **Vercel
  Cron** job that calls `/api/cron/dispatch-emails` daily at 16:15 UTC (00:15 Philippine time) to send
  the "project delayed" emails queued by the database job, plus anything a hiccup left behind. Vercel
  sends `Authorization: Bearer <CRON_SECRET>` automatically when the `CRON_SECRET` variable is set.
  On the free Hobby plan, cron jobs can run only once a day and may start any time within that hour.
- `/api/cron/daily` is an optional manual fallback that runs the same daily check from Vercel (only
  needed if `pg_cron` ever stops). Run either job by hand from PowerShell:

  ```powershell
  $secret = "<your Vercel CRON_SECRET>"
  Invoke-RestMethod -Method Post -Uri "https://civpms.vercel.app/api/cron/dispatch-emails" -Headers @{ Authorization = "Bearer $secret" }
  Invoke-RestMethod -Method Post -Uri "https://civpms.vercel.app/api/cron/daily" -Headers @{ Authorization = "Bearer $secret" }
  ```

  A healthy answer looks like `ok: True, status: ok, sent: …`. `status: disabled` names the missing
  setting (secret key or Brevo).

## 9. Demo accounts

The database has sample data for trying the app and for automated browser tests: two companies,
five projects (one Delayed and over budget, one near its budget limit, one empty) and five accounts
on the reserved `@civpms.test` domain, which can never receive email:

| Sign in as | To see |
|---|---|
| `owner@civpms.test` (Juan Dela Cruz, Owner PM of *Dela Cruz Builders*) | everything an Owner PM sees |
| `pm@civpms.test` (Maria Santos, PM) | only the projects she is on |
| `inspector@civpms.test` (Paolo Reyes, Inspector) | the inspector's read-mostly view |
| `rival@civpms.test` (Ana Villanueva, *Bayanihan Construction*) | another company that must never see Dela Cruz data |
| `newbie@civpms.test` | a confirmed account that hasn't been onboarded yet |

All five share one password, `DEMO_PASSWORD`. It is kept in `.env.local` and is **never** in the
repository. The full list, what each project demonstrates, and how to (re)create the data are in
[`supabase/seed/README.md`](../supabase/seed/README.md). In short:

1. Pick a password (10+ characters) and add it to `.env.local` as `DEMO_PASSWORD=…`. If an agent
   already seeded the data, use the same value from its `.env.local`. Running the seed again resets
   every demo account to the password you pass.
2. In Supabase → **SQL Editor**, run `select set_config('civpms.demo_password', 'YOUR-DEMO-PASSWORD', false);`
   followed by the content of `supabase/seed/demo.sql`. It is safe to run more than once.
3. Check that sign-in works: `node --env-file=.env.local scripts/verify-demo-accounts.mjs`.

> **Remove the demo data before production.** When real users are about to join, run
> `supabase/seed/demo-cleanup.sql` in the SQL Editor. It deletes every `@civpms.test` account and the
> demo companies with everything in them. Then delete `DEMO_PASSWORD` from `.env.local`. Don't run it
> while you or the test suite still use the demo accounts.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| The app won't start: "Invalid public environment variables … is missing" | A value in `.env.local` is empty or misspelled. Fill it in and restart `npm run dev`. |
| `npm ci` fails | Check `node --version` (20.9+). Close VS Code and any running `npm run dev`, delete the packages with `Remove-Item -Recurse -Force node_modules`, and run `npm ci` again. |
| Port 3000 is busy | `npm run dev -- -p 3001`, then use `http://localhost:3001` in `APP_URL` and Supabase Redirect URLs. |
| Sign-up says "We couldn't send the email just now" | Custom SMTP isn't working (6.3): wrong SMTP login or key, or the sender isn't verified in Brevo. Supabase → **Logs → Auth** shows the exact reason. |
| Sign-up says "We can't send email to this address yet" | Custom SMTP isn't enabled, so Supabase only emails your organization's members (6.3). |
| No confirmation email arrives | Check spam. In Brevo → **Transactional → Logs**, look for the address. Make sure the sender domain is authenticated (step 4 note). |
| The confirmation link opens `localhost` (or the wrong site) | Fix the **Site URL** (6.1). Links already sent keep the old address; request a new one. |
| "This link is invalid or was already used" | Email links work once and expire. Sign in again (or use *Forgot password*) to get a new one. Some email scanners open links before you do; a domain sender with good reputation helps. |
| Google: "redirect_uri_mismatch" | The redirect URI in Google Cloud must be exactly `https://bxfohhwvzbvmyokcsmwq.supabase.co/auth/v1/callback` (7.3). |
| Google: "Access blocked: this app's request is invalid" or only some people can sign in | The consent screen is still in *Testing*. Add those people as test users or publish the app (7.2). |
| After signing in you land on the sign-in page again | The address you use isn't in Supabase **Redirect URLs** (6.1), or the browser blocks cookies for the site. |
| Notification emails never arrive | On Vercel: `BREVO_SANDBOX` must be `false`, and `SUPABASE_SECRET_KEY`, `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` must be set. On your PC no emails are sent unless all three are set (and with `BREVO_SANDBOX=true` Brevo drops them). Check the queue with the SQL below. |
| A cron call answers 401 | The `Authorization: Bearer …` value doesn't match `CRON_SECRET` (or `CRON_SECRET` isn't set). |

See the email queue (Supabase → **SQL Editor**):

```sql
select created_at, type, email_status, email_attempts, email_error
from public.notifications
order by created_at desc
limit 20;
```

`pending` = waiting to be sent, `sent` = delivered to Brevo, `failed` = retried up to 5 times,
`skipped` = no email address, email turned off, or a test address that can't receive mail (such as
the `@civpms.test` demo accounts). Check the database's daily job with
`select * from cron.job_run_details order by start_time desc limit 10;`.
