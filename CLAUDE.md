# CivPMS — engineering guide

CivPMS is a Project Management System for engineering/construction companies (Primavera + ProjectLibre + Procore, with a modern UI). This file is the contract every contributor (human or agent) follows. Read it fully before writing code.

- **Product spec:** `SPEC.md` lives outside the repo (the repo is public). Agents get its path in their task prompt. Section numbers below (`§5.2`) refer to it.
- **Decisions that override or extend the spec:** `docs/DECISIONS.md`. When the spec and this file disagree, this file wins.
- **Current scope: Phases 0–1** (foundations + planning core). Gantt, dependencies, CPM, baselines UI, progress updates, inspections, S-curve, sharing/viewers, offline/PWA, global search and import/export are later phases. Build so they slot in without rewrites, but do not build them now.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Next.js 16 (App Router, React 19, TypeScript strict, Turbopack). Deployed on **Vercel** (Node runtime). |
| Styling | Tailwind CSS v4 (CSS-first `@theme` in `src/app/globals.css`), `class-variance-authority`, `tailwind-merge` via `cn()` |
| UI primitives | `radix-ui` (unified package), `sonner` (snackbars), `cmdk` (command palette), `lucide-react` (icons), `next-themes` (light/dark/system) |
| Forms | `react-hook-form` + `zod` v4 (`@hookform/resolvers/zod`) |
| Data | Supabase (Postgres + RLS, Auth, Storage, Realtime). `@supabase/ssr` for cookies-based sessions |
| Email | Brevo transactional REST API (plain `fetch`, no SDK) |
| Dates | ISO date strings `YYYY-MM-DD` for calendar dates; `date-fns` + `@date-fns/tz`; business timezone **Asia/Manila** |
| Tests | Vitest (pure logic), SQL test scripts (RLS/RPC), Playwright 1.56.1 (e2e, Chromium at `/opt/pw-browsers`) |

Next 16 specifics: route protection lives in **`src/proxy.ts`** (the `middleware` convention is deprecated). `cacheComponents` is **off**. Bundled Next docs: `node_modules/next/dist/docs/` — check them instead of guessing APIs. `params`/`searchParams`/`cookies()`/`headers()` are async.

Supabase project: **CivPMS**, ref `bxfohhwvzbvmyokcsmwq`, region ap-southeast-1. Env vars: see `.env.example`. Use the **publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) for browser/server user clients and the **secret key** (`SUPABASE_SECRET_KEY`, server-only) only in `src/lib/supabase/admin.ts`.

## Folder structure (src/)

```
app/
  (auth)/            login, signup, forgot-password, reset-password, check-email   (split layout, mockups 3–4)
  auth/              callback/route.ts (OAuth + PKCE code), confirm/route.ts (token_hash), signout/route.ts
  onboarding/        role + company / invite code (mockup 5)
  invite/[token]/    email-invitation landing
  (app)/             authenticated area; layout enforces session + onboarding
    (home)/          top-bar shell: "/" projects home (mockups 6–7), profile, settings (company), notifications
    projects/[projectId]/   sidebar shell (mockup 8): dashboard, wbs, gantt, s-curve, calendar, collaborators, audit, settings
  api/cron/          protected job endpoints (Bearer CRON_SECRET)
  dev/styleguide/    design-system showcase (404 in production)
components/
  ui/                design-system primitives ONLY (no data fetching, no Supabase)
  shell/             TopBar, UserMenu, NotificationBell, ThemeToggle, CommandPalette, ProjectSidebar, Logo, AppShell frames
  <feature>/         feature components (projects/, wbs/, calendar/, collaborators/, onboarding/, auth/, notifications/, ...)
lib/
  domain/            PURE TypeScript business logic (no React, no Supabase, no Date.now() without injection) + *.test.ts
  supabase/          client.ts (browser), server.ts (RSC/actions), proxy.ts (session refresh), admin.ts (secret key), database.types.ts (generated)
  email/             brevo.ts + templates/
  errors.ts          AppError codes + Postgres error mapping
  action-result.ts   ActionResult<T> type + helpers
  env.ts             typed env access (server/public split)
  utils.ts           cn() and tiny helpers
  constants.ts       APP_NAME, palettes, limits
server/
  context.ts         getSessionContext(), getProjectAccess(projectId) — React cache()'d, server-only
  queries/           server-only read functions (RLS as the signed-in user)
  actions/           'use server' mutations, one file per feature
proxy.ts
```

Ownership rule: a feature's pages, components, queries and actions live in that feature's folders. Never edit another feature's files to make yours work; if a shared primitive is missing or wrong, note it in your report.

