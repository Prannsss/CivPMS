# CivPMS — what's left to do

Snapshot of **22 Nov 2026**, after the security audit, the UI passes, the date pickers and the
read-only Gantt / planned S-curve (Stage A) went live on `main`. The detailed plan, estimates and
dependencies stay in [`ROADMAP.md`](ROADMAP.md); open bugs and caveats in [`HANDOFF.md`](HANDOFF.md) §4.
Tick items here as they land and keep this file short: one line per item, a link for the detail.

**Done so far:** Phases 0–1 (accounts, companies, invitations and codes, projects and status rules,
3-level WBS with rollups and budget warnings, working calendar, audit trail, notifications, profile
and company settings), Stage A (read-only Gantt, planned S-curve), and before-Phase-2 packages B-01,
B-02, B-10 (avatar links) and B-11 (Oxlint).

---

## 1. You (owner) — setup only you can do

Most take minutes; several block the agent work below. Status is what could be checked from here.

- [ ] **Turn on leaked-password protection** — Supabase → Authentication → Passwords (HaveIBeenPwned check; may need a paid plan). Off at the 22 Nov audit.
- [ ] **Paste the two updated email templates** from `supabase/templates/` into Supabase → Authentication → Email templates (wording now says "Log in"). Part of O-7.
- [ ] **O-2** Rotate the Brevo API key that was pasted in chat; put the new one only in `.env.local` and Vercel.
- [ ] **O-3** Create the free Supabase project `civpms-staging` (Singapore) and give the agent access → unblocks B-03.
- [ ] **O-4** Backup bucket (Cloudflare R2 or Backblaze B2, write-only keys), an `age` key pair kept offline, GitHub repo secrets → unblocks B-04.
- [ ] **O-5** Sentry project (free plan); DSN and a build-only token in Vercel → unblocks B-06.
- [ ] **O-6** Vercel: choose the plan (Pro recommended — Hobby is non-commercial and runs cron once a day), functions region `sin1`, env vars `APP_URL`, `SUPABASE_SECRET_KEY`, `BREVO_*`, `CRON_SECRET`.
- [ ] **O-7** Supabase Auth URLs: Site URL `https://civpms.prannsss.dev`, redirect `…/auth/callback`, localhost and staging/preview URLs.
- [ ] **O-8** Brevo sender `no-reply@civpms.prannsss.dev` with SPF/DKIM/DMARC, then Supabase custom SMTP through Brevo (until then sign-up emails only reach Supabase team members).
- [ ] **O-9** Render `civpms-media`: Health Check Path `/healthz`; set **`NEXT_PUBLIC_MEDIA_API_URL=https://civpms-media.onrender.com` on Vercel** (not set — production uploads go straight to Storage) and redeploy; redeploy Render once to ship the "Log in" wording.
- [ ] **O-10** Move `rhecy@civpms.test` to a real mailbox before Phase 3 emails.
- [ ] **O-11** Supabase Vault secrets `app_url` and `cron_secret` (5-minute email dispatcher) — before P3-04.
- [ ] **O-12** Google sign-in: Google Cloud project, consent screen (Testing), Supabase Google provider — before P4-10.
- [ ] **O-13** Approve the `CLAUDE.md` exception for browser-side ⌘K search — before P5-18.
- [ ] **`DEMO_PASSWORD` in this cloud environment's secrets** so agents can run the full Playwright suite (today only the `[P2]`, styleguide and similar specs run here).
- [ ] Answer the open questions in [ROADMAP §7](ROADMAP.md#7-questions-for-the-owner) **10–40** only where you disagree with the recommendation (1–9 are answered).

## 2. Before Phase 2 — agent packages still open

Detail: [ROADMAP §2](ROADMAP.md#2-before-phase-2).

- [ ] **B-03** Staging: apply every migration, seed demo data, point Vercel Preview at staging (needs O-3).
- [ ] **B-04** Nightly encrypted off-site backup (GitHub Action, `pg_dump` + `age`, `rclone crypt` of both buckets, 35-day retention) — **before any Phase 2 migration** (needs O-4).
- [ ] **B-05** Web CI `.github/workflows/web.yml`: typecheck, lint, Vitest, build, `npm audit`, gitleaks, secret-key import guard.
- [ ] **B-06** Error reporting with Sentry (needs O-5).
- [ ] **B-07** Pin Vercel functions to `sin1` in `vercel.json`.
- [ ] **B-08** Small debt: register-based `FormField` variant; `{{ .RedirectTo }}` in `confirm-signup.html`; hide the WBS graph minimap on narrow screens.
- [ ] **B-09** Offline clean-up for D7: hide the "Offline sync conflicts" notification row; record D7.

## 3. Phase 2 — Scheduling (29 packages, ≈ 24 agent-days)

Links between work packages, automatic rescheduling, critical path, baselines, Gantt editing, shared
filters and sorting. Detail: [ROADMAP §4.1](ROADMAP.md#41-phase-2--scheduling). Stage A already
delivered the read-only halves of P2-05b, P2-11 and P2-13a/b.

- [ ] P2-01a/b Gantt renderer spike (SVAR first, DHTMLX only if SVAR fails)
- [ ] P2-02 Calendar additions + working-day axis
- [ ] P2-03 Dependency graph module
- [ ] P2-04a/b CPM forward/backward pass, float, critical path, property tests, benchmark
- [ ] P2-05a Schedule intents, Undo inverse, permissions, schemas · P2-05b baseline compare, filter + sort model
- [ ] P2-06 / P2-07 / P2-08 Database: links + schedule revision · `apply_schedule_change` · `set_baseline` + calendar snapshot (needs B-04 first)
- [ ] P2-09 Server schedule pipeline + actions · P2-10 rewire WBS/calendar actions · P2-22 non-working-date warnings
- [ ] P2-11 Chart legend (tokens done) · P2-12 Schedule panel + predecessor picker
- [ ] P2-13a/b/c Gantt core, styles, critical path + baseline overlay · P2-14a/b Gantt editing (move, resize, drag-to-link, touch)
- [ ] P2-15 Baselines sheet + Set new baseline · P2-16 Dashboard CPM forecast
- [ ] P2-17a Shared filters (WBS list, graph, Gantt) · P2-17b WBS column sorting · P2-23 Deliverable "Over budget" chip
- [ ] P2-18 Audit labels for links/baselines · P2-19 Mobile + accessibility pass · P2-20 Performance check on staging (needs B-03) · P2-21 E2E, screenshots, docs

## 4. Later phases

- [ ] **Phase 3 — Field & tracking** (30 packages, ≈ 25 days): progress updates with photos, parent cascades, site inspections, the S-curve **actual** line, dashboard additions, 5-minute email delivery, retry-safe submits and drafts, mobile-first field screens, home-screen icon. [ROADMAP §4.2](ROADMAP.md#42-phase-3--field--tracking)
- [ ] **Phase 4 — Sharing & viewers** (13 packages, ≈ 9.75 days): Google-style sharing, viewers, public links, request access. [ROADMAP §4.3](ROADMAP.md#43-phase-4--sharing--viewers)
- [ ] **Phase 5 — Polish & launch** (53 packages, ≈ 45.75 days): global search, imports (Excel, Google Sheets, MS Project), exports and reports, retention and privacy, Platform Admin, web push, security, performance, accessibility. [ROADMAP §4.4](ROADMAP.md#44-phase-5--polish-launch-readiness-and-uat)
- [ ] **UAT** with the client (2 weeks), then go-live (Supabase Pro + backups confirmed).

## 5. Known issues and small follow-ups

From [HANDOFF §4](HANDOFF.md) and the 22 Nov audit; none blocks daily use.

- [ ] WBS "add first child": if clearing the parent's own values fails, the error is ignored (rare; surface it as a warning).
- [ ] WBS graph: on wide trees the first view starts with outer branches off-screen (pan or Fit).
- [ ] CSP still allows inline scripts (a nonce policy needs per-request rendering, D9a) — revisit when rich text arrives.
- [ ] A missing project shows the not-found screen with HTTP 200 instead of 404 (streamed layout).
- [ ] Some list links are 20 px tall on phones (pass WCAG 2.2's spacing exception, below the 44 px house rule).
- [ ] `project_overview` keeps Supabase's default write grants (harmless today; revoke in a later migration).
- [ ] 2027 Eid holidays are not seeded (not proclaimed yet) — add by migration when declared.
- [ ] Calendar: a single very long word in a holiday name can break mid-word in narrow day cells (full name is in the list and popover).
- [ ] Re-run the full Playwright suite once `DEMO_PASSWORD` is available (specs were updated for the new settings layouts, Logout wording and date pickers but only partly run here).
