# CivPMS roadmap: from the planning core to launch (Phases 2–5)

Version 1.1 · 28 Oct 2026 (includes owner decision **D7**: offline mode dropped) · Sources: SPEC v0.2 (cited as §n), `CLAUDE.md`, `docs/DECISIONS.md` (D-numbers), `docs/HANDOFF.md`, the code at `910219c` (verified state pushed as `cde38f7`), the live database (read-only), the four phase plans and their review. Decisions in `docs/DECISIONS.md` override the spec; `CLAUDE.md` overrides both.

**Fixed decisions (not re-asked):** Next.js on Vercel · Supabase project **CivPMS** (Singapore, `ap-southeast-1`) · Brevo for email · Rust media/cache service **civpms-media** on Render free plan, keep-alive **off**, auto-deploy off (`https://civpms-media.onrender.com`) · production domain **https://civpms.prannsss.dev** · **offline mode is out of scope (D7, 28 Oct 2026); an installable home-screen icon stays** · `rhecy@civpms.test` (company RHEngineering) is the owner's own PM account and is kept by `supabase/seed/demo-cleanup.sql` · Phases 0–1 are built.

**Words used in this document**
- **Agent-day:** one AI coding agent working one focused day. A **work package** is ≤ 1.5 agent-days, has its own branch and checkpoints, and can be verified on its own.
- **RLS (row-level security):** database rules that decide which rows each signed-in person may read. **RPC:** a database function the app calls; all writes go through RPCs that check permissions.
- **Migration:** a numbered SQL file that changes the database. **SQL test:** a script that checks the database rules and rolls itself back.
- **CPM (critical path method):** the scheduling calculation that finds each activity's earliest/latest dates, its **float** (how many days it can slip without moving the project finish) and the **critical path** (the chain with zero float).
- **Baseline:** a frozen copy of the plan used for comparison. **S-curve:** cumulative planned vs actual progress over time.
- **Idempotent / retry-safe:** sending the same request twice has the effect of sending it once (each save carries a `client_id`). **Web push:** phone/desktop alerts sent through the browser; it needs a small background script called a **service worker** (used only for push, never for offline caching).
- **CSP:** a browser security header that limits which scripts may run. **Staging:** a second, throw-away copy of the system for heavy and destructive tests.

---

## 1. Summary

**Where the product is.** Phases 0–1 are built and on the branch: sign-up and onboarding, companies, invitations and invite codes, projects and status rules, the 3-level WBS with costs, hours and rollups, budget warnings, the working calendar, the audit trail, in-app and email notifications, profile and company settings, and the Rust media service. Final QA finished on 28 Oct (HANDOFF §1). The database **plan lock** (completed or cancelled projects refuse plan edits) is applied and tested; it is recorded as decision **D24**. The media service is live on Render. Gantt and S-curve are "coming next" placeholders. No activity has progress yet, because nothing can write status or % until Phase 3.

**Owner decision D7 (28 Oct 2026): offline mode is out of scope.** No offline page cache, offline queue, background sync or conflict notices. Kept instead (Phase 3): retry-safe submits (a flaky connection or double tap never creates duplicates), a failed save keeps everything typed including picked photos ("No connection — try again"), local drafts of the progress and inspection-result forms, mobile-first field screens, and an "Add to Home screen" icon (manifest and icons only). Inspectors therefore need a signal to submit; see risk 1 in section 8.

**What remains** (spec §21):
- **Phase 2, Scheduling:** links between work packages, automatic rescheduling, critical path, baselines, the Gantt chart, shared filters and sorting.
- **Phase 3, Field & tracking:** progress updates with photos, parent cascades, site inspections, the S-curve, dashboard additions, 5-minute email delivery, retry-safe submits and drafts, mobile-first field screens, home-screen icon.
- **Phase 4, Sharing & viewers:** Google-style sharing with viewers, public links and request access.
- **Phase 5, Polish:** global search, import (Excel, Google Sheets, MS Project XML), exports and reports, retention and privacy, Platform Admin, web push, security, performance, accessibility, then UAT (user acceptance testing with the client).

**Recommended order.** Foundations first (section 2), then Phases 2 → 3 → 4 → 5. Phases overlap: one agent owns the database lane, which is strictly serial and is the critical path; pure-logic work for the next phase runs alongside it; at most two heavy agents (dev server or build) run at once.

| Stage | Packages | Agent-days | Notes |
|---|---:|---:|---|
| Before Phase 2 (foundations) | 9 | 4.75 | Final QA (B-01) already done; plus owner setup actions (section 2) |
| Phase 2 – Scheduling | 29 | 24 | +1 day contingency if the first Gantt library fails its spike |
| Phase 3 – Field & tracking | 30 | 25 | Includes the D7 replacements (P3-23 to P3-25) |
| Phase 4 – Sharing & viewers | 13 | 9.75 | Offline work removed by D7 |
| Phase 5 – Polish | 53 | 45.75 | Optional cut list ≈ 4 days, plus an optional 0.5-day sample project (section 4.4) |
| UAT (2 weeks, client) | 1 buffer | ≤ 5 | One ≤ 1-day package per serious defect |
| **Total** | **135** | **≈ 109 + UAT** | ≈ 54–61 working days of build with 2 heavy agents, then 2 weeks of UAT (≈ 3½ months) |

The 9 owner questions that block Phases 2–3 are listed first in section 7 ("Decide first").

---

## 2. Before Phase 2

These foundations come first because the live database now holds the owner's real company, the free Supabase plan has no backups, and the heavy Phase 2 tests must not run on production. Agents do the "B" packages; the owner does the "O" actions (most take minutes).

