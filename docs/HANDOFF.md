# CivPMS — build status & handoff

Last updated: 2026-10-28 · branch `claude/exciting-sagan-7valgn` (pushed to github.com/Prannsss/CivPMS).
**Phases 0–1 (foundations + planning core) are built, merged and verified.** Lessons learned /
pitfalls live in `CLAUDE.md` → "Known pitfalls" — read them before working.

## 1. Finished and on the branch (verified)

| Area | What works | Verified by |
|---|---|---|
| Database (`supabase/migrations`, 20 files) | Full Phase 0–1 schema on Supabase project **CivPMS** (`bxfohhwvzbvmyokcsmwq`, Singapore): RLS on every table, `private` helpers, ~40 SECURITY DEFINER RPCs (onboarding, company, invitations, invite codes, projects + status transitions + baseline v1, WBS create/update/move/delete/restore, calendar, trash, notifications, email outbox), append-only audit log via triggers, `project_overview` view, pg_cron daily job (Delayed alerts, invitation expiry, 30-day purge), PH holidays 2026–2027, `avatars` + `project-media` buckets, daily email digest, **plan lock**: every WBS/calendar RPC refuses Completed/Cancelled projects (`20261023090000_plan_lock.sql`) | 11 SQL test suites (`supabase/tests`; `11_plan_lock.sql` run on the live DB 2026-10-28), Supabase advisors: no new findings (see §4) — `docs/DATABASE.md` |
| Domain logic (`src/lib/domain`) | Working-calendar math (D20), WBS tree/codes/moves, rollups + weighting fallbacks, statuses, project transitions, budget badges, permissions, ₱/date formatting (Asia/Manila), invite codes, zod schemas | Vitest, 100 % line coverage — `docs/DOMAIN.md` |
| Design system (`src/components/ui`, `shell`) | Tokens light/dark (AA-checked), Poppins, ~40 components incl. modal, sheet, confirm dialog (`useConfirm`), snackbars with Undo, status badges, meters, command palette, sidebar | `/dev/styleguide`, screenshots in `docs/screenshots`, `docs/DESIGN.md` |
| Platform plumbing | Supabase SSR clients, `src/proxy.ts` route protection, auth routes (`/auth/callback`, `/auth/confirm`, `/auth/signout`), typed env, error mapping, `ActionResult`, Brevo email + branded templates, email outbox dispatch + cron routes, Supabase Auth email templates, `docs/SETUP.md` (Windows) | unit tests, curl checks |
| Demo data (`supabase/seed`) | 5 accounts on `@civpms.test` (owner, pm, inspector, rival, newbie) + 5 projects covering ok / near-budget / exceeded+delayed / empty states. Password only in `.env.local` → `DEMO_PASSWORD` | sign-in + RLS isolation script |
| App foundation | Authenticated layouts, connected top bar (live Realtime notifications bell, user menu, ⌘K palette), project sidebar + mobile drawer, loading/error/404 pages, shared invite-code + pending-invitation components, Playwright harness (`e2e/helpers/auth.ts` `loginAs`) | 25 e2e specs green |
| F1 Auth & onboarding | Login, sign-up, forgot/reset password, check-email, 3-step onboarding (name → role → company or invite code / pending invitations / "No company yet"), `/invite/[token]` landing | 20 e2e specs green (live DB) |
| F2 Projects home | Project cards (gradient, status + derived badges, progress), URL-synced filters/search/sort, create-project dialog (also `/?new=1`), archive/unarchive, delete with type-to-confirm + Undo, Recently deleted (owner), empty states per role | 10 e2e specs green (live DB) |
| F3 Project workspace | Dashboard (status + derived badges, overdue banner, KPI cards, budget meter, needs-attention), project settings (details with Reload / Keep mine, status transitions, archive, owner-only delete with Undo), collaborators (members, Brevo email invitations, invite codes), audit trail + CSV export | `e2e/f3-*.spec.ts` green (live DB, `[F3]` tenant), screenshots `docs/screenshots/f3-*` |
| F4 WBS + working calendar | `/projects/[id]/wbs`: list with inline edits (end dates recomputed on the server from calendar + holidays + overrides, STALE_VERSION → Reload / Keep mine), dnd-kit drag & drop with move validation and explained invalid drops, keyboard up/down/indent/outdent, Undo snackbar per move, delete confirm stating impact + Undo (`restore_activity`) + Recently deleted panel, D21 first-child takeover of cost/hours/dates, Hours \| Days toggle saved to the profile (`update_profile`), Graph \| List remembered in localStorage, budget bar + hours-weighting fallback warning, empty state with "Use sample structure", windowed list for large trees, `@xyflow/react` graph (collapsible branches, pan/zoom, neutral connectors, delayed flagged on cards). Read-only banner for inspectors and completed/cancelled projects; every WBS/calendar action refuses plan edits there (`planLockFor` → FORBIDDEN), and since 2026-10-28 the database does too. `/projects/[id]/calendar`: settings card, month grid with context menu + keyboard alternative, holidays + overrides lists, staged changes, save previews moved activities → confirm → `save_calendar` in one transaction. No schema change. | `e2e/f4-wbs.spec.ts`, `f4-calendar.spec.ts`, `f4-wbs-large.spec.ts` (20 tests, live DB, fail on any console error/hydration warning), screenshots `docs/screenshots/f4-*` (light/dark/mobile) |
| F5 Profile, company settings, notifications | `/profile`: name, avatar (via the media service when `NEXT_PUBLIC_MEDIA_API_URL` is set, otherwise browser crop + resize to a 256 px WebP uploaded straight to the `avatars` bucket; remove with Undo), Hours \| Days and theme, notification matrix per event type + daily email digest (migration `20261014090000`), password change, sign out. `/settings`: Owner PM edits company name, default calendar, members (promote/demote/remove), company invite codes and sees pending invitations; other PMs and inspectors get a read-only view; no company → friendly panel. `/notifications`: All/Unread + project filters, mark one/all read, keyset pagination, deep links, empty state. | `e2e/f5-profile`, `f5-company`, `f5-notifications` specs (live DB, `[F5]` tenant), SQL test 09, screenshots `docs/screenshots/f5-*` |
| Final QA (2026-10-23 → 28) | Whole Phase 0–1 app on Next.js 16.4.2: full Playwright suite, golden path on brand-new accounts (`e2e/final-golden-path.spec.ts`), avatar upload through the media service and its browser fallback (`e2e/final-media-service.spec.ts`), review of every Server Action and Route Handler, plan lock moved into the database, README gallery (`e2e/final-screenshots.spec.ts`, `docs/screenshots/final-*`) | see "Verification" below |

