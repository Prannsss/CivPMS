//! Image pipeline: sniff → header bomb guard (pixels and decoder memory) → ffprobe →
//! orientation → ffmpeg → verify.
//!
//! Input files live in a per-request temporary directory that is deleted when the request
//! ends (success, error, timeout or client disconnect). ffmpeg runs are limited by a
//! semaphore (`FFMPEG_CONCURRENCY`); a request that cannot get a slot within
//! `FFMPEG_QUEUE_TIMEOUT_SECS` gets `503 BUSY` instead of piling up.

pub mod capabilities;
pub mod exif;
pub mod sniff;
pub mod tools;
pub mod transcode;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use serde::Deserialize;
use tokio::io::AsyncReadExt;
use tokio::sync::Semaphore;

use crate::config::Config;
use crate::error::{AppError, ErrorCode};

use capabilities::Capabilities;
use sniff::ImageKind;
use transcode::{Job, Preset};

/// Bytes read from the start of a file for sniffing, header dimensions and EXIF.
const HEAD_BYTES: u64 = 1024 * 1024;

/// One encoded output.
#[derive(Debug, Clone)]
pub struct Encoded {
    pub bytes: Bytes,
    pub width: u32,
    pub height: u32,
}

/// Result of processing one upload.
#[derive(Debug, Clone)]
pub struct Processed {
    pub main: Encoded,
    pub thumb: Option<Encoded>,
    pub source_kind: ImageKind,
    pub source_width: u32,
    pub source_height: u32,
    pub orientation: Option<u16>,
    pub elapsed: Duration,
}

#[derive(Debug)]
pub struct MediaProcessor {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    semaphore: Arc<Semaphore>,
    timeout: Duration,
    queue_timeout: Duration,
    max_pixels: u64,
    max_decode_bytes: u64,
    capabilities: parking_lot::RwLock<Capabilities>,
    selftest: parking_lot::RwLock<SelfTest>,
}

/// Outcome of the startup orientation self-test.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelfTest {
    NotRun,
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct ProbeStream {
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub pix_fmt: Option<String>,
    #[serde(default)]
    pub disposition: Disposition,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
pub struct Disposition {
    /// 1 for the stream the container marks as the default (HEIF: the primary item).
    #[serde(default)]
    pub default: u8,
}

/// The picture to decode, chosen from the video streams ffprobe listed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Primary {
    /// Position among the input's video streams (`[0:v:N]`).
    pub stream: usize,
    pub width: u32,
    pub height: u32,
    pub pix_fmt: Option<String>,
}

/// Why no single picture could be chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickError {
    /// No decodable picture.
    Empty,
    /// A HEIF/AVIF "grid" (iPhone HEIC photos are 512×512 tiles): decoding one stream would
    /// silently produce a single tile, so it is refused instead.
    Tiled,
}

/// Picks the primary picture: the only stream, or the larger of a picture + its embedded
/// thumbnail. Equal sizes (e.g. a picture and its alpha plane) go to the stream marked
/// default, then to the first one. More than two pictures means a tiled image
/// ([`PickError::Tiled`]).
pub fn pick_primary(streams: &[ProbeStream]) -> Result<Primary, PickError> {
    let usable: Vec<(usize, &ProbeStream)> = streams
        .iter()
        .enumerate()
        .filter(|(_, s)| s.width > 0 && s.height > 0)
        .collect();
    if usable.len() > 2 {
        return Err(PickError::Tiled);
    }
    usable
        .into_iter()
        .max_by_key(|(index, s)| {
            (
                u64::from(s.width) * u64::from(s.height),
                s.disposition.default > 0,
                std::cmp::Reverse(*index),
            )
        })
        .map(|(stream, s)| Primary {
            stream,
            width: s.width,
            height: s.height,
            pix_fmt: s.pix_fmt.clone(),
        })
        .ok_or(PickError::Empty)
}

impl MediaProcessor {
    /// Resolves the tool paths (missing tools are reported by `/readyz`, not fatal).
    pub fn new(config: &Config) -> Self {
        let resolve = |p: &Path| tools::resolve_executable(p).unwrap_or_else(|| p.to_path_buf());
        Self {
            ffmpeg: resolve(&config.ffmpeg_path),
            ffprobe: resolve(&config.ffprobe_path),
            semaphore: Arc::new(Semaphore::new(config.ffmpeg_concurrency)),
            timeout: config.ffmpeg_timeout,
            queue_timeout: config.ffmpeg_queue_timeout,
            max_pixels: config.max_image_pixels,
            max_decode_bytes: config.max_decode_bytes,
            capabilities: parking_lot::RwLock::new(Capabilities::default()),
            selftest: parking_lot::RwLock::new(SelfTest::NotRun),
        }
    }

