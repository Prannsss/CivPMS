#!/usr/bin/env bash
# Live smoke test of the media + cache service against the real Supabase project.
#
#   backend/scripts/smoke-live.sh            # builds the release binary if needed
#
# What it does:
#   1. Signs in a demo user (default owner@civpms.test) with the GoTrue password grant.
#      DEMO_PASSWORD and the publishable key are read from the repo's .env.local at runtime and
#      are never printed or passed on a command line.
#   2. Starts a throwaway local redis-server (unless REDIS_URL is set) and the service.
#   3. Exercises /healthz, /readyz, cached reads, an avatar upload, a project image upload for
#      "Cebu Coastal Road Widening" (+ idempotent replay), signed URLs, and downloads the stored
#      objects to check they are small WebP files.
#   4. Deletes every object it uploaded through the Storage API with the same user's token, and
#      checks the service log never contains the access token.
#
# Requirements: curl, jq, ffmpeg/ffprobe, redis-server (or REDIS_URL), cargo (first run).
# Optional env: ENV_FILE, SMOKE_EMAIL, SMOKE_PROJECT, REDIS_URL, SERVICE_BIN.

set -euo pipefail
set +x # never trace: commands below handle credentials

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(dirname "$HERE")"
ROOT="$(dirname "$BACKEND")"
ENV_FILE="${ENV_FILE:-$ROOT/.env.local}"
if [[ ! -r "$ENV_FILE" ]]; then # inside a git worktree: use the main checkout's .env.local
  common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [[ -n "$common" && -r "$(dirname "$common")/.env.local" ]] && ENV_FILE="$(dirname "$common")/.env.local"
fi
EMAIL="${SMOKE_EMAIL:-owner@civpms.test}"
PROJECT_NAME="${SMOKE_PROJECT:-Cebu Coastal Road Widening}"
SERVICE_BIN="${SERVICE_BIN:-$BACKEND/target/release/civpms-media}"

for tool in curl jq ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done
[[ -r "$ENV_FILE" ]] || { echo "cannot read $ENV_FILE" >&2; exit 2; }