### Verification (final QA, Next.js 16.4.2, live Supabase project)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npx eslint src e2e` | pass (0 problems) |
| `npx vitest run` | 42 files, 766 tests passed |
| `npm run build` (without `NODE_USE_ENV_PROXY`) | pass — 28 routes + proxy |
| Full Playwright suite (`BASE_URL=http://localhost:3210 npx playwright test`) | **104 passed, 0 failed**, 45 skipped (opt-in only), 8.4 min — final run on 2026-10-28 after every change, including the database plan lock |
| Golden path, fresh accounts (`QA_STAMP=1028045926`, seed `supabase/seed/qa-e2e.sql`) | 8 / 8 passed: onboard → company → project → WBS → calendar reschedule → email invite → inspector accepts (read-only) → audit trail → profile/company/notifications → rival company sees nothing (UI + database) |
| Media service spec, local `civpms-media` (build of `9cdcc5c`) + Redis | `QA_MEDIA_EXPECT=service` passed (upload through the service, 256×256 WebP); `QA_MEDIA_EXPECT=fallback` passed (service stopped → browser resize + direct Storage upload) |
| `supabase/tests/11_plan_lock.sql` on the live DB (rolled back) | all assertions passed; Supabase advisors after the migration: no new findings |
| Gallery screenshots (`FINAL_SHOTS=1`, demo accounts) | 30 images, 1440×900 light/dark + 390×844 phone, 85–345 KB each, no console errors; reviewed, no visual defects needing a fix |
| Render (owner) | reviewed backend (`2c6963a`) is live on `civpms-media`; live smoke 15/15 |

Earlier runs of the same day: Playwright 103 passed, 1 failed, 44 skipped. The failure was test
data, not the app: `f1-pool-24` had been left half-onboarded (name + Inspector saved) by a run in
another container, so onboarding resumed at step 3. `claimFreshAccount()` now skips such accounts
(`e2e/f1-support.ts`); the spec then passed 4/4. The 44 skipped tests are the opt-in generators and
specs (`f2/f3/f4/f5-screenshots`, `final-golden-path`, `final-media-service`; the final run also
counts the new `final-screenshots`, hence 45).