    pub fn capabilities(&self) -> Capabilities {
        self.capabilities.read().clone()
    }

    pub fn selftest(&self) -> SelfTest {
        *self.selftest.read()
    }

    /// Detects ffmpeg features and runs the orientation self-test. Call once at startup.
    pub async fn initialize(&self) {
        let caps = Capabilities::detect(&self.ffmpeg, &self.ffprobe).await;
        tracing::info!(
            ffmpeg = caps.ffmpeg_version.as_deref().unwrap_or("missing"),
            ffprobe = caps.ffprobe,
            webp_encoder = caps.webp_encoder,
            formats = ?caps.formats,
            "media capabilities"
        );
        let ready = caps.ready();
        *self.capabilities.write() = caps;
        let result = if ready {
            self.orientation_selftest().await
        } else {
            SelfTest::Skipped
        };
        if result == SelfTest::Failed {
            tracing::error!(
                "orientation self-test FAILED: rotated photos would be stored sideways"
            );
        }
        *self.selftest.write() = result;
    }

    /// Generates a 64×32 JPEG, tags it "rotate 90° clockwise" and checks the output is 32×64.
    async fn orientation_selftest(&self) -> SelfTest {
        let Ok(dir) = tempfile::tempdir() else {
            return SelfTest::Skipped;
        };
        let raw = dir.path().join("selftest-raw.jpg");
        let mut raw_arg = std::ffi::OsString::from("file:");
        raw_arg.push(raw.as_os_str());
        let args: Vec<std::ffi::OsString> = [
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=64x32:rate=1",
            "-frames:v",
            "1",
            "-f",
            "image2",
        ]
        .iter()
        .map(Into::into)
        .chain(std::iter::once(raw_arg))
        .collect();
        match tools::run(&self.ffmpeg, &args, self.timeout).await {
            Ok(out) if out.success => {}
            _ => return SelfTest::Skipped, // e.g. a build without lavfi
        }
        let Ok(jpeg) = tokio::fs::read(&raw).await else {
            return SelfTest::Skipped;
        };
        let Some(rotated) = exif::jpeg_with_orientation(&jpeg, 6) else {
            return SelfTest::Skipped;
        };
        let input = dir.path().join("selftest.jpg");
        if tokio::fs::write(&input, rotated).await.is_err() {
            return SelfTest::Skipped;
        }
        match self.process(&input, dir.path(), Preset::PHOTO).await {
            Ok(p) if (p.main.width, p.main.height) == (32, 64) => SelfTest::Passed,
            Ok(p) => {
                tracing::error!(
                    width = p.main.width,
                    height = p.main.height,
                    "unexpected self-test output size"
                );
                SelfTest::Failed
            }
            Err(e) => {
                tracing::error!(error = %e, "self-test processing failed");
                SelfTest::Failed
            }
        }
    }

