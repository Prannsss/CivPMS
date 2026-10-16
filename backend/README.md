# civpms-media — media + cache service

A small Rust service that sits next to the CivPMS web app (Next.js on Vercel) and does two
jobs the app should not do inside a serverless function:

1. **Image uploads**: avatars and project photos are validated, decoded with **ffmpeg**,
   turned upright, resized, stripped of all metadata (GPS!) and stored as compact **WebP**
   in Supabase Storage.
2. **Resilient reads**: a few hot, read-only endpoints are served through a **Redis cache**
   that keeps answering (with stale data, clearly marked) when Supabase is slow or down.

Everything else (all writes, RPCs, auth) stays in the web app talking to Supabase directly.
Row Level Security remains the security boundary: this service holds **no Supabase secret
key** and forwards the caller's own access token on every upstream call.

- Crate: `civpms-media` (Rust 1.97, edition 2024, axum 0.8, tokio)
- Deployed by the owner to **Render** (Docker, Singapore) with a Render **Key Value** (Redis)
- Spec references: §12.4 (image handling), §13 (idempotent `client_id`s)

---

## Architecture

```
 browser (Next.js app) ──Bearer <Supabase access token>──▶ civpms-media (Render, Docker)
                                                           │
   ┌───────────────────────────────────────────────────────┤
   │ tower middleware: request id → JSON trace log → CORS allow-list → security headers
   │                   → error envelope → activity tracker (keep-alive) → catch-panic
   │ per route group: timeout (uploads 60 s, reads 10 s) + body limit
   │
   ├─ auth/      ES256 JWT verified locally against the project's JWKS
   │             (memory + Redis copy, 10 min TTL, single-flight refresh on unknown kid)
   ├─ ratelimit  per user, sliding window; Redis (shared) or in-memory fallback
   ├─ media/     sniff magic bytes → header dimensions (bomb guard 1) → ffmpeg semaphore
   │             → ffprobe -max_pixels (bomb guard 2) → EXIF orientation → one ffmpeg run
   │             → WebP outputs verified → per-request temp dir always deleted
   ├─ idempotency  (user, client_id) → pending marker / stored result for 24 h
   ├─ cache/     cache-aside: Redis → in-memory LRU mirror; stale-while-revalidate,
   │             stale-on-error (≤ 10 min), single-flight per key
   ├─ circuit    breaker around Supabase reads (5 failures → open 15 s → one probe)
   └─ supabase.rs  PostgREST + Storage client: apikey = publishable key,
                   Authorization = the caller's token (RLS + Storage policies apply)
                                                           │
                                                           ▼
                                  Supabase (Postgres + RLS, Storage, Auth JWKS)
   keepalive (opt-in): GETs its own public /healthz after 14 min without traffic
```

Source layout: `src/main.rs` (thin entry point), `src/lib.rs` (`build_app(state)` used by the
tests, `run(config)`), `config.rs`, `error.rs`, `state.rs`, `auth/`, `supabase.rs`, `media/`
(`sniff`, `exif`, `transcode`, `tools`, `capabilities`), `cache/` (`memory`, `singleflight`),
`circuit.rs`, `ratelimit.rs`, `idempotency.rs`, `keepalive.rs`, `redis_client.rs`,
`routes/` (`health`, `media`, `reads`), `telemetry.rs`, `clock.rs` (injectable clock).

---

## API

All `/v1/*` routes need `Authorization: Bearer <Supabase access token>` (the session's
`access_token`; anonymous sessions are refused). Responses to them carry
`Cache-Control: private, no-store`. Every response carries `x-request-id` (a client-sent
plain id is kept, anything else is replaced).

Errors always look like this, and clients switch on `code`, never on `message`:

```json
{ "error": { "code": "IMAGE_TOO_LARGE", "message": "The image is 12000×9000 pixels; the limit is 50 megapixels. Resize it and try again.", "request_id": "0b6c2c1e-…" } }
```