Review of `src/server/actions/**` (11 files) and every `src/app/**/route.ts` (6 handlers): every
action validates with zod, runs as the signed-in user (`@/lib/supabase/server`, RLS + RPC role
checks) and returns `ActionResult` through `runAction`/`failFrom` (only our own RPC `detail` text
reaches users; anything else is UNEXPECTED with a logged reference id); `revalidatePath` covers the
changed pages; nothing logs passwords or keys (`logging.serverFunctions: false`; the password change
runs in the browser). The secret key is used only by the email outbox worker and `/api/cron/*`
(Bearer `CRON_SECRET`, constant-time compare), never for user-facing reads. Sign-out is POST +
same-origin; auth callbacks only redirect to sanitised `next` paths with error codes; the audit CSV
export is read through RLS, permission-checked, formula-escaped and uses a slug filename. WBS and
calendar edits on Completed/Cancelled projects are refused by the actions (`planLockFor`) and now by
the database (`private.lock_wbs` / `private.get_managed_activity` → `assert_plan_open`), covered by
SQL test 11 and by `e2e/f4-wbs` / `f4-calendar` calling the RPCs with the Owner PM's own token.

## 2. Partially built — NOT on the branch

Nothing. All feature and backend branches are merged; no work lives only in a container.

## 3. Not built yet (by design)

- Gantt and S-curve show a deliberate "coming next" state; every other Phase 0–1 page is built.
- Later phases (spec §21): Gantt + dependencies + CPM + baselines UI (Phase 2); progress updates,
  inspections, images, S-curve (Phase 3); sharing/viewers, PWA/offline (Phase 4); search,
  import/export, reports (Phase 5).

## 4. Known issues (open)

- Shared `FormField` (react-hook-form `Controller`) wipes text typed before hydration. Forms use
  `register()` instead; add a register-based variant to `src/components/ui`.
- `supabase/templates/confirm-signup.html` hard-codes `next=/onboarding`; people who sign up from
  an invitation land in onboarding (the invitation still appears there). Use `{{ .RedirectTo }}`.
- `profiles.avatar_url` accepts any `https://` URL (by RPC or direct update). An outside image link
  would load in teammates' browsers (IP leak). Restrict it to the Storage bucket and Google photo
  hosts.
- WBS "add first child" (D21): if clearing the parent's own values fails (e.g. someone edited the
  parent in between), the error is ignored. The values are hidden while the parent has children,
  but would resurface if all children were deleted. Rare; surface it as a warning.
- WBS graph: on wide trees the first view keeps cards readable (≥ 50 % zoom) so outer branches
  start off-screen (pan or use Fit); at 1440 px the minimap can cover part of an edge card.
- Audit filters use native date inputs: they show the browser's locale format (mm/dd/yyyy in
  en-US) instead of `10 Oct 2026`.
- Supabase advisors: `get_invitation_by_token` is executable by `anon` (intentional: the
  `/invite/[token]` landing page); the SECURITY DEFINER RPCs callable by `authenticated` are the API
  by design (they check roles themselves); leaked-password protection is off (Auth setting, owner);
  20 unused indexes (INFO: foreign-key / policy indexes kept on purpose, see
  `20261012001600_advisor_fixes.sql`).
- 2027 Eid holidays are not seeded (not proclaimed yet) — add by migration when declared.
- Dev log shows a benign `The destination stream errored while writing data` when a Playwright test
  closes a page mid-stream.

Fixed during final QA: Server Function arguments (passwords) no longer reach the dev log
(`a2117c9`); initials skip a leading `[tag]` (`7ccd137`, `ec7177d`); Next.js 16.4.0 → 16.4.2 for
GHSA-2464-fhr4-w9xw / GHSA-p3m5-59mp-jv5r / GHSA-673q-mjm6-r5xr (`2c6963a`); the database now
refuses WBS/calendar edits on Completed/Cancelled projects (`20261023090000_plan_lock.sql`).

## 5. Owner actions (outside the code)

1. **Render — `civpms-media`** is live at <https://civpms-media.onrender.com> (free plan, Singapore)
   with the reviewed backend (`2c6963a`; live smoke 15/15).
   - Auto-deploy is **off**: redeploy manually (Render dashboard → Manual Deploy) after every change
     under `backend/`.
   - Keep-alive is **off** (`KEEPALIVE_ENABLED=false`); the free instance sleeps when idle, so the
     first upload after a pause is slow. The web app falls back to the browser upload if it times out.
   - Set **Health Check Path** to `/healthz` in the service's settings (dashboard).
   - `APP_ORIGINS` is `http://localhost:3000,https://civpms.prannsss.dev`. Add every other origin the
     web app is served from (e.g. a `*.vercel.app` preview domain), comma-separated, exact origins.