env_value() { # last KEY=value in .env.local, quotes stripped
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
SUPABASE_URL="$(env_value NEXT_PUBLIC_SUPABASE_URL)"
SUPABASE_URL="${SUPABASE_URL%/}"
PUBLISHABLE_KEY="$(env_value NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
[[ -n "$SUPABASE_URL" && -n "$PUBLISHABLE_KEY" ]] || { echo "Supabase URL/key missing in $ENV_FILE" >&2; exit 2; }

WORK="$(mktemp -d -t civpms-smoke.XXXXXX)"
chmod 700 "$WORK"
SERVICE_PID=""
REDIS_PID=""
CREATED_MEDIA=()
CREATED_AVATARS=()
FAILURES=0

say() { printf '%s\n' "$*"; }
ok() { printf '  \033[32mok\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILURES=$((FAILURES + 1)); }
check() { if eval "$1"; then ok "$2"; else fail "$2"; fi; }

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }

storage_delete() { # bucket, paths... (same user's JWT; Storage RLS decides)
  local bucket="$1"; shift
  [[ $# -gt 0 ]] || return 0
  jq -n '{prefixes: $ARGS.positional}' --args "$@" |
    curl -sS -X DELETE -H @"$WORK/auth.hdr" -H "apikey: $PUBLISHABLE_KEY" -H 'content-type: application/json' \
      --data @- "$SUPABASE_URL/storage/v1/object/$bucket"
}

cleanup() {
  local status=$?
  if [[ -s "$WORK/auth.hdr" ]]; then
    if [[ ${#CREATED_MEDIA[@]} -gt 0 ]]; then
      removed=$(storage_delete project-media "${CREATED_MEDIA[@]}" | jq 'length' 2>/dev/null || echo "?")
      say "cleanup: removed $removed/${#CREATED_MEDIA[@]} project-media object(s)"
    fi
    if [[ ${#CREATED_AVATARS[@]} -gt 0 ]]; then
      removed=$(storage_delete avatars "${CREATED_AVATARS[@]}" | jq 'length' 2>/dev/null || echo "?")
      say "cleanup: removed $removed/${#CREATED_AVATARS[@]} avatar object(s)"
    fi
  fi
  [[ -n "$SERVICE_PID" ]] && kill -TERM "$SERVICE_PID" 2>/dev/null && wait "$SERVICE_PID" 2>/dev/null || true
  [[ -n "$REDIS_PID" ]] && kill "$REDIS_PID" 2>/dev/null && wait "$REDIS_PID" 2>/dev/null || true
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
say "== 1. Sign in $EMAIL (GoTrue password grant)"
DEMO_PASSWORD="$(env_value DEMO_PASSWORD)" EMAIL="$EMAIL" \
  jq -n '{email: env.EMAIL, password: env.DEMO_PASSWORD}' |
  curl -sS --fail-with-body -H "apikey: $PUBLISHABLE_KEY" -H 'content-type: application/json' \
    --data @- "$SUPABASE_URL/auth/v1/token?grant_type=password" > "$WORK/session.json" ||
  { echo "sign-in failed: $(jq -r '.msg // .error_description // .error // "?"' "$WORK/session.json")" >&2; exit 1; }
TOKEN="$(jq -r .access_token "$WORK/session.json")"
USER_ID="$(jq -r .user.id "$WORK/session.json")"
printf 'Authorization: Bearer %s\n' "$TOKEN" > "$WORK/auth.hdr"
ok "signed in (user ${USER_ID:0:8}…, token kept in a 0600 file, never printed)"

# ---------------------------------------------------------------------------
say "== 2. Start Redis and the service"
if [[ -z "${REDIS_URL:-}" ]]; then
  command -v redis-server >/dev/null || { echo "redis-server missing (or set REDIS_URL)" >&2; exit 2; }
  REDIS_PORT="$(free_port)"
  redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save "" --appendonly no --loglevel warning \
    > "$WORK/redis.log" 2>&1 &
  REDIS_PID=$!
  REDIS_URL="redis://127.0.0.1:$REDIS_PORT"
fi
if [[ ! -x "$SERVICE_BIN" ]]; then
  (cd "$BACKEND" && cargo build --release --locked)
fi
PORT="$(free_port)"
BASE="http://127.0.0.1:$PORT"
env PORT="$PORT" SUPABASE_URL="$SUPABASE_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" \
  REDIS_URL="$REDIS_URL" APP_ORIGINS="http://localhost:3000" LOG_FORMAT=json RUST_LOG=info \
  "$SERVICE_BIN" > "$WORK/service.log" 2>&1 &
SERVICE_PID=$!
for _ in $(seq 1 100); do
  curl -sf "$BASE/healthz" > /dev/null 2>&1 && break
  sleep 0.1
done
check '[[ "$(curl -s -o /dev/null -w "%{http_code}" "$BASE/healthz")" == 200 ]]' "GET /healthz → 200"

api() { # method path [curl args...] → body in $WORK/body, headers in $WORK/headers; prints "status seconds"
  local method="$1" path="$2"; shift 2
  curl -sS -X "$method" -H @"$WORK/auth.hdr" -D "$WORK/headers" -o "$WORK/body" \
    -w '%{http_code} %{time_total}\n' "$@" "$BASE$path"
}
header() { grep -i "^$1:" "$WORK/headers" | tail -n 1 | cut -d' ' -f2- | tr -d '\r'; }
ms() { awk -v s="$1" 'BEGIN { printf "%.0f ms", s * 1000 }'; }

read -r status secs < <(api GET /readyz)
say "  /readyz → $status in $(ms "$secs"): $(jq -c '{status, redis: .checks.redis.status, jwks: .checks.jwks.status, ffmpeg: .checks.media.ffmpeg_version, heic: .checks.media.formats.heic, avif: .checks.media.formats.avif, selftest: .checks.media.orientation_selftest, uploads: .checks.uploads}' "$WORK/body")"
check '[[ "$status" == 200 ]]' "GET /readyz → 200 (Redis up, JWKS loaded, ffmpeg ready)"

# ---------------------------------------------------------------------------
say "== 3. Cached reads"
read -r status secs < <(api GET /v1/projects)
check '[[ "$status" == 200 && "$(header x-cache)" == MISS ]]' "GET /v1/projects → $status $(header x-cache) in $(ms "$secs")"
PROJECT_ID="$(jq -r --arg n "$PROJECT_NAME" '.[] | select(.name == $n) | .id' "$WORK/body" | head -n 1)"
read -r status secs < <(api GET /v1/projects)
check '[[ "$status" == 200 && "$(header x-cache)" == HIT ]]' "GET /v1/projects again → $status $(header x-cache) in $(ms "$secs")"
[[ -n "$PROJECT_ID" ]] || { echo "project '$PROJECT_NAME' not visible to $EMAIL" >&2; exit 1; }
read -r status secs < <(api GET "/v1/projects/$PROJECT_ID/summary")
check '[[ "$status" == 200 ]]' "GET /v1/projects/{id}/summary → $status $(header x-cache) in $(ms "$secs") ($(jq -r .name "$WORK/body"))"
read -r status secs < <(api GET "/v1/holidays?year=2026")
check '[[ "$status" == 200 ]]' "GET /v1/holidays?year=2026 → $status $(header x-cache) in $(ms "$secs") ($(jq length "$WORK/body") holidays)"

# ---------------------------------------------------------------------------
say "== 4. Uploads"
# Photo-like inputs: noisy test pattern so JPEG sizes resemble real camera files.
ffmpeg -hide_banner -loglevel error -nostdin -y -f lavfi -i "testsrc2=size=4032x3024:rate=1" \
  -vf "noise=alls=25:allf=t" -frames:v 1 -q:v 2 "$WORK/site-photo.jpg"
ffmpeg -hide_banner -loglevel error -nostdin -y -f lavfi -i "testsrc2=size=1080x1350:rate=1" \
  -vf "noise=alls=20:allf=t" -frames:v 1 -q:v 2 "$WORK/portrait.jpg"
size() { stat -c %s "$1"; }

read -r status secs < <(api POST /v1/media/avatar -F "file=@$WORK/portrait.jpg;type=image/jpeg")
AVATAR_PATH="$(jq -r '.path // empty' "$WORK/body")"
[[ -n "$AVATAR_PATH" ]] && CREATED_AVATARS+=("$AVATAR_PATH")
check '[[ "$status" == 201 && "$(jq -r .width "$WORK/body")x$(jq -r .height "$WORK/body")" == 256x256 ]]' \
  "POST /v1/media/avatar → $status in $(ms "$secs"): $(size "$WORK/portrait.jpg") B JPEG 1080×1350 → $(jq -r .bytes "$WORK/body") B WebP 256×256"
AVATAR_URL="$(jq -r '.url // empty' "$WORK/body")"
curl -sS -o "$WORK/avatar.webp" "$AVATAR_URL"
check '[[ "$(head -c 4 "$WORK/avatar.webp")" == RIFF && "$(ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$WORK/avatar.webp")" == webp ]]' \
  "public avatar URL serves the WebP ($(size "$WORK/avatar.webp") B)"

CLIENT_ID="smoke-$(date +%s)-$RANDOM"
read -r status secs < <(api POST /v1/media/images -F "project_id=$PROJECT_ID" -F "client_id=$CLIENT_ID" \
  -F "kind=progress" -F "file=@$WORK/site-photo.jpg;type=image/jpeg")
cp "$WORK/body" "$WORK/image.json"
IMAGE_PATH="$(jq -r '.path // empty' "$WORK/image.json")"
THUMB_PATH="$(jq -r '.thumb_path // empty' "$WORK/image.json")"
[[ -n "$IMAGE_PATH" ]] && CREATED_MEDIA+=("$IMAGE_PATH" "$THUMB_PATH")
check '[[ "$status" == 201 ]]' \
  "POST /v1/media/images → $status in $(ms "$secs"): $(size "$WORK/site-photo.jpg") B JPEG 4032×3024 → $(jq -r .bytes "$WORK/image.json") B WebP $(jq -r .width "$WORK/image.json")×$(jq -r .height "$WORK/image.json") + thumb $(jq -r .thumb_bytes "$WORK/image.json") B $(jq -r .thumb_width "$WORK/image.json")×$(jq -r .thumb_height "$WORK/image.json")"

read -r status secs < <(api POST /v1/media/images -F "project_id=$PROJECT_ID" -F "client_id=$CLIENT_ID" \
  -F "file=@$WORK/site-photo.jpg;type=image/jpeg")
check '[[ "$status" == 200 && "$(header idempotent-replayed)" == true && "$(jq -r .path "$WORK/body")" == "$IMAGE_PATH" ]]' \
  "same client_id again → $status replayed in $(ms "$secs") (no second upload)"

# ---------------------------------------------------------------------------
say "== 5. Signed URLs and stored objects"
read -r status secs < <(api GET "/v1/media/signed-url?path=$IMAGE_PATH")
SIGNED="$(jq -r '.signed_url // empty' "$WORK/body")"
check '[[ "$status" == 200 && "$(header x-cache)" == MISS && -n "$SIGNED" ]]' "GET /v1/media/signed-url → $status MISS in $(ms "$secs")"
read -r status secs < <(api GET "/v1/media/signed-url?path=$IMAGE_PATH")
check '[[ "$status" == 200 && "$(header x-cache)" == HIT ]]' "GET /v1/media/signed-url again → $status HIT in $(ms "$secs")"
dl_secs="$(curl -sS -o "$WORK/stored.webp" -w '%{time_total}' "$SIGNED")"
IFS=, read -r codec width height < <(ffprobe -v error -show_entries stream=codec_name,width,height -of csv=p=0 "$WORK/stored.webp")
check '[[ "$codec" == webp && "$(size "$WORK/stored.webp")" == "$(jq -r .bytes "$WORK/image.json")" && "$(size "$WORK/stored.webp")" -lt 3145728 ]]' \
  "signed URL downloads the stored object in $(ms "$dl_secs"): $codec ${width}×${height}, $(size "$WORK/stored.webp") B (< 3 MB bucket limit)"
check '[[ -z "$(ffprobe -v error -show_entries format_tags:stream_tags -of csv=p=0 "$WORK/stored.webp")" ]]' "stored object carries no metadata tags"
curl -sS -o "$WORK/thumb.webp" "$(jq -r .thumb_signed_url "$WORK/image.json")"
check '[[ "$(head -c 4 "$WORK/thumb.webp")" == RIFF ]]' "thumbnail downloads via its signed URL ($(size "$WORK/thumb.webp") B)"

# ---------------------------------------------------------------------------
say "== 6. Hygiene"
check '! grep -qF "$TOKEN" "$WORK/service.log"' "service log never contains the access token"
check '! grep -qF "$PUBLISHABLE_KEY" "$WORK/service.log"' "service log never contains the full API key"
say "  sample log line: $(grep '"image stored"\|project image stored' "$WORK/service.log" | tail -n 1 | jq -c '{level, message: .message, route: .span.route, status: .span.status, user: .span.user, input_bytes, output_bytes, processing_ms}' 2>/dev/null || true)"

say ""
if [[ "$FAILURES" -eq 0 ]]; then say "SMOKE PASSED"; else say "SMOKE FAILED ($FAILURES check(s))"; exit 1; fi
