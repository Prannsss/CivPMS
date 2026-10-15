//! ffmpeg command lines for the two output presets.
//!
//! One ffmpeg run decodes the input once and writes every output: upright pixels, resized
//! with Lanczos, encoded as WebP, all metadata dropped (`-map_metadata -1`; the WebP muxer
//! writes no EXIF/XMP/ICC chunks, which the tests verify).

use std::ffi::OsString;
use std::path::Path;

use super::exif;
use super::sniff::ImageKind;

/// What to produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preset {
    /// Center-cropped square avatar.
    Avatar { size: u32, quality: u8 },
    /// Photo bounded by `max_edge` (never upscaled) plus a thumbnail bounded by `thumb_edge`.
    Photo {
        max_edge: u32,
        thumb_edge: u32,
        quality: u8,
        thumb_quality: u8,
    },
}

impl Preset {
    pub const AVATAR: Self = Self::Avatar {
        size: 256,
        quality: 82,
    };
    pub const PHOTO: Self = Self::Photo {
        max_edge: 1600,
        thumb_edge: 400,
        quality: 80,
        thumb_quality: 75,
    };

    pub const fn has_thumbnail(self) -> bool {
        matches!(self, Self::Photo { .. })
    }
}

/// Inputs for one ffmpeg run.
#[derive(Debug, Clone, Copy)]
pub struct Job<'a> {
    pub input: &'a Path,
    pub kind: ImageKind,
    /// EXIF orientation (1–8) for formats whose orientation this service applies itself.
    pub orientation: Option<u16>,
    pub preset: Preset,
    pub max_pixels: u64,
    pub main_out: &'a Path,
    pub thumb_out: Option<&'a Path>,
}

fn bounded_scale(edge: u32) -> String {
    format!(
        "scale=w='min({edge},iw)':h='min({edge},ih)':force_original_aspect_ratio=decrease:flags=lanczos"
    )
}

/// The `-filter_complex` graph for a job.
pub fn filter_graph(job: &Job<'_>) -> String {
    let orient = if job.kind.container_orientation() {
        None
    } else {
        job.orientation.and_then(exif::filter_for)
    };
    let prefix = orient.map(|f| format!("{f},")).unwrap_or_default();
    match job.preset {
        Preset::Avatar { size, .. } => format!(
            "[0:v]{prefix}crop=w='min(iw,ih)':h='min(iw,ih)',scale={size}:{size}:flags=lanczos,setsar=1[main]"
        ),
        Preset::Photo {
            max_edge,
            thumb_edge,
            ..
        } => format!(
            "[0:v]{prefix}{},setsar=1,split=2[main][t0];[t0]{}[thumb]",
            bounded_scale(max_edge),
            bounded_scale(thumb_edge),
        ),
    }
}

fn webp_output(args: &mut Vec<OsString>, label: &str, quality: u8, out: &Path) {
    for a in [
        "-map",
        label,
        "-frames:v",
        "1",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-c:v",
        "libwebp",
        "-preset",
        "photo",
        "-compression_level",
        "4",
        "-quality",
    ] {
        args.push(a.into());
    }
    args.push(quality.to_string().into());
    args.push("-f".into());
    args.push("webp".into());
    args.push(file_url(out));
}

/// `file:` prefix so a path can never be read as another protocol or option.
fn file_url(path: &Path) -> OsString {
    let mut s = OsString::from("file:");
    s.push(path.as_os_str());
    s
}

/// The full ffmpeg argument list.
pub fn ffmpeg_args(job: &Job<'_>) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::with_capacity(48);
    for a in [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-threads",
        "1",
        "-filter_threads",
        "1",
    ] {
        args.push(a.into());
    }
    // Input options.
    args.push("-protocol_whitelist".into());
    args.push("file".into());
    if !job.kind.container_orientation() {
        args.push("-noautorotate".into());
    }
    args.push("-max_pixels".into());
    args.push(job.max_pixels.to_string().into());
    args.push("-f".into());
    args.push(job.kind.demuxer().into());
    args.push("-i".into());
    args.push(file_url(job.input));

    args.push("-filter_complex".into());
    args.push(filter_graph(job).into());
    match job.preset {
        Preset::Avatar { quality, .. } => webp_output(&mut args, "[main]", quality, job.main_out),
        Preset::Photo {
            quality,
            thumb_quality,
            ..
        } => {
            webp_output(&mut args, "[main]", quality, job.main_out);
            if let Some(thumb) = job.thumb_out {
                webp_output(&mut args, "[thumb]", thumb_quality, thumb);
            }
        }
    }
    args
}

/// The ffprobe argument list (stream header only; `-max_pixels` stops the decoder before a
/// huge frame is allocated).
pub fn ffprobe_args(input: &Path, kind: ImageKind, max_pixels: u64) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::with_capacity(20);
    for a in [
        "-v",
        "error",
        "-hide_banner",
        "-protocol_whitelist",
        "file",
        "-max_pixels",
    ] {
        args.push(a.into());
    }
    args.push(max_pixels.to_string().into());
    for a in [
        "-f",
        kind.demuxer(),
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height",
        "-of",
        "json",
    ] {
        args.push(a.into());
    }
    args.push(file_url(input));
    args
}

