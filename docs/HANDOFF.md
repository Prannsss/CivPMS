# CivPMS — build status & handoff

Last updated: 2026-10-16 · branch `claude/exciting-sagan-7valgn` (F1–F5 + backend merged; pushed to github.com/Prannsss/CivPMS).
Scope in progress: **Phases 0–1** (foundations + planning core). Lessons learned / pitfalls live in `CLAUDE.md` → "Known pitfalls" — read them before working.

## 1. Finished and on the branch (verified)

| Area | What works | Verified by |
|---|---|---|
| Database (`supabase/migrations`, 17 files) | Full Phase 0–1 schema on Supabase project **CivPMS** (`bxfohhwvzbvmyokcsmwq`, Singapore): RLS on every table, `private` helpers, ~40 SECURITY DEFINER RPCs (onboarding, company, invitations, invite codes, projects + status transitions + baseline v1, WBS create/update/move/delete/restore, calendar, trash, notifications, email outbox), append-only audit log via triggers, `project_overview` view, pg_cron daily job (Delayed alerts, invitation expiry, 30-day purge), PH holidays 2026–2027, `avatars` bucket | 8 SQL test suites (`supabase/tests`), Supabase advisors clean (2 intentional WARNs) — see `docs/DATABASE.md` |
| Domain logic (`src/lib/domain`) | Working-calendar math (D20), WBS tree/codes/moves, rollups + weighting fallbacks, statuses, project transitions, budget badges, permissions, ₱/date formatting (Asia/Manila), invite codes, zod schemas | Vitest, 100 % line coverage — `docs/DOMAIN.md` |
| Design system (`src/components/ui`, `shell`) | Tokens light/dark (AA-checked), Poppins, ~40 components incl. modal, sheet, confirm dialog (`useConfirm`), snackbars with Undo, status badges, meters, command palette, sidebar | `/dev/styleguide`, screenshots in `docs/screenshots`, `docs/DESIGN.md` |
| Platform plumbing | Supabase SSR clients, `src/proxy.ts` route protection, auth routes (`/auth/callback`, `/auth/confirm`, `/auth/signout`), typed env, error mapping, `ActionResult`, Brevo email + branded templates, email outbox dispatch + cron routes, Supabase Auth email templates, `docs/SETUP.md` (Windows) | unit tests, curl checks |
| Demo data (`supabase/seed`) | 5 accounts on `@civpms.test` (owner, pm, inspector, rival, newbie) + 5 projects covering ok / near-budget / exceeded+delayed / empty states. Password only in `.env.local` → `DEMO_PASSWORD` | sign-in + RLS isolation script |
| App foundation | Authenticated layouts, connected top bar (live Realtime notifications bell, user menu, ⌘K palette), project sidebar + mobile drawer, loading/error/404 pages, shared invite-code + pending-invitation components, Playwright harness (`e2e/helpers/auth.ts` `loginAs`) | 25 e2e specs green |
| F1 Auth & onboarding | Login, sign-up, forgot/reset password, check-email, 3-step onboarding (name → role → company or invite code / pending invitations / "No company yet"), `/invite/[token]` landing | 20 e2e specs green (live DB) |
| F2 Projects home | Project cards (gradient, status + derived badges, progress), URL-synced filters/search/sort, create-project dialog (also `/?new=1`), archive/unarchive, delete with type-to-confirm + Undo, Recently deleted (owner), empty states per role | 10 e2e specs green (live DB) |
| F3 Project workspace | Dashboard (status + derived badges, overdue banner, KPI cards, budget meter, needs-attention), project settings (details with Reload / Keep mine, status transitions, archive, owner-only delete with Undo), collaborators (members, Brevo email invitations, invite codes), audit trail + CSV export | `e2e/f3-*.spec.ts` green (live DB, `[F3]` tenant), screenshots `docs/screenshots/f3-*` |
| F4 WBS + working calendar | `/projects/[id]/wbs`: list with inline edits (end dates recomputed on the server from calendar + holidays + overrides, STALE_VERSION → Reload / Keep mine), dnd-kit drag & drop with move validation and explained invalid drops, keyboard up/down/indent/outdent, Undo snackbar per move, delete confirm stating impact + Undo (`restore_activity`) + Recently deleted panel, D21 first-child takeover of cost/hours/dates, Hours \| Days toggle saved to the profile (`update_profile`), Graph \| List remembered in localStorage, budget bar + hours-weighting fallback warning, empty state with "Use sample structure", windowed list for large trees, `@xyflow/react` graph (collapsible branches, pan/zoom, neutral connectors, delayed flagged on cards). Read-only banner for inspectors and completed/cancelled projects; every WBS/calendar action refuses plan edits there (`planLockFor` → FORBIDDEN). `/projects/[id]/calendar`: settings card, month grid with context menu + keyboard alternative, holidays + overrides lists, staged changes, save previews moved activities → confirm → `save_calendar` in one transaction. No schema change. | `e2e/f4-wbs.spec.ts`, `f4-calendar.spec.ts`, `f4-wbs-large.spec.ts` (20 tests, live DB, fail on any console error/hydration warning), screenshots `docs/screenshots/f4-*` (light/dark/mobile) |
| F5 Profile, company settings, notifications | `/profile`: name, avatar (via the media service when `NEXT_PUBLIC_MEDIA_API_URL` is set, otherwise browser crop + resize to a 256 px WebP uploaded straight to the `avatars` bucket; remove with Undo), Hours \| Days and theme, notification matrix per event type + daily email digest (migration `20261014090000`), password change, sign out. `/settings`: Owner PM edits company name, default calendar, members (promote/demote/remove), company invite codes and sees pending invitations; other PMs and inspectors get a read-only view; no company → friendly panel. `/notifications`: All/Unread + project filters, mark one/all read, keyset pagination, deep links, empty state. | `e2e/f5-profile`, `f5-company`, `f5-notifications` specs (live DB, `[F5]` tenant), SQL test 09, screenshots `docs/screenshots/f5-*` |

