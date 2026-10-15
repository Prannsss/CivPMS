# CivPMS — build status & handoff

Last updated: 2026-10-14 · branch `claude/exciting-sagan-7valgn` @ `c7bb833` (pushed to github.com/Prannsss/CivPMS).
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

After merging F1+F2: `npm run typecheck`, `npx eslint src e2e`, `npx vitest run` (32 files, 666 tests), `npm run build` all pass. The **combined** Playwright suite has not been re-run since the merge.

## 2. Partially built — NOT on the branch

These exist only inside this cloud container as local commits. If the container was reclaimed they are gone and must be rebuilt from the feature brief.

| Feature | Local branch / worktree | State |
|---|---|---|
| F3 Project workspace — dashboard, project settings (details, status transitions, archive, delete), collaborators (members, email invitations via Brevo, invite codes), audit trail + CSV export | `wf/workspace` @ `a173ce1` in `.claude/worktrees/wf_b818029a-bdf-6` | Code written (60 files). Live verification, screenshots and e2e specs not finished. WIP commit, unverified. |
| F4 WBS (list + graph, inline edit, drag & drop, delete/undo, trash) + working calendar | `wf/wbs` @ `480fa55` in `.claude/worktrees/wf_b818029a-bdf-7` | Only server queries/actions started (14 files). UI not built. WIP commit, unverified. |

## 3. Not built yet

- **F5** Profile (avatar, name, theme, hours/days, notification preferences, password), Company settings (rename, default calendar, members, company invite codes), Notifications page. Placeholder pages exist.
- **Final merge & QA:** full Playwright suite on the merged app, golden-path walkthrough, multi-lens review (security/RLS, spec conformance, UX/visual, accessibility) and fixes.
- Pages that are still placeholders on the branch: project dashboard, project settings, collaborators, audit trail, WBS, calendar, profile, company settings, notifications. Gantt and S-curve show a deliberate "coming next" state (Phase 2/3).
- Later phases (per spec §21): Gantt + dependencies + CPM + baselines UI (Phase 2); progress updates, inspections, images, S-curve (Phase 3); sharing/viewers, PWA/offline (Phase 4); search, import/export, reports (Phase 5).

## 4. Known issues to fix

- Dev server logs Server Action arguments in development → the login action's password appears in the local dev log (production does not). Turn off server-function argument logging in `next.config.ts`.
- Shared `FormField` (react-hook-form `Controller`) wipes text typed before hydration. F1 worked around it with `register()`; add a register-based variant to `src/components/ui`.
- `initials()` / avatars show "[S" for names that start with a bracketed tag (test data only).
- `supabase/templates/confirm-signup.html` hard-codes `next=/onboarding`; people who sign up from an invitation land in onboarding (the invite still appears there). Use `{{ .RedirectTo }}`.
- DB allows WBS edits on completed/cancelled projects — the F4 UI must block them.
- 2027 Eid holidays not seeded (not proclaimed yet) — add by migration when declared.

## 5. Owner actions (outside the code)

1. **Rotate the Brevo API key** that was pasted in chat; put the new one in `.env.local` / Vercel only.
2. Supabase dashboard (see `docs/SETUP.md`): custom SMTP via Brevo (without it, sign-up confirmation emails only reach project team members), URL configuration (localhost + Vercel domain), paste `supabase/templates/*`, enable Google provider.
3. Add `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `CRON_SECRET` to `.env.local` and Vercel. Prefer a domain sender with SPF/DKIM over a gmail.com address.
4. Before production: run `supabase/seed/demo-cleanup.sql` to remove every `@civpms.test` account.
5. Open spec questions: Q8 (account ownership), Q15 (who may create companies), Q17 (users per company).

## 6. Next steps (in order)

1. Resume F3 in its worktree → verify live + e2e → commit → merge → push.
2. Resume F4 → build the WBS + calendar UI → verify → merge → push.
3. Build F5 → verify → merge → push.
4. Run the full e2e suite on the merged branch, walk the golden path (onboard → company → project → WBS → calendar → invite → accept → audit trail), fix.
5. QA review pass (security/RLS, spec conformance, UX/visual, a11y) and fixes.
6. Start Phase 2.

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
