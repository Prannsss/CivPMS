# Decisions log

Decisions that refine, extend or override `SPEC.md` (Draft v0.2). Newest first within each group. "Spec §" points to the section being refined.

## Platform

| # | Decision | Why |
|---|---|---|
| D1 | Deploy plain **Next.js on Vercel** (owner deploys manually). No OpenNext/Cloudflare adapter. Cloudflare may still front the domain for DNS/CDN later. | Owner decision 2026-10-12. Removes Workers limits (3 MB bundle, no `sharp`, no Puppeteer). |
| D2 | Supabase Cloud project **CivPMS** in `ap-southeast-1` (Singapore). | Owner decision; nearest region to PH (spec §18.7, Q8 partially answered). |
| D3 | Supabase **publishable/secret keys** instead of legacy anon/service-role env names. | Current Supabase recommendation; independent rotation. |
| D4 | Product name **CivPMS**, brand blue **#0866FF**, Poppins, black/white backgrounds. | Owner decision (answers Q16 except final logo, which is `public/logo.svg`). |
| D5 | **Dark mode ships in v1** (light/dark/system). | Owner decision; overrides spec §17.1 "light only". Brand blue fails AA as small text on black, so dark mode uses `#4C8DFF` for blue text/links and keeps `#0866FF` for filled buttons. |
| D6 | `cacheComponents` disabled. | Almost every screen is per-user and dynamic; Suspense streaming + skeletons still apply. |
| D7 | **Offline mode is out of scope**: no service worker caching, offline queue or background sync. Field forms instead keep what was typed (including picked photos) when a save fails, autosave a local draft, and every save is retry-safe (`client_id`). An installable "Add to Home screen" icon is kept (web manifest + icons only, roadmap P3-25). | Owner decision 2026-10-28. Removes about 14.5 agent-days and the riskiest technology from Phase 4; spec §13 offline items and the §17.2 "offline queue" line are dropped (confirm with the client). See `docs/ROADMAP.md`. |

## Onboarding & membership

| # | Decision | Why |
|---|---|---|
| D10 | Sign-up form collects only email + password (+ Google). Name, role and company/invite code move to **onboarding**. | Mockups 3–5. Also gives Google sign-ups the same path. |
| D11 | **Invite codes** (new): PMs create company-wide or project-specific codes for inspectors. Format `XXXX-XXXX` (Crockford base32, ~40 bits), optional expiry and max uses, revocable, redemption limited to 10 failed attempts per user per hour. Codes are stored readable (PMs can copy them again) but only visible to PMs via RLS. | Mockup 5: "If Inspector, must have an Invite Code per project or for the whole company". |
| D12 | Inspectors without a code or invitation finish onboarding in the spec's "No company yet" state, where code entry and pending invitations stay available. | Reconciles mockup 5 ("must have a code") with spec §4.3 (inspector can sign up without a company) without creating a dead end. |
| D13 | One company per user applies to PMs and inspectors alike (`company_members.user_id` unique). | Spec §18.2 data model; flagged to the client because a consultant PM cannot serve two companies. |
| D14 | Company creation is open to anyone onboarding as PM (no admin approval yet). | Spec Q15 still open; easy to gate later behind a Platform Admin. |

## Scheduling & WBS

| # | Decision | Why |
|---|---|---|
| D20 | Durations are stored in working hours. A leaf's end date is the working day on which its last working hour falls (ceil to whole days), e.g. 12 h at 8 h/day starting Monday ends Tuesday. Zero duration = milestone (end = start). | Spec §6.2–6.3 store hours but schedule in dates; the spec did not say how partial days round. |
| D21 | When a leaf gains its first child, its own cost/hours/dates stop counting (parents always derive from leaves). The UI warns and offers to carry the values to the new child. | Spec §6.1–6.2 leave this case undefined. |
| D22 | WBS depth is fixed at 3 (Deliverable → Sub-deliverable → Work Package); moves that would exceed depth 3 are rejected. | Spec §6.1. |
| D23 | Rollups (dates, hours, cost, weighted %) are computed by the pure TS module `src/lib/domain`; the database stores leaf values only. A SQL view mirrors the budget/progress totals for list screens, with tests to keep both in sync. | Spec §18.4. |

## Visual design (improvements over the mockups)