After merging F5 (2026-10-16): `npm run typecheck`, `npx eslint src e2e`, `npx vitest run` (41 files, 741 tests) and `npm run build` pass; Playwright on the merged branch: 60 passed, 1 failed (`found-shell` expected the old Owner-only company page — spec updated to F5's read-only PM view, then 7/7 green), 8 skipped (opt-in screenshot generators).

After merging F4 (2026-10-16): `npm run typecheck`, `npx eslint src e2e`, `npx vitest run` (38 files, 715 tests) and `npm run build` pass. Playwright on the merged branch (`e2e/f4-*`, `shell`, `found-shell`, `f1-auth`, `f2-home`, `f3-dashboard`, `f3-settings`): 64 passed, 5 skipped (the opt-in `F4_SHOTS=1` screenshot generator). Not re-run on the merged branch: `f1-invite`, `f1-onboarding`, `f3-audit`, `f3-collaborators`, `found-invitations`, `styleguide`.

Build fix during the F4 merge: `src/app/globals.css` now uses `@import "tailwindcss" source("..")` (class detection limited to `src/`). With the default (project root) the Tailwind scanner walked `.claude/worktrees` (agent checkouts with node_modules and a 7 GB Rust target) and `next build` was OOM-killed at ~14 GB. Keep class names inside `src/`.

## 2. Partially built — NOT on the branch

These exist only inside this cloud container as local commits. If the container was reclaimed they are gone and must be rebuilt from the feature brief.

| Feature | Local branch / worktree | State |
|---|---|---|
| — | — | Nothing pending: F1–F5 and the backend are merged (see §1 and §7). Backend review fixes are being finished on `wf/backend`. |

## 3. Not built yet

- **Final merge & QA:** full Playwright suite on the merged app, golden-path walkthrough, multi-lens review (security/RLS, spec conformance, UX/visual, accessibility) and fixes.
- Gantt and S-curve show a deliberate "coming next" state (Phase 2/3); every other Phase 0–1 page is built.
- Later phases (per spec §21): Gantt + dependencies + CPM + baselines UI (Phase 2); progress updates, inspections, images, S-curve (Phase 3); sharing/viewers, PWA/offline (Phase 4); search, import/export, reports (Phase 5).

## 4. Known issues to fix

- Dev server logs Server Action arguments in development → the login action's password appears in the local dev log (production does not). Turn off server-function argument logging in `next.config.ts`.
- Shared `FormField` (react-hook-form `Controller`) wipes text typed before hydration. F1 worked around it with `register()`; add a register-based variant to `src/components/ui`.
- `initials()` / avatars show "[S" for names that start with a bracketed tag (test data only).
- `supabase/templates/confirm-signup.html` hard-codes `next=/onboarding`; people who sign up from an invitation land in onboarding (the invite still appears there). Use `{{ .RedirectTo }}`.
- DB allows WBS edits on completed/cancelled projects — F4's UI and server actions block them (`planLockFor`); the RPCs themselves still accept them.
- F4 graph view: the React Flow minimap (bottom right) can cover part of an edge card at 1440px. Cosmetic; hide it below a width breakpoint.
- Dev log shows benign `The destination stream errored while writing data` when a Playwright test closes a page mid-stream.
- 2027 Eid holidays not seeded (not proclaimed yet) — add by migration when declared.

## 5. Owner actions (outside the code)

1. **Rotate the Brevo API key** that was pasted in chat; put the new one in `.env.local` / Vercel only.
2. Supabase dashboard (see `docs/SETUP.md`): custom SMTP via Brevo (without it, sign-up confirmation emails only reach project team members), URL configuration (localhost + Vercel domain), paste `supabase/templates/*`, enable Google provider.
3. Add `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `CRON_SECRET` to `.env.local` and Vercel. Prefer a domain sender with SPF/DKIM over a gmail.com address.
4. Before production: run `supabase/seed/demo-cleanup.sql` to remove every `@civpms.test` account.
5. Open spec questions: Q8 (account ownership), Q15 (who may create companies), Q17 (users per company).

## 6. Next steps (in order)

1. F1–F5 and the backend are merged and pushed.
2. Finish the backend review fixes, redeploy `civpms-media` on Render.
3. Run the full e2e suite on the merged branch, walk the golden path (onboard → company → project → WBS → calendar → invite → accept → audit trail), fix.
4. QA review pass (security/RLS, spec conformance, UX/visual, a11y) and fixes.
5. Start Phase 2.

## 7. Backend (media + cache service)

Rust service in `backend/` (crate `civpms-media`), owner-deployed to Render; decisions D40–D47, full guide in `backend/README.md`.

| What | State |
|---|---|
| Endpoints | `GET /healthz`, `GET /readyz`, `POST /v1/media/avatar`, `POST /v1/media/images` (idempotent `client_id`), `GET /v1/media/signed-url`, cached `GET /v1/projects`, `GET /v1/projects/{id}/summary`, `GET /v1/holidays?year=` |
| Security | Verifies the Supabase JWT (ES256/JWKS) and forwards the user's own token; no secret key (refused at startup); CORS allow-list; RLS + Storage policies are the boundary |
| Database | Migration `20261015100000_project_media_bucket.sql` **applied** to `bxfohhwvzbvmyokcsmwq` (version renamed to match the file, statements byte-identical); `supabase/tests/10_project_media_storage.sql` passes on the live DB |
| Ops | `backend/Dockerfile` (rust:1.97.0-slim-trixie → debian:trixie-slim + ffmpeg + tini, non-root, digests pinned), `render.yaml` (web `civpms-media` + Key Value `civpms-cache`, Singapore, free, auto-deploy off, `KEEPALIVE_ENABLED=false`), `.github/workflows/backend.yml` |
| Verified | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (84 unit + 23 integration, real redis-server + ffmpeg, wiremock as Supabase), `cargo build --release` (9.4 MB binary), local run (`/healthz` 200, `/readyz` 200 → 503 when Redis stops, clean SIGTERM exit), `backend/scripts/smoke-live.sh` against the live project (avatar 870 KB JPEG → 6.6 KB WebP; 12 MP 7.7 MB JPEG → 359 KB WebP 1600×1200 + 3.6 KB thumb in 3.3 s end to end (≈ 0.7 s ffmpeg); replay 0.3 s; cached reads 2–3 ms on HIT vs 0.4–1.4 s MISS; signed URLs; every created object deleted afterwards) |
| Not verified | `docker build` (no Docker daemon in the container: layers reproduced by hand), a real Render deploy, HEIC on ffmpeg 7.1 (local ffmpeg is 6.1) |

Owner actions to go live: create the Blueprint from `render.yaml`, set `SUPABASE_PUBLISHABLE_KEY` + `APP_ORIGINS`, then add `NEXT_PUBLIC_MEDIA_API_URL` to Vercel (steps in `backend/README.md` → "Deploy on Render"). Keep-alive stays off unless this becomes the only free service that must stay awake.

Next: F5's profile page should call `POST /v1/media/avatar` when `NEXT_PUBLIC_MEDIA_API_URL` is set and fall back to the direct Supabase upload (contract and snippet in the README); Phase 3 photo features use `/v1/media/images` with a `client_id` per queued item.
