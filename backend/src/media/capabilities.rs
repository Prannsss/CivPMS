//! What the installed ffmpeg can do, detected once at startup and reported by `/readyz`.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::sniff::ImageKind;
use super::tools;

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Default, Serialize)]
pub struct Capabilities {
    /// e.g. "6.1.1-3ubuntu5"; `None` when ffmpeg could not be run.
    pub ffmpeg_version: Option<String>,
    pub ffprobe: bool,
    /// The libwebp encoder (required for every output).
    pub webp_encoder: bool,
    /// Which input formats can be decoded.
    pub formats: BTreeMap<&'static str, bool>,
}

impl Capabilities {
    /// Ready when both tools run and JPEG/PNG/WebP can be turned into WebP.
    pub fn ready(&self) -> bool {
        self.ffmpeg_version.is_some()
            && self.ffprobe
            && self.webp_encoder
            && [ImageKind::Jpeg, ImageKind::Png, ImageKind::Webp].iter().all(|k| self.supports(*k))
    }

    pub fn supports(&self, kind: ImageKind) -> bool {
        self.formats.get(kind.label()).copied().unwrap_or(false)
    }

    pub async fn detect(ffmpeg: &Path, ffprobe: &Path) -> Self {
        let run = |program: &Path, arg: &'static str| {
            let args = vec![OsString::from("-hide_banner"), OsString::from(arg)];
            let program = program.to_path_buf();
            async move {
                match tools::run(&program, &args, PROBE_TIMEOUT).await {
                    Ok(out) if out.success => Some(String::from_utf8_lossy(&out.stdout).into_owned()),
                    Ok(out) => {
                        tracing::warn!(stderr = %out.stderr, arg, "capability probe failed");
                        None
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, arg, "capability probe failed");
                        None
                    }
                }
            }
        };
        let (version, decoders, encoders, demuxers, probe_version) = tokio::join!(
            run(ffmpeg, "-version"),
            run(ffmpeg, "-decoders"),
            run(ffmpeg, "-encoders"),
            run(ffmpeg, "-demuxers"),
            run(ffprobe, "-version"),
        );
        Self::from_listings(
            version.as_deref(),
            decoders.as_deref().unwrap_or_default(),
            encoders.as_deref().unwrap_or_default(),
            demuxers.as_deref().unwrap_or_default(),
            probe_version.is_some(),
        )
    }

    /// Pure parsing of `ffmpeg -version/-decoders/-encoders/-demuxers` output (unit-tested).
    pub fn from_listings(
        version: Option<&str>,
        decoders: &str,
        encoders: &str,
        demuxers: &str,
        ffprobe: bool,
    ) -> Self {
        let ffmpeg_version = version.and_then(|v| {
            v.lines().next().and_then(|line| line.strip_prefix("ffmpeg version ")).map(|rest| {
                rest.split_whitespace().next().unwrap_or_default().to_owned()
            })
        });
        let names = |listing: &str| -> Vec<String> {
            listing
                .lines()
                .filter_map(|line| {
                    let mut parts = line.split_whitespace();
                    let flags = parts.next()?;
                    // Listing rows look like " V....D mjpeg  MJPEG (Motion JPEG)" or " D  mov,mp4,…".
                    if flags.len() > 6 || flags.contains('=') {
                        return None;
                    }
                    parts.next().map(str::to_owned)
                })
                .collect()
        };
        let decoders = names(decoders);
        let encoders = names(encoders);
        let demuxers: Vec<String> =
            names(demuxers).iter().flat_map(|d| d.split(',').map(str::to_owned).collect::<Vec<_>>()).collect();
        let has = |list: &[String], name: &str| list.iter().any(|n| n == name);
        let mov = has(&demuxers, "mov");
        let (major, minor) = parse_version(ffmpeg_version.as_deref());

        let mut formats = BTreeMap::new();
        formats.insert("jpeg", has(&decoders, "mjpeg") && has(&demuxers, "jpeg_pipe"));
        formats.insert("png", has(&decoders, "png") && has(&demuxers, "png_pipe"));
        formats.insert("webp", has(&decoders, "webp") && has(&demuxers, "webp_pipe"));
        formats.insert("gif", has(&decoders, "gif") && has(&demuxers, "gif"));
        // HEIF still images (item-based, tiled) are only demuxed by ffmpeg >= 7.1.
        formats.insert("heic", has(&decoders, "hevc") && mov && (major, minor) >= (7, 1));
        formats.insert(
            "avif",
            mov && ["libdav1d", "libaom-av1", "av1"].iter().any(|d| has(&decoders, d)),
        );

        Self {
            ffmpeg_version,
            ffprobe,
            webp_encoder: has(&encoders, "libwebp"),
            formats,
        }
    }
}

/// "6.1.1-3ubuntu5" → (6, 1); "n7.1" → (7, 1); git snapshots ("N-1234-g…") count as newest.
fn parse_version(version: Option<&str>) -> (u32, u32) {
    let Some(v) = version else { return (0, 0) };
    if v.starts_with("N-") || v.starts_with("git") {
        return (u32::MAX, 0);
    }
    let v = v.trim_start_matches('n');
    let mut parts = v.split(|c: char| !c.is_ascii_digit());
    let major = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    (major, minor)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DECODERS: &str = "Decoders:\n V..... = Video\n ------\n V....D mjpeg  MJPEG\n VF...D png   PNG\n VF...D webp  WebP\n V....D gif   GIF\n VFS..D hevc  HEVC\n V..... libdav1d dav1d\n";
    const ENCODERS: &str = "Encoders:\n V..... = Video\n ------\n V....D libwebp  libwebp WebP image\n";
    const DEMUXERS: &str = "Demuxers:\n D. = Demuxing supported\n --\n D  gif  GIF\n D  jpeg_pipe  piped jpeg\n D  mov,mp4,m4a,3gp,3g2,mj2 QuickTime / MOV\n D  png_pipe  piped png\n D  webp_pipe  piped webp\n";

    #[test]
    fn parses_ffmpeg_6_listings() {
        let caps = Capabilities::from_listings(
            Some("ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023"),
            DECODERS,
            ENCODERS,
            DEMUXERS,
            true,
        );
        assert_eq!(caps.ffmpeg_version.as_deref(), Some("6.1.1-3ubuntu5"));
        assert!(caps.webp_encoder);
        assert!(caps.ready());
        for kind in [ImageKind::Jpeg, ImageKind::Png, ImageKind::Webp, ImageKind::Gif, ImageKind::Avif] {
            assert!(caps.supports(kind), "{kind:?}");
        }
        assert!(!caps.supports(ImageKind::Heif), "HEIC needs ffmpeg >= 7.1");
    }

    #[test]
    fn heic_with_ffmpeg_7_1() {
        let caps =
            Capabilities::from_listings(Some("ffmpeg version 7.1.2-1+b1"), DECODERS, ENCODERS, DEMUXERS, true);
        assert!(caps.supports(ImageKind::Heif));
    }

    #[test]
    fn not_ready_without_tools() {
        let caps = Capabilities::from_listings(None, "", "", "", false);
        assert!(!caps.ready());
        assert!(!caps.supports(ImageKind::Jpeg));
    }

    #[test]
    fn versions() {
        assert_eq!(parse_version(Some("6.1.1-3ubuntu5")), (6, 1));
        assert_eq!(parse_version(Some("n7.1")), (7, 1));
        assert_eq!(parse_version(Some("7.1.2-1+b1")), (7, 1));
        assert_eq!(parse_version(Some("N-115000-gabc")), (u32::MAX, 0));
        assert_eq!(parse_version(None), (0, 0));
    }
}