| # | Decision | Why |
|---|---|---|
| D30 | Project card palette excludes red/orange/yellow (mockup 7 used red). | Red/orange/yellow are reserved for danger and warnings; a red card would read as "delayed". |
| D31 | Project cards add status, derived badges, progress and budget meter; the header shows the company name and logo (spec §4.2) alongside the welcome text. | Visual hierarchy: the home screen should answer "what needs attention?" at a glance. |
| D32 | The empty blue panel on auth screens carries the white logo mark, value proposition and feature highlights; it is hidden on small screens. | Mockups 3–4 left it as a placeholder. |
| D33 | Project sidebar keeps the blue identity in light mode; in dark mode it becomes a near-black surface with a blue active item. | A full-height saturated blue panel is harsh on a black page. |
| D34 | Optimized brand assets are generated from the owner's files (`public/brand/*`, `src/app/icon.png`, `src/app/apple-icon.png`, `src/app/favicon.ico`). The originals (`favicon.ico`, `public/logo.svg`, 420 KB with an embedded raster) are kept untouched. | Page weight. |

## Backend (media + cache service)

| # | Decision | Why |
|---|---|---|
| D40 | A separate **Rust** service in `backend/` (crate `civpms-media`), deployed by the owner to **Render** (Docker, Singapore). Scope is "media + cache" only: image uploads with ffmpeg compression, Redis-cached reads, an optional keep-alive pinger. All other reads/writes stay in the Next.js app talking to Supabase directly. | Owner decision 2026-10-15. ffmpeg and long uploads do not fit Vercel functions; keeping the service narrow keeps RLS the single security boundary. |
| D41 | The service holds **no Supabase secret key**. It verifies the caller's access token (ES256 via JWKS) and forwards that same token to PostgREST and Storage; it refuses `sb_secret_…`/`service_role` keys at startup. | RLS and Storage policies apply exactly as in the app; a compromised service cannot exceed the caller's rights. |
| D42 | Uploads are re-encoded to **WebP** (avatars 256×256 center crop q82; photos ≤ 1600 px q80 + 400 px thumbnail q75), EXIF orientation applied by the service, all metadata (incl. GPS) stripped, object names generated server-side. | Spec §12.4; small files on site connections; privacy. |
| D43 | New private bucket **`project-media`** (WebP only, 3 MB/object), layout `<project_id>/<yyyy>/<mm>/<uuid>[_thumb].webp`. SELECT/INSERT for anyone who can view the project (incl. inspectors), DELETE only for project managers, no UPDATE (immutable objects). Reads via short-lived signed URLs (10 min). | Inspectors must upload photos (Phase 3); managers clean up; names validated by policy as defence in depth. Migration `20261015100000`. |
| D44 | Upload idempotency: `client_id` per user, result replayed for **24 h**; concurrent duplicates wait for (or take over from) the first attempt; reusing a key for another project is `409`. | Spec §13 offline queue retries must not create duplicates. |
| D45 | Cached reads (`/v1/projects`, `/v1/projects/{id}/summary` per user 30 s; `/v1/holidays` shared 24 h) serve **stale data for up to 10 min** (holidays 7 days) when Supabase fails, marked `x-cache: STALE`; Redis down → in-memory fallback, service keeps serving. | Owner goal: the API keeps working when Supabase is slow/down; staleness is explicit, never silent. |
| D46 | **Keep-alive is opt-in (`KEEPALIVE_ENABLED=false` by default and in `render.yaml`)**. The feature stays implemented and tested. | Owner decision 2026-10-15: Render free plan, and the 750 free instance-hours/month are shared with the owner's other free services; one never-sleeping service uses ~744 h. |
| D47 | HEIC is accepted only where ffmpeg ≥ 7.1 can demux it (the Debian trixie image); tiled HEIF/AVIF (most iPhone photos) are refused with a clear `415` instead of storing one tile. | Never store a wrong image silently; browsers usually convert HEIC to JPEG on upload anyway. |
| D48 | Objects in `project-media` (and `avatars`) are **untrusted input**: project members can also write any ≤ 3 MB bytes under a valid generated name with the Storage API and their own session, so the pipeline's guarantees (re-encoded WebP, no metadata, `_thumb` twin) hold only for objects the service wrote. Consumers show them only via `<img>` from signed URLs (no `next/image` optimization or other server-side decoding), re-validate before any server-side use, list photos from database rows, and tolerate a missing thumbnail. | Keeping INSERT on the caller's token keeps D41 (no secret key in the service). A privileged service-only upload path is the upgrade if Phase 3 needs the guarantees (`backend/README.md` → Security model). |
| D49 | Upload admission in the media service: **one upload per user at a time** per instance, at most `MAX_CONCURRENT_UPLOADS` (default 4 × `FFMPEG_CONCURRENCY`, at least 8) in progress (extra → `503 BUSY` before the body is read), and every second an upload holds an ffmpeg slot costs one more unit of the per-user upload budget. | Review finding: one account could keep the free instance's single ffmpeg slot busy and lock everyone else out of uploads. |

## Deferred (not in Phase 0–1)

Platform Admin role (A26), retention purge job (spec §19), web push, PWA/offline, sharing/viewers, global search, import/export, Gantt, dependencies, CPM, baselines UI, progress updates, inspections, S-curve.