| Code | HTTP | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | missing/invalid/expired token, wrong issuer/audience, unknown signing key |
| `FORBIDDEN` | 403 | Storage policy refused the write |
| `NOT_FOUND` | 404 | project not visible to the caller, unknown object, unknown route |
| `METHOD_NOT_ALLOWED` | 405 | |
| `CONFLICT` | 409 | `client_id` reused for another project; duplicate still processing after 10 s |
| `PAYLOAD_TOO_LARGE` | 413 | file over `MAX_UPLOAD_MB` |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | not JPEG/PNG/WebP/GIF/HEIC/AVIF by magic bytes; HEIC on an ffmpeg without HEIF support; tiled HEIF/AVIF |
| `IMAGE_TOO_LARGE` | 422 | more than `MAX_IMAGE_PIXELS` (checked before decoding) |
| `PROCESSING_FAILED` | 422 | damaged image, ffmpeg error or timeout |
| `VALIDATION` | 422 | bad form fields / query parameters |
| `RATE_LIMITED` | 429 | per-user budget exhausted (`Retry-After` set) |
| `BUSY` | 503 | no ffmpeg slot free within `FFMPEG_QUEUE_TIMEOUT_SECS` (`Retry-After: 5`) |
| `UPSTREAM_UNAVAILABLE` | 503 | Supabase down and nothing cached (`Retry-After: 5`) |
| `TIMEOUT` | 504 | request exceeded 60 s (uploads) / 10 s (reads) |
| `INTERNAL` | 500 | bug; details are logged under the `request_id` |

### Endpoints