    /// Processes the uploaded file at `input`; outputs are written into `work_dir`.
    pub async fn process(
        &self,
        input: &Path,
        work_dir: &Path,
        preset: Preset,
    ) -> Result<Processed, AppError> {
        if self.selftest() == SelfTest::Failed {
            // Rotated photos would be stored sideways: refuse instead of corrupting them.
            return Err(AppError::new(
                ErrorCode::MediaUnavailable,
                "Image processing is unavailable on this server. Try again later.",
            ));
        }
        let started = Instant::now();
        let head = read_head(input).await?;
        let kind = sniff::sniff(&head).ok_or_else(|| {
            AppError::new(
                ErrorCode::UnsupportedMediaType,
                "This file is not a supported image. Upload a JPEG, PNG, WebP or HEIC photo.",
            )
        })?;
        if !self.capabilities.read().supports(kind) {
            let message = if kind == ImageKind::Heif {
                "HEIC photos are not supported by this server yet. Export the photo as JPEG and try again."
            } else {
                "This image format is not supported by this server."
            };
            return Err(AppError::new(ErrorCode::UnsupportedMediaType, message));
        }

        // Bomb guard #1: dimensions and decoder memory from the container header, before any
        // decoding (ffprobe itself decodes a PNG frame).
        if let Some(info) = sniff::header_info(kind, &head) {
            self.check_pixels(info.width, info.height)?;
            self.check_decode_memory(info.width, info.height, info.decode_bytes)?;
        } else if !matches!(kind, ImageKind::Heif | ImageKind::Avif) {
            return Err(AppError::new(
                ErrorCode::ProcessingFailed,
                "The image file is damaged or incomplete.",
            ));
        }

        let Ok(Ok(_permit)) = tokio::time::timeout(
            self.queue_timeout,
            Arc::clone(&self.semaphore).acquire_owned(),
        )
        .await
        else {
            return Err(AppError::new(
                ErrorCode::Busy,
                "The server is busy processing other images. Try again shortly.",
            )
            .with_retry_after(5));
        };

        // Bomb guard #2: ffprobe with -max_pixels (also the only size source for HEIF/AVIF).
        let primary = self.probe(input, kind).await?;
        let (src_w, src_h) = (primary.width, primary.height);
        self.check_pixels(src_w, src_h)?;
        if kind.container_orientation() {
            // No header estimate for HEIF/AVIF: use the decoder's pixel format, doubled for
            // the HEVC/AV1 decoders' own picture buffers.
            let per_pixel = primary
                .pix_fmt
                .as_deref()
                .map_or(8.0, sniff::pix_fmt_bytes_per_pixel);
            let pixels = u64::from(src_w) * u64::from(src_h);
            let estimate = (pixels as f64 * per_pixel * 2.0).ceil() as u64;
            self.check_decode_memory(src_w, src_h, estimate)?;
        }

        let orientation = if kind.container_orientation() {
            None
        } else {
            exif::orientation(kind, &head)
        };
        let main_out = work_dir.join("main.webp");
        let thumb_out = work_dir.join("thumb.webp");
        let job = Job {
            input,
            kind,
            orientation,
            preset,
            max_pixels: self.max_pixels,
            stream: primary.stream,
            main_out: &main_out,
            thumb_out: preset.has_thumbnail().then_some(thumb_out.as_path()),
        };
        let args = transcode::ffmpeg_args(&job);
        let output = tools::run(&self.ffmpeg, &args, self.timeout)
            .await
            .map_err(|e| {
                tracing::warn!(error = %e, "ffmpeg did not finish");
                AppError::new(
                    ErrorCode::ProcessingFailed,
                    "The image took too long to process. Try a smaller photo.",
                )
            })?;
        if !output.success {
            tracing::warn!(stderr = %output.stderr, kind = kind.label(), "ffmpeg failed");
            return Err(AppError::new(
                ErrorCode::ProcessingFailed,
                "The image could not be processed. It may be damaged.",
            ));
        }

        let main = read_output(&main_out).await?;
        let thumb = if preset.has_thumbnail() {
            Some(read_output(&thumb_out).await?)
        } else {
            None
        };
        Ok(Processed {
            main,
            thumb,
            source_kind: kind,
            source_width: src_w,
            source_height: src_h,
            orientation,
            elapsed: started.elapsed(),
        })
    }

    fn check_pixels(&self, w: u32, h: u32) -> Result<(), AppError> {
        if w == 0 || h == 0 {
            return Err(AppError::new(
                ErrorCode::ProcessingFailed,
                "The image has no pixels.",
            ));
        }
        if u64::from(w) * u64::from(h) > self.max_pixels {
            return Err(AppError::new(
                ErrorCode::ImageTooLarge,
                format!(
                    "The image is {w}×{h} pixels; the limit is {} megapixels. Resize it and try again.",
                    self.max_pixels / 1_000_000
                ),
            ));
        }
        Ok(())
    }

    fn check_decode_memory(&self, w: u32, h: u32, estimate: u64) -> Result<(), AppError> {
        if estimate <= self.max_decode_bytes {
            return Ok(());
        }
        tracing::info!(
            width = w,
            height = h,
            estimate_mb = estimate / (1024 * 1024),
            limit_mb = self.max_decode_bytes / (1024 * 1024),
            "image refused: decoding would need too much memory"
        );
        Err(AppError::new(
            ErrorCode::ImageTooLarge,
            format!(
                "This {w}×{h} image needs too much memory to process (high bit depth, transparency or progressive encoding). Save it as a normal JPEG or make it smaller."
            ),
        ))
    }

    async fn probe(&self, input: &Path, kind: ImageKind) -> Result<Primary, AppError> {
        let args = transcode::ffprobe_args(input, kind, self.max_pixels);
        let output = tools::run(&self.ffprobe, &args, self.timeout)
            .await
            .map_err(|e| {
                tracing::warn!(error = %e, "ffprobe did not finish");
                AppError::new(ErrorCode::ProcessingFailed, "The image could not be read.")
            })?;
        let streams = serde_json::from_slice::<ProbeOutput>(&output.stdout)
            .map(|p| p.streams)
            .unwrap_or_default();
        match pick_primary(&streams) {
            Ok(primary) => Ok(primary),
            Err(PickError::Tiled) => {
                tracing::info!(
                    streams = streams.len(),
                    kind = kind.label(),
                    "tiled image refused"
                );
                Err(AppError::new(
                    ErrorCode::UnsupportedMediaType,
                    "This photo is stored as tiles (common for iPhone HEIC), which this server can't convert yet. Export it as JPEG and try again.",
                ))
            }
            Err(PickError::Empty) => {
                tracing::info!(stderr = %output.stderr, kind = kind.label(), "ffprobe found no decodable image");
                if output.stderr.contains("exceeds specified max pixel count") {
                    return Err(AppError::new(
                        ErrorCode::ImageTooLarge,
                        "The image dimensions are too large.",
                    ));
                }
                Err(AppError::new(
                    ErrorCode::ProcessingFailed,
                    "The image file is damaged or incomplete.",
                ))
            }
        }
    }
}