/// Expected output size for a source of `width`×`height` (after orientation), mirroring the
/// ffmpeg scale expressions; used to sanity-check results.
pub fn expected_size(preset: Preset, width: u32, height: u32) -> (u32, u32) {
    match preset {
        Preset::Avatar { size, .. } => (size, size),
        Preset::Photo { max_edge, .. } => fit_within(width, height, max_edge),
    }
}

/// Largest size with the same aspect ratio that fits in `edge`×`edge` (never upscaled).
pub fn fit_within(width: u32, height: u32, edge: u32) -> (u32, u32) {
    if width <= edge && height <= edge {
        return (width, height);
    }
    let (w, h) = (f64::from(width), f64::from(height));
    let scale = (f64::from(edge) / w).min(f64::from(edge) / h);
    (
        ((w * scale).round() as u32).clamp(1, edge),
        ((h * scale).round() as u32).clamp(1, edge),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn job(
        kind: ImageKind,
        orientation: Option<u16>,
        preset: Preset,
    ) -> (PathBuf, PathBuf, PathBuf, ImageKind, Option<u16>, Preset) {
        (
            PathBuf::from("/tmp/w/in"),
            PathBuf::from("/tmp/w/main.webp"),
            PathBuf::from("/tmp/w/thumb.webp"),
            kind,
            orientation,
            preset,
        )
    }

    fn args_for(kind: ImageKind, orientation: Option<u16>, preset: Preset) -> Vec<String> {
        let (input, main, thumb, kind, orientation, preset) = job(kind, orientation, preset);
        let job = Job {
            input: &input,
            kind,
            orientation,
            preset,
            max_pixels: 50_000_000,
            main_out: &main,
            thumb_out: preset.has_thumbnail().then_some(thumb.as_path()),
        };
        ffmpeg_args(&job)
            .into_iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    fn value_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        args.iter()
            .position(|a| a == flag)
            .map(|i| args[i + 1].as_str())
    }

    #[test]
    fn photo_args_are_hardened_and_strip_metadata() {
        let args = args_for(ImageKind::Jpeg, Some(6), Preset::PHOTO);
        assert_eq!(value_after(&args, "-protocol_whitelist"), Some("file"));
        assert_eq!(
            value_after(&args, "-f"),
            Some("jpeg_pipe"),
            "demuxer is forced"
        );
        assert_eq!(value_after(&args, "-max_pixels"), Some("50000000"));
        assert_eq!(value_after(&args, "-i"), Some("file:/tmp/w/in"));
        assert!(args.contains(&"-noautorotate".to_owned()));
        assert_eq!(
            args.iter().filter(|a| *a == "-map_metadata").count(),
            2,
            "both outputs"
        );
        assert_eq!(args.iter().filter(|a| *a == "libwebp").count(), 2);
        assert!(args.contains(&"file:/tmp/w/main.webp".to_owned()));
        assert!(args.contains(&"file:/tmp/w/thumb.webp".to_owned()));
        let graph = value_after(&args, "-filter_complex").unwrap();
        assert!(
            graph.starts_with("[0:v]transpose=clock,scale=w='min(1600,iw)'"),
            "{graph}"
        );
        assert!(graph.contains("[t0]scale=w='min(400,iw)'"), "{graph}");
    }

    #[test]
    fn avatar_graph_crops_to_a_square() {
        let args = args_for(ImageKind::Png, None, Preset::AVATAR);
        let graph = value_after(&args, "-filter_complex").unwrap();
        assert_eq!(
            graph,
            "[0:v]crop=w='min(iw,ih)':h='min(iw,ih)',scale=256:256:flags=lanczos,setsar=1[main]"
        );
        assert_eq!(value_after(&args, "-quality"), Some("82"));
        assert!(!args.iter().any(|a| a.contains("thumb")));
    }

    #[test]
    fn heif_uses_container_orientation() {
        let args = args_for(ImageKind::Heif, Some(6), Preset::PHOTO);
        assert!(!args.contains(&"-noautorotate".to_owned()));
        assert_eq!(value_after(&args, "-f"), Some("mov"));
        assert!(
            !value_after(&args, "-filter_complex")
                .unwrap()
                .contains("transpose")
        );
    }

    #[test]
    fn probe_args() {
        let args: Vec<String> = ffprobe_args(Path::new("/tmp/x"), ImageKind::Gif, 1000)
            .into_iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(value_after(&args, "-f"), Some("gif"));
        assert_eq!(value_after(&args, "-max_pixels"), Some("1000"));
        assert_eq!(args.last().map(String::as_str), Some("file:/tmp/x"));
    }

    #[test]
    fn fit_within_matches_ffmpeg_scaling() {
        assert_eq!(fit_within(4000, 3000, 1600), (1600, 1200));
        assert_eq!(fit_within(3000, 4000, 1600), (1200, 1600));
        assert_eq!(fit_within(800, 600, 1600), (800, 600), "never upscaled");
        assert_eq!(fit_within(1001, 667, 400), (400, 267));
        assert_eq!(expected_size(Preset::AVATAR, 1000, 10), (256, 256));
    }
}