| # | Step | Who | Effort | When |
|---|---|---|---|---|
| B-01 | Phase 0–1 Final QA — **done 28 Oct** (Playwright suite, golden path on fresh accounts, media-service spec, review of every action and route; HANDOFF §1) | Agent | done | — |
| B-02 | Record the plan lock as **D24** in DECISIONS.md (Scheduling & WBS group): migration `20261023090000_plan_lock.sql` is applied and SQL test 11 is green and committed (`910219c`) | Agent | 0.25 d | First |
| O-1 | Answer the 9 "Decide first" questions (section 7) | Owner | 30 min | Before P2-04a / P2-06 |
| O-2 | Rotate the Brevo API key that was pasted in chat; put the new one only in `.env.local` and Vercel | Owner | 10 min | Now |
| O-3 | Create the free Supabase project **civpms-staging** (Singapore) and give the agent access (check the organisation still has a free-project slot) | Owner | 15 min | Before B-03 |
| B-03 | Staging setup: apply every migration, seed demo data, point Vercel **Preview** at staging (Preview never holds the production secret key), document it in SETUP.md | Agent (+ owner for env vars) | 0.5 d | Before P2-20 |
| O-4 | Backup target: a client-owned bucket (Cloudflare R2 or Backblaze B2) with write-only keys, an `age` key pair (private key kept offline by the client), GitHub repo secrets | Owner | 30 min | Before B-04 |
| B-04 | Nightly encrypted off-site backup (pulled forward from P5-45): GitHub Action at 02:00 Manila, `pg_dump` encrypted with `age`, `rclone crypt` copy of the `project-media` and `avatars` buckets, 35-day retention, logs never print secrets (the repo is public) | Agent | 0.75 d | Before any Phase 2 migration |
| B-05 | Web CI `.github/workflows/web.yml` (pulled forward from P5-38): typecheck, lint, Vitest, `next build` with placeholder env, `npm audit --omit=dev --audit-level=high`, gitleaks over full history, guard that `SUPABASE_SECRET_KEY` is read only in `src/lib/supabase/admin.ts`; actions pinned by SHA like `backend.yml` | Agent | 0.75 d | Before Phase 2 |
| O-5 | Create a Sentry project (free Developer plan); put the DSN and a build-only auth token in Vercel | Owner | 15 min | Before B-06 |
| B-06 | Error reporting (pulled forward from P5-37): `@sentry/nextjs`, `instrumentation.ts`, `instrumentation-client.ts`, new `global-error.tsx`, `route-error.tsx` tags the same reference id it shows, scrubber for emails/tokens/cookies/action arguments, replay off, tunnel route `/monitoring` exempted in `src/proxy.ts` | Agent | 1 d | Before Phase 2 |
| O-6 | Vercel: choose the plan (question 8), confirm the functions region **sin1 (Singapore)**, set `APP_URL=https://civpms.prannsss.dev`, `SUPABASE_SECRET_KEY`, `BREVO_*`, `CRON_SECRET`, attach the domain | Owner | 30 min | Before B-07 |
| B-07 | Pin functions to `sin1` in `vercel.json` (`regions`; today it only has the daily cron) so every database round trip stays in Singapore before any performance number is recorded | Agent | 0.25 d | Before P2-20 |
| B-08 | Small debt that later forms depend on (pulled forward from P5-40): register-based `FormField` variant in `components/ui` (the `Controller` one loses text typed before hydration), `{{ .RedirectTo }}` in `supabase/templates/confirm-signup.html`, hide the WBS graph minimap below a width breakpoint | Agent | 0.5 d | Before P3-11a |
| B-09 | Offline clean-up for **D7**: hide the "Offline sync conflicts" row in Profile → Notifications (`src/components/profile/notification-prefs.ts`; nothing produces it — keep the `sync_conflicts` key in `NOTIFICATION_EVENT_TYPES` so stored preferences still validate); keep the audit via label "Offline sync" (`src/components/audit/audit-format.ts`) and the database enum values (removing Postgres enum values is not worth it); write D7 in DECISIONS.md (Platform group) and, with the owner's approval, drop offline/PWA from the scope line in `CLAUDE.md` | Agent | 0.25 d | Before Phase 2 |
| B-10 | Security fix from HANDOFF §4: restrict `profiles.avatar_url` to the `avatars` bucket and Google photo hosts (an outside image link would leak teammates' IP addresses) — small migration (DB lane, before P2-06) + SQL test `19_avatar_url.sql` | Agent | 0.5 d | Before P2-06 |
| O-7 | Supabase Auth URL configuration: Site URL `https://civpms.prannsss.dev`, redirect `https://civpms.prannsss.dev/auth/callback`, localhost and the staging/preview URLs; paste `supabase/templates/*` | Owner | 15 min | Now |
| O-8 | Brevo sender `no-reply@civpms.prannsss.dev` with SPF/DKIM/DMARC on `prannsss.dev` (question 32), then Supabase Auth custom SMTP through Brevo | Owner | 1 h | Before Phase 3 emails |
| O-9 | Render: `civpms-media` is already live (free plan, Singapore, `APP_ORIGINS` = localhost + `https://civpms.prannsss.dev`). Remaining: set Health Check Path `/healthz` (Render's own readiness check, not an outside pinger; keep-alive stays **off**), add any preview origin to `APP_ORIGINS`, set `NEXT_PUBLIC_MEDIA_API_URL=https://civpms-media.onrender.com` on Vercel and redeploy; redeploy Render manually after backend changes (auto-deploy off) | Owner | 15 min | Before P3-10 |
| O-10 | Move `rhecy@civpms.test` to a real mailbox (question 9); `.test` addresses never receive mail | Owner | 10 min | Before Phase 3 emails |
| O-11 | Supabase Vault secrets `app_url` and `cron_secret` for the 5-minute email dispatcher (never in a migration file) | Owner | 10 min | Before P3-04 |
| O-12 | Google sign-in: Google Cloud project, consent screen in Testing mode with test users, Supabase Google provider; publish the consent screen once `/privacy` exists (P5-31a) | Owner | 1 h | Before P4-10 |
| O-13 | Approve the `CLAUDE.md` data-access exception for browser-side search (question 27) so agents may edit `CLAUDE.md` | Owner | 5 min | Before P5-18 |

The open foundations cost 4.75 agent-days (B-01 is done). B-02 to B-10 are light and can run in parallel; B-10 is the only one that touches the database lane. The home-screen icon is **not** here but in early Phase 3 (P3-25): nothing in Phase 2 needs it, and it is checked on the same phones as the mobile-first field pass.

---

## 3. Status today, by spec section

Legend: **Built** · **Partial** (what is missing and where it lands) · **P2–P5** (planned in that phase) · **Deferred** · **N/A** (information only).

| § | Topic | Status | Note |
|---|---|---|---|
| 1.1 | Goals | Partial | Planning done; schedule P2, phone-friendly field updates P3; offline use dropped (D7) |
| 1.2 | Non-goals | N/A | Respected: no resources, actual cost, `.mpp` or `.xer` |
| 2.1 | Roles | Partial | Owner PM, PM, Inspector built; **Viewer** in P4 |
| 2.2 | Permission matrix | Partial | Enforced in the DB for built features; links/baselines P2, updates/inspections P3, sharing P4 |
| 3 | Glossary | Built | Weight rules in `rollup.ts` and `project_overview` |
| 4.1 | Sign-up / sign-in | Partial | Built; Google OAuth and Brevo SMTP are owner actions (O-8, O-12) |
| 4.2 | PM first run | Built | Sample *project* (A7) replaced by "Use sample structure"; question 37 |
| 4.3 | Inspector first run | Built | "No company yet" state (D12) |
| 4.4 | Invitations | Built | Plus invite codes (D11) |
| 5.1 | Create project | Built | |
| 5.2 | Project status | Built | Plan lock in the DB since D24 |
| 5.3 | Derived badges | Built | |
| 5.4 | Delayed-project behaviour | Partial | Badge, banner, alert built; extended axis, end marker, shaded overrun on Gantt P2, on S-curve P3 |
| 6.1 | Hierarchy | Built | Depth 3 (D22) |
| 6.2 | Fields | Partial | % and status via updates P3; dependencies P2 |
| 6.3 | Hours/Days toggle | Built | |
| 6.4 | Budget allocation | Partial | Deliverable "Over budget" tooltip P2 (P2-23) |
| 6.5 | Weighting and rollup | Built | Inputs stay 0 % until P3 |
| 7 | Working calendar | Partial | Built; successors move with links and non-working-date warnings in P2 |
| 8.1 | Dependencies | P2 | |
| 8.2 | Critical path | P2 | |
| 8.3 | Forecast (light) | Partial | Leaf-date check today; CPM finish P2; status-date forecast P3 |
| 8.4 | Baseline | Partial | v1 captured on activation; "Set new baseline", list, Gantt bars P2 |
| 9 | Shared view filters | P2 | "Assignee" becomes an "Inspector" filter in P3 (question 7) |
| 9.1 | Gantt | P2 | Inspector "Update" row action in P3 |
| 9.2 | S-curve | P3 | |
| 9.3 | WBS list / graph | Partial | Built; column sorting P2 |
| 9.4 | Project dashboard | Partial | CPM forecast P2; planned vs actual, inspections P3 |
| 9.5 | Other tabs | Partial | Inspections P3, Sharing P4 |
| 10.1 | Activity statuses | Partial | Enum and badges exist; set via updates in P3 |
| 10.2 | Update form | P3 | |
| 10.3 | Status ↔ % rules | Partial | TS logic exists; DB enforcement P3 |
| 10.4 | Parent updates / cascade | Partial | TS logic exists; cascade RPC and dialog P3 |
| 10.5 | Delayed manual + derived | Partial | Derived shown; filters P2; "reported" source and tooltip P3 |
| 10.6 | Activity log | Partial | Planning changes logged; progress, inspections P3; sharing P4; imports/exports P5; "offline sync" entries dropped (D7) |
| 11.1–11.5 | Site inspections | P3 | |
| 12.1 | Sharing model | P4 | |
| 12.2–12.3 | Viewer data and calendar | P4 | |
| 12.4 | Image handling | Partial | Media service built; project photos in the app P3 |
| 13 | Mobile, PWA, offline | **Dropped — D7** | Replaced in P3: mobile-first field screens, retry-safe submits, kept form data + local drafts, home-screen icon (no offline) |
| 14 | Notifications | Partial | 10 types, email, digest built; field types and 5-minute email P3; sharing P4; web push P5; sync-conflict type dropped (D7) |
| 15 | Global search | Partial | ⌘K finds projects and pages; full search P5 |
| 16.1 | Export | Partial | Audit CSV only; everything else P5 |
| 16.2 | Import | P5 | `.xer` and `.mpp` stay out of v1 (§1.2) |
| 17.1 | UX principles | Built | For Phases 0–1; full audit P5 |
| 17.2 | Error handling | Partial | Monitoring B-06; upload errors and "typed data never lost" (kept form + drafts) P3; request access P4; conflict diff P5; "saved to the offline queue" **dropped — D7** |
| 17.3 | Visual identity | Built | Dark mode (D5); chart colours P2 |
| 18.1 | Stack | Partial | Vercel (D1) and Render (D40) decided; Sentry B-06; Serwist/Dexie dropped (D7) |
| 18.2 | Data model | Partial | New tables in P2–P5 |
| 18.3 | Security (RLS) | Built | For current tables; viewer RPCs and hashed link tokens P4 |
| 18.4 | Scheduling logic in TS | Partial | Calendar and rollups built; CPM P2, S-curve P3 |
| 18.5 | Gantt component spike | P2 | P2-01a |
| 18.6 | Environment variables | Built | Renamed (D3); Sentry B-06; VAPID and Google Picker keys P5 |
| 18.7 | Deployment and ownership | Partial | Hosting decided; Platform Admin P5; account ownership open (question 31) |
| 19 | Security and privacy | Partial | RLS, EXIF stripping, immutable log, 30-day trash built; off-site backups B-04; retention, privacy notice, rights P5 |
| 20 | Non-functional targets | Partial | 2,000-row WBS tested; Gantt/CPM P2; app shell, load, accessibility P5 |
| 21 | Phasing | N/A | This roadmap |
| 22 | Assumptions | Partial | A11/A13/A15 P2; A2/A3/A14/A17/A19 P3; A18 P4; A20/A21/A24/A26/A27 P5; A7 question 37 |
| 23.1 | Confirmed decisions | Partial | Q4/Q9 P2; Q1/Q2/Q11 P3; Q3 P4; Q6/Q10 P5; Q5 (offline conflicts) dropped by D7; the rest built |
| 23.2 | Open questions | Open | Q8 → question 31, Q15 → 29, Q16 → 40, Q17 → 39 |

---

## 4. Phase plans

**Conventions for every phase**
- **Migration files** use a 14-digit creation timestamp that sorts **after the last applied migration** (today `20261023090000_plan_lock`) and after the previous phase's last file, with a phase prefix: `<YYYYMMDDhhmmss>_p2_dependencies.sql`. One database agent at a time applies them with MCP `apply_migration`, renames the recorded version to the file timestamp, keeps the file byte-identical, runs every SQL test, then `npm run db:types`. Deletes inside migrations use a data-modifying CTE. Below, "M1, M2 …" give the order; the timestamp is set when the file is created.
- **SQL test numbers:** 11 = plan lock (D24, on main) · Phase 2 = 12–13 · Phase 3 = 14–18 · Phase 4 = 20–22 · Phase 5 = 30–36 · 19 = B-10 avatar fix · 23–29 stay free for fix-ups.
- **Decision numbers:** D7 (new, Platform group: offline out of scope) · D24–D25 (new, Scheduling & WBS group) · Phase 2 D50–D59 · Phase 3 D60–D69 · Phase 4 D70–D73 (D74–D79 dropped by D7) · Phase 5 D80–D97. Each package writes its decision text into `docs/DECISIONS.md`.
- **Package IDs** keep the phase plans' numbers (Phase 4 was renumbered P4-01 … P4-13 after D7); a split package gets letter suffixes, a new package takes the next free number. Sizes: **S** 0.5 d · **S–M** 0.75 d · **M** 1 d · **L** 1.5 d.
- **Notification types** live in a table from Phase 3 on (P3-02a); later phases **insert rows**, never rewrite the list. TypeScript lists (`NOTIFICATION_TYPES`, `TYPE_FAMILY`, `NOTIFICATION_EVENT_TYPES`) are append-only.
- **Files under `src/components/wbs/*`** are edited by one package at a time, in this order: P2-10 → P2-22 → P2-12 → P2-17a → P2-17b → P2-23 → P3-13a → P5-19 → P5-22.
- **Tests that write data** use tagged records (`[P2]` … `[P5]`). Heavy seeds, load tests and destructive drills run on **staging**, never on production.

---

### 4.1 Phase 2 – Scheduling

**Goal (what the owner gets).** A PM opens **Gantt** and sees every deliverable, sub-deliverable and work package on a timeline built from the WBS and the working calendar. PMs link work packages (finish-to-start and the other three types, with a wait or overlap in working days) by dragging between bars or from a picker. When a date changes, linked work moves automatically and a "Moved 5 activities · Undo" message appears. A toggle highlights the critical path; each activity shows its float in plain words ("3 days of float"). PMs set a **new baseline** with a reason and compare the plan against any baseline. Delayed projects show the timeline past the end date, a labelled original-end marker and a shaded overrun; overdue bars get a hatched extension to today. The dashboard warns "Projected to finish 6 days late". WBS, graph and Gantt share filters; the WBS list can be sorted by column. Inspectors see the same chart read-only. Every link, baseline and propagated move is in the audit trail.

**Scope:** §2.2 (edit links, set baseline), §5.4 (Gantt part), §6.4 (deliverable "Over budget"), §7 (successors move, non-working-date warnings), §8.1–8.4, §9 intro, §9.1, §9.3 (sorting), §10.5 (derived Delayed display and filters), §10.6 (link and baseline entries), §18.4, §18.5, §20 (CPM and Gantt speed). Not in scope: the inspector "Update" row action (P3-13b), the status-date forecast (P3-20), Gantt PDF/PNG (P5).

**Key decisions**

| # | Decision | Why |
|---|---|---|
| D24 | **Plan lock in the database** (on main): `private.assert_plan_open` runs inside `private.lock_wbs` and `private.get_managed_activity`, so every planning RPC refuses completed/cancelled projects with `FORBIDDEN` | Closes the HANDOFF §4 gap; the UI check `planLockFor` stays as a fast pre-check |
| D25 | **Shared filters** apply to the WBS list, WBS graph and Gantt; the Inspections tab keeps its own filter bar; the S-curve is project-wide. The WBS list is **sortable** by column (URL-synced); drag-and-drop is off while a sort is active, with "Back to plan order" | Narrows §9 "all views share filters" explicitly; adds §9.3 "sortable" |
| D50 | Gantt renderer **SVAR React Gantt 2.8.1 (MIT)**, used only to draw, loaded client-side on the Gantt route; fallback DHTMLX Gantt 10.0.3 Community (MIT since 10.0); last resort our own renderer (+4–6 days). Never DHTMLX's online export service | §18.5 / Q9; we compute CPM, baselines, today line and markers ourselves because both free editions lack them |
| D51 | Scheduling in **whole working days**; lag stored as `lag_days` (−999…999); milestones follow the predecessor's finish | Matches D20 (end = day of the last working hour) |
| D52 | Linked work packages start **as soon as their links allow** (they also move earlier); a PM pins a later date with **Start no earlier than**; completed work is fixed and started work keeps its start | Standard scheduling (question 3); history is never rewritten |
| D53 | CPM runs in **TypeScript** (client preview, server authority); the database checks structure only (leaf-to-leaf, same project, no loops). A per-project **schedule revision** (`project_schedule_state.rev`) catches concurrent edits. It changes on dates, start constraints, parents, deletes, links and calendar changes, and on status **only when the scheduling class changes** (not started ↔ started ↔ completed); never on % or reported delay | One engine; field updates in Phase 3 must not keep failing PM saves |
| D54 | Float is measured against the schedule's own finish (there is always a critical path); lateness against the project end date is a separate warning. Phase 2 forecasts from the plan; P3-20 adds the **status date** (today) | §8.3, question 13 |
| D55 | One atomic write path `apply_schedule_change`; **Undo** sends the exact inverse change and is refused if the schedule changed since. "Undo" is a note on `via='direct'`/`'schedule'` log rows, not a separate `via` value | No silent overwrite |
| D56 | Links follow WBS changes: a linked work package that gets its first child passes its links to that child; moving items under a linked work package is refused; links of deleted activities hide and return on restore. A **removed link comes back only through Undo** (refines A22; question 5) | Keeps links leaf-to-leaf (A11) |
| D57 | **Set new baseline** only while Active or On-Hold, reason 3–1000 characters. Baselines store a **calendar snapshot** in the shape `{work_days, hours_per_day, holidays_nonworking, dates:[{date,kind}], approximate?}` plus `finish_date` and `leaf_count`; existing baselines are back-filled with `approximate: true`. This is the only owner of the snapshot; the Phase 3 S-curve reads it | The planned S-curve must not move when the calendar is edited later |
| D58 | (rescoped) The new schedule RPCs (`apply_schedule_change`, `ensure_calendar_years`, `set_baseline`) take `private.lock_wbs`, so they inherit D24 | The original "retrofit every RPC" step is already done by D24 |
| D59 | Chart colours are tokens; **critical path is violet, never red** (red means danger and Delayed); status always colour + icon/pattern; ≥ 3:1 contrast for chart marks in light and dark. One token table covers Gantt **and** S-curve | Question 11; avoids two token sets |

**Data model (in order)**

*M1 `<ts>_p2_dependencies.sql` (P2-06)*
- Enum `dependency_type` (`fs`, `ss`, `ff`, `sf`). Table **`dependencies`**: `id`, `project_id` (cascade), `predecessor_id`, `successor_id`, `type` default `fs`, `lag_days int` (−999…999), `created_by`, `created_at`, `updated_at`; composite FKs `(project_id, predecessor_id)` / `(project_id, successor_id)` → `activities(project_id, id)` on delete cascade; no self link; unique pair; indexes on `project_id`, `successor_id`, `created_by`. RLS: select for `private.can_view_project(project_id)`; no client writes.
- `activities.start_no_earlier_than date` (RPCs allow it only on work packages with predecessors). No change to the version trigger: it is exclusion-based, so new planning columns already bump `version`.
- `audit_activities` also logs `start_no_earlier_than` ("Start no earlier than: — → 12 Oct 2026").
- Table **`project_schedule_state`** (`project_id` pk, `rev bigint`, `updated_at`), one row per project (insert trigger on `projects` + back-fill), RLS select `can_view_project`.
- Statement-level **rev triggers** on `activities`, `dependencies`, `calendars`, `calendar_dates` per D53 (status only on a class change computed from status and %).
- Trigger `audit_dependencies` → `activity_logs` with `entity_type='dependency'`, `activity_id` = successor, actions `create`/`update`/`delete`, summary "Link added: 1.2 Excavation → 1.3 Footings (Finish → Start, +2 days)"; silent when `pms.audit='off'` (purges).
- Helpers `private.is_leaf(id)`, `private.cycle_path_text(...)` ("1.2 → 1.3 → 1.2", at most 10 hops).

*M2 `<ts>_p2_schedule_rpcs.sql` (P2-07)*
- `private.graph_find_cycle(p_project_id) → uuid[]`: Kahn's algorithm over the project's active links, returns a loop path or empty. `private.validate_links(...)`: shared validator (both ends non-deleted leaves of the project, not equal, no duplicate pair, lag range). **Phase 5 import reuses both.**
- **`public.apply_schedule_change(p_project_id, p_expected_rev, p_change jsonb) → jsonb`**: `assert_can_manage_project` → `lock_wbs` (D24) → lock the schedule row; rev mismatch → `SCHEDULE_CHANGED` → allowed keys `add_links`, `update_links`, `remove_links`, `constraints`, `rows`, `note` → link removals, updates, inserts (client-supplied ids so Undo restores the same id) → validator and `graph_find_cycle` (`DEPENDENCY_CYCLE` with the path in the detail) → start constraints → date rows through `private.apply_schedule_rows` (optional `expected_version` → `STALE_VERSION`; `pms.via` = `direct` for edited rows, `schedule` for moved successors; `pms.note` ≤ 300 chars) → `copy_holidays` for newly touched years. Returns `{rev, rows_changed, links_added, links_updated, links_removed, holidays_added}`. Any failure rolls back everything.
- `public.ensure_calendar_years(p_project_id, p_from_year, p_to_year) → int` (manager, `lock_wbs`).
- Redefine, **starting from the live definitions** (`pg_get_functiondef`, so D24's lock stays): `create_activity` (moves links to the first child, logged `via='schedule'`), `move_activity` (refuses a move under a linked work package: `DEPENDENCY_NOT_LEAF`), `update_activity` (accepts `start_no_earlier_than`), `save_calendar` (new `p_expected_rev default null`; drop the old signature and re-grant).
- New error codes (also in `src/lib/errors.ts` and DATABASE.md): `DEPENDENCY_CYCLE`, `DEPENDENCY_NOT_LEAF`, `DEPENDENCY_EXISTS`, `DEPENDENCY_SELF`, `SCHEDULE_CHANGED`, `BASELINE_NOT_ALLOWED`.

*M3 `<ts>_p2_baselines.sql` (P2-08)*
- `baselines.calendar_snapshot jsonb`, `finish_date date`, `leaf_count int`; back-fill existing baselines from the current calendar with `approximate: true`.
- `private.capture_baseline` fills them and logs `entity_type='baseline'` ("Baseline v2 set", note = reason; v1 on activation via `system`).
- **`public.set_baseline(p_project_id, p_reason)`**: manager, `lock_wbs`, status Active/On-Hold else `BASELINE_NOT_ALLOWED`, reason 3–1000 else `REASON_REQUIRED`, at least one dated work package.

*SQL tests:* **12_dependencies_schedule.sql** (privileges; inspector read-only; other company `NOT_FOUND`; leaf-only, self, duplicate, cross-project; 3-node loop with path; `SCHEDULE_CHANGED`; rev bumps for dates, links, calendar dates, deletes and status-class changes but not for name, cost or %; atomic rollback; log rows and `via`; `STALE_VERSION`; start constraint only with predecessors; link transfer; move refusal; deleted endpoints hide and restore; purge without per-link logs; `holidays_added`). **13_baselines.sql** (permissions, Planning refused, reason, versioning with one active, snapshot contents, log row, closed projects locked, v1 on activation still works). The plan lock itself stays covered by test 11.

**Domain logic** (`src/lib/domain`, pure TypeScript, ≥ 95 % line coverage)
- `calendar.ts` additions: `previousWorkingDay`, signed `addWorkingDays`, `createWorkingDayAxis` (date ↔ working-day index), `workingDayVariance`, `yearsTouched`, `workingDaysInRange` (Phase 3 reuses it).
- `dependencies.ts`: types, plain labels ("Finish → Start · starts after it finishes"), lag labels ("+2 days wait", "2 days overlap"), `formatPredecessors` (`1.2FS+2d, 1.4SS`, reused by Phase 5 import/export), `activeLinks`, `validateNewLink`, `findCycle` (returns the path for highlighting), `topologicalOrder` (never throws on bad data).
- `cpm.ts`: `scheduleProject({leaves, links, calendar, statusDate?})` → early/late dates, total and free float, critical ids and links, driver ("Starts after 1.2 Excavation finishes (+2 days)"), unscheduled reasons, warnings; `diffSchedule` (rows to write, moved list); `scheduleDrift` (stored dates that no longer match links → "Recalculate" banner). Test vectors on a Mon–Fri 8 h calendar: A 16 h from Mon 12 Oct → 12–13 Oct; B FS A, 24 h → Wed 14–Fri 16 (Thu 15–Mon 19 if Wed 14 is a holiday); C SS A +1 d → Tue 13; D FF B → Fri 16; milestone FS B → Fri 16, its FS successor Mon 19; G SF A → Fri 9 Oct; B FS A −1 d starts Tue 13. Plus a textbook float network, 200 random networks (every link holds, earliest dates minimal, float ≥ 0, re-running gives no change) and a benchmark (2,000 leaves / 4,000 links < 100 ms in CI; spec target < 500 ms).
- `schedule-change.ts`: intents `planMoveBar`, `planResize`, `planAddLink`, `planUpdateLink`, `planRemoveLink`, `planSetConstraint`, `planEditLeaf`, `planRecalculate`, each returning `{change, moved, warnings, undo}` with an exact inverse.
- `baseline.ts` (`compareToBaseline` in working days: ahead / on plan / behind / not in baseline), `gantt.ts` (`timelineRange` extends to max(project end, latest end, today) while the project is open; `overrunSegment`; `projectOverrun`; zoom levels; `buildGanttRows` with float and Delayed-reason text), `schedule-filters.ts` (status, level, date overlap, Delayed auto/reported/any, critical only, text; sort keys; URL parse/serialise; parents stay when a child matches), `project.ts` `overBudgetBranches` (P2-23).
- `permissions.ts`: `canEditDependencies`, `canSetBaseline` (Owner PM and project PMs; UI also checks the plan lock). `schemas.ts`: link input, baseline reason ("Add a short reason, like 'Client approved revised scope'"), schedule-change shape for Undo payloads.

**Server**
- `src/server/queries/schedule.ts`: `fetchScheduleSnapshot` (reads `rev` first, then activities with the start constraint, links, calendar with holiday years, baselines list), `fetchBaselineRows`.
- `src/server/schedule.ts` pipeline `commitScheduleIntent`: snapshot → load missing holiday years (`ensure_calendar_years`) → plan → `apply_schedule_change` → retry up to 2× on `SCHEDULE_CHANGED` ("The schedule changed while saving. Reload and try again.") → recompute once if holidays were added → `revalidatePath`.
- `src/server/actions/schedule.ts`: add/update/remove link, move/resize bar, set start constraint, recalculate, undo, set baseline, load baseline bars; results `{moved, undo, rev, warnings}`.
- Rewired (named cross-feature edits in P2-10): `actions/wbs.ts` date and duration edits go through the pipeline (name/cost-only edits stay on `update_activity`); create/delete/restore trigger a follow-up recalculation; `actions/calendar.ts` previews and saves with CPM rows and `p_expected_rev`, and the preview counts moved successors.

**UI/UX**
- **`/projects/[id]/gantt`** replaces the placeholder (remove `soon` for Gantt in `getProjectNavItems`; stop using `coming-next/gantt-preview`). Header "Gantt Chart"; one primary action for PMs, **Link activities**; overflow: Recalculate schedule, Baselines…, Expand/Collapse all.
- Toolbar: zoom Day/Week/Month/Quarter, Fit, Today; toggles Critical path, Baseline (version select) and Links; shared Filters; Legend. Zoom and toggles remembered per device; filters in the URL.
- Grid (sticky left): WBS, Name (tree), Start, End, Duration (Hours/Days per profile), Cost (₱), %, Status (badge with Delayed reason); optional Float, Predecessors, variance columns.
- Chart: non-working shading with holiday names, today line, dashed "Planned end 30 Nov 2026" marker, shaded overrun for Delayed projects, status-coloured bars with progress fill and patterns (On-Hold stripes, Delayed edge + hatch, Completed check), thin summary bars, milestone diamonds, baseline bars under rows, orthogonal arrows.
- PM editing (tablet/desktop ≥ 768 px): move/resize snaps to working days with a ghost tooltip ("Starts Mon 19 Oct · 3 working days"); optimistic, then confirmed by the server; snackbar "Moved 1.2.3 and 4 linked activities · Undo · Details". A linked bar dragged too early snaps back with the reason. Drag from a bar end to link; click a link for type, wait/overlap and **Remove link** with Undo. A loop is outlined in danger for 6 s with "This link would create a loop: 1.2 → 1.3 → 1.2. Remove one of these links first." Grid cells edit like the WBS.
- **Schedule panel** (side sheet; bottom sheet on phones), from a bar, Enter on a row, or the WBS row action "Schedule & links": dates, Start no earlier than, float, "Driven by", predecessor picker (WBS code + name, parents disabled with the reason), successors, baseline comparison, broken links with Remove.
- Read-only for inspectors, closed projects and phones (< 768 px), with the WBS read-only banner copy.
- States: fixed-height skeleton; "No work packages yet" → Plan in Work Breakdown; "Give work packages a start date and duration…" with a "Not scheduled · 4" group; library load error → route error with Retry; drift banner "3 activities don't match their links · Recalculate"; "Holidays for 2028 aren't loaded yet"; `SCHEDULE_CHANGED` toast with Reload.
- Accessibility: the grid is a `treegrid` with arrow keys and Enter; the chart is `aria-hidden` with a screen-reader summary ("124 activities … 18 on the critical path; 3 delayed"); every drag has a panel alternative; focus rings; reduced motion; ≥ 44 px toolbar targets.
- **Baselines sheet** (Gantt overflow and Project Settings → Schedule card): versions with reason, author, date, finish, count, Active badge, **Show on Gantt**; **Set new baseline** dialog states the impact; disabled with the reason in Planning and on closed projects.
- **WBS list:** row action "Schedule & links"; optional Predecessors and Float columns; shared filter bar; column sorting; **"Over budget" chip** on deliverable/sub-deliverable rows when the project is Budget Exceeded, tooltip "This deliverable holds ₱Y of ₱X allocated; the project is ₱Z over", largest contributors marked (also on graph cards and Gantt grid).
- **Non-working-date warnings:** a leaf start, or a project start/end, on a non-working day shows a non-blocking banner/toast with "Review" (`calendar.nonWorkingReason`) in WBS edits and in the create-project dialog and project details form.
- **Dashboard:** "Projected to finish 6 days late — the schedule ends Tue 8 Dec; the project ends 30 Nov" links to Gantt with the critical path on; the Schedule card adds the computed finish, critical count and baseline variance.
- **Chart tokens** (P2-11) in `globals.css`, `@theme inline`, DESIGN.md (with contrast results) and the styleguide: `chart-critical` (#7C3AED / #A78BFA), `chart-baseline`, `chart-today` (primary; label in `primary-text`), `chart-end-marker` (warning text), `chart-overrun-region`, `chart-overrun-hatch`, `chart-nonworking`, `chart-gridline`, `chart-link`, and the S-curve set `chart-planned` (slate, dashed), `chart-actual` (primary), `chart-baseline-old` (dotted), `chart-axis`, `chart-ahead`, `chart-behind`. The library theme is mapped in one scoped `gantt-theme.css`.

**Notifications and audit.** No new notification types (a "projected late" alert is question 12, default no). Audit: `dependency` and `baseline` entity types, `start_no_earlier_than` changes, propagated moves `via='schedule'` with notes ("After adding link 1.2 → 1.3", "Undo", "Recalculated schedule"), calendar moves stay `via='calendar'`. The audit filters gain "Links" and "Baselines" and the label "Schedule (links)".

**Backend (Rust service).** No change.

**Testing.** SQL tests 12–13. Vitest for every new domain module, the Gantt adapter's date conversion on UTC+8 **and** UTC machines, filters/sort URL round trips, `attention.ts`. Playwright `e2e/p2-gantt.spec.ts` (`[P2]` tenant: today line and end marker, zoom, link in panel → successor moves → Undo, drag snaps, loop message, critical path, new baseline overlay, grid edit, inspector read-only, closed project refused, 390 px notice, dark screenshot, no console errors). `e2e/p2-gantt-large.spec.ts` **on staging** (2,000 activities, ≈ 1,500 links). Regression: `f4-wbs`, `f4-calendar`, `f4-wbs-large`, golden path. A read-only dry run (P2-10) runs CPM on every live project and must report **zero** date changes before deploy.

**Work packages – Phase 2** (29 packages, 24 agent-days)

| ID | Title | Depends on | Size | Parallel? | Acceptance |
|---|---|---|---|---|---|
| P2-01a | Gantt spike: SVAR prototype + checklist | B-01 | M 1 | Yes (spike lane) | Same 2,000-row fixture; evidence for build without SSR errors, tree, 4 link types, snappable drag, drag-to-link, shading, overlays that follow scroll/zoom, per-bar classes, dark tokens, p95 frame < 50 ms, touch, keyboard, bundle size, PRO props ignored, no CSS bleed; go/no-go in D50 |
| P2-01b | Gantt spike: DHTMLX (only if SVAR fails a must-have) | P2-01a | M 1 (contingency) | — | Same checklist; if both fail, re-plan P2-13/14 at +4–6 d |
| P2-02 | Calendar additions + working-day axis | B-02 | S 0.5 | Yes (domain lane) | New functions with holidays at boundaries, override Saturdays, 7.5 h days, empty years, negative steps; 100 % lines |
| P2-03 | Dependency graph module | B-02 | S 0.5 | Yes (with 02) | Loop path for 2- and 5-node loops; topological order never throws; labels; 10,000-edge test |
| P2-04a | CPM forward pass | 02, 03, Q3–Q4 | M 1 | Domain lane | All test vectors pass; milestones (D51), start constraints and frozen work (D52) |
| P2-04b | CPM backward pass, float, critical path, property tests, benchmark | 04a | M 1 | Domain lane | 200 random networks hold all properties; benchmark < 100 ms; `diffSchedule`, `scheduleDrift` |
| P2-05a | Schedule intents, Undo inverse, permissions, schemas | 04b | M 1 | Domain lane | Undo round-trip property test; new permission flags; link/baseline/change schemas |
| P2-05b | Baseline compare, Gantt view model, filter + sort model | 04b | M 1 | Parallel with 05a | §5.4 range rules; overrun segment; filter and sort URL round trip; parents kept when a child matches |
| P2-06 | DB M1: links, start constraint, schedule revision, RLS, audit | B-04, B-10, Q4–Q5 | M 1 | DB lane (parallel with domain) | Applied + version-repaired; test 12 structure/RLS/rev/log parts pass; rev unchanged by name, cost, %; types regenerated; advisors clean |
| P2-07 | DB M2: `apply_schedule_change`, loop finder + validator, holiday years, link transfer, move guard, constraint key, calendar rev | 06 | M 1 | DB lane | Test 12 complete; tests 06, 07, 11 still pass; new codes mapped in `errors.ts` |
| P2-08 | DB M3: `set_baseline`, calendar snapshot + back-fill, baseline log | 07, Q6 | S 0.5 | DB lane | Test 13 passes; existing baselines back-filled `approximate`; test 06 still passes |
| P2-09 | Server schedule pipeline + actions | 05a, 05b, 07 | M 1 | After domain + DB | Retries `SCHEDULE_CHANGED` ≤ 2×; loads holiday years first; Undo refused after a change; unit tests; manual script on `[P2]` tenant |
| P2-10 | Rewire WBS + calendar actions, moved-successor snackbar, dry run | 09 | M 1 | No (WBS files) | f4-wbs, f4-calendar, golden path green; dry run reports 0 changes on live data; D21 dialog says "Its links move too" |
| P2-22 | Non-working-date warnings | 10 | S 0.5 | No (WBS files) | Banner/toast with Review in WBS edits, create-project dialog and project details form; Vitest + 1 e2e assertion |
| P2-11 | Chart tokens (Gantt + S-curve) + legend | — | S–M 0.75 | Yes (any time) | One token table, light + dark contrast results in DESIGN.md; styleguide mini-Gantt; `gantt-legend.tsx` |
| P2-12 | Schedule panel + predecessor picker | 09, 11, 22 | M 1 | Parallel with 13a | Add/edit/remove link with Undo; loop path; float and driver text; start constraint; read-only mode; keyboard-only flow |
| P2-13a | Gantt read-only core | 01a, 05b, 11 | M 1 | Parallel with 12 | Adapter with date tests (UTC+8 and UTC); tree, collapse, zoom, Fit, Today; shading; arrows; empty/unscheduled/loading states; `?focus=<id>`; sidebar `soon` removed |
| P2-13b | Gantt styles and states | 13a | M 1 | — | Status colours + icons/patterns; overrun hatch; planned-end marker + shaded overrun; drift banner; inspector and phone read-only; screen-reader summary; 2,000-row smoke |
| P2-13c | Critical path + baseline overlay | 13b, 08 | M 1 | Parallel with 14a | Toggle dims others and outlines critical bars/links in violet; baseline version loads lazily; variance columns; "Not in baseline" chip |
| P2-14a | Gantt editing: move and resize | 13b, 09, 12 | M 1 | — | Snap to working days; early drag on a linked bar refused with the reason; optimistic apply + reconcile; Undo + Details sheet |
| P2-14b | Gantt editing: drag-to-link, link popover, grid edits, touch | 14a | M 1 | — | Typed links by handle pair; popover type/lag/remove with Undo; grid edits reuse WBS actions; touch handles only ≥ 768 px |
| P2-15 | Baselines sheet + Set new baseline dialog | 08, 09, 13a | S 0.5 | Parallel | Disabled with reason in Planning/closed; inline reason validation; toast; overlay switch |
| P2-16 | Dashboard CPM forecast | 05b, 09 | S 0.5 | Parallel | `projected_late` from the CPM finish; Schedule card finish, critical count, baseline variance; f3-dashboard green |
| P2-17a | Shared filters: WBS list, graph, Gantt | 05b, 12, 13a | M 1 | No (WBS files) | Status, level, dates, Delayed auto/reported/any, critical only, text; URL-synced; "Clear filters" empty state; graph honours filters |
| P2-17b | WBS list column sorting | 17a | S 0.5 | No (WBS files) | Sort by code, start, end, duration, cost, %, status (URL); drag-and-drop off while sorted + "Back to plan order"; f4-wbs-large green |
| P2-23 | Deliverable "Over budget" chip | 17b | S 0.5 | No (WBS files) | Chip + tooltip on list, graph and Gantt grid when Budget Exceeded; pure helper with tests |
| P2-18 | Audit labels and filters (links, baselines, schedule notes) | 06 | S 0.5 | Parallel | New types and labels render; Undo shown as a note; CSV includes them; f3-audit green |
| P2-19 | Mobile + accessibility pass | 13c, 14b, 17a | S–M 0.75 | — | axe: no serious/critical issues on Gantt; keyboard-only script; 390/768/1440 px light + dark screenshots |
| P2-20 | Performance check on staging | 14b, B-03, B-07 | M 1 | — | 2,000 activities: bars < 2.5 s, no long task > 200 ms, p95 frame < 50 ms, drag round trip < 1.5 s; numbers in HANDOFF |
| P2-21 | E2E, screenshots, docs, handoff | all | M 1 | Last | `p2-gantt.spec.ts` + full suite green; D25, D50–D59 written; DATABASE/DOMAIN/DESIGN/HANDOFF updated; pushed |

**Lanes:** domain 02/03 → 04a → 04b → 05a ∥ 05b · DB 06 → 07 → 08 · spike 01a · tokens 11 any time · app 09 → 10 → 22 → 12 → 17a → 17b → 23 (WBS chain) and 13a → 13b → {13c, 14a → 14b}; 15, 16, 18 alongside; 19 → 20 → 21 last.

---

### 4.2 Phase 3 – Field & tracking

**Goal (what the owner gets).** Inspectors and PMs record status and % on any activity from a phone or a desk: from the WBS row, the Gantt row, the activity history, an inspection or a notification link. The status ↔ % rules are enforced in the browser and the database, a note is required where the spec asks for one, and marking Completed needs 1–2 photos (compressed by the media service, shown through short-lived links). A parent can be marked Completed, On-Hold or Not Started, which updates all unfinished work packages under it after "This will update 12 work packages"; a parent can also report or clear a delay. One Delayed badge explains its source ("Reported by Maria on 3 Oct" and/or "Auto: planned end passed 5 days ago"). Each update is one readable log entry with note, photos, source (Direct update · Inspection #14 · Cascade from 1.2) and time; a per-activity **History** drawer shows them. **Site inspections:** inspectors propose, PMs schedule directly (auto-approved) and may assign an inspector, approve/approve with a new date/reject, handle reschedule requests, cancel; results use the same update form; an Inspections tab has a list and a Month/Week/Agenda calendar. **S-curve:** planned (from the active baseline) vs actual (from the log) by cost or hours, variance on hover and keyboard, older baselines, overrun shading. The dashboard shows actual vs planned %, next inspections and pending approvals, and its "projected late" warning now uses today's progress. Emails go out within 5 minutes; inspection reminders arrive the day before and the morning of. On a weak site connection a retry or double tap never creates duplicates, a failed save keeps everything typed (photos included) with "No connection — try again", and an unsent update is kept as a draft on the device. Field screens are designed for phones first, and CivPMS can be added to the home screen as an icon (no offline mode, D7).

**Scope:** §2.2 (update, propose, approve/reject/reschedule, request reschedule), §5.4 (S-curve part), §8.3 (status-date forecast), §9.1 (inspector Update action), §9.2, §9.4, §9.5 (Inspections tab), §10.1–10.6, §11.1–11.5, §12.4 (project photos), §13 replacement under D7 (retry-safe submits, kept form data and drafts, mobile-first screens, home-screen icon), §14 (all field notification types; push comes in Phase 5), §17.2 (upload errors; "typed data never lost" through kept forms and drafts), §9 intro ("Inspector" filter).

**Key decisions**

| # | Decision | Why |
|---|---|---|
| D60 | A progress update is stored as **log rows** (no separate table): one combined row per affected activity (`action='progress'`, old/new `{status, percent, delayed_reported}`), an `update_id` per submission, `client_id` only on the target row; `activity_logs` gains `update_id` and `inspection_id` | One entry per update (§10.6); fixes the unique `client_id` problem; one event stream for the S-curve |
| D61 | Field progress does **not** change `activities.version` (status, %, reported delay and the new progress columns join the trigger's exclusion list) and has no version check: the latest saved update wins, in server order. With offline dropped (D7) there is **no client-supplied observed time**: updates are recorded at server time, `p_observed_at` and `progress_observed_at` are not built, and the existing `activity_logs.observed_at` column stays unused | Planners stop getting "changed by someone else" because of field updates; nothing in Phase 3 still needs an observed time |
| D62 | Leaf: any of the 5 statuses. Parent: Completed, On-Hold, Not Started (cascade to unfinished leaves) and Report/Clear delay (no cascade); parent status and % stay derived. Cascades carry the confirmed count; a different count → `CASCADE_CHANGED`. No Undo for progress (a correction is a new update) | §10.4; never update more rows than the person confirmed |
| D63 | Progress and results only while the project is **Active or On-Hold** (`PROGRESS_LOCKED`); inspections may be proposed in Planning, Active, On-Hold; open inspections are cancelled when the project closes or the activity is deleted. Progress RPCs do **not** take `lock_wbs` (it would refuse closed projects and queue behind WBS edits) | Question 6 |
| D64 | A note is required when a leaf **changes to** Delayed or On-Hold, when reopening a Completed leaf, for a parent On-Hold cascade and for Report a delay (≤ 1,000 characters). A submission that changes nothing needs a note, else `NO_CHANGE` | Fixes today's `activityProgressSchema`, which also demands a note when nothing changes |
| D65 | Photos: browser → media service `POST /v1/media/images` (`kind` completion/inspection, `client_id` chosen at pick time) → `register_media` stores a **staged** row after checking the Storage object (owner, path shape, WebP, ≤ 3 MB) → the update attaches 1–2 photos atomically. Registration is **first-wins** on `(uploaded_by, client_id)`. If the service is unset, cold (45 s timeout) or failing, the browser re-encodes and uploads the same path shape. Display through batched signed URLs from the user's Supabase client. Staged rows and unreferenced objects are removed after **24 hours** (the media service's existing replay window, D44). `media.activity_id` is **on delete cascade**, so photos of purged activities disappear with them | Works on Render's free plan; a retry or double tap never stores two photos; keeps D41/D48 |
| D66 | Inspection statuses: proposed, approved, reschedule_requested, completed, rejected, cancelled; numbered per project ("Inspection #14") under its own advisory lock key `civpms.inspection_no:<project>`; optional time window; every date change writes an `inspection_reschedules` row and bumps `reschedule_count`; new dates are today or later (`INSPECTION_DATE_PAST`). Optional **`assigned_to`** inspector, set when a PM schedules or approves. Results come from the **proposer, the assignee or a project PM**; reschedule requests from the proposer or the assignee; wrong-state actions raise `INVALID_INSPECTION_STATE` in the database **and** the domain module | §11, A3, A17; question 7 (without an assignee, nobody could complete a PM-scheduled inspection) |
| D67 | Notifications: the catalog becomes a table `private.notification_types` read by `notification_catalog()` (now also returning `push_default`, false until Phase 5); actor always excluded; one notification per cascade; reminders at **16:00 the day before and 06:30 the same morning** (Manila), bypassing the digest; `pg_net` + pg_cron call `/api/cron/dispatch-emails` every 5 minutes **only when emails are pending**, using Vault secrets `app_url` and `cron_secret` (missing secrets = logged no-op); every notifying action also calls `queueEmailDispatch()` | Fixes the 17-hour email delay of today's daily Vercel cron; later phases add rows, not rewrites |
| D68 | S-curve: planned = active baseline leaves, weight spread evenly over each leaf's working days **on the baseline's `calendar_snapshot`** (from P2-08), flat at 100 % after; actual = current leaves with current weights, last progress event per Manila day by `recorded_at`, deleted activities excluded (question 17); ₱/hours axis = % × baseline total; computed on the server, ≤ 400 points sent | The last actual point equals the dashboard % (D23) |
| D69 | Charts are custom SVG with `d3-scale` + `d3-shape`, styled only with the P2-11 chart tokens; the geometry (scales, paths, markers, overrun band) lives in a pure module `domain/scurve-geometry.ts` that the Phase 5 export reuses | Full control of markers and hatching; one drawing for screen and PDF |
| D54 (update) | P3-20 turns on the status-date forecast: not-started work cannot start before today, started work cannot finish before today | §8.3 once progress exists |
| D7 (Platform) | **Offline mode out of scope** (owner decision 2026-10-28): no service-worker caching, offline pages, IndexedDB queue, background sync or conflict notices. Kept: an installable "Add to Home screen" shortcut (manifest, icons, theme colours only — "installable shortcut kept, offline dropped"); retry-safe submits (`client_id` on `submit_progress`, `submit_inspection_result`, `propose_inspection`, `request_inspection_reschedule`, plus the media service's 24 h `client_id` replay); a failed submit keeps everything, including picked photos, with "No connection — try again"; local drafts (localStorage) of the progress and inspection-result forms, cleared on success and on sign-out; mobile-first field screens | Owner decision; §13 and the §17.2 "offline queue" line are dropped (risk 1, section 8) |

**Data model (in order)**

*M1 `<ts>_p3_media.sql` (P3-01)*
- Table **`media`**: `id`, `project_id` (cascade), `uploaded_by`, `path` unique (shape `<project_id>/<yyyy>/<mm>/<uuid>.webp`), `thumb_path`, `width`, `height`, `bytes`, `content_type`, `kind` (`completion` | `inspection`), `client_id`, `captured_at`, `activity_id` (**cascade**), `update_id`, `inspection_id` (FK added in M4), `attached_at` (null = staged), `created_at`. Unique `(uploaded_by, client_id)`; indexes on `update_id`, `inspection_id`, `(project_id, created_at)`, staged rows. RLS: visible project and (attached or own upload); no client writes.
- RPCs: `register_media(...)` (first-wins replay returns the existing row), `discard_media(id)` (own staged rows), `claim_media_cleanup(p_limit)` and `complete_media_cleanup(p_paths)` (**service role only**; staged rows and unreferenced `project-media` objects older than 24 hours). Objects are deleted through the Storage API by a Vercel route (SQL deletes on `storage.objects` are blocked).
- Test **14_media.sql**.

*M2 `<ts>_p3_progress_core.sql` (P3-02a)*
- `activities`: `progress_updated_at/_by`, `status_changed_at/_by`, `delay_reported_at/_by`. Add these and `status`, `percent`, `delayed_reported` to the **exclusion array** of `private.activities_before_update` (D61).
- `activity_logs`: `update_id`, `inspection_id` (soft references, indexed; the append-only trigger is untouched) and a progress index on `(project_id, entity_id, recorded_at) where action='progress'`.
- `private.notification_types (type pk, label, description, family, in_app_default, email_default, push_default false, sort)` seeded with today's 10 types plus all Phase 3 types; `notification_catalog()` dropped and recreated to read it (adds `push_default`), re-granted; `update_notification_prefs` validates against it.
- `private.notify(..., p_bypass_digest boolean default false)`: drop, recreate, re-grant.

*M3 `<ts>_p3_progress_rpcs.sql` (P3-02b)*
- Helpers: `check_status_percent` (same words as `validateStatusPercent`), `assert_progress_allowed` (`PROGRESS_LOCKED` with "Set the project to Active before recording progress." / "This project is closed. Reopen it to record progress."), `can_update_progress` (Owner PM or any project member), `write_progress_log`.
- `private.apply_progress(...)`, the shared core: lock target → replay by `client_id` (same actor returns the stored result with `replayed: true`; other actor → `CONFLICT`) → leaf rules (status ↔ %, D64 notes, 1–2 photos only when newly Completed: `PHOTOS_REQUIRED` / `TOO_MANY_PHOTOS`) or parent rules (no %, one of the 5 parent actions, cascade targets locked in id order, count check) → one `UPDATE … FROM unnest(...)` → log rows (target row with `client_id`; one row per cascaded leaf `via='cascade'`; parent summary "Marked Completed: 12 work packages"; escalation flag) → attach media → notify managers once (`activity_escalated`, `activity_completed`) → return `{update_id, replayed, target, affected[], cascade_count}` (a replay returns exactly the first result).
- Public: `submit_progress(p_activity_id, p_status, p_percent, p_note, p_media_ids, p_report_delay, p_expected_count, p_client_id)` (`via='direct'`); `carry_progress_to_child(p_parent_id, p_child_id)` (manager; the D21 first-child case; `via='system'`).
- Test **15_progress.sql**: every §10.3 cell, notes, photos, reopen, `NO_CHANGE`, locks, `FORBIDDEN`/`NOT_FOUND`, cascade counts and `CASCADE_CHANGED`, completed leaves untouched, one log row per leaf, escalation flags, replay returns the identical result (no second log row), version unchanged, carry-over, notifications (one per cascade, actor excluded, preferences honoured), 2,000-leaf cascade < 1.5 s.

*M4 `<ts>_p3_inspections.sql` (P3-03a)*
- Enums `inspection_status`, `inspection_reschedule_kind` (`request`, `pm_approve_new_date`, `pm_reschedule`), `inspection_reschedule_decision`.
- Table **`inspections`**: `id`, `project_id`, `company_id`, `number` (unique per project), `activity_id` (cascade on purge), `scheduled_date`, `start_time`, `end_time` (end after start), `status`, `notes`, `assigned_to` (project inspector, nullable), `proposed_by/_at`, `reviewed_by/_at`, `review_note`, `original_date`, `reschedule_count`, `cancelled_by/_at`, `cancel_reason`, `result_update_id`, `result_status`, `result_percent`, `result_note`, `completed_by/_at`, `client_id` (unique per proposer), `reminded_eve_for`, `reminded_morning_for`, timestamps. `media.inspection_id` FK. RLS: select for visible projects; no client writes (viewers will use a dedicated RPC in Phase 4).
- RPCs: `propose_inspection(p_project_id, p_activity_id, p_date, p_start_time, p_end_time, p_notes, p_assigned_to, p_client_id)` (inspector → proposed; manager → approved; idempotent), `review_inspection(p_id, p_decision, p_date, p_start, p_end, p_note, p_assigned_to)` (reject needs a reason), `cancel_inspection(p_id, p_reason)` (proposer or manager; reason when a manager cancels someone else's).
- Triggers: `audit_inspections` (`entity_type='inspection'`, actions propose/schedule/approve/reject/…/complete; e.g. "Approved inspection #14 of 1.2.3 Rebar Installation for 14 Oct 2026, 9:00–11:00 AM (moved from 12 Oct)"); system cancel on activity delete and on project completed/cancelled (proposer and assignee notified).

*M5 `<ts>_p3_inspection_reschedules.sql` (P3-03b)*
- Table **`inspection_reschedules`** (`kind`, `requested_by/_at`, from/to date and times, `reason`, `decision`, `decided_by/_at`, `decision_note`, `client_id`; unique `(requested_by, client_id)`).
- RPCs: `request_inspection_reschedule` (proposer or assignee; reason required), `decide_inspection_reschedule(p_id, p_approve, p_note)`, `reschedule_inspection` (manager; closes a pending request as declined). Notifications inside the RPCs.
- Test **16_inspections.sql** (P3-03a writes part 1): role × state matrix (Owner PM, PM, proposer, assignee, other inspector, non-member, other company), numbering, past dates, time range, history rows, `reschedule_count`, auto-cancel, one log row per transition, recipients, RLS.

*M6 `<ts>_p3_inspection_results_jobs.sql` (P3-04)*
- `submit_inspection_result(p_id, …same as submit_progress…)`: proposer, assignee or manager; inspection must be approved; calls `apply_progress` with `via='inspection'`; marks it completed with the result; notifies managers `inspection_completed`. The early-date warning is UI-only (A17).
- `private.send_inspection_reminders('eve' | 'morning')`: approved inspections for tomorrow / today, once per date (again after a reschedule), to the proposer, assignee and managers, bypassing the digest; pg_cron `civpms-inspection-reminders-eve` `0 8 * * *` UTC and `-morning` `30 22 * * *` UTC.
- `create extension pg_net`; `private.call_app_route(path)` reads the Vault secrets; pg_cron `civpms-dispatch-emails` every 5 min when pending emails exist, `civpms-media-cleanup` at `20 17 * * *` UTC (01:20 Manila).
- Test **17_inspection_results_jobs.sql** (results by role and state, photos, cascades from a parent inspection, `via='inspection'` rows carry `inspection_id`, reminders, no-op without secrets, jobs exist).

*M7 `<ts>_p3_scurve.sql` (P3-05)*
- `public.scurve_data(p_project_id, p_baseline_id default null) → jsonb` (viewable projects, else `NOT_FOUND`): project fields, baselines list, the chosen baseline's `calendar_snapshot` and leaves, current leaves, compacted daily progress events, the current calendar. Reads Phase 2's snapshot; adds no baseline column.
- Test **18_scurve.sql**.

*Error codes:* `PROGRESS_LOCKED`, `PHOTOS_REQUIRED`, `TOO_MANY_PHOTOS`, `MEDIA_INVALID`, `CASCADE_CHANGED`, `NO_CHANGE`, `INVALID_INSPECTION_STATE`, `INSPECTION_DATE_PAST`, `INVALID_TIME_RANGE`, `CONFLICT` (mapped in `src/lib/errors.ts` with plain messages, e.g. "Add 1 or 2 photos showing the completed work.").

**Domain logic**
- `progress.ts`: `progressAllowed`, `parentUpdateOptions`, `cascadeTargets` (mirrors SQL), `describeCascade` ("This will update 12 work packages." + how many lose progress), `noteRequirement`, `photoRequirement`, `buildProgressPlan`, `delaySources` (tooltip lines). Schemas `leafProgressSchema`, `parentProgressSchema` replace `activityProgressSchema`. Delayed filtering stays in Phase 2's `schedule-filters.ts`; P3 only supplies the "reported" data (a leaf with status Delayed, or a parent with a reported delay).
- `inspection.ts`: statuses, labels, tones, icons; `inspectionActions({status, isProposer, isAssignee, isManager, …})`; `transition` (throws `INVALID_INSPECTION_STATE`); `isOverdue`; `earlySubmissionWarning`; `validateSchedule` (soft non-working warning); `groupForList` (Needs your review, Overdue, Upcoming, Past); zod schemas.
- `scurve.ts`: `plannedCumulative`, `actualCumulative`, `buildSCurve` (range to max(project end, baseline end, latest end, today); markers; overrun window), `sampleSCurve` (≤ 400 points, keeps markers and the biggest variance), `varianceAt`, `plannedPercentAt`. Fixture: A ₱30,000 5–9 Oct, B ₱10,000 12–16 Oct → planned 45 % on Wed 7 Oct, 75 % on Fri 9, 100 % on Fri 16; A at 50 % on Tue 6 → actual 37.5 %; variance on Wed −7.5 pts / −₱3,000.00. 5,000 leaves < 150 ms.
- `permissions.ts`: `canProposeInspection`, `canScheduleInspection`, `canReviewInspection`, `canRequestReschedule`, `canSubmitInspectionResult`, `progressPermissions`.

**UI/UX**
- **Progress update sheet** (`components/progress/`, right sheet 480 px; full-height bottom sheet on phones), opened from WBS rows (inspectors see an **Update** button), graph node menu, Gantt row menu and schedule panel, History drawer, dashboard items and `?update=<id>` links, through a `ProgressUpdateProvider`. Leaf form: 5 status cards, slider + number + chips limited to the allowed range, note with counter shown as required only when needed, two photo slots for Completed ("Take photo" / "Choose photo"; Uploading n % → Processing → Ready / Failed with reason and Retry). Parent form: derived % read-only, the 5 actions with counts, confirm dialog "This will update 12 work packages. Continue?" (danger tone for Not Started). Locked states explain what to do. Uncontrolled inputs (`register()`) only. Opening the sheet wakes the media service with a no-cors `GET /healthz`.
- **Retry-safe submits and drafts (D7, P3-23)** for the progress sheet and the inspection result: one `client_id` per logical submission, reused on every retry and double tap; the Save button locks while sending; a network failure keeps every field and picked photo and shows "No connection — try again" with **Try again**; a draft (status, %, note, delay flag, already-uploaded photo ids) is autosaved to localStorage (wrapped in try/catch; private windows simply skip it), offered again when the form reopens ("Unsent update from 14:05 · Restore / Discard"), and cleared on success and on sign-out. Photo files themselves stay in memory only; staged photos older than 24 h are dropped from a restored draft with "Add the photos again".
- **Mobile-first field pass (P3-24)** over the progress sheet, inspections list, drawer and dialogs, and History drawer at 390 px: ≥ 44 px targets, bottom sheets with sticky Save, camera capture, no horizontal scroll, one-hand reach for the primary action.
- **Home-screen icon (P3-25):** `src/app/manifest.ts` (name CivPMS, `display: standalone`, `start_url: "/"`, icons from `public/icons/*` and the brand assets), `apple-touch-icon` from the existing `src/app/apple-icon.png`, light/dark `theme-color`; no service worker, no offline page; the owner's `favicon.ico` and `public/logo.svg` are never modified.
- **Photos** (`src/lib/media/project-photo-upload.ts`, `components/media/`): type/size checks (JPEG, PNG, WebP, HEIC ≤ 15 MB), optional pre-shrink, XHR progress, retry on 429/503 honouring `Retry-After`, browser fallback, `registerMedia`; `PhotoSlots`, `PhotoThumb` (`<img>` only, D48), `PhotoLightbox`.
- **History drawer** (`components/history/`): tabs All · Progress · Plan changes · Inspections; "Include work packages" for parents; via chips; thumbnails; pages of 50; `?history=<id>`. **Audit page:** Progress and Inspections types, an Activity filter, via labels, CSV columns `via` and `inspection #`.
- **WBS:** Update, History and Propose inspection actions; Delayed tooltip from `delaySources`; D21 dialog offers "Carry progress (Ongoing, 40 %) to the new work package".
- **Inspections** (`/projects/[id]/inspections`, sidebar item with a review-count pill for managers): primary action "Propose inspection" (inspector) or "Schedule inspection" (PM, with optional assigned inspector); List | Calendar; filters (status, activity, inspector, dates, "Only mine"); sections Needs your review, Overdue, Upcoming, Past; badges Awaiting approval (warning, `Clock`), Approved (primary, `CalendarCheck`), Reschedule requested (orange, `CalendarClock`), Completed (success), Rejected (danger chip, never a button), Cancelled (neutral, `Ban`), Overdue (danger). Detail drawer with timeline and result; dialogs for propose/schedule, review, request reschedule, decide, PM reschedule, cancel; result submission reuses the progress form with an early-date warning. Calendar: presentational `components/schedule-calendar/` (Month, Week, Agenda; Agenda default under 640 px) that Phase 4 reuses.
- **S-curve page** (replaces the placeholder; remove `soon`): KPIs Planned today / Actual today / Variance; Cost | Hours; baseline select and "Compare with earlier baselines"; hover/touch crosshair and keyboard readout; "Show as table"; states for Planning, no dated work, no progress yet, and warnings (undated work, scope changed).
- **Dashboard:** "Actual 35 % vs Planned 42 %", Next inspections, "3 inspections wait for your approval" and overdue items, Recently updated, and the status-date forecast.
- **Notifications UI:** new types in the bell with icons and deep links (`?inspection=`, `?history=`, `?update=`); a new `inspection_results` family; the profile matrix drops its "coming" labels.

**Notifications** (rows in `private.notification_types`; actor always excluded)

| Type | To | In-app | Email default |
|---|---|:-:|:-:|
| inspection_proposed | Managers | ✓ | ✓ |
| inspection_approved / _rejected / _rescheduled / _reschedule_declined | Proposer and assignee | ✓ | ✓ |
| inspection_cancelled | The other party | ✓ | ✓ |
| inspection_reschedule_requested | Managers | ✓ | ✓ |
| inspection_reminder | Proposer, assignee, managers (bypasses digest) | ✓ | ✓ |
| inspection_completed | Managers | ✓ | off (question 16) |
| activity_escalated | Managers | ✓ | ✓ |
| activity_completed | Managers | ✓ | off (question 16) |

Audit: `action='progress'` rows (`via` direct, inspection, cascade; system for carry-over) and `entity_type='inspection'` for every transition. Photo uploads are not logged separately.

**Backend (Rust service).** No code change. The owner deploys it (O-9); without it the browser fallback works. README gains "How the web app uses it" (kinds, register flow). `docker build` and HEIC on ffmpeg 7.1 are checked in P3-10 if Docker is available, otherwise on Render.

**Testing.** SQL 14–18 plus additions to 01 (new functions, service-role RPCs, jobs, `pg_net`), 03 (cross-company `NOT_FOUND`) and 07 (version unchanged by progress). Vitest for the three domain modules, upload helper (success, replay, 429, 503 → fallback, register failure), families, templates, `attention.ts`, error codes. Playwright: `p3-progress` (inspector leaf flow with photo through the fallback path, parent cascade, locked Planning, Gantt entry point, 390 px), `p3-inspections` (propose → approve with new date → request → decline → early result with photo; calendar; PM direct schedule with assignee; cancel), `p3-scurve`, `p3-dashboard`, `p3-field-resilience` (a submit aborted with `page.route` shows "No connection — try again", keeps the form and photos, and a retry creates exactly one log row and one media row; a reloaded form offers the draft; sign-out clears it), golden path extended. Performance: cascade 2,000 leaves < 1.5 s; S-curve compute < 150 ms; `/s-curve` server render < 800 ms on the 560-activity project.

**Work packages – Phase 3** (30 packages, 25 agent-days)

| ID | Title | Depends on | Size | Parallel? | Acceptance |
|---|---|---|---|---|---|
| P3-01 | DB M1: media table, register (first-wins), discard, cleanup RPCs | P2-08 | S 0.5 | DB lane | Test 14 + all earlier tests pass; 24 h grace; cascade on activity purge; DATABASE.md media section |
| P3-02a | DB M2: version rule, log columns, notification types table, `notify` digest bypass | 01, Q16 | M 1 | DB lane | Test 07 updated (progress leaves `version` alone); catalog reads the table incl. `push_default`; tests 01 and 09 pass |
| P3-02b | DB M3: `apply_progress`, `submit_progress`, `carry_progress_to_child` | 02a, Q6 | L 1.5 | DB lane | Test 15 passes incl. 2,000-leaf cascade < 1.5 s; no `lock_wbs` in progress RPCs; D60–D64 written |
| P3-03a | DB M4: inspections, assignee, numbering, propose/review/cancel, audit, auto-cancel | 02b, Q7 | M 1 | DB lane | Test 16 part 1 passes; numbering under its own lock key |
| P3-03b | DB M5: reschedules, decisions, PM reschedule, notifications | 03a | M 1 | DB lane | Test 16 complete (full matrix incl. assignee); D66 written |
| P3-04 | DB M6: results, reminders, 5-minute dispatcher, cleanup job | 03b, Q8, O-11 | M 1 | DB lane | Test 17 passes; missing secrets = logged no-op; D67 written; SETUP.md Vault steps |
| P3-05 | DB M7: `scurve_data` | 04 | S 0.5 | DB lane | Test 18 passes; reads `calendar_snapshot`; D68 written |
| P3-06 | Domain: progress rules, permissions, schemas | P2-05a | S 0.5 | Domain lane (during P2) | Every §10.3 cell; note matrix (unchanged Delayed needs no note); cascade targets; delay sources; 100 % lines |
| P3-07 | Domain: inspection state machine | P2-05a | S 0.5 | Domain lane | Matrix identical to SQL incl. assignee; `INVALID_INSPECTION_STATE`; overdue in Manila; early warning |
| P3-08 | Domain: S-curve model | P2-02 | S–M 0.75 | Domain lane | Fixture numbers exact; 5,000 leaves < 150 ms; sampling keeps markers |
| P3-09 | App plumbing: error codes, notification types and families, sidebar item, permission flags | 02a, 03a, 06, 07 | S 0.5 | App | Mapping and family tests; `getProjectAccess` returns new flags; build green |
| P3-10 | Photo upload pipeline + components | 01, 09, B-08, O-9 (service path) | M 1 | App | Service path and browser fallback both verified; progress, `Retry-After`, register; signed thumbnails in the styleguide |
| P3-11a | Progress sheet: leaf form, action, locked states, provider | 10, 02b, 06 | M 1 | App | Leaf flow end to end; `register()` inputs; locked states; `queueEmailDispatch()` called |
| P3-11b | Progress sheet: parent actions, cascade confirm, photo slots, phone layout | 11a | M 1 | App | Count confirm + `CASCADE_CHANGED` re-confirm; Completed needs 1–2 photos; 390 px bottom sheet with ≥ 44 px targets |
| P3-12 | History drawer + audit additions | 11b | S–M 0.75 | App | Tabs, paging, `?history=`; Activity filter URL-synced; via chips; CSV columns |
| P3-13a | WBS integration | 12, P2-23 | S–M 0.75 | No (WBS files) | Update/History/Propose actions; inspector Update button; delay tooltip; reported-delay data feeds the P2 filter; carry-progress option |
| P3-13b | Gantt Update action + Inspector filter | 13a, 14, P2-21 | S 0.5 | No (gantt files) | Gantt row menu and schedule panel open the progress sheet; "Inspector" filter (proposer/assignee of open inspections) in the shared filter bar |
| P3-14 | Inspections server layer | 04, 09 | S–M 0.75 | App (parallel with 10–12) | Queries (groups, range, detail + history, counts) and every lifecycle action; zod → RPC → revalidate → `ActionResult`; dispatch called |
| P3-15 | Inspections list, drawer, propose/schedule dialog | 14 | M 1 | App | Sections, filters, empty states; drawer timeline; propose and auto-approved schedule with assignee work end to end |
| P3-16 | Decision flows + result submission | 15, 11b | M 1 | App | Every role × state action works or is hidden/disabled with a reason; early warning; Completed result with photo |
| P3-17 | Schedule calendar + Inspections calendar | 15 | M 1 | Parallel with 16 | Month/Week/Agenda, keyboard navigation, non-working shading, click → drawer; presentational API documented for the Phase 4 viewer calendar |
| P3-18 | S-curve chart + geometry module | 08, P2-11 | M 1 | Yes | Uses P2 tokens only; geometry in `domain/scurve-geometry.ts`; keyboard crosshair and table mode; light/dark/phone |
| P3-19 | S-curve page | 05, 18 | S–M 0.75 | App | All states; last actual point = dashboard %; server render < 800 ms; `soon` removed |
| P3-20 | Dashboard additions + status-date forecast | 14, 19 | S–M 0.75 | App | Actual vs planned, next inspections, approvals and overdue items, recently updated; CPM with status date = Manila today drives the warning; `attention.test.ts` covers a started-late leaf |
| P3-21 | Notification templates, bell, media-cleanup route | 04 | S–M 0.75 | Parallel | Templates tested; bell icons and deep links; cleanup removes a stale `[P3]` object via the Storage API; prefs show the new groups |
| P3-23 | Retry-safe submits, kept form data, local drafts (D7) | 11b, 16 | M 1 | App | One `client_id` per submission reused on retry/double tap (1 log row, 1 media row); failed submit keeps fields and photos with "No connection — try again"; drafts restore and clear on success and sign-out (named edit in `components/shell/user-menu.tsx`); Vitest for the draft store |
| P3-24 | Mobile-first field pass | 23 | S–M 0.75 | App | Progress sheet, inspections list/drawer/dialogs and History at 390 px: ≥ 44 px targets, sticky Save, camera capture, no horizontal scroll; light/dark screenshots |
| P3-25 | "Add to Home screen" icon (manifest only, D7) | — (any time in Phase 3) | S 0.5 | Yes | Installability passes on Android Chrome (Lighthouse 12+ no longer has a PWA audit, so verify in Chrome DevTools → Application → Manifest; Chrome no longer requires a service worker for this — if it ever does, report instead of adding one); iOS shows the CivPMS icon via apple-touch-icon; uses `public/brand`, `public/icons`, `src/app/icon.png`, `src/app/apple-icon.png`; light/dark theme-color; no offline page; `favicon.ico` and `public/logo.svg` untouched |
| P3-22a | E2E: progress + inspections + field resilience | 13b, 16, 17, 24 | M 1 | Near last | `p3-progress` (incl. Gantt entry), `p3-inspections` and `p3-field-resilience` green |
| P3-22b | E2E: S-curve + dashboard, golden path, performance, docs | 20, 21, 22a | M 1 | Last | Specs and golden path green; performance numbers in HANDOFF; DECISIONS/DATABASE/DOMAIN final; pushed |

**Lanes:** DB 01 → 02a → 02b → 03a → 03b → 04 → 05 · domain 06, 07, 08 (during Phase 2) · app 09 → 10 → 11a → 11b → 12 → 13a → 13b and 14 → 15 → {16 ∥ 17} → 23 → 24 · chart 18 (after 08 + P2-11) → 19 → 20 · 21 after 04 · 25 any time · 22a → 22b last.

---

### 4.3 Phase 4 – Sharing & viewers

**Goal (what the owner gets).** **Google-style sharing:** a PM opens **Share** (button on every project page, or the new **Sharing** tab), adds people by email as **Viewer**, sees who has opened it, removes access with Undo, or promotes someone to Inspector/PM through the existing invitation flow. General access is **Restricted** (default) or **Anyone with the link**: the link is unguessable, can be copied again, reset (the old one stops working) and set to expire (7/30/90 days or never), and turning it on requires confirming exactly what becomes visible. **Viewers** sign in with the invited email and see only the project name, the full site address and an inspection calendar ("Site inspection", date, time window, Approved/Rescheduled; the activity title on hover, tap or focus). Link visitors see the same page without signing in. Signed-in people who open a project they cannot see get a friendly page with **Request access**. Every sharing change is in the audit trail, visible to managers only. Offline mode is **not** part of this phase any more (D7).

**Scope:** §2.1–2.2 (Viewer role, manage sharing), §9.5 (Sharing tab), §10.6 (sharing entries), §12.1–12.3, §14 (sharing notifications), §17.2 (permission denied → request access), §18.2–18.3 (viewer tables, viewer RPCs, hashed revocable rate-limited link tokens), §19 (data minimisation for viewers and public links), A18. §13 (PWA, offline queue, sync) is **dropped by D7**; its replacement (retry-safe submits, kept form data, drafts, mobile-first screens, home-screen icon) ships in Phase 3.

**Key decisions**

| # | Decision | Why |
|---|---|---|
| D70 | A viewer is a **per-project grant on a canonical email** (`project_viewers.email_key`: lower-case; for Gmail, dots and `+tags` removed), matched against the signed-in user's **verified** email whatever the sign-in method. Viewers are never company or project members, have **no table or Storage access**, and read only through definer RPCs with an explicit field list. Routes live outside `(app)`: `/shared`, `/shared/[projectId]` (signed in, no onboarding), `/s/[token]` (public). Becoming a project member removes the viewer row | Keeps D13 and every existing RLS rule intact; question 19 |
| D71 | One active link per project; token = 32 random bytes as 64 hex characters (`private.new_token()`), stored as a **hash** for lookup plus a **Vault copy** so PMs can copy it again (question 20); turning the link off or resetting always mints a new token; expiry 7/30/90/none (default 90, question 21); > 600 hits per 10 minutes → `RATE_LIMITED`; `/s/*` pages send `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` | §18.3 (hashed, revocable, rate-limited) with copy-again convenience |
| D72 | **Exposure contract** (one gate `private.shared_project_gate`, one row source `private.viewer_events`): approved inspections (label Approved, or Rescheduled when `reschedule_count > 0`), pending reschedules on their current date, completed ones with their old label (never "Completed"); proposed/rejected/cancelled hidden; window today − 30 days to + 365 days, ≤ 62 days per request; fields: opaque key, date, times, status, activity title (name only, no WBS code); project name, site name and site address only. **Sharing audit rows are visible to managers only** (`activity_logs_select` updated), so inspectors never see viewers' emails | §12.2–12.3, RA 10173 minimisation; question 22 |
| D73 | Safety rails: ≤ 200 viewers per project, ≤ 50 new viewer emails per person per day, ≤ 20 per submission (question 24); exposure notice confirm before the link turns on; the Owner PM is told when another PM turns it on (question 23); access survives Completed/Cancelled until removed, with a reminder (question 25). **One request-access design (owned here):** `request_project_access` always answers "Request sent" (no existence leak), ≤ 10 per person per day, managers get `access_requested` at most once per requester per day; `resolve_access_request(p_request_id, p_grant_as)` grants **viewer**, or **inspector/pm** only when the requester belongs to the project's company; one requests card on the Sharing page, linked from Collaborators; a member who opens `/projects/<id>` without access but with a viewer grant is redirected to `/shared/<id>` | Merges the two request-access designs of the phase plans into one (question 26) |
| D74–D79 | **Dropped by D7** (PWA tooling, offline caching, outbox, sync engine, queued photos, conflict FYI). D44 (24 h media replay) stays as it is | Owner decision 2026-10-28 |

**Data model (in order)**

*M1 `<ts>_p4_viewers.sql` (P4-01)*
- Helpers `private.share_email_key(email)` (immutable; same rules as the TS `shareEmailKey`, shared test vectors), `private.my_email_key()`, `private.shared_project_gate(project_id)` (exists and not deleted; Phase 5 adds "company not suspended" here).
- Table **`project_viewers`**: `id`, `project_id` (cascade), `company_id`, `email`, `email_key` (unique per project), `user_id` (bound on first access), `added_by`, `first_viewed_at`, `last_viewed_at`, timestamps. RLS select for `manageable_project_ids()`; no client writes.
- RPCs (manager): `share_project(p_project_id, p_emails[], p_notify)` → `{added[], skipped[{email, reason self|member|already}]}` with the caps above; `remove_project_viewer(p_viewer_id)` (Undo re-shares without email); `get_project_sharing(p_project_id)` (viewers, link incl. the Vault token, open requests, member count).
- Triggers: `audit_project_viewers` (`entity_type='project_viewer'`: share, unshare, replaced), `project_members_replace_viewer`. Policy change: `activity_logs_select` hides `project_viewer`, `share_link`, `access_request` rows from non-managers. Notification type `project_shared_with_you` (row insert into `private.notification_types`).

*M2 `<ts>_p4_links_requests.sql` (P4-02)*
- Vault helpers `link_secret_put/get/drop` (revoked from everyone; called only by definer functions).
- Table **`project_share_links`**: `token_hash` unique, `vault_secret_id`, `expires_in_days`, `expires_at`, created/revoked fields with `revoke_reason` (turned_off, reset, expired), `last_used_at`, `use_count`, `expiry_warned_at`, `expired_logged_at`; one active link per project (partial unique index); deny-all RLS; a BEFORE DELETE trigger drops the Vault secret (so the Phase 5 purge cleans Vault too).
- Table **`project_access_requests`**: `project_id`, `company_id`, `user_id`, `email`, `message` (≤ 300), `request_count`, `created_at`, `last_requested_at`, `resolved_at/_by`, `resolution` (granted_viewer, granted_member, dismissed); unique `(project_id, user_id)`; RLS select for managers.
- RPCs: `set_link_sharing(p_project_id, p_enabled, p_expires_in_days)`, `reset_share_link`, `set_share_link_expiry`, `resolve_access_request(p_request_id, p_grant_as 'viewer' | 'inspector' | 'pm' | null)` (null = dismiss; member roles use the `add_project_member` internals and only for same-company requesters).
- Trigger `audit_project_share_links` (`share_link`: link_on, link_off, link_reset, link_expiry, link_expired). Types `access_requested`, `share_link_enabled`, `share_link_expiring` (row inserts).
- Test **20_sharing.sql** (P4-01 writes part 1, P4-02 part 2): email-key vectors, validation and caps, skips, idempotent re-share, binding, Undo, member-replaces-viewer, links on/off/reset/expiry with a new token each time, Vault readable only through `get_project_sharing` and dropped on revoke/delete, the hash never returned, grant rules, RLS (inspectors and non-members see 0 sharing rows), `FORBIDDEN` / `NOT_FOUND`, log rows.

*M3 `<ts>_p4_viewer_reads.sql` (P4-03)*
- `private.viewer_grant`, `private.viewer_events(project, from, to)`, private table `share_link_hits(link_id, bucket, hits)`.
- RPCs: `viewer_project(p_project_id)` → `{id, name, site_name, site_address, access: member|viewer}` (members may preview; `NOT_FOUND` otherwise); `viewer_calendar(p_project_id, p_from, p_to)` → `{events, next_date, range}`; **`shared_link_view(p_token, p_from, p_to)`** (the only new anon grant) → `SHARE_LINK_INVALID` (unknown, revoked or deleted, identical), `SHARE_LINK_EXPIRED`, `RATE_LIMITED`; `my_shared_projects()`; `request_project_access(p_project_id, p_message)`.
- `private.run_sharing_checks()` (pg_cron `civpms-sharing-checks` at `10 16 * * *` UTC = 00:10 Manila): expiry warnings 3 days before, expired links logged and their Vault secret dropped, hit buckets and old resolved requests trimmed.
- Tests **21_viewer_reads.sql** (exact key sets of every viewer response; status mapping; window; a viewer session reads **0 rows from every table and from `project-media`**; link states; rate limit; uniform request answer; job) and **22_sharing_privileges.sql** (search_path pinned, grants, anon only on `shared_link_view` and the existing `get_invitation_by_token`; test 03 gains cross-company rows).

*Error codes:* `VIEWER_LIMIT`, `SHARE_LINK_INVALID`, `SHARE_LINK_EXPIRED`, `SHARE_LINK_OFF` (the existing `LINK_INVALID`/`LINK_EXPIRED` belong to sign-in email links and keep their copy); reuse `RATE_LIMITED`, `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`.

**Domain logic.** `domain/sharing.ts`: `shareEmailKey`, `parseEmailList` (≤ 20, invalid and duplicate lists), `LINK_EXPIRY_OPTIONS`, `linkExpiryLabel` (Manila), `viewerEventView` (label, status, tone, icon, time text, full aria label incl. the activity title), `EXPOSURE_NOTICE` (one copy constant for the dialog, the email and the tests), `viewerAccessStatus`, `sortSharePeople`; schemas `shareProjectSchema`, `linkSharingSchema`, `accessRequestSchema`; permission flags `canManageSharing`, `canPreviewAsViewer`.

**UI/UX**
- **Share dialog** (`components/sharing/*`, 560 px; full-height sheet on phones): add people (email chips validated on blur, role fixed to Viewer with "Need them to update progress? Invite as Inspector"), notify checkbox and optional message (sent, never stored), result banner with skipped reasons; people with access (member summary, viewer rows with "Hasn't opened yet" / "Last opened 2 days ago", menu Invite as Inspector or PM…, Copy email, Remove access with Undo); general access select (Restricted `Lock` / Anyone with the link `Globe`) with the exposure confirm ("Anyone with the link will see the project name, the full site address and the dates of site inspections with activity titles. They won't see costs, progress, people or photos.") and the expiry select; link field with Copy, native share on phones, opens count, Reset.
- **Sharing page** `/projects/[id]/sharing` (managers; sidebar item after Collaborators; top-bar Share button; ⌘K "Share project"): people, general access, access requests (Grant as Viewer / Inspector / PM, Dismiss), "See exactly what viewers see" preview, history link to the audit Sharing filter, closed-project reminder, empty state "No one outside the project team can see this project yet…".
- **Viewer pages**: `/shared` (cards with name and address; empty state with "Set up your account" for PMs/inspectors); `/shared/[projectId]` (header with address, "Open in Maps", "Times are Philippine time"; the Phase 3 `schedule-calendar` component; legend Approved / Rescheduled; chips "Site inspection · 9:00 AM" with tooltip and popover; "Go to next inspection"; member preview banner; access-denied page with Request access and Switch account); `/s/[token]` (same layout, theme toggle only, footer "Shared by link. Anyone with this link can see this calendar.", invalid/expired/off/busy states, month navigation that works without JavaScript).
- **Access flows:** viewer-only users land on `/shared` instead of onboarding; onboarded members see a "Shared with you" strip on home; login and sign-up show "Use the Google account (or email) the project was shared with" when `next` starts with `/shared` or `/s/`; `/projects/[id]` without access shows **ProjectUnavailable** (redirect to `/shared/<id>` when a grant exists, otherwise Request access with the uniform answer).
- Accessibility: tooltips are never the only way to read a title (popover and aria label carry it); dialog traps focus, Esc closes, Backspace removes chips; 390/768/1440 px light and dark.

**Notifications and audit**

| Type | To | In-app | Email default |
|---|---|:-:|:-:|
| project_shared_with_you | The viewer (existing account) | ✓ | ✓ |
| access_requested | Project managers | ✓ | ✓ |
| share_link_enabled | Owner PM, when another PM turns it on | ✓ | — |
| share_link_expiring | Link creator (else managers), 3 days before | ✓ | ✓ |

New preference family **Sharing** (`sharing`). Emails (Brevo, branded like invitations): `viewer-shared` (also sent directly to people without an account; CTA "Open shared calendar" → `https://civpms.prannsss.dev/shared/<projectId>`), `share-access-requested`, `share-link-expiring`; viewer emails carry a preferences/unsubscribe link (finished in P5-31b). `queueEmailDispatch()` in every sharing action. Audit: `project_viewer`, `share_link`, `access_request` (managers only); viewer page opens are not logged (only first/last viewed and link counts, no IP addresses).

**Backend (Rust service).** No change.

**Testing.** SQL 20–22. Vitest: sharing vectors (shared fixture with test 20), schemas, labels across a Manila midnight, aria text, error mapping, templates. Playwright on `chromium`: `p4-sharing` (share with a `[P4]` viewer; the viewer's calendar; a DOM text scan finds no WBS code, inspector name, %, ₱ or inspection number; `viewer_calendar` response keys; Remove + Undo; inspector sees no Sharing; 390 px), `p4-link` (anonymous context, headers, reset, turn off, expired link), `p4-access` (request → grant → access; viewer-only redirect; redirect from `/projects/<id>`; login hint). Performance: `viewer_calendar` for 62 days < 200 ms; `/s/<token>` TTFB < 1 s from `sin1`.

**Work packages – Phase 4** (13 packages, 9.75 agent-days)

| ID | Title | Depends on | Size | Parallel? | Acceptance |
|---|---|---|---|---|---|
| P4-01 | DB M1: viewers, share/remove/get sharing, member-replaces-viewer, audit, log policy | P3-05 | M 1 | DB lane | Test 20 part 1 passes; inspectors see 0 sharing rows; D70 written |
| P4-02 | DB M2: share links + Vault, link RPCs, access requests, notification rows | 01, Q20 | M 1 | DB lane | Test 20 complete; Vault token only via `get_project_sharing`; hash never returned; D71, D73 written |
| P4-03 | DB M3: viewer and public reads, request access, sharing job | 02 | S–M 0.75 | DB lane | Tests 21 + 22 pass incl. exact key sets and "0 rows everywhere"; 62-day query < 200 ms; D72 written |
| P4-04 | Domain: sharing | P3-06 | S 0.5 | Domain lane (during Phase 3) | Vector fixture shared with test 20; list parsing cap 20; labels across Manila midnight; aria text; 100 % lines |
| P4-05 | Sharing server layer + emails | 02, 03, 04 | S–M 0.75 | App | Actions zod → RPC → revalidate → `ActionResult`; link URL from `APP_URL`; Brevo email to non-users; Undo re-share without email; `sharing` family; template tests |
| P4-06 | Share dialog | 05 | S–M 0.75 | App | Add people with skipped reasons; people list; general access with exposure confirm; copy, reset, expiry; light/dark/phone screenshots |
| P4-07 | Sharing page, requests card, entry points | 06 | S–M 0.75 | App | Cards; grant as Viewer/Inspector/PM; sidebar item, top-bar button, Collaborators link; audit Sharing filter |
| P4-08 | Viewer page `/shared/[projectId]` | 03, 04, P3-17 | S–M 0.75 | Parallel with 06 | Viewer shell, calendar adapter, states, member preview; no hidden fields in the DOM |
| P4-09 | Public link page `/s/[token]` | 08 | S–M 0.75 | App | Headers no-store/no-referrer/noindex; month navigation without JS; invalid/expired/off/busy states |
| P4-10 | Viewer-only redirect, onboarding banner, home strip, login hint | 08, O-12 | S–M 0.75 | App | Viewer-only users land on `/shared`; strip for members; `f1-*` specs green |
| P4-11 | ProjectUnavailable + request access | 10 | S–M 0.75 | App | `/projects/<id>` without access: grant → `/shared/<id>`, else Request access with the uniform answer; `/shared/<id>` access-denied page |
| P4-12 | E2E: sharing, link, access | 07, 09, 11 | S–M 0.75 | Near last | Three specs green incl. DOM exposure scan, response keys, `/projects/<id>` redirect; no console errors |
| P4-13 | Performance, docs, handoff | 12 | S 0.5 | Last | Viewer timings recorded; D70–D73 final and D74–D79 marked dropped; DATABASE/DOMAIN/HANDOFF/SETUP updated; pushed |

**Lanes:** DB 01 → 02 → 03 · domain 04 (during Phase 3) · app 05 → {06 → 07 ∥ 08 → 09} → 10 → 11 → 12 → 13. The app lane needs P4-03 and P3-17 (calendar component), not the rest of Phase 3, so it can overlap Phase 3's last UI packages.

---

### 4.4 Phase 5 – Polish, launch readiness and UAT

**Goal (what the owner gets).** **Find anything** with ⌘K / Ctrl+K (search icon on phones): activities by name or WBS code, projects, inspections (`#14`), people, notes, and actions such as "Propose inspection" or "Import WBS…"; typo-tolerant and accent-insensitive ("Paranaque" finds "Parañaque"); "This project" / "All projects" scopes; results only from what the person may see, enforced by the database. **Import a plan in minutes** from Excel/CSV (with a template), a Google Sheet or an MS Project XML file: map columns, fix row errors inline, confirm; one atomic, logged import that can be undone for 24 hours. **Export and report:** Gantt PDF (paged, to scale) and PNG; S-curve PDF/PNG/Excel; WBS PDF/PNG/Excel/CSV; activity log and inspections CSV/Excel; a **Full project report** PDF; a project archive ZIP; every file carries the project name, generation time (Manila), ₱ formatting and the person's Hours/Days choice. **Retention and privacy:** closed projects are deleted 1 year after closing with warnings 30 and 7 days before and an export link; reopening resets the clock; privacy notice and terms with recorded consent (members and viewers); "Download my data", "Delete my account", ownership transfer, a breach runbook. **Platform Admin:** a hidden, MFA-protected `/admin` for the deployment owner (companies, user lookup, company-owner invitations, ownership transfer, retention queue; optional suspension), metadata only. **Web push** alerts on phones and desktops (on iPhone after Add to Home Screen). **Production readiness:** health checks and uptime monitoring, security headers and CSP, a tested restore, verified performance budgets and a 300-user load test on staging, a WCAG 2.1 AA audit with fixes, go-live configuration, then a 2-week UAT signed off by the client.

**Scope:** §15, §16.1, §16.2 (Excel/CSV, Google Sheets, MS Project XML; `.xer` and `.mpp` out of v1), §17.1–17.2 (audit, conflict diff, monitoring), §18.6–18.7 (Sentry done in B-06; Platform Admin A26), §19 (retention, backups/restore, RA 10173 notice, consent, rights, breach procedure, sign-in rate limits review), §14/A20 (web push), §20 (all budgets, browsers, WCAG 2.1 AA, scale), §21 UAT, §22 A4/A20/A21/A24/A26/A27, §23.2 Q8/Q15/Q16/Q17. Pulled forward to "Before Phase 2": nightly backup (B-04), web CI (B-05), Sentry (B-06), region pin (B-07), FormField (B-08), staging (B-03).

**Key decisions**

| # | Decision | Why |
|---|---|---|
| D80 | Search index = table **`search_documents`** (one row per project, activity, inspection, person, note) kept in sync by triggers, with trigram + full-text indexes scoped by company and RLS mirroring the sources. Notes are indexed only from project-scoped log rows with a note, **skipping sharing rows** (`project_viewer`, `share_link`, `access_request`) and `via='cascade'` rows (the note lives on the target row) | Fast at 100 companies; never leaks managers-only sharing data to inspectors; no duplicate cascade notes |
| D81 | The palette calls `supabase.rpc('search')` **from the browser** with the user's session (RLS applies), 120 ms debounce, aborts per keystroke — an approved exception to `CLAUDE.md` rule 1 (question 27) | Server Actions run one at a time per client and would queue keystrokes |
| D82 | Search modes: WBS code (`1.2.3`), inspection number (`#14`), else fuzzy text (trigram ≥ 0.3 or prefix full-text, `'simple'` config so Filipino and English names are not stemmed); scoring boosts exact code, prefix, current project and recent items; 6 per kind, 24 total | §15 |
| D83 | Import files are **parsed in the browser** (Web Worker: `read-excel-file`, `papaparse`, `fast-xml-parser` with entities off); the server action re-validates the normalised plan, computes dates with the Phase 2 CPM and calls one atomic RPC `import_wbs`, which **reuses Phase 2's link validator, `graph_find_cycle` and the schedule revision**. SheetJS from npm and ExcelJS are rejected (unmaintained / unpatched) | Files never reach our servers; no body-size limits; one implementation |
| D84 | Import semantics: into an existing project; **Append** (default) or **Replace** (only in Planning with no progress, question 36); hierarchy from codes, levels or flat; MS Project deeper than 3 levels rolled up into level 3 with warnings; leaf-to-leaf links, lag in whole working days, percent lags → 0 with a warning; durations in working hours; costs on leaves; progress, resources and actual costs not imported; optional "use this file's working days and holidays" — the dry run runs CPM over **existing and imported** work with the new calendar, the preview lists existing activities that move, and `import_wbs` writes them in the same transaction; limits 10 MB, 5,000 rows, project ≤ 5,000 activities, 20,000 links; one log row per import; **Undo for 24 h** (latest import only, refused after progress) | §16.2 |
| D85 | One spreadsheet layout for the template, the WBS export and re-import: WBS code, Name, Level, Start, Duration (unit in header), End, Cost (₱), Predecessors (`1.2FS+2d`), Description (+ read-only % and Status on export) | Round trip |
| D86 | Exports use one **scene** model (pure TS) drawn by two renderers: PDF on the server with `@react-pdf/renderer` (as the signed-in user), PNG in the browser via SVG → canvas; Excel with `write-excel-file`; ZIP with `fflate` in a Worker. The S-curve scene uses Phase 3's `scurve-geometry.ts`. No headless browser, no third-party export service | Same picture on screen and paper |
| D87 | Exports follow `canExport` (Owner PM, PMs, inspectors; never viewers or link visitors); each export writes one `entity_type='export'` log row (the existing audit CSV route is retrofitted); PDF/ZIP limited to 20 per person per hour (question 35); paper A4, A3, Letter, Legal, Long bond; Gantt PDF ≤ 200 pages, PNG ≤ 16 MP | §16.1 governance |
| D88 | Retention: `private.run_retention()` (pg_cron `civpms-retention`, 00:20 Manila) warns at 30 and 7 days (the 7-day one bypasses the digest) and purges only when the 7-day warning is ≥ 7 days old; `private.purge_project` deletes the log, notifications and the project (cascade: activities, links, baselines, inspections, media rows, imports, search documents, sharing rows, Vault secrets via the Phase 4 trigger) and writes a company-scoped tombstone; the log stays append-only except one guarded delete scoped to the project being purged. The 30-day trash purge uses the same function, so trashed projects' logs go too (question 33); no "keep one more year" button | §19 / A27 |
| D89 | Platform Admin: rows in `private.platform_admins` added by SQL only; every admin RPC calls `private.assert_platform_admin()` (`NOT_FOUND` for others, `MFA_REQUIRED` without an authenticator-app session); metadata only, no impersonation; append-only `private.platform_audit` plus a company-visible log row for company-affecting actions | A26; question 30 |
| D90 | `platform_settings.company_creation_mode` = `open` (today, D14) or `invite_only` (admin-issued, hashed, 14-day company invitations; otherwise `COMPANY_CREATION_CLOSED`) | §23.2 Q15 (question 29) |
| D91 | Privacy (RA 10173, drafted for counsel; not legal advice): public `/privacy` and `/terms`; consent in onboarding **and on a viewer's first `/shared` visit**; re-consent banner on version change; "Download my data"; "Delete my account" for non-owners **including viewer-only users**; a "Data & privacy" page reachable without onboarding; ownership transfer; breach runbook (client within 24 h; NPC within 72 h when required) | §19; viewers must have the same rights |
| D92 | Web push owned by Phase 5 with a minimal **push-only service worker** (`push` and `notificationclick` handlers only; no caching, nothing offline, D7): `push_subscriptions`, a `push` channel per type (defaults in question 28), sent by the existing dispatcher with `web-push` and VAPID keys; permission asked only on an explicit click; on iPhone it works after Add to Home Screen (P3-25 icon) | §14 / A20 best effort |
| D93 | Observability: Sentry (B-06); public **`/api/health`** (DB + job windows, 200/503) and bearer-protected `/api/health/details` for uptime; one external monitor on the app only; **nothing ever pings Render** (keep-alive off) | Errors and job health visible; Render keeps sleeping |
| D94 | Security headers and a per-request nonce **CSP**, report-only for ≥ 7 days then enforced; includes `worker-src 'self' blob:` (import/ZIP Workers and the push worker) and `manifest-src 'self'` (home-screen icon), with the `/s/*` headers applied last; zero violations on every e2e spec | Must not break Workers, push, the manifest or Google Picker |
| D95 | Backups: nightly encrypted off-site copy (B-04) + Supabase **Pro** at go-live (daily backups, no pausing; question 2); PITR only if a contract needs < 24 h data loss; RPO 24 h, RTO 4 h; restore drill before go-live and quarterly | §19 "restore tested" |
| D96 | Functions in `sin1` (B-07); budgets in section 5.2; load tests and destructive drills only on staging (B-03) | §20 |
| D97 | (narrowed) §17.2 conflict diff: `STALE_VERSION` opens "Changed by Maria Santos 2 minutes ago" with a Field · Yours · Theirs table and Reload / Keep mine. Request access moved to D73 | One owner per feature |

**Data model (in order)**

| Migration | Package | Contents |
|---|---|---|
| M1 `<ts>_p5_search_index.sql` | P5-01 | Extensions `pg_trgm`, `unaccent`, `btree_gin` (schema `extensions`); `private.search_norm`; table `search_documents` (company, project, kind, ref ids, title, subtitle, code, status, event time, `is_hidden`, `search_text`, generated `tsv`); indexes; RLS (people by company, project rows by `visible_project_ids()` and not hidden); sync triggers on projects, activities (statement-level), inspections, activity_logs (notes, with the D80 exclusions), company_members, profiles; `pms.search='defer'` for bulk writes; reindex helpers; back-fill |
| M2 `<ts>_p5_search_rpc.sql` | P5-02 | `public.search(p_query, p_project_id, p_kinds, p_limit)` (security invoker, explicit company filter, D82 modes and scoring) |
| M3 `<ts>_p5_import.sql` | P5-03a | Enums `import_source`, `import_status`; table `import_jobs`; `activities.import_job_id`; `import_wbs` for rows (access, `lock_wbs`, rev check, limits, Replace rules with `IMPORT_CHANGED`, parents before children, leaf-only values, one log row) |
| M4 `<ts>_p5_import_links.sql` | P5-03b | `import_wbs` redefined with links (Phase 2 validator + `graph_find_cycle`), the calendar option (existing rows rescheduled in the same transaction, `via='import'`), renumbering, holidays, search reindex |
| M5 `<ts>_p5_import_undo_export_log.sql` | P5-04 | `undo_import(p_job_id, p_expected_count)`; `log_export(p_project_id, p_kind, p_format, p_detail)` with the 20/h limit; export-rate index |
| M6 `<ts>_p5_retention.sql` | P5-05 | `projects.retention_warned_30_at/_7_at` (added to the `projects_before_update` exclusion list; cleared on reopen); `private.retention_due` (mirrored by `domain/retention.ts`); guarded log delete; `private.purge_project`; trash purge through it; `private.run_retention`; notification housekeeping (> 12 months); job `civpms-retention`; types `retention_warning`, `retention_purged`; one-time clean-up of orphaned log rows from earlier trash purges (question 33) |
| M7 `<ts>_p5_privacy_account.sql` | P5-06 | `profiles.privacy_version`, `privacy_accepted_at`; `accept_privacy`; `transfer_company_ownership`; `prepare_account_deletion` (members and viewer-only users; Owner PM → `OWNER_MUST_TRANSFER`); `my_data_export`; type `ownership_transferred` |
| M8 `<ts>_p5_platform_admin.sql` | P5-07a | `private.platform_admins`, `private.platform_audit`, `private.company_creation_invites`, `public.platform_settings`, `company_creation_mode()`, `am_i_platform_admin()`, `assert_platform_admin`, `create_company` gate |
| M9 `<ts>_p5_admin_rpcs.sql` | P5-07b | `admin_overview`, `admin_companies`, `admin_company`, `admin_find_user`, `admin_set_company_creation_mode`, `admin_invite_company_owner`, `admin_revoke_company_invite`, `admin_transfer_ownership`, `admin_retention_queue` |
| M10 `<ts>_p5_company_suspension.sql` (optional) | P5-08 | `companies.suspended_*`; access helpers and `private.shared_project_gate` exclude suspended companies; `assert_company_active`; `my_company_status`; `admin_set_company_suspended`; types `company_suspended`, `company_unsuspended` |
| M11 `<ts>_p5_web_push.sql` | P5-09 | `push_subscriptions`; `notifications.push_status/_attempts/pushed_at`; set `push_default` values in `private.notification_types` (column exists since P3-02a); `register_push_subscription`, `remove_push_subscription`, service-role `claim_push_batch`, `complete_push`; `notify` marks pushes; dispatcher condition "emails or pushes pending" |
| M12 `<ts>_p5_ops.sql` | P5-10 | `private.health_snapshot` (+ service-role wrapper); indexes proven by `EXPLAIN` of the top queries; default-privilege hardening |

Error codes: `IMPORT_TOO_LARGE`, `IMPORT_INVALID`, `IMPORT_MODE_NOT_ALLOWED`, `IMPORT_CHANGED`, `IMPORT_UNDO_EXPIRED`, `IMPORT_UNDO_BLOCKED`, `OWNER_MUST_TRANSFER`, `TRANSFER_TARGET_INVALID`, `COMPANY_SUSPENDED`, `COMPANY_CREATION_CLOSED`, `MFA_REQUIRED`; client codes `FILE_UNSUPPORTED` (own text for `.mpp` and `.xer`), `FILE_TOO_LARGE`, `FILE_UNREADABLE`, `PUSH_UNSUPPORTED`, `PUSH_DENIED`, `EXPORT_TOO_LARGE`.

SQL tests: **30_search.sql** (every sync path, RLS matrix, scopes, modes incl. accents and typos, sharing rows and cascade notes excluded, 50,000-document harness < 60 ms with index scans) · **31_import.sql** (roles, plan lock, Append/Replace, limits, links and 10,000-link loop check, calendar option moving existing rows, one log row, `SCHEDULE_CHANGED`, undo rules, export log and limit) · **32_retention.sql** (due dates incl. leap day and Manila midnight, warnings once, no purge without the 7-day gap, purge removes logs, media rows, Vault secrets and sharing rows, guard still blocks other deletes, reopen clears markers, trash purge, housekeeping) · **33_privacy_account.sql** · **34_platform_admin.sql** · **35_company_suspension.sql** (every public RPC incl. Phase 4 viewer RPCs) · **36_push.sql**; additions to 01, 03, 08.

**Domain logic**
- `search.ts`: `parseSearchQuery`, accent-insensitive `highlightRanges`, `searchResultHref` (activity → `/projects/<p>/wbs?focus=<a>`, inspection → `…/inspections?inspection=<i>`, note → `…/wbs?history=<a>` or audit), `mergePaletteGroups` (This project, Activities, Inspections, Projects, People, Notes, Actions, Go to), `paletteActions` with disabled reasons.
- `import/*`: `types`, `template` (columns, synonyms incl. MS Project/Excel headers), `spreadsheet` (header detection, mapping suggestions, dates incl. Excel serials and ambiguous day/month order defaulting to MDY, ₱ amounts, durations), `mspdi` (tasks, links: type codes and `LinkLag` in tenths of a minute verified with fixtures from MS Project and ProjectLibre; costs; calendars), `hierarchy` (codes, levels, roll-up), `predecessors` (inverse of `formatPredecessors`), `validate` (stable issue codes with "what's wrong + how to fix"), `preview` (summary, impact text, schedule diff, server payload). 5,000 rows validate < 300 ms; 8,000-task XML < 1.5 s.
- `export/*`: `scene`, `paging` (paper sizes, tiling with repeated grid, scale legend), `gantt-scene` (from Phase 2's view model and tokens), `scurve-scene` (from Phase 3's geometry), `wbs-tree-scene`, `report`, `sheets` (typed ₱, dates, %), `filenames` (`<project>-<kind>-<YYYY-MM-DD>`).
- `retention.ts`, `conflict.ts` (`diffKeyFields`), `privacy.ts`, permission flags (`canUndoImport`, `exportFormatsFor`, `adminPermissions`), `pushPayload` (no ₱ amounts).

**UI/UX**
- **⌘K palette:** scope chips (Tab toggles), grouped results with highlighted matches and hints ("1.2.3 · Tower B", "Tue 14 Oct · Approved"), states searching / no results ("Search all projects") / error ("Search isn't available right now. Try again."); recent items now include activities and inspections. Deep links: WBS `?focus=` scrolls, expands and briefly highlights the row (no flash with reduced motion), Collaborators `?member=`, Calendar `?action=mark-nonworking`.
- **Import wizard** `/projects/[id]/wbs/import` (managers, plan open; WBS toolbar, WBS empty state, ⌘K): Choose file (upload, Google Sheets via Picker with `drive.file` and an in-memory token, template download; clear messages for `.mpp`, `.xer`, protected or oversized files) → Map columns / Options → Review (summary with budget impact, issues grouped, virtualised grid editable inline, "Only rows with problems", "Remove these 2 links" for loops, schedule preview incl. existing activities that move) → Confirm (Append / Replace with danger copy) → toast "Imported 412 activities and 380 links · Undo"; Imports sheet with Undo until a stated time.
- **Export dialog** (overflow "Export…" on Dashboard, WBS, Gantt, S-curve, Inspections, Audit; ⌘K): what and format, options per kind (range, zoom, levels, baseline, critical path, paper; basis; depth; filters; units), "Preparing… 12 s" with Cancel, rate-limit and size messages, network errors with Try again. Layouts for Gantt PDF, S-curve PDF, WBS PDF, the full report (cover, summary, WBS, Gantt, S-curve, inspections, legend; contents and bookmarks) and the archive ZIP (report, sheets, CSVs, photos by WBS code, README).
- **Retention:** banner on closed projects ("…permanently deleted on 12 Oct 2027… Export it before then, or reopen it") turning warning at 30 days and danger at 7; "Deletes in 6 days" chip on project cards; reopen confirm adds "Reopening also cancels the scheduled deletion".
- **Privacy and account:** `/privacy`, `/terms` (public); consent checkbox in onboarding and on a viewer's first `/shared` visit; re-consent banner; Data & privacy page (also for viewer-only users) with Download my data and Delete my account (type your email; Owner PM sees "Transfer ownership first"); Ownership card in company settings.
- **Conflict dialog** `components/ui/conflict-dialog.tsx` used by project settings and the WBS controller.
- **Admin** `/admin` (own layout; 404 for others; TOTP enrolment and challenge): overview KPIs and job health, companies (search, detail, transfer, suspend/resume), user lookup, settings (creation mode, invite a company owner), retention queue, platform audit; paused page for suspended companies.
- **Web push:** Profile → Notifications gains a Push column and a "This device" card (Turn on, Blocked, Not supported, "Add CivPMS to your Home Screen first" on iOS, devices list with Remove).
- **§17 audit:** a checklist over every route and dialog (one primary action, empty states, skeletons with CLS ≤ 0.05, inline validation, impact-stating danger confirms, Undo, plain language, keyboard, 44 px, network and upload errors, 403/404) with findings fixed in P5-44a/b.

**Notifications and audit.** New types `retention_warning` (in-app, email; push for the 7-day one), `retention_purged` (in-app), `ownership_transferred` (in-app, email), `company_suspended` / `company_unsuspended` (in-app, email); families `retention` and `account` added with tests. Emails: retention warning with "Export project", company-owner invitation, ownership transferred; every footer links `/privacy`. Audit: entity types `import`, `export`; actions `import`, `undo_import`, `export`, `retention_warning`, `purge`, `transfer_ownership`, `suspend`, `unsuspend`, `leave`; via `import`, `retention`, `trash`, `platform_admin`, `account_deletion`; audit filters gain Imports and Exports. Searches are not logged.

**Backend (Rust service).** No feature code. Production `APP_ORIGINS` includes the domain; Preview points to staging or uses the browser fallback; `cargo audit` in `backend.yml`; no uptime pinger. Cached summaries of a suspended or purged project may live up to 30 s (10 min stale on a Supabase outage) — documented.

**Testing.** SQL 30–36. Vitest for every domain module (≥ 95 %), errors, families with push, templates, export helpers, palette merge, worker protocol, push payloads, Sentry scrubber, CSP builder, health evaluator. Playwright `p5-search`, `p5-import`, `p5-export` (downloads, PDF magic bytes and page count, XLSX formats, CSV re-import), `p5-retention`, `p5-privacy` (incl. a viewer-only user), `p5-access` is replaced by Phase 4's `p4-access`, `p5-admin` (TOTP from a seeded secret), `p5-push`, `p5-conflict`, `p5-a11y` (axe on every route, light/dark, 390/1440 px), extended golden path. Performance (P5-41) on a production build and Vercel Preview in `sin1`; load (P5-42) with k6 on staging only; accessibility audit (P5-43) with NVDA, VoiceOver, 200 % zoom, forced colours; security review (P5-39) incl. advisors, IDOR sweep, Auth settings, gitleaks, `npm audit`, `cargo audit`.

**UAT plan (P5-47/48).** Who: the client's Owner PM, 1–2 PMs, 2 inspectors (Android and iPhone, CivPMS on the home screen), 1 Gmail viewer; the developer triages daily. Where: production before launch with `[UAT]` records (removed after sign-off); purge and restore drills on staging. Two weeks: scripted week 1, real use week 2. 17 scripts in `docs/UAT.md` covering sign-up to export, weak-signal retries and drafts, sharing exposure, notifications (email, digest, push), retention on staging, privacy, admin, errors, accessibility and performance on the client's own phones. Severity S1 (data loss, security, core flow impossible) to S4 (cosmetic). Exit: no open S1/S2, S3 dated, performance re-measured on production, client signs `docs/UAT.md`. Feedback goes by email from the in-app button, never as public GitHub issues.

**Work packages – Phase 5** (53 packages, 45.75 agent-days; plus the UAT buffer P5-48 and the optional P5-50)

| ID | Title | Depends on | Size | Parallel? | Acceptance |
|---|---|---|---|---|---|
| P5-01 | DB M1: search index + sync triggers | P4-03 | M 1 | DB lane | Back-fill = source counts; every sync path; RLS matrix; D80 exclusions in test 30 |
| P5-02 | DB M2: `search()` RPC | 01 | M 1 | DB lane | Modes and ranking fixtures; 50,000-document harness < 60 ms with index scans; `EXPLAIN` in DATABASE.md |
| P5-03a | DB M3: import jobs + `import_wbs` rows | 02 | M 1 | DB lane | Test 31 apply part: roles, plan lock, limits, Replace rules, one log row, `SCHEDULE_CHANGED` |
| P5-03b | DB M4: import links, calendar option, reindex | 03a | M 1 | DB lane | Links through the Phase 2 validator and loop finder (10,000 links in time); existing rows rescheduled by the calendar option in the same transaction |
| P5-04 | DB M5: `undo_import`, `log_export` | 03b | S–M 0.75 | DB lane | 24 h boundary, latest-only, progress block, `IMPORT_CHANGED`, Replace restore; 20/h export limit |
| P5-05 | DB M6: retention and purge | 04, Q33 | M 1 | DB lane | Test 32 green incl. media rows, Vault secrets and sharing rows removed; guard holds; markers excluded from `version` |
| P5-06 | DB M7: consent, ownership transfer, account deletion, data export | 05 | S–M 0.75 | DB lane | Test 33 green incl. a viewer-only user; Owner PM blocked |
| P5-07a | DB M8: Platform Admin core + creation gate | 06, Q29–Q30 | S–M 0.75 | DB lane | Test 34 part 1: `NOT_FOUND` for non-admins, `MFA_REQUIRED` at aal1, invites, `create_company` gate |
| P5-07b | DB M9: admin RPCs | 07a | S–M 0.75 | DB lane | Test 34 complete: metadata-only shapes; admin transfer; platform audit append-only |
| P5-08 | DB M10: company suspension (optional) | 07b | M 1 | DB lane | Test 35 over every public RPC incl. viewer RPCs via the shared gate |
| P5-09 | DB M11: web push | 08 (or 07b if 08 is cut), Q28 | S–M 0.75 | DB lane | Test 36 green; push defaults set without changing the catalog function |
| P5-10 | DB M12: ops, indexes, privileges | 09 | S 0.5 | DB lane | Health snapshot documented; each index tied to a measured query; test 01 inventory; advisors clean |
| P5-11 | Domain: search | — | S 0.5 | Domain lane (during P4) | Query modes, highlight with ñ/é, hrefs per kind and role, group order, action visibility; 100 % |
| P5-12 | Domain: import template + spreadsheet coercion | — | M 1 | Domain lane | Date/money/duration matrix; header synonyms; D85 layout in DOMAIN.md |
| P5-13 | Domain: hierarchy, roll-up, predecessors, validation, preview | 12, P2-03 | M 1 | Domain lane | All D84 rules incl. loops created by roll-up; 5,000 rows < 300 ms |
| P5-14 | Domain: MS Project XML mapper + fixtures | 13 | M 1 | Domain lane | MS Project and ProjectLibre fixtures parse; link-type and cost units verified; 8,000 tasks < 1.5 s |
| P5-15 | Domain: export scene, paging, Gantt scene | P2-05b | M 1 | Domain lane | Paging per paper; 2,000-row page counts; scene snapshots; hatch clipped |
| P5-16 | Domain: S-curve and WBS scenes, report model, sheets | 15, P3-18 | M 1 | Domain lane | Snapshots; report with and without baseline/inspections/progress; Excel formats |
| P5-17 | Domain: retention, conflict diff, flags, push payload, privacy version | — | S 0.5 | Domain lane | SQL-parity retention vectors; diff formatting |
| P5-18 | ⌘K global search | 02, 11, Q27 | M 1 | App | Debounce and abort; scopes with Tab; groups and highlights; all states; `p5-search` green |
| P5-19 | Deep links + palette actions | 18, P3-13a | S 0.5 | No (WBS files) | Every result kind and action lands correctly; reduced motion respected |
| P5-20 | Import intake, worker parsing, template route | 12, 14 | M 1 | App | Every file error state; worker progress (main-thread fallback if Turbopack workers fail); template opens in Excel and Google Sheets |
| P5-21 | Import mapping + review grid | 20, 13 | M 1 | App | Suggestions; ambiguous dates; live re-validation; problem filter; drop-loop action; phone layout |
| P5-22 | Import server actions, confirm, Imports sheet, Undo | 21, 04, 19 | M 1 | No (WBS files) | Atomic apply with retry; Replace rules; existing-row moves previewed; 24 h Undo with impact; `p5-import` green |
| P5-23 | Google Sheets source | 20, O-12 | S–M 0.75 | Parallel with 21–22 | Hidden when unconfigured; token in memory only; export to xlsx then the same parser; manual check documented |
| P5-24 | react-pdf spike | 15 (or a dummy scene) | S 0.5 | Yes (can start during Phase 3–4) | Turbopack build; Node route on Preview `sin1`; Poppins registered and **₱ renders** (else Noto Sans); clip/paths/text; 50 pages < 10 s; PNG matches |
| P5-25 | Export dialog, routes, `log_export`, Excel/CSV | 16, 04, 24 | M 1 | App | WBS XLSX/CSV re-importable; S-curve, log, inspections sheets; audit CSV route retrofitted to `log_export`; rate-limit UI |
| P5-26 | Gantt PDF + PNG | 25 | M 1 | App | To scale; overlays; 2,000 rows ≤ 20 s; PNG cap message |
| P5-27 | S-curve and WBS PDF/PNG | 25 | M 1 | Parallel with 26 | Layouts; table alternatives; depth option |
| P5-28 | Full project report PDF | 26, 27 | M 1 | App | Contents with page numbers and bookmarks; 560-activity project ≤ 30 s; empty-data variants |
| P5-29 | Project archive ZIP | 25 | S–M 0.75 | App | Contents; size estimate; without-photos option; progress and cancel; photos never decoded |
| P5-30 | Retention UI + emails | 05, 17, 29 | S 0.5 | App | Banner states 30/7/due; chips; `?export=archive` opens the dialog; reopen copy; `p5-retention` green |
| P5-31a | Privacy pages and consent (members and viewers) | 06, 17 | S–M 0.75 | App | Public pages; onboarding and first-`/shared` consent; re-consent banner; texts marked "for counsel review" |
| P5-31b | Data download, account deletion, ownership card, Data & privacy page | 31a | M 1 | App | Works for members and viewer-only users; deleted user cannot sign in; avatar removed; viewer emails get a preferences link; `p5-privacy` green |
| P5-33 | Conflict diff dialog | 17 | S 0.5 | Parallel | `p5-conflict` green; keyboard and Esc; §17.2 copy |
| P5-34a | Admin UI: MFA, overview, companies, user lookup | 07b | M 1 | App | 404 for non-admins; MFA flow; tables with loading/empty/error; no project content |
| P5-34b | Admin UI: creation mode, owner invites, transfer, retention queue, audit (cuttable) | 34a | M 1 | App | Invite-only flow end to end in the Brevo sandbox; `p5-admin` green |
| P5-35 | Suspension UI (cuttable) | 08, 34a | S 0.5 | App | Paused page; resume restores; smoke test |
| P5-36 | Web push: push-only service worker, client, dispatcher (cuttable) | 09, Q28 | L 1.5 | App | Push-only worker (no caching) registered on opt-in; `p5-push` green; gone endpoints disabled; Android and home-screen iPhone manual check |
| P5-37 | Health routes, uptime monitor, runbook | 10, B-06 | S–M 0.75 | Ops | `/api/health` 200/503 logic; details route bearer-protected; monitor on the app only; RUNBOOK.md |
| P5-38 | Security headers + CSP (report-only) | 37, 20, 29, 36 (if built) | M 1 | Ops | D94 directives; zero violations on every e2e spec; CSP builder tests |
| P5-39 | CSP enforce + security review | 38 (+ ≥ 7 days) | S–M 0.75 | Ops | Findings table; High/Critical fixed; advisors clean; CSP enforced with e2e green |
| P5-40 | Remaining debt (HANDOFF §4): 2027 Eid / 2028 holidays when proclaimed; surface the D21 "clear parent values" failure as a warning; audit date filters shown as `10 Oct 2026` instead of the browser locale | — | S–M 0.75 | Any time | Holidays migration; D21 warning tested; audit date format; HANDOFF §4 emptied |
| P5-41 | Performance verification + fixes | 18, 26, 37 | M 1 | Verification | Section 5.2 budgets recorded; bundle budget enforced in CI; P2 bench and large Gantt re-run |
| P5-42a | Load-test setup on staging | 41, B-03 | S–M 0.75 | Verification | 300 staging users; token helper; seed; no secrets in git |
| P5-42b | k6 load test + report | 42a | M 1 | Verification | 300 users meet the budgets, or a written compute recommendation |
| P5-43 | Accessibility audit (axe + manual) | UI packages merged | M 1 | Verification | Every route scanned; manual flows; findings table; `docs/ACCESSIBILITY.md` |
| P5-44a | Accessibility + §17 fixes: auth, home, workspace, WBS, Gantt, calendar | 43 | M 1 | After 43 | axe serious/critical = 0 in these areas; checklist green or accepted with a reason |
| P5-44b | Accessibility + §17 fixes: field, inspections, S-curve, sharing, import/export, admin | 43 | M 1 | Parallel with 44a | Same for these areas |
| P5-45 | Restore drill + DR/incident/breach runbook | B-04 | S–M 0.75 | Parallel | Restore into a scratch project; SQL tests + golden path green there; RPO/RTO recorded; runbook notes that Vault share-link copies do not survive a restore into another project (links still work by hash; "Copy link" needs Reset) |
| P5-46 | Go-live configuration and checks | 37, 38, 31b, Q31–Q32 | S–M 0.75 | — | Read-only `verify-production` script passes: headers, health, redirects, OAuth URIs, email DNS; Supabase plan and Auth settings; Vercel plan/region/env/crons; Render `APP_ORIGINS`; demo clean-up run (keeps `rhecy`); first Platform Admin added |
| P5-47 | UAT preparation | 46 | S–M 0.75 | — | `docs/UAT.md` scripts and exit criteria; in-app feedback button emails support with route + reference id; accounts ready |
| P5-48 | UAT support + fix buffer | 47 | ≤ 5 d total | During UAT | One ≤ 1-day package per S1/S2 defect, triaged daily; client sign-off recorded |
| P5-49 | Final regression, docs, release | all | M 1 | Last | Full suite green; DECISIONS (D80–D97), DATABASE, DOMAIN, DESIGN, SETUP, RUNBOOK, HANDOFF updated; release notes; pushed |
| P5-50 | "Try a sample project" (optional, question 37) | 22 | S 0.5 | Optional | `[Sample]` project created from the bundled template through `import_wbs`, linked from the home checklist |

**Lanes:** DB 01 → 02 → 03a → 03b → 04 → 05 → 06 → 07a → 07b → (08) → 09 → 10 · domain 11–17 (during Phase 4) · search 18 → 19 · import 20 → 21 → 22, 23, (50) · export 24 → 25 → {26 ∥ 27} → 28; 29 → 30 · privacy 31a → 31b; 33 · admin 34a → 34b, 35 · push 36 · ops 37 → 38 → ≥ 7 days → 39 · then 41 → 42a → 42b, 43 → {44a ∥ 44b}, 45, 46 → 47 → 48 → 49. P5-32 of the phase plan is retired (merged into P4-11).

**Cut list (owner decides):** P5-08 + P5-35 suspension (1.5 d), P5-34b admin invites (1 d; only if company creation stays open), P5-36 web push (1.5 d; A20 is best effort) — 4 d in total; P5-50 is optional (0.5 d).

---

## 5. Cross-cutting

### 5.1 Testing strategy
- **Pure logic** (`src/lib/domain`): Vitest, ≥ 95 % line coverage (100 % where the module already has it), hand-computed fixtures for schedules and S-curves, property tests for CPM, timing guards for the big cases.
- **Database:** one SQL test file per migration group, run in one transaction that rolls back; every new RPC gets a cross-company `NOT_FOUND` row in test 03 and a privileges row in test 01; tests 01–11 plus all newer ones run after every migration.
- **End to end:** Playwright 1.56.1 with Chromium from `/opt/pw-browsers`; specs fail on any console error or hydration warning; records tagged `[P2]`…`[P5]`; light, dark and 390 px screenshots for new screens. Heavy seeds, load tests and destructive drills (purge, restore) run on **staging** only.
- **CI** (B-05): typecheck, lint, Vitest, build, dependency audit, secret scan on every push; Playwright and SQL tests run locally by the agent (they need credentials that a public repo's CI must not hold).
- **Golden path** grows each phase: onboard → project → WBS → links and Gantt → activate → inspection → progress with photo → S-curve → share with a viewer → search → import → export → audit shows everything.

### 5.2 Performance budgets (§20)

| Area | Target | Measured in |
|---|---|---|
| App shell (home, project dashboard) | Interactive < 3 s on a mid-range phone over 4G: LCP ≤ 2.5 s, hydrated ≤ 3 s | P5-41 |
| First-load JavaScript of shell routes | ≤ 220 KB gzip; Gantt, PDF, Excel and ZIP libraries load only where used | P5-41 (CI budget) |
| CPM recompute | < 500 ms (spec); CI guard < 100 ms at 2,000 leaves / 4,000 links | P2-04b |
| Gantt with 2,000 activities | bars < 2.5 s; no long task > 200 ms; p95 frame < 50 ms; drag round trip < 1.5 s | P2-20 (staging) |
| Progress cascade | 2,000 leaves < 1.5 s | P3-02b |
| S-curve | compute for 5,000 leaves < 150 ms; page server render < 800 ms (560 activities) | P3-08, P3-19 |
| Viewer calendar | 62 days < 200 ms in SQL; `/s/<token>` TTFB < 1 s from `sin1` | P4-03, P4-13 |
| Search | database p95 ≤ 60 ms; keystroke → results ≤ 200 ms after the debounce | P5-02, P5-41 |
| Import | apply 5,000 rows ≤ 10 s; dry run ≤ 3 s; parse a 5,000-row XLSX ≤ 3 s; 10 MB XML ≤ 5 s | P5-03a/b, P5-41 |
| Exports | Gantt PDF (2,000 rows) ≤ 20 s; full report ≤ 30 s; WBS Excel (5,000 rows) ≤ 5 s | P5-26, P5-28, P5-41 |
| Load (staging) | 300 concurrent users: errors < 0.5 %, page TTFB p95 ≤ 1.2 s, RPC p95 ≤ 500 ms, DB CPU < 70 % | P5-42b |
| Availability | ≥ 99.5 % | uptime monitor (P5-37) |

### 5.3 Security and privacy (§19)
- **Authorization lives in the database:** RLS on every new table, writes only through `SECURITY DEFINER` RPCs with `search_path = ''` and explicit grants; the only anonymous RPCs are `get_invitation_by_token` and `shared_link_view`. The UI only hides controls.
- **Every project-scoped table cascades from `projects`**, so the retention purge removes everything; photos follow their activity (D65).
- **Viewers and public links** get exactly the §12.3 fields (exact key-set tests), never Storage, never the sharing audit, never search.
- **Tokens and abuse:** share-link and invitation tokens hashed (share links also keep an encrypted Vault copy, question 20); rate limits on links, viewer emails, access requests, heavy exports and invite codes.
- **Photos:** EXIF/GPS stripped by the media service; stored objects are untrusted (D48) and shown only through `<img>` from short-lived signed URLs.
- **Secrets:** the secret key only in `src/lib/supabase/admin.ts` (CI guard); database-side secrets in Supabase Vault; gitleaks over the public history; Preview never holds production secrets; logs never print environment values.
- **Headers and CSP** (D94), HSTS, `nosniff`, `frame-ancestors 'none'`; Auth settings reviewed in P5-39 (email confirmation, minimum password 10, rate limits, MFA for admins, redirect allow-list).
- **RA 10173** (not legal advice): privacy notice and terms for counsel review, consent for members and viewers, download and deletion rights, 1-year retention with warnings, breach runbook, data minimisation in monitoring (no session replay, scrubbed events). Drafts kept in the browser (D7) contain field notes; they stay on that device, are cleared on success and sign-out, and are mentioned in the privacy notice.
- **Backups:** encrypted nightly copy kept 35 days (B-04), Supabase Pro daily backups at go-live, restore drill (P5-45).

### 5.4 Observability
- **Errors:** Sentry from B-06; every error page shows a reference id that matches the Sentry event.
- **Health:** `/api/health` (public: database reachable, pg_cron jobs ran in their windows) and `/api/health/details` (bearer: job runs, email/push backlog, retention due, search-index drift) from P5-37; one uptime monitor on the app.
- **Logs:** Vercel runtime logs and the media service's JSON logs on Render. **Nothing pings Render** — keep-alive stays off and cold starts are handled by the browser fallback.
- **Jobs:** `civpms-daily-checks`, `civpms-email-digest`, `civpms-dispatch-emails`, `civpms-inspection-reminders-*`, `civpms-media-cleanup`, `civpms-sharing-checks`, `civpms-retention` all appear in the health snapshot.

### 5.5 Documentation
Each package updates the doc for what it changed: `docs/DECISIONS.md` (its D-numbers), `DATABASE.md` (tables, RPCs, error codes, tests, indexes), `DOMAIN.md`, `DESIGN.md` (tokens with contrast results), `SETUP.md` (owner steps), `HANDOFF.md` (status, performance numbers, owner actions) and `backend/README.md`. Phase 5 adds `RUNBOOK.md`, `ACCESSIBILITY.md` and `UAT.md`. `CLAUDE.md` changes only with the owner's approval (D7 scope line, the search exception).

### 5.6 How agents work
1. **Small packages:** one agent per package (≤ 1.5 days), its own branch created with `git checkout -B wf/<package> <current sha of claude/exciting-sagan-7valgn>` (workflow worktrees start from `origin/main`).
2. **Checkpoint commits** after each acceptance item, with a "RESUME MODE" note (done / left / next) in the body. Usage limits interrupt agents; uncommitted work is lost.
3. **Merge and push promptly** to `claude/exciting-sagan-7valgn` only; reset the remote first (`git remote set-url origin https://github.com/Prannsss/CivPMS`); never leave verified work on a `wf/*` branch.
4. **Checks before merge:** `npm run typecheck` (not plain `tsc`), `npx eslint src e2e`, `npx vitest run`, `npm run build` **without** `NODE_USE_ENV_PROXY`, the package's Playwright subset **with** `NODE_USE_ENV_PROXY=1`; never `playwright install`; delete `.next/dev` after killing the dev server; keep Tailwind classes inside `src/`.
5. **One database lane at a time:** a single agent applies migrations in order, renames the recorded version to the file timestamp, keeps files byte-identical, uses CTEs instead of plain `delete`, runs every SQL test and `npm run db:types`. Users created by SQL need rows in both `auth.users` and `auth.identities` (token columns `''`).
6. **At most two heavy agents** (dev server or build) at once; domain and SQL work is light and runs alongside.
7. **Ownership:** touch only the package's files; cross-feature edits are named in its row; `components/wbs/*` follows the chain in section 4; notification types are inserted, never rewritten; shared TS lists are append-only.
8. **UI rules from `CLAUDE.md`:** tokens only (no hex), `register()`/`defaultValue` inputs, skeletons + empty + error states, colour + icon + label for status, `primary-text` for blue text, ≥ 44 px targets, danger confirms that state the impact, Undo for reversible actions, plain language.
9. **Data hygiene:** tag test records, never hard-code demo data, never write the demo password into a file or report, never paste dev logs anywhere public.

---

## 6. Dependency overview

```
BEFORE PHASE 2   B-01 Final QA ✓ (28 Oct) · B-02 record D24
                 B-03 staging · B-04 backups · B-05 CI · B-06 Sentry · B-07 sin1 · B-08 FormField · B-09 D7 clean-up · B-10 avatar fix   (light, parallel)
                 Owner: O-1 "Decide first" answers, O-2…O-13 by their deadlines

DATABASE LANE    one agent, strictly serial — the backbone of the critical path (≈ 22 agent-days)
  (B-10) → P2-06 → P2-07 → P2-08 → P3-01 → P3-02a → P3-02b → P3-03a → P3-03b → P3-04 → P3-05
        → P4-01 → P4-02 → P4-03 → P5-01 → P5-02 → P5-03a → P5-03b → P5-04 → P5-05 → P5-06
        → P5-07a → P5-07b → (P5-08) → P5-09 → P5-10

DOMAIN LANES     light, always one phase ahead of the app work
  P2-02/03 → P2-04a → P2-04b → P2-05a ∥ P2-05b      P3-06 · P3-07 · P3-08 (during Phase 2)
  P4-04 (during Phase 3)                            P5-11 … P5-17 (during Phase 4)

APP LANES        ≤ 2 heavy agents
  Phase 2: P2-01a spike ─► P2-13a → 13b → {13c, 14a → 14b} → 19 → 20 → 21
           P2-09 → 10 → 22 → 12 → 17a → 17b → 23   (WBS file chain)      15 · 16 · 18 alongside
  Phase 3: 09 → 10 → 11a → 11b → 12 → 13a → 13b   and   14 → 15 → {16 ∥ 17} → 23 → 24
           18 → 19 → 20 · 21 · 25 (any time) → 22a → 22b
  Phase 4: 05 → {06 → 07 ∥ 08 → 09} → 10 → 11 → 12 → 13   (starts after P4-03 and P3-17; overlaps Phase 3's tail)
  Phase 5: search 18 → 19 · import 20 → 21 → 22 (+23, 50) · export 24 → 25 → {26 ∥ 27} → 28; 29 → 30
           privacy 31a → 31b · 33 · admin 34a → 34b, 35 · push 36 · ops 37 → 38 → (≥ 7 days) → 39
           verification 41 → 42a → 42b · 43 → {44a ∥ 44b} · 45 · 46 → 47 → UAT (48) → 49

ANY TIME         P2-11 chart tokens · P3-25 home-screen icon · P5-24 react-pdf spike (from Phase 3 on) · P5-40 debt
```

**Critical path in words:** foundations → the database lane → each phase's app chain that waits on it (Phase 2 Gantt chain, Phase 3 progress and inspection chains, Phase 5 import/export chains) → verification (performance, load, accessibility, security) → go-live configuration → UAT → release. Starting the next phase's domain modules early, and Phase 4's app lane as soon as P4-03 and P3-17 land, keeps the app agents busy while the database lane moves.

---

## 7. Questions for the owner

One list, de-duplicated. Answer only where you disagree with the recommendation. Already decided and not asked: hosting stack, domain, Render keep-alive off, `rhecy@civpms.test` kept, offline mode dropped (D7), home-screen icon kept.

### Decide first (these block Phases 2–3)
1. **Staging:** create a free second Supabase project `civpms-staging` for heavy seeds, load tests and destructive drills? Recommended: yes, before Phase 2 (check the organisation still has a free-project slot).
2. **Backups and plan:** start a nightly encrypted off-site copy now (client-owned bucket, client holds the key) and move production to Supabase Pro at go-live? Recommended: yes to both; add PITR only if a contract needs < 24 h of possible data loss.
3. **Linked work moving earlier:** when a predecessor finishes early, do linked work packages move earlier too, or only ever later? Recommended: move earlier; "Start no earlier than" pins a date; every move has Undo.
4. **Lag unit:** waits/overlaps between linked work in whole working days, even in Hours display (2 days shows as 16 h)? Recommended: yes.
5. **Removed links:** a removed link comes back only through Undo, not the 30-day trash (refines A22)? Recommended: yes; links of a deleted activity return when it is restored.
6. **Status gates:** "Set new baseline" and progress updates only while a project is Active or On-Hold? Recommended: yes; Baseline v1 stays automatic on activation.
7. **Assigned inspector:** PMs may assign an inspector when scheduling; results come from the proposer, the assignee or a project PM; the spec's "assignee" filter becomes an "Inspector" filter? Recommended: yes.
8. **Vercel plan and email speed:** Vercel Pro (Hobby is non-commercial and runs cron once a day) with functions in Singapore, plus the 5-minute database-driven email dispatcher using two Vault secrets? Recommended: yes; the daily Vercel cron stays as a fallback.
9. **Your account's mailbox:** `rhecy@civpms.test` cannot receive email; move it to a real address before Phase 3 emails? Recommended: yes; the clean-up script keeps the account either way.

### Phase 2 – Scheduling
10. Gantt read-only on phones (below 768 px), editing on tablets and computers? Recommended: yes.
11. Critical path drawn with a violet outline and faded other bars, never red? Recommended: yes (red stays for danger and Delayed).
12. Notify PMs when a project becomes "projected to finish late"? Recommended: no, dashboard warning only.
13. Float measured against the schedule's own finish (there is always a critical path), with a separate "later than the end date" warning? Recommended: yes.

### Phase 3 – Field & tracking
14. Photos only when marking Completed (1–2 required), or also optional on Delayed/On-Hold updates? Recommended: as the spec says; optional photos later as a toggle.
15. Inspection reminders at 16:00 the day before and 06:30 the same morning (Manila)? Recommended: yes.
16. Email defaults for frequent events ("activity completed", "inspection completed")? Recommended: in-app on, email off; each person can turn email on.
17. Should progress on work packages that were later deleted still count in the S-curve's actual line? Recommended: no (matches the dashboard %).
18. May a PM record an inspection with a past date? Recommended: no; unplanned visits are recorded as direct updates.

### Phase 4 – Sharing & viewers
19. Viewers: accept any verified sign-in with the invited email (not only the same Google account), including non-Gmail addresses? Recommended: yes, with Google highlighted; email-password viewers need Brevo SMTP (O-8).
20. Keep an encrypted Vault copy of the share link so PMs can copy it again (the spec says tokens are "stored hashed")? Recommended: yes; the hash is used for lookup and the copy is deleted on revoke (alternative: show once + Reset).
21. Default expiry for "Anyone with the link"? Recommended: 90 days (choices 7/30/90/no end date), reminder 3 days before.
22. Viewers see approved (incl. pending reschedule) and completed inspections from 30 days back to 12 months ahead, labelled only Approved/Rescheduled? Recommended: yes; proposed, rejected and cancelled stay hidden.
23. Tell the Owner PM (in-app) when another PM turns on link sharing? Recommended: yes.
24. Limits: 200 viewers per project, 50 new viewer emails per person per day, 20 per submission? Recommended: yes.
25. Keep viewer access and links after a project is Completed or Cancelled until a PM removes them? Recommended: yes, with a reminder on the Sharing page; they end at the 1-year purge.
26. One "Request access" flow for signed-in people who open a project they cannot see? Recommended: yes; uniform "Request sent"; same-company people can be added as Inspector/PM, others as Viewer; 10 requests per person per day.

### Phase 5 – Polish
27. Approve one exception to `CLAUDE.md` data-access rule 1: the ⌘K search RPC is called from the browser with the user's session? Recommended: approve; record it as a decision and update `CLAUDE.md` before P5-18.
28. Web push defaults: on for invitations, inspection decisions, reminders and reschedule requests, escalations, project delayed, access requests and the 7-day deletion warning; off for the rest? Recommended: yes (push uses a tiny push-only service worker, no offline).
29. Who may create a company after launch (spec §23.2 Q15)? Recommended: invite only, through a Platform Admin invitation; switchable back to open.
30. Platform Admin: who? Recommended: only you, on an identity with a real mailbox and an authenticator app; metadata only; every admin action visible to the company's Owner PM.
31. Account ownership and handover (spec §23.2 Q8): who owns Vercel, Supabase, Render, Brevo, Google Cloud, Sentry, the domain, the backup bucket and its key? Recommended: the client owns them and adds the developer as a member.
32. Brevo sender address on the decided domain? Recommended: `no-reply@civpms.prannsss.dev` (or a `mail.` subdomain) with SPF/DKIM/DMARC.
33. Retention: when a trashed project is purged after 30 days, delete its activity log too; and no "keep one more year" button? Recommended: yes to deleting (a short tombstone stays); no extension — reopening resets the clock.
34. Self-service account deletion for non-owners, including viewer-only users (log entries keep the person's name, §4.4)? Recommended: yes.
35. Record every export in the Audit Trail and limit large exports to 20 per person per hour? Recommended: yes.
36. Imports: "Replace current WBS" only in Planning with no progress; MS Project files deeper than 3 levels rolled up into level 3 with warnings? Recommended: yes to both.
37. First-run sample project (A7): keep "Use sample structure", or also add "Try a sample project"? Recommended: keep it and record the decision; add P5-50 only if you want it.
38. Privacy notice and Terms drafted in plain language for your counsel to review (RA 10173)? Recommended: yes; counsel review before go-live (not legal advice).
39. Users per company for the load test (spec §23.2 Q17)? Recommended: keep ≤ 50 per company, ≤ 300 at once, ≤ 5,000 activities per project.
40. Final logo for PDF covers and emails (spec §23.2 Q16)? Recommended: the current `public/brand` assets.

---

## 8. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Inspectors on sites with no signal cannot submit until they are back online** (offline mode dropped, D7) | Draft autosave, retry-safe submits and a form that keeps everything (P3-23); clear "No connection — try again" copy. **Confirm with the client**, because §13 was a client-spec item |
| 2 | Agents are interrupted by usage limits mid-task | Packages ≤ 1.5 days, checkpoint commits with RESUME notes, prompt merges and pushes |
| 3 | The serial database lane delays everything behind it | One dedicated DB agent; domain lanes one phase ahead; app lanes start as soon as their RPCs exist |
| 4 | The live database holds the owner's real company and the free plan has no backups | Staging for heavy and destructive work (B-03), nightly encrypted backup (B-04), Supabase Pro at go-live, tagged test records, restore drill |
| 5 | The free Gantt libraries lack baselines, today line and critical path, or fail at 2,000 rows | Spike gate before any Gantt UI (P2-01a), fallback library, own renderer as last resort (+4–6 days) |
| 6 | Date off-by-one between the Gantt library's `Date` objects and ISO dates (UTC+8 vs UTC) | Adapter built on local-midnight dates, tested on both time zones (P2-13a) |
| 7 | Render free cold starts (30–60 s) during photo uploads | Warm-up ping when the sheet opens, 45 s timeout then browser upload, `Retry-After` honoured; nothing keeps Render awake |
| 8 | Emails don't arrive (`.test` mailbox, default Supabase SMTP, daily-only Vercel cron) | O-8 Brevo SMTP and sender domain, O-10 real mailbox, 5-minute dispatcher with Vault secrets (P3-04) |
| 9 | Concurrent schedule edits keep failing | Schedule revision with automatic retry; field updates don't bump it except on a scheduling-class change (D53) |
| 10 | Retention deletes the wrong data | Two warnings, a 7-day gap rule, a delete guard scoped to one project, tombstones, SQL test 32, a staging drill in UAT |
| 11 | A public share link spreads further than intended | Exposure confirm, default 90-day expiry, Reset, Owner PM notice, opens count, `no-referrer`, `noindex`, instant revocation |
| 12 | The CSP blocks Google Picker, Sentry, Supabase Realtime, Workers or push | Report-only for ≥ 7 days with reports to Sentry, zero-violation e2e gate, unit-tested CSP builder |
| 13 | The public repository leaks data (CI logs, backups, feedback) | No secret echo, gitleaks, encrypted backups to private storage, feedback by email only |
| 14 | Unverified platform facts (react-pdf and the ₱ glyph, Vercel limits and region, MS Project XML codes, `btree_gin` on uuid, Chrome install criteria) | Spikes and fixtures before the dependent UI (P5-24, P5-14, P3-25), documented fallbacks |
| 15 | Free-plan limits in production (Supabase pausing after inactivity, Vercel Hobby non-commercial) | Questions 2 and 8; Pro plans at go-live |
| 16 | Holidays missing for future years (2027 Eid, 2028+) push wrong dates | `ensure_calendar_years` and an info pill (P2), holidays migration when proclaimed (P5-40) |
| 17 | Estimates are wrong | ≈ 109 agent-days ± 20 %; an explicit 4-day cut list; re-plan at the end of each phase from actual numbers |
| 18 | Privacy texts are legally inadequate | Drafts marked for counsel review before go-live; not legal advice |

---

## Appendix A. How the plan review was applied

The four phase plans were reviewed (17 gaps, 24 conflicts, 19 oversized packages, 23 renumberings, 42 owner questions). Everything valid is applied above; items made moot by D7 are marked.

**Gaps:** 1 status-date forecast → P3-20 · 2 Gantt "Update" action → P3-13b · 3 assigned inspector → D66, P3-03a/b, question 7 · 4 assignee filter → "Inspector" filter in P3-13b · 5 filter scope → D25 · 6 WBS sorting → P2-17b · 7 "Over budget" tooltip → P2-23 · 8 non-working-date warning → P2-22 · 9 import calendar moves existing work → D84, P5-03b, P5-22 · 10 sample project (A7) → question 37, optional P5-50 · 11 photos of purged activities → P3-01 (see disagreements) · 12 viewer privacy rights → D91, P5-31a/b · 13 Background Sync → moot (D7) · 14 links and A22 → D56, question 5 · 15 Vault link copy → D71, question 20, P5-45 restore note · 16 offline import/export states → moot (D7); audit CSV retrofit → P5-25 · 17 viewer opening `/projects/<id>` → P4-11.

**Conflicts:** 1 plan lock → D24 (B-02), D58 rescoped, P2-07 shrunk, inspections use their own lock key, progress RPCs avoid `lock_wbs` · 2 baseline calendar → P2-08 only owner · 3 test numbers → 12–13 / 14–18 / 20–22 / 30–36 · 4 migration names → 14-digit, after `20261023090000` · 5 request access → one design in D73 (P4-02, P4-03, P4-11); P5-06 drops it, P5-32 retired · 6 `/api/health` vs `/api/ping` → only `/api/health` remains (D7) · 7 Delayed filters → owned by P2, P3 feeds data · 8 chart tokens → one table in P2-11 · 9 media amendments → first-wins in P3-01; grace stays 24 h after D7 · 10 notification catalog → table in P3-02a · 11 families → `sync_conflicts` hidden (B-09), `sharing` (P4-05), `retention`/`account` (P5) · 12 error codes → `SHARE_LINK_*`, `INVALID_INSPECTION_STATE`, `UNAUTHENTICATED` reused · 13 search leak and cascade notes → D80 · 14 CSP vs PWA → reduced by D7; `worker-src`/`manifest-src` kept (D94) · 15 `CLAUDE.md` exceptions → only browser search remains (question 27) · 16 cycle checks → `graph_find_cycle` + validator in P2-07, reused by P5-03b · 17 version-bump lists → P2-06 step dropped, P3-02a and P5-05 extend the exclusion lists · 18 rev bump on status → class-change rule (D53) · 19 web push owner → Phase 5 (D92) with a push-only worker · 20 service worker on `/s/*` → moot (D7) · 21 S-curve drawn twice → geometry module (D69) · 22 question reference / Undo as via → fixed (D55) · 23 tests on the live DB → staging (B-03), backups (B-04) · 24 missing tests → added to P2-13a, P5-01, P5-05, P5-31a.

**Oversized packages** (all split; Phase 4 names are the phase plan's old IDs): P2-01, P2-04, P2-13a, P2-14, P3-02, P3-03, P3-11, P3-22, old P4-01 (→ P4-01/02), old P4-19 (→ P4-06/07), old P4-20 (→ P4-08/09), P5-03, P5-07, P5-31, P5-42, P5-48 (per-defect buffer); the offline packages old P4-06, P4-10 and P4-24 were dropped with D7. Also split here: P2-05, P2-17, old P4-21 (→ P4-10/11), P5-44.

**Renumbering:** all 23 items applied; Phase 4 packages and tests were renumbered again after D7 (P4-01 … P4-13, tests 20–22).

**Where this roadmap disagrees with the review (one line each)**
- Gap 11: photos of purged activities are fixed at the source (`media.activity_id … on delete cascade` in P3-01) instead of a Phase 5 clean-up, so they never linger between Phase 3 and Phase 5.
- Conflict 5 / gap 17: the "project unavailable" page is built in Phase 4 (P4-11), not P5-32, so one package owns the whole request-access flow.
- Conflict 10: `push_default` is added to the notification catalog in P3-02a, so P5-09 needs no function drop at all.
- Conflict 9: the 7-day media grace was only needed by the offline queue; with D7 it stays at 24 h, matching the media service's replay window (D44).
- Effort: the review estimated ≈ 97–100 agent-days; this roadmap plans ≈ 109 because splitting exposed real sizes and the gap fixes add work, while D7 removed ≈ 14.5 days of offline work and added ≈ 3 days of simpler replacements (P3-23 to P3-25, B-09, the push-only worker).

---

## 9. Handoff to the next session

### 9.1 Before you open the new session (owner checklist, ~10 minutes)

1. **Environment variables.** `.env.local` is git-ignored, so a fresh cloud session will not have it. In the new cloud environment's settings add these variables (same values as your local `.env.local`): `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `BREVO_API_KEY` (use the **rotated** key), `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SANDBOX`, `CRON_SECRET`, `DEMO_PASSWORD`. Optional: `NEXT_PUBLIC_MEDIA_API_URL=https://civpms-media.onrender.com`.
2. **Network access** (environment settings → Allowed domains): `bxfohhwvzbvmyokcsmwq.supabase.co`, `civpms-media.onrender.com`, `api.brevo.com`, `github.com`, plus the default package managers (npm, crates.io). Add `civpms.prannsss.dev` if you want the agent to check the deployed site.
3. **Connectors:** keep Supabase, Render and GitHub connected (the agent uses them for migrations, redeploys and repo access).
4. **Attach `SPEC.md`** to the first message. It is deliberately not in the repo, because the repo is public.
5. Paste the prompt below as the first message.

### 9.2 Prompt to paste

```text
You are continuing the build of CivPMS, a project-management system for engineering and construction companies (Primavera + ProjectLibre + Procore, with a modern UI). Repository: github.com/Prannsss/CivPMS.

START FROM branch `claude/civpms-roadmap`. It is the verified main work branch `claude/exciting-sagan-7valgn` plus docs/ROADMAP.md. Develop on the branch this session assigns you; never push to any other branch and never open a pull request unless I ask.

READ FIRST, in this order: CLAUDE.md (especially "Known pitfalls"), docs/HANDOFF.md, docs/ROADMAP.md, docs/DECISIONS.md, then docs/DATABASE.md, docs/DOMAIN.md, docs/DESIGN.md and backend/README.md when you touch those areas. The product spec SPEC.md is attached to this message (it is not in the repo because the repo is public). If it is missing, ask me for it before planning anything.

WHERE THINGS STAND
- Phases 0–1 (foundations + planning core) are built, merged, verified and pushed: auth and onboarding, projects home, project dashboard/settings/collaborators/audit trail, WBS (list + graph) and working calendar, profile, company settings and notifications. Next.js 16.4.2 on Vercel, Supabase, Brevo. The database refuses plan edits on completed/cancelled projects (migration 20261023090000_plan_lock).
- The Rust media + cache service in backend/ is deployed on Render and passed a 15/15 live smoke test.
- docs/ROADMAP.md is the proposed plan for Phases 2–5 (≈ 109 agent-days + UAT). It is a proposal: the owner still has to answer its "Decide first" questions (section 7).

LIVE SYSTEMS (be careful: they hold the owner's real data)
- Supabase project CivPMS, ref bxfohhwvzbvmyokcsmwq (ap-southeast-1). There is no staging project yet (roadmap item B-03), so tests run on the live database. Tag every test record you create (e.g. "[P2] …") and never modify data you did not create.
- Render (workspace tea-d3oa79be5dus73aikus0): web service civpms-media (srv-db8o41ff3r2c73eq0p5g), https://civpms-media.onrender.com, free plan, Singapore, auto-deploy OFF (after backend changes: push, then trigger a deploy and run a live smoke test). Key Value civpms-cache (red-db7f5hfavr4c73812d60). Keep-alive stays OFF (owner decision: the free 750 instance-hours are shared with other services). APP_ORIGINS = http://localhost:3000,https://civpms.prannsss.dev. NEVER touch the owner's other Render services (loginactivity, users-api, SeeBu, Budgee); the Render tools cannot delete anything and you must never try.
- Production domain https://civpms.prannsss.dev (Vercel; the owner deploys manually).
- Accounts: rhecy@civpms.test is the owner's own PM account (company RHEngineering): never use, modify or delete it, and keep it excluded in supabase/seed/demo-cleanup.sql. Demo/test accounts are owner@, pm@, inspector@, rival@ and newbie@civpms.test, all with password DEMO_PASSWORD. If .env.local is missing, create it from this session's environment variables (it is git-ignored; never commit it, never print DEMO_PASSWORD or any key).

OWNER DECISIONS ALREADY MADE (do not re-ask)
Plain Next.js on Vercel (no OpenNext); Supabase project CivPMS; Brevo email; Render free plan with keep-alive OFF; D7: offline mode is dropped (no service worker, outbox or sync); an "Add to Home screen" icon is kept (manifest + icons only, P3-25); production domain civpms.prannsss.dev.

OWNER RULES (non-negotiable)
- Never delete files you did not create; double-check every command before running it. No destructive git (no reset --hard, clean, force-push, rebase of shared branches, branch deletion).
- Never commit secrets; the repo is public. Never touch favicon.ico, public/logo.svg or public/[3-8].png.
- Chain checks with && before any push, so a failed check can never push. (A previous session pushed after a failed build because steps were joined with ";".)
- Commit messages: imperative and scoped (feat(x): …), ending with the attribution lines this session specifies.
- Owner preferences: be honest, concise and precise; ask when something is vague; say when the owner is wrong and offer a better alternative.

ENVIRONMENT LESSONS (full list in CLAUDE.md → Known pitfalls)
- Run `git remote set-url origin https://github.com/Prannsss/CivPMS` before every push (the remote resets to the old repo name).
- `next dev` and Playwright need NODE_USE_ENV_PROXY=1; `npm run build` must run WITHOUT it. Use `npm run typecheck`, not bare tsc. Playwright 1.56.1 with Chromium in /opt/pw-browsers; never run `playwright install`.
- Usage limits and container restarts interrupted work about ten times. Keep agent tasks small, commit a WIP checkpoint after every step, and resume interrupted agents with a short RESUME note (worktree, branch, what is done, what is left). At most 2 heavy agents (dev server + build) at a time.
- Supabase MCP: apply_migration records a wall-clock version, so rename it to the file's timestamp and keep the file byte-identical. A plain `delete from` inside a migration hangs, so use a data-modifying CTE. SQL test files run through execute_sql need the ROLLBACK-SENTINEL trick described in CLAUDE.md.
- Never `pkill -f <pattern>` from the Bash tool (it kills its own shell); kill by PID.

FIRST STEPS
1. Verify the state: `git log --oneline -5`, the working tree is clean, Supabase list_migrations ends at 20261023090000_plan_lock, and https://civpms-media.onrender.com/healthz answers (the first call after idle can take 30–60 s).
2. Show me the "Decide first" questions (ROADMAP §7), each with its recommended default, and wait for my answers. Record them in docs/DECISIONS.md.
3. Then run "Before Phase 2" (ROADMAP §2) package by package, verifying each one: tests, typecheck, lint, build, e2e where relevant, then commit and push. B-10 (the profiles.avatar_url privacy fix) must land before Phase 2's first migration.
4. Then start Phase 2 (ROADMAP §4.1) in the listed package order. Keep docs/HANDOFF.md and the ROADMAP status columns current as packages merge.
```