async fn read_head(input: &Path) -> Result<Vec<u8>, AppError> {
    let file = tokio::fs::File::open(input)
        .await
        .map_err(AppError::internal)?;
    let mut head = Vec::with_capacity(64 * 1024);
    file.take(HEAD_BYTES)
        .read_to_end(&mut head)
        .await
        .map_err(AppError::internal)?;
    Ok(head)
}

async fn read_output(path: &Path) -> Result<Encoded, AppError> {
    let bytes = tokio::fs::read(path).await.map_err(|e| {
        tracing::warn!(error = %e, "ffmpeg produced no output file");
        AppError::new(
            ErrorCode::ProcessingFailed,
            "The image could not be processed.",
        )
    })?;
    if sniff::sniff(&bytes) != Some(ImageKind::Webp) {
        return Err(AppError::internal("ffmpeg output is not WebP"));
    }
    let (width, height) = sniff::header_dimensions(ImageKind::Webp, &bytes)
        .ok_or_else(|| AppError::internal("unreadable WebP output"))?;
    Ok(Encoded {
        bytes: Bytes::from(bytes),
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(width: u32, height: u32) -> ProbeStream {
        ProbeStream {
            width,
            height,
            ..ProbeStream::default()
        }
    }

    #[test]
    fn picks_the_single_picture() {
        assert_eq!(
            pick_primary(&[stream(4032, 3024)]),
            Ok(Primary {
                stream: 0,
                width: 4032,
                height: 3024,
                pix_fmt: None,
            })
        );
    }

    /// Regression (review finding): `max_by_key` returns the *last* of equal maxima, so a
    /// picture followed by its same-sized alpha plane decoded the alpha plane.
    #[test]
    fn equal_sizes_prefer_the_default_stream_then_the_first() {
        let pick = |streams: &[ProbeStream]| pick_primary(streams).map(|p| p.stream);
        assert_eq!(pick(&[stream(640, 480), stream(640, 480)]), Ok(0));
        let mut default = stream(640, 480);
        default.disposition.default = 1;
        assert_eq!(pick(&[stream(640, 480), default.clone()]), Ok(1));
        assert_eq!(pick(&[default, stream(640, 480)]), Ok(0));
        // Size still wins over the flag (a default-marked thumbnail is not the picture).
        let mut thumb = stream(320, 240);
        thumb.disposition.default = 1;
        assert_eq!(pick(&[thumb, stream(4032, 3024)]), Ok(1));
    }

    #[test]
    fn probe_output_with_disposition_and_pixel_format_parses() {
        let json = br#"{"streams":[{"index":0,"codec_name":"av1","width":640,"height":480,"pix_fmt":"yuv420p","disposition":{"default":1}}]}"#;
        let streams = serde_json::from_slice::<ProbeOutput>(json).unwrap().streams;
        let primary = pick_primary(&streams).unwrap();
        assert_eq!(primary.pix_fmt.as_deref(), Some("yuv420p"));
        assert_eq!(streams[0].disposition.default, 1);
    }

    #[test]
    fn prefers_the_picture_over_its_thumbnail_in_any_order() {
        let expected = Ok(Primary {
            stream: 1,
            width: 4032,
            height: 3024,
            pix_fmt: None,
        });
        assert_eq!(
            pick_primary(&[stream(320, 240), stream(4032, 3024)]),
            expected
        );
        assert_eq!(
            pick_primary(&[stream(4032, 3024), stream(320, 240)]).map(|p| p.stream),
            Ok(0)
        );
    }

    #[test]
    fn refuses_tiled_grids_and_empty_probes() {
        let tiles: Vec<ProbeStream> = (0..48).map(|_| stream(512, 512)).collect();
        assert_eq!(pick_primary(&tiles), Err(PickError::Tiled));
        assert_eq!(pick_primary(&[]), Err(PickError::Empty));
        assert_eq!(pick_primary(&[stream(0, 0)]), Err(PickError::Empty));
    }
}