| Method & path | Auth | Rate class | What it does |
|---|---|---|---|
| `GET /healthz` | – | – | Liveness. No dependencies are checked (Render's health check). |
| `GET /readyz` | – | – | Readiness: Redis ping, ffmpeg/ffprobe + decoders (incl. HEIC/AVIF), orientation self-test, JWKS loaded, circuit state. `503` with the same JSON when not ready. |
| `POST /v1/media/avatar` | ✓ | upload 30/min | multipart `file` → 256×256 center-cropped WebP (q82) at `avatars/<uid>/<uuid>.webp`. **201** `{url, path, width, height, bytes, content_type}` |
| `POST /v1/media/images` | ✓ | upload 30/min | multipart `file`, `project_id` (uuid), optional `client_id`, optional `kind`. Photo ≤ 1600 px (q80) + thumbnail ≤ 400 px (q75) at `project-media/<project_id>/<yyyy>/<mm>/<uuid>.webp` and `…_thumb.webp`. **201** (or **200** + `idempotent-replayed: true` on replay) |
| `GET /v1/media/signed-url?path=` | ✓ | read 120/min | Fresh signed URL (10 min) for a project image path; cached per user + path until 1 min before expiry (`x-cache`). |
| `GET /v1/projects` | ✓ | read 120/min | The caller's `project_overview` rows (newest first). Per-user cache, 30 s. |
| `GET /v1/projects/{id}/summary` | ✓ | read 120/min | One `project_overview` row. Per-user cache, 30 s. |
| `GET /v1/holidays?year=YYYY` | ✓ | read 120/min | Philippine holidays (`date`, `name`, `type`). Shared cache, 24 h. |

Cached reads set `x-cache: HIT | MISS | STALE | BYPASS` and `Age`. Send
`Cache-Control: no-cache` to bypass the cache (e.g. right after a mutation); the fresh value is
stored and a failing upstream still falls back to the stale copy.

#### Examples

```bash
TOKEN=…   # supabase.auth.getSession() → session.access_token
API=https://civpms-media.onrender.com

# Avatar
curl -sS -H "Authorization: Bearer $TOKEN" -F "file=@me.jpg" "$API/v1/media/avatar"
# {"url":"https://<ref>.supabase.co/storage/v1/object/public/avatars/<uid>/<uuid>.webp",
#  "path":"<uid>/<uuid>.webp","width":256,"height":256,"bytes":6648,"content_type":"image/webp"}

# Project photo, idempotent (safe to retry from an offline queue)
curl -sS -H "Authorization: Bearer $TOKEN" \
  -F "project_id=7e2b4031-2374-4e0f-b7a7-0bef9f629bd1" -F "client_id=$(uuidgen)" -F "kind=progress" \
  -F "file=@site.jpg" "$API/v1/media/images"
# {"project_id":"7e2b…","path":"7e2b…/2026/10/<uuid>.webp","thumb_path":"7e2b…/2026/10/<uuid>_thumb.webp",
#  "width":1600,"height":1200,"bytes":359220,"thumb_width":400,"thumb_height":300,"thumb_bytes":3594,
#  "content_type":"image/webp","kind":"progress","client_id":"…","captured_at":"2026-10-15T02:55:01Z",
#  "signed_url":"https://…/storage/v1/object/sign/project-media/…?token=…",
#  "thumb_signed_url":"…","signed_url_expires_at":"2026-10-15T03:05:01Z"}

# Later: a new signed URL for a stored path
curl -sS -H "Authorization: Bearer $TOKEN" "$API/v1/media/signed-url?path=7e2b…/2026/10/<uuid>.webp"

# Cached reads
curl -sS -i -H "Authorization: Bearer $TOKEN" "$API/v1/projects" | grep -i '^x-cache'
curl -sS -H "Authorization: Bearer $TOKEN" "$API/v1/holidays?year=2026"
```

**Idempotency (spec §13).** `client_id` (form field, or the `Idempotency-Key` /
`x-client-id` header; 8–128 chars of `[A-Za-z0-9_.:-]`, a UUID works) makes uploads safe to
retry: the same user + `client_id` within 24 h gets the stored result (`200`,
`idempotent-replayed: true`, fresh signed URLs) instead of a second upload. A duplicate that
arrives while the first is still running waits for it (up to 10 s) and replays its result; if
the first attempt fails, the duplicate takes over. Reusing a `client_id` for another project
is a `409`.

---

## Configuration

12-factor: everything comes from environment variables, validated at startup. All problems
are reported at once and the process exits with status 2:

```
invalid configuration:
  - SUPABASE_URL is required
  - APP_ORIGINS must list exact origins; wildcards are not allowed
```

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | Render sets it. |
| `SUPABASE_URL` | – (required) | `https://<ref>.supabase.co` (http only for loopback). JWT issuer = `${SUPABASE_URL}/auth/v1`. |
| `SUPABASE_PUBLISHABLE_KEY` | – (required) | `sb_publishable_…` (or legacy anon JWT). `sb_secret_…` and legacy `service_role` keys are **refused**. |
| `APP_ORIGINS` | – (required) | Comma-separated exact origins for CORS, e.g. `https://civpms.vercel.app,http://localhost:3000`. No `*`. |
| `REDIS_URL` | unset | `redis://[user:pass@]host:port` (Render Key Value internal URL). Unset/down → in-memory cache and rate limits (degraded, per instance). `rediss://` is not supported by this build. |
| `MAX_UPLOAD_MB` | `15` | 1–100. |
| `MAX_IMAGE_PIXELS` | `50000000` | Decompression-bomb limit (width × height). |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Resolved on `PATH` once at startup (children run with an empty environment). |
| `FFMPEG_CONCURRENCY` | CPU cores (cgroup-aware), min 1 | Parallel ffmpeg runs. Use `1` on 512 MB instances. |
| `FFMPEG_TIMEOUT_SECS` | `30` | Per ffmpeg/ffprobe run; the child is killed and reaped. |
| `FFMPEG_QUEUE_TIMEOUT_SECS` | `20` | Wait for a free slot before `503 BUSY`. |
| `AVATAR_BUCKET` / `MEDIA_BUCKET` | `avatars` / `project-media` | |
| `SIGNED_URL_TTL_SECS` | `600` | Lifetime of signed URLs (60–3600). |
| `KEEPALIVE_ENABLED` | **`false`** | Opt-in self-ping; see [Keep-alive](#keep-alive). |
| `KEEPALIVE_URL` | `${RENDER_EXTERNAL_URL}/healthz` | Required when enabled outside Render. |
| `KEEPALIVE_IDLE_SECS` | `840` (14 min) | Ping after this long without inbound requests. |
| `CACHE_PROJECTS_TTL_SECS` / `CACHE_HOLIDAYS_TTL_SECS` / `CACHE_STALE_MAX_SECS` | `30` / `86400` / `600` | Freshness and how long stale data may be served on errors (holidays: up to 7 days). |
| `RATE_LIMIT_UPLOADS_PER_MIN` / `RATE_LIMIT_READS_PER_MIN` | `30` / `120` | Per user. |
| `UPLOAD_REQUEST_TIMEOUT_SECS` / `READ_REQUEST_TIMEOUT_SECS` | `60` / `10` | Whole-request deadlines. |
| `UPSTREAM_READ_TIMEOUT_SECS` / `UPSTREAM_WRITE_TIMEOUT_SECS` | `4` / `20` | Per Supabase attempt. Reads retry twice with full jitter; writes never retry. |
| `SHUTDOWN_GRACE_SECS` | `25` | Drain time after SIGTERM. |
| `LOG_FORMAT` | `json` | `json` (Render) or `pretty` (local). |
| `RUST_LOG` | `info` | e.g. `info,civpms_media=debug`. |

The startup log line prints a one-line config summary with credentials redacted.

---

## Run locally

Requirements: Rust 1.97 (pinned by `rust-toolchain.toml`), ffmpeg + ffprobe, optionally
`redis-server`.

```bash
cd backend
cp .env.example .env            # fill SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
redis-server --port 6379 --save "" &
set -a; . ./.env; set +a
cargo run --release
curl -s localhost:8080/healthz; curl -s localhost:8080/readyz | jq .
```

Docker (no Docker daemon was available while this was written; the Dockerfile's dependency
layer and release build were reproduced locally step by step):

```bash
docker build -t civpms-media backend/
docker run --rm -p 8080:8080 --env-file backend/.env civpms-media
```

## Tests

```bash
cd backend
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test                      # unit + integration, no network needed
scripts/smoke-live.sh           # LIVE: real Supabase + local Redis (see below)
```

- **Unit tests** (in `src/`): config validation, JWT verification (wrong issuer/audience,
  expired, `nbf`, unknown kid, `alg: none`, HS256 key confusion, tampered payload, anonymous
  and non-`authenticated` roles), JWKS parsing, rate-limit window maths, cache
  (stale-on-error, stale-while-revalidate, bypass, single-flight), circuit breaker (incl. a
  cancelled half-open probe), keep-alive decisions with an injectable clock, ffmpeg/ffprobe
  argument hardening, magic-byte sniffing and header dimensions, EXIF parsing, killing and
  reaping timed-out children, idempotency store.
- **Integration tests** (`tests/api.rs`, `tests/keepalive.rs`): the full router from
  `build_app` against **wiremock** playing Supabase (JWKS, PostgREST, Storage) and a **real
  `redis-server`** on a random port (tests print `SKIPPED (redis part)` if it is missing).
  Images are generated with the local ffmpeg: JPEG/PNG/WebP/GIF/AVIF, a JPEG tagged with
  EXIF orientation 6 (+ a fake GPS marker), headers claiming 100 000 × 80 000 pixels, a text
  file renamed `.jpg`, a truncated PNG. They check WebP output, dimensions, metadata removal
  (ffprobe + RIFF chunk list), thumbnails, idempotent replay incl. concurrent duplicates, auth
  failures, CORS preflight, `/readyz` with Redis down, STALE reads while PostgREST returns
  503, the circuit opening, 429s, `503 BUSY`, and the keep-alive loop.
- **Live smoke** (`scripts/smoke-live.sh`): signs in `owner@civpms.test` with the GoTrue
  password grant (`DEMO_PASSWORD` is read from the repo's `.env.local` at runtime and never
  printed), starts a throwaway Redis and the release binary, uploads an avatar and a photo
  for "Cebu Coastal Road Widening", replays it, fetches signed URLs, downloads the stored
  objects, checks they are small WebP files without metadata and that the log never contains
  the token, then deletes everything it uploaded with the same user's token.

CI: `.github/workflows/backend.yml` runs fmt, clippy (`-D warnings`), tests (with ffmpeg and
redis-server installed) and a release build on every change under `backend/`.

---

## Deploy on Render

The Blueprint is `render.yaml` at the repository root: web service **civpms-media**
(Docker, `./backend/Dockerfile`, context `./backend`, Singapore, free plan, health check
`/healthz`, auto-deploy **off**) and Key Value **civpms-cache** (free, Singapore,
`allkeys-lru`, no external access).

1. **Database first.** Make sure migration `supabase/migrations/20261015100000_project_media_bucket.sql`
   is applied (it is on project `bxfohhwvzbvmyokcsmwq`): it creates the private
   `project-media` bucket and its Storage policies. Without it project uploads fail with 403/404.
2. Render Dashboard → **New → Blueprint** → connect the GitHub repo → branch → Render reads
   `render.yaml` and shows both resources.
3. Fill the variables marked `sync: false`:
   - `SUPABASE_PUBLISHABLE_KEY` = the project's **publishable** key (Supabase → Project
     Settings → API Keys). Never the secret key: the service refuses it.
   - `APP_ORIGINS` = the web app's exact origins, comma separated, e.g.
     `https://civpms.vercel.app,https://www.example.ph` (add `http://localhost:3000` only if you
     want local development to call the deployed service).
4. **Apply.** Render creates the Key Value first and wires `REDIS_URL` to its internal
   connection string (`fromService … property: connectionString`), then builds the Docker
   image (first build ≈ 5–10 min; later builds reuse the dependency layer while
   `Cargo.toml`/`Cargo.lock` are unchanged).
5. Check: `https://civpms-media.onrender.com/healthz` → `{"status":"ok"}` and
   `/readyz` → `"status":"ready"` with `redis.status = up`, `jwks.status = loaded`,
   `media.orientation_selftest = passed`. If the self-test says `failed`, do not use the
   service for photos and open an issue (it means the installed ffmpeg rotates differently).
6. **Vercel:** add `NEXT_PUBLIC_MEDIA_API_URL=https://civpms-media.onrender.com` (no trailing
   slash) to the web app's environment and redeploy.
7. Deploys are manual: Dashboard → civpms-media → **Manual Deploy → Deploy latest commit**
   (or set `autoDeployTrigger: commit` in `render.yaml`; `buildFilter` already limits builds to
   `backend/**`).

Free-plan facts to keep in mind: the web service has 512 MB RAM and a fraction of a CPU
(hence `FFMPEG_CONCURRENCY=1`; a 12 MP photo needs ≈ 0.7 s of CPU, so expect several seconds
there, and very large images can approach `FFMPEG_TIMEOUT_SECS`), it **sleeps after 15 minutes
without inbound traffic** (the next request waits for a cold start of ~30–60 s), and the free
Key Value has 25 MB and no persistence (fine: it only holds caches, rate-limit counters and
24 h idempotency records; under memory pressure `allkeys-lru` evicts the oldest).

### How the web app uses it

`NEXT_PUBLIC_MEDIA_API_URL` is optional. When it is set, the profile page (F5) uploads the
avatar to `POST ${NEXT_PUBLIC_MEDIA_API_URL}/v1/media/avatar` with the signed-in user's
`Authorization: Bearer <access_token>` and saves the returned `url` with
`update_profile({ avatar_url })`. When it is unset, or the call fails with a network error,
`5xx` or `BUSY`, the page falls back to uploading the (unprocessed) file straight to the
`avatars` bucket with the Supabase client, as before. `4xx` answers (too large, not an
image) are shown to the user instead of falling back.

```ts
const { data: { session } } = await supabase.auth.getSession();
const form = new FormData();
form.append("file", file);
const res = await fetch(`${process.env.NEXT_PUBLIC_MEDIA_API_URL}/v1/media/avatar`, {
  method: "POST",
  headers: { Authorization: `Bearer ${session!.access_token}` },
  body: form,
});
if (res.ok) {
  const { url } = await res.json();          // public WebP URL
  await supabase.rpc("update_profile", { p_patch: { avatar_url: url } });
} else {
  const { error } = await res.json();         // { code, message, request_id }
}
```

Project photos (Phase 3: progress updates, inspections) use `POST /v1/media/images` with a
`client_id` per queued item, store `path`/`thumb_path` in the database, and ask
`/v1/media/signed-url` (or Supabase's `createSignedUrl`) for URLs when showing them.

---

## Keep-alive

**Decision: off by default (`KEEPALIVE_ENABLED=false`), and off in `render.yaml`.**

Render's free web services sleep after 15 minutes without inbound traffic. When enabled, a
background task records the time of the last inbound request (probe paths `/healthz` and
`/readyz` do not count), checks every 60 s, and after `KEEPALIVE_IDLE_SECS` (14 min, minus a
little jitter) without traffic GETs `KEEPALIVE_URL` (default `${RENDER_EXTERNAL_URL}/healthz`,
i.e. through Render's public edge, which counts as inbound traffic) with a 10 s timeout.
Failures are logged and retried at the next idle deadline; the task never panics and stops
on shutdown.

Why it is off: free instance-hours are **750 per month per workspace, shared by every free
service**. A service that never sleeps uses ~744 h (24 × 31) on its own, which would starve
the owner's other free services (they would be suspended for the rest of the month).

When turning it on makes sense:
- this is the **only** free web service in the workspace that needs to be awake, and a
  ~30–60 s cold start after idle periods is not acceptable; or
- you are on a paid plan (**Starter** and above never sleep): there the pinger is
  unnecessary, so leave it off.

To enable: set `KEEPALIVE_ENABLED=true` on the service (Render Dashboard → Environment) and
redeploy; the startup log says `keep-alive enabled`. Caveats: pings keep the instance warm but
do not make it faster or bigger; Render may still restart instances (deploys, maintenance);
the web app must tolerate a cold service anyway (it falls back to direct Supabase uploads).

---

## Image pipeline

1. The multipart file is streamed to a private per-request temp directory (never fully held
   in memory); size limited by `MAX_UPLOAD_MB`. The directory is removed when the request
   ends (success, error, timeout or client disconnect).
2. **Type by magic bytes**, never by file name or `Content-Type`: JPEG, PNG, WebP, GIF, HEIC,
   AVIF. SVG, PDF and everything else → `415`.
3. **Bomb guard 1**: width/height read from the container header (JPEG SOF, PNG IHDR, WebP
   VP8/VP8L/VP8X, GIF) before any decoder runs; over `MAX_IMAGE_PIXELS` → `422`.
4. An ffmpeg slot is taken (`FFMPEG_CONCURRENCY`; queue timeout → `503 BUSY`).
5. **Bomb guard 2**: `ffprobe -max_pixels` (decoder-level limit; the only size source for
   HEIF/AVIF), which also picks the primary picture of HEIF/AVIF files.
6. **Orientation**: ffmpeg runs with `-noautorotate`; the EXIF orientation (JPEG APP1, PNG
   eXIf, WebP EXIF) is parsed by the service and applied with the matching
   `hflip`/`vflip`/`transpose` filter (all 8 values). HEIF/AVIF use their container rotation.
   At startup a 64×32 JPEG tagged "rotate 90°" is processed and must come out 32×64
   (`/readyz → orientation_selftest`).
7. **One ffmpeg run** decodes once and writes every output: Lanczos resize, `setsar=1`,
   libwebp (`-preset photo`), `-map_metadata -1` (EXIF, XMP, ICC, GPS dropped; tests assert
   no metadata chunks/tags remain). Hardening: `-nostdin`, `-protocol_whitelist file`, forced
   demuxer, `file:` URLs only, `-threads 1`, empty environment, hard timeout (child killed
   and reaped).
8. Outputs are re-checked (WebP magic + dimensions), then uploaded with `x-upsert: false`
   under names generated by the service (`<uuid>.webp`); nothing from the client ends up in a
   storage path except the validated project UUID and the user's own id.

Damaged JPEGs are decoded with error concealment (as browsers do); damaged PNG/WebP/GIF are
refused (`PROCESSING_FAILED`).

### HEIC caveat

iPhone photos are HEIC by default. ffmpeg only demuxes HEIF still images from **7.1** on, so
`/readyz` reports `formats.heic=false` on older builds (e.g. Ubuntu 24.04's 6.1) and uploads
get a clear `415` asking for a JPEG. The Docker image is Debian trixie, which ships ffmpeg 7.1,
so HEIC is enabled there. However, iPhone HEICs are usually **tiled grids** (e.g. 48 tiles of
512×512); decoding them needs ffmpeg's stream-group support, which this service does not use
yet. To never store a single tile by mistake, files with more than two pictures are refused
with `415` ("export it as JPEG"). In practice: browsers and the iOS share sheet convert HEIC to
JPEG on upload for `<input type="file" accept="image/*">`, so most uploads arrive as JPEG
anyway. AVIF (single image) works on both ffmpeg versions.

---

## Caching and resilience

| Situation | Behaviour |
|---|---|
| entry younger than TTL | `HIT` |
| TTL < age < TTL + min(TTL, 1 h) | `HIT`, refreshed in the background (stale-while-revalidate) |
| older / missing | fetched (`MISS`); concurrent misses for a key share one upstream call |
| upstream 5xx / timeout / circuit open | last good value as `STALE` while age < TTL + 10 min (holidays: 7 days); otherwise `503 UPSTREAM_UNAVAILABLE` |
| upstream 401/403/404 | passed through, never masked by stale data |
| Redis down | warning logged at most once per minute; in-memory LRU (10 000 entries) mirror and in-memory rate limiter take over; `/readyz` → 503, `/healthz` stays 200 |

Keys are per user for RLS-scoped data (`c:v1:projects:<uid>`, `c:v1:summary:<uid>:<id>`,
`c:v1:sign:<uid>:<path>`) and shared only for the public holiday list
(`c:v1:holidays:<year>`). Upstream reads use a 4 s per-attempt timeout and up to two retries
with full jitter (GETs only); uploads are never retried. A circuit breaker opens after 5
consecutive failures and probes again after 15 s. SIGTERM stops accepting connections, drains
in-flight requests for up to `SHUTDOWN_GRACE_SECS`, then exits; panics in handlers become a
`500` envelope instead of killing the connection.

## Security model

- **User-JWT pass-through.** The service verifies the Supabase access token itself (ES256
  against the project's JWKS: issuer `${SUPABASE_URL}/auth/v1`, audience `authenticated`,
  role `authenticated`, `exp`/`nbf` with 30 s leeway, `sub` must be a UUID, only asymmetric
  keys accepted) and then forwards **the same token** to PostgREST and Storage. RLS and the
  Storage policies decide what the caller may read or write, exactly as in the web app.
- **No secret key.** The only Supabase credential is the publishable key; secret and
  `service_role` keys are refused at startup. The service cannot do anything the user could
  not do with their own session.
- **Storage policies** (`20261015100000_project_media_bucket.sql`, tested by
  `supabase/tests/10_project_media_storage.sql`): `project-media` is private, WebP only, 3 MB
  per object. SELECT/INSERT for people who can view the project (Owner PM, project PMs,
  inspectors), names must match the generated pattern; DELETE only for managers (Owner PM,
  project PMs); no UPDATE. Avatars stay in the public `avatars` bucket under the user's own
  folder.
- **Inputs**: every field is validated (UUIDs, `kind` = short lowercase word, `client_id`
  charset, signed-URL paths must match the generated pattern exactly); unknown multipart
  fields are rejected; at most 8 fields.
- **HTTP**: CORS allow-list only (no wildcard), methods GET/POST/OPTIONS, headers
  `Authorization`, `Content-Type`, `Idempotency-Key`, `x-client-id` (+ `Cache-Control`,
  `x-request-id`); `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a `default-src 'none'` CSP, HSTS, `no-store` on `/v1/*`.
  Redirects from upstreams are never followed (they could carry the token elsewhere).
- **Logs** are JSON lines with request id, method, matched route, status, latency and a
  12-hex-character SHA-256 prefix of the user id. `Authorization`/`Cookie` are marked
  sensitive; tokens, file bytes and keys are never logged (the smoke test checks this).
- **Container**: non-root user (uid 10001), tini as PID 1, only ffmpeg + CA certificates
  installed, writes only to `/tmp`.