## Data-access rules

1. **Reads** happen in Server Components through `src/server/queries/*` (user-scoped Supabase client → RLS enforced). No secret-key reads for user-facing data.
2. **Writes** go through Server Actions in `src/server/actions/*`. Every action: `zod` validate → call a Postgres RPC (multi-row/state-transition logic) or a single-table write (RLS-enforced) → `revalidatePath` → return `ActionResult<T>`.
3. `ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string> } }`. Actions never throw to the client and never leak raw Postgres/Supabase messages.
4. **Authorization is enforced in the database** (RLS + `SECURITY DEFINER` RPCs that check the caller's role). UI permission checks only hide/disable controls; they are never the security boundary.
5. RPC errors: `raise exception using errcode = 'P0001', message = '<ERROR_CODE>', detail = '<human message>', hint = '<field name or empty>'`. `src/lib/errors.ts` maps them; unknown errors become `UNEXPECTED` with a reference id logged server-side.
6. Optimistic concurrency: `projects` and `activities` have a `version` int. Update RPCs take `expected_version` and raise `STALE_VERSION` when it differs; UI shows "Changed by someone else just now — Reload / Keep mine".
7. Every mutation that the spec says is logged writes an `activity_logs` row (done by DB triggers; RPCs set `set_config('pms.via', '<via>', true)` for cascade/import/etc.). Logs are append-only.

## Design system

Brand: **Poppins** (400/500/600/700, `next/font/google`, CSS var `--font-poppins`). Primary blue **`#0866FF`**. Backgrounds: white (light) / black (dark). Red = danger (logout, delete, remove, cancel, errors). Yellow/orange/red = badges & warnings. Light **and** dark mode (class strategy via `next-themes`, default `system`).

All colors are CSS variables in `globals.css`, exposed as Tailwind colors via `@theme inline`; `docs/DESIGN.md` is the source of truth for exact values and contrast results. **Never hard-code hex values in components** — use the tokens (`bg-primary`, `text-muted-foreground`, `bg-danger-soft`, …). Key tokens:

| Token | Light | Dark | Use |
|---|---|---|---|
| background | #FFFFFF | #000000 | page |
| surface / surface-muted / surface-sunken | #FFFFFF / #F8FAFC / #F1F5F9 | #0B0B0C / #111113 / #18181B | cards / panels & stripes / input fills |
| border / border-strong | #E2E8F0 / #CBD5E1 | #27272A / #3F3F46 | |
| foreground / muted-foreground | #0A0A0A / #475569 | #FAFAFA / #A1A1AA | text (≥4.5:1) |
| primary (+hover/active) / primary-foreground | #0866FF / white | #0866FF / white | buttons, active states, focus ring |
| primary-text | #0656D6 | #4C8DFF | links & blue text (#0866FF is only 4.2:1 on primary-soft, and fails AA as small text on black) |
| primary-soft | #E7F0FF | rgba(8,102,255,.16) | selected rows, tinted chips |
| danger / danger-soft / danger-text | #DC2626 / #FEE2E2 / #B91C1C | #DC2626 (white text on #EF4444 is only 3.8:1) / rgba(239,68,68,.16) / #F87171 | destructive + Delayed + Budget Exceeded |
| warning (yellow/amber) | #F59E0B / #FEF3C7 / #92400E | … | Near budget limit, soft warnings |
| orange | #EA580C / #FFEDD5 / #9A3412 | … | On-Hold, escalations |
| success | #16A34A / #DCFCE7 / #166534 | … | Completed |
| info (sky — "Ongoing", lighter than brand) | #0EA5E9 / #E0F2FE / #075985 | … | Ongoing |
| neutral | #64748B / #F1F5F9 / #334155 | … | Not Started, Planning |
| sidebar-* | bg #0866FF, fg white, active-bg white, active-fg #0A0A0A | bg #0B0B0C, fg #E4E4E7, active-bg #0866FF, active-fg white | project sidebar (mockup 8) |

Status semantics (always color **+ icon + label**, never color alone):
- Activity: Not Started (neutral, `Circle`), Ongoing (info, `CircleDot`/`Loader`), Delayed (danger, `AlertTriangle`), On-Hold (orange, `PauseCircle`), Completed (success, `CheckCircle2`).
- Project: Planning (neutral), Active (primary), On-Hold (orange), Completed (success), Cancelled (neutral, strikethrough-free, `XCircle`); derived badges Delayed (danger), Budget Exceeded (danger), Near Budget Limit (warning).
- Delayed is a chip/badge with icon — never a solid red button — so it is not confused with destructive actions.

Project card colors (mockup 7) come from a fixed palette **without red/orange/yellow** (those mean warnings): `blue #0866FF, green, pink, purple, teal, graphite`. White text on cards must meet contrast (use deeper tones or a bottom scrim).

Typography scale (Poppins is wide — keep body at 14px): display 36/44 600 · h1 28/36 600 · h2 22/30 600 · h3 18/26 600 · body 14/22 400 · body-lg 15/24 · label 13/20 500 · caption 12/16 400. Use `tabular-nums` for money, dates and percentages. Headings use slight negative tracking (-0.01em to -0.02em).

Spacing on a 4px grid; page gutters 16px mobile / 24–32px desktop; card padding 20–24px; radius: sm 8 · md 12 (inputs, buttons) · lg 16 (cards) · xl 20 · full (pills, search). Shadows are subtle; elevation only for popovers/dialogs/toasts. Motion 150–200ms ease-out; honor `prefers-reduced-motion`.

UX rules (spec §17): one obvious primary action per screen; empty states always explain + offer the action; skeletons instead of spinners for page loads (no layout shift); inline validation on blur and submit with "what's wrong + how to fix"; destructive actions use the confirm dialog stating impact and danger styling; reversible actions show an **Undo** snackbar; plain language; keyboard friendly (Esc closes, visible focus ring, ⌘/Ctrl+K palette); touch targets ≥44px on mobile; WCAG 2.1 AA. Formatting: money `₱1,234,567.89`, dates `10 Oct 2026`, timezone Asia/Manila.

Global UI services (from `components/ui`): `toast` helpers (sonner, themed, supports `action: { label: 'Undo', onClick }`), `useConfirm()` → `Promise<boolean>` (tones `default|danger`, optional "type the name to confirm"), `Dialog`/`Sheet`, `EmptyState`, `Skeleton`, `StatusBadge`, `Meter`.

## Business decisions (Phase 0–1) — see docs/DECISIONS.md for rationale

- **Auth/onboarding (mockups 3–5):** sign-up form = email + password (≥10 chars) + Google. Name, role and company/invite code are collected in **onboarding**, which both email and Google users go through.
  - PM → company name (unique, case-insensitive) → becomes Owner PM. If the PM has pending email invitations, those are offered first.
  - Inspector/QA/QC → **invite code** (company-wide or project-specific) or a pending email invitation. Without one they finish onboarding in the "No company yet" state (spec §4.3) where code entry and pending invitations remain available.
- **Invite codes** are new (mockup 5): created by PMs, inspector role only, format `XXXX-XXXX` (Crockford base32), optional expiry/max uses, revocable, redemption rate-limited.
- **Email invitations** per spec §4.4 (project + role pm|inspector, 7-day expiry, token hashed, one company per user).
- **Durations** are stored in working hours. End date = the working day on which the last working hour falls (12 h at 8 h/day starting Mon → ends Tue). Zero-duration = milestone (end = start).
- **Parents ignore their own cost/hours/dates** once they have children (values derive from leaves).
- Gantt and S-curve tabs exist in the sidebar but show a "coming next" empty state in this phase.

## Commands

```
npm run dev          # http://localhost:3000
npm run build        # must pass before every push
npm run lint
npm run typecheck
npm test             # vitest
npm run test:e2e     # playwright
```

## Quality bar

- TypeScript strict, no `any` (use generated `Database` types), no `// @ts-ignore`.
- No secrets in code or commits. `.env.local` is git-ignored; `.env.example` holds placeholders only.
- Never delete or overwrite files you did not create; move nothing the user owns (`favicon.ico`, `public/logo.svg`, `public/[3-8].png`).
- Server-only modules import `server-only`.
- Every page has loading (skeleton) and error states; every list has an empty state.
- Commit messages: imperative, scoped (`feat(wbs): …`, `fix(db): …`).

## Known pitfalls (lessons learned — read before working)

Current build status and next steps: `docs/HANDOFF.md`.

Environment (cloud container)
- **Remote URL resets on session restart** to the repo's old name `Prannsss/PMS` → push fails with "repository not found". Always run `git remote set-url origin https://github.com/Prannsss/CivPMS` before pushing.
- **Only `claude/exciting-sagan-7valgn` may be pushed.** Agent branches (`wf/*`) exist only locally and die with the container — merge finished work into the main branch and push promptly; never leave verified work only on a `wf/*` branch.
- **Network:** `next dev`, Node scripts and Playwright web servers need `NODE_USE_ENV_PROXY=1` to reach Supabase through the proxy (otherwise every page redirects to /login). But **`next build` must run WITHOUT it** — with it, `next/font` fails to fetch Poppins.
- Killing `next dev` can corrupt `.next/dev/types/routes.d.ts` → the next build fails; delete the generated `.next/dev` folder and rebuild.
- `tsc` alone fails on `LayoutProps` → always use `npm run typecheck` (runs `next typegen` first).
- Playwright 1.56.1 with Chromium in `/opt/pw-browsers`; never run `playwright install`.
- Machine has 4 CPUs / 15 GB → at most 2 heavy agents (dev server + build) at a time.
- Never `pkill -f "<pattern>"` from the Bash tool: the tool's own shell command line contains the pattern, so it kills itself (exit 144). Find the PID (`ps -eo pid,args`) and `kill <pid>`.
- `NEXT_PUBLIC_*` values are inlined when `next dev` compiles, and two dev servers in one checkout share `.next/dev` → to test another value (e.g. `NEXT_PUBLIC_MEDIA_API_URL`), stop the server, delete `.next/dev` and start it again with the new env.

Long-running agent work
- **Usage limits interrupt agents mid-task** (happened 4 times). Commit WIP early and often (checkpoint commits on the feature branch), keep each agent's scope small, and on resume give the agent a "RESUME MODE" note: worktree path, branch, what is done, what is left. Never assume uncommitted work survives.
- Workflow-created worktrees start from `origin/main`, not from the working branch → first `git checkout -B <branch> <base-sha>`.
- The Workflow tool only accepts a `scriptPath` it returned or a file under the current working directory; keep a backup copy of edited scripts.

Supabase
- `apply_migration` (MCP) records a wall-clock version → rename it to match the file timestamp (`supabase migration repair` equivalent); keep repo files byte-identical to what was applied.
- A plain `delete from` inside a migration makes the MCP hang waiting for a confirmation → use a data-modifying CTE (`with gone as (delete … returning 1) select …`).
- Users created by SQL need rows in **both** `auth.users` and `auth.identities`, with token columns `''` (not NULL), or GoTrue refuses the sign-in.
- Default Supabase SMTP only emails project team members → sign-up confirmation fails for real users until Brevo SMTP is configured. Google OAuth is not configured yet (UI shows a friendly toast).
- `redeem_invite_code` returns `{ ok:false, error_code }` instead of raising (the failed-attempt row must persist for rate limiting) → handle with `errorFromRpcResult`.
- Since `20261023090000_plan_lock.sql` the database refuses WBS/calendar edits on Completed/Cancelled projects (FORBIDDEN from `private.assert_plan_open`, called by `private.lock_wbs` and `private.get_managed_activity`). New WBS/calendar RPCs must call one of them after their permission check; keep the UI lock and `planLockFor` for the friendly message.
- Running a `supabase/tests/*.sql` file through MCP `execute_sql`: replace the final `select … passed; rollback;` with `do $$ begin raise exception 'ROLLBACK-SENTINEL: all assertions passed'; end $$;` — the error proves every assertion ran and forces the rollback. Inside tests, `activities` RLS hides soft-deleted rows: read the trash through `activity_trash()`.
- Demo password lives only in `.env.local` (`DEMO_PASSWORD`); seed files read it via `current_setting('civpms.demo_password')`. Never write it into a file or report.

Code
- **Controlled inputs lose text typed before hydration.** Use `register()` (uncontrolled) or `defaultValue` for form fields; the shared `FormField` (`Controller`) needs a register-based variant.
- `tailwind-merge` drops custom `text-h1…text-caption` utilities unless registered (done in `cn()` — keep it that way when adding new type utilities).
- `#0866FF` fails AA as small text on `primary-soft` and on black → use the `primary-text` token for blue text/links; `#0866FF` only for fills.
- Realtime: a row created between server render and subscription is lost → subscribe with `wait` and catch up once on every (re)subscribe, de-duplicating by id (see the notification bell).
- In development Next logs Server Action arguments (passwords included) unless `logging.serverFunctions: false` in `next.config.ts` — keep it off. Still, never paste dev logs anywhere public.
- Never hard-code demo data assumptions in e2e specs without tagging test records (`[F3] …`); the database is shared by all agents.
- Shared e2e account pools (`f1-pool-*`) are used by every container, but the "used" list (`test-results/.f1-pool.json`) is per container → a pool account can be half-onboarded by another run. `claimFreshAccount()` skips accounts with a saved role; do the same for any new pool.
