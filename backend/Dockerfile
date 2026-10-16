# syntax=docker/dockerfile:1
#
# CivPMS media + cache service.
# Build context: this directory (render.yaml → dockerContext ./backend).
#
#   docker build -t civpms-media backend/
#   docker run --rm -p 8080:8080 --env-file backend/.env civpms-media
#
# Base images are pinned by tag *and* digest (multi-arch index digests, checked against
# Docker Hub on 2026-10-15). Bump both together.

ARG RUST_IMAGE=rust:1.97.0-slim-trixie@sha256:686a437ead83701e8f871e66e838c3ec55f46b5fc235b025756396ac823bdc51
ARG RUNTIME_IMAGE=debian:trixie-20261005-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM ${RUST_IMAGE} AS build
WORKDIR /build
ENV CARGO_TERM_COLOR=never \
    CARGO_INCREMENTAL=0

# 1) Dependencies only, so this layer is cached until Cargo.toml/Cargo.lock change.
#    rust-toolchain.toml is deliberately not copied: the image already is Rust 1.97.0, and the
#    file would make rustup download clippy/rustfmt, which a release build does not need.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src \
 && echo 'fn main() {}' > src/main.rs \
 && touch src/lib.rs \
 && cargo build --release --locked \
 && rm -rf src target/release/civpms-media* target/release/.fingerprint/civpms-media-* \
           target/release/deps/civpms_media-* target/release/deps/libcivpms_media-*

# 2) The service itself.
COPY src ./src
RUN cargo build --release --locked --bin civpms-media \
 && ./target/release/civpms-media --version

# ---------------------------------------------------------------------------
# Runtime stage: Debian slim + ffmpeg (libwebp, dav1d, HEVC) + CA roots + tini
# ---------------------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libwebp \
 && groupadd --system --gid 10001 civpms \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent \
            --shell /usr/sbin/nologin civpms

COPY --from=build /build/target/release/civpms-media /usr/local/bin/civpms-media

# Non-root; writes only to /tmp (per-request temp dirs, always removed).
USER 10001:10001
WORKDIR /tmp
ENV PORT=8080 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    RUST_LOG=info
EXPOSE 8080

# No Docker HEALTHCHECK: the slim image has no HTTP client, and Render probes
# `healthCheckPath: /healthz` itself.

# tini is PID 1: it forwards SIGTERM to the service (which drains in-flight requests and
# stops its ffmpeg children) and reaps any orphaned process.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/civpms-media"]