2. **Vercel:** set `NEXT_PUBLIC_MEDIA_API_URL=https://civpms-media.onrender.com` to route profile
   photos through the media service (redeploy after setting it; `NEXT_PUBLIC_*` is build-time). Set
   `APP_URL=https://civpms.prannsss.dev` so invitation links use the real domain. Also
   `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `CRON_SECRET` (see `docs/SETUP.md`).
3. **Rotate the Brevo API key** that was pasted in chat; put the new one in `.env.local` / Vercel only.
4. **Supabase dashboard** (`docs/SETUP.md`): custom SMTP via Brevo (without it, sign-up
   confirmation emails only reach project team members), enable the **Google** provider (OAuth
   client in Google Cloud), URL configuration (localhost + `https://civpms.prannsss.dev`), paste
   `supabase/templates/*`, and consider leaked-password protection.
5. **Before production:** run `supabase/seed/demo-cleanup.sql` to remove every `@civpms.test`
   demo/test account (including the `qa-<stamp>-*` golden-path accounts). It deliberately **keeps**
   the owner's own PM account `rhecy@civpms.test` (company RHEngineering) — listed in the script's
   `c_keep` (owner decision 2026-10-16). Its password is known to the owner only; `@civpms.test`
   cannot receive email, so reset it via SQL if needed, or move the account to a real address.
6. Open spec questions: Q8 (account ownership), Q15 (who may create companies), Q17 (users per company).

## 6. Next steps

1. **Phase 2** (Gantt, dependencies, CPM, baselines UI) — plan in `docs/ROADMAP.md`.
2. Pick up the open items in §4 as small fixes along the way.

## 7. Backend (media + cache service)

Rust service in `backend/` (crate `civpms-media`), deployed by the owner to Render as `civpms-media` (<https://civpms-media.onrender.com>); decisions D40–D47, full guide in `backend/README.md`.

| What | State |
|---|---|
| Endpoints | `GET /healthz`, `GET /readyz`, `POST /v1/media/avatar`, `POST /v1/media/images` (idempotent `client_id`), `GET /v1/media/signed-url`, cached `GET /v1/projects`, `GET /v1/projects/{id}/summary`, `GET /v1/holidays?year=` |
| Security | Verifies the Supabase JWT (ES256/JWKS) and forwards the user's own token; no secret key (refused at startup); CORS allow-list; RLS + Storage policies are the boundary |
| Database | Migration `20261015100000_project_media_bucket.sql` **applied** to `bxfohhwvzbvmyokcsmwq` (version renamed to match the file, statements byte-identical); `supabase/tests/10_project_media_storage.sql` passes on the live DB |
| Ops | `backend/Dockerfile` (rust:1.97.0-slim-trixie → debian:trixie-slim + ffmpeg + tini, non-root, digests pinned), `render.yaml` (web `civpms-media` + Key Value `civpms-cache`, Singapore, free, auto-deploy off, `KEEPALIVE_ENABLED=false`), `.github/workflows/backend.yml` |
| Verified | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (84 unit + 23 integration, real redis-server + ffmpeg, wiremock as Supabase), `cargo build --release` (9.4 MB binary), local run (`/healthz` 200, `/readyz` 200 → 503 when Redis stops, clean SIGTERM exit), `backend/scripts/smoke-live.sh` against the live project (avatar 870 KB JPEG → 6.6 KB WebP; 12 MP 7.7 MB JPEG → 359 KB WebP 1600×1200 + 3.6 KB thumb in 3.3 s end to end (≈ 0.7 s ffmpeg); replay 0.3 s; cached reads 2–3 ms on HIT vs 0.4–1.4 s MISS; signed URLs; every created object deleted afterwards) |
| Live | Reviewed build (`2c6963a`) deployed on Render by the owner; live smoke 15/15. The web app's avatar upload through the service and its fallback pass `e2e/final-media-service.spec.ts` (local service) |
| Not verified | `docker build` in this container (no Docker daemon; Render builds it from `render.yaml` → `backend/Dockerfile`), HEIC on ffmpeg 7.1 (local ffmpeg is 6.1) |

Phase 3 photo features use `POST /v1/media/images` with a `client_id` per queued item. Owner settings: §5.1.
