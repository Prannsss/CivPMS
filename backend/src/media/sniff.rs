//! File-type detection from magic bytes (never from the file name or the client's
//! `Content-Type`), and image dimensions read straight from the container headers, so a
//! decompression bomb is rejected before any decoder allocates a frame.
//!
//! The header also tells how much memory decoding will take, which depends on far more than
//! the pixel count (bit depth, channels, chroma subsampling, progressive coding):
//! [`HeaderInfo::decode_bytes`] estimates what ffmpeg's decoder allocates. Measured with
//! ffmpeg 6.1 at 48 MP, the whole ffmpeg run peaks at roughly this estimate + 75 MB:
//!
//! | source (48 MP)               | estimate | ffmpeg peak RSS |
//! |------------------------------|---------:|----------------:|
//! | JPEG 4:2:0 baseline          |    72 MB |          130 MB |
//! | JPEG 4:2:0 progressive       |   216 MB |          267 MB |
//! | JPEG 4:4:4 baseline          |   144 MB |          209 MB |
//! | PNG 8-bit RGBA / WebP lossless |  192 MB |          266 MB |
//! | PNG 16-bit RGB               |   288 MB |          350 MB |
//! | PNG 16-bit RGBA              |   384 MB |          449 MB |

/// Image formats this service accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ImageKind {
    Jpeg,
    Png,
    Webp,
    Gif,
    Heif,
    Avif,
}

impl ImageKind {
    pub const ALL: [Self; 6] = [
        Self::Jpeg,
        Self::Png,
        Self::Webp,
        Self::Gif,
        Self::Heif,
        Self::Avif,
    ];

    pub const fn label(self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg",
            Self::Png => "png",
            Self::Webp => "webp",
            Self::Gif => "gif",
            Self::Heif => "heic",
            Self::Avif => "avif",
        }
    }

    pub const fn mime(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
            Self::Gif => "image/gif",
            Self::Heif => "image/heic",
            Self::Avif => "image/avif",
        }
    }

    /// The ffmpeg demuxer forced for this input (ffmpeg never guesses the container, which
    /// keeps exotic demuxers and their attack surface out of reach).
    pub const fn demuxer(self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg_pipe",
            Self::Png => "png_pipe",
            Self::Webp => "webp_pipe",
            Self::Gif => "gif",
            Self::Heif | Self::Avif => "mov",
        }
    }

    /// Whether orientation comes from the container (HEIF `irot`/`imir`, applied by ffmpeg)
    /// rather than from EXIF (parsed and applied by this service).
    pub const fn container_orientation(self) -> bool {
        matches!(self, Self::Heif | Self::Avif)
    }
}

/// Detects the image format from the first bytes of a file.
pub fn sniff(head: &[u8]) -> Option<ImageKind> {
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(ImageKind::Jpeg);
    }
    if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(ImageKind::Png);
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return Some(ImageKind::Webp);
    }
    if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        return Some(ImageKind::Gif);
    }
    if infer::image::is_avif(head) {
        return Some(ImageKind::Avif);
    }
    if infer::image::is_heif(head) {
        return Some(ImageKind::Heif);
    }
    None
}

/// What the container header says about an image, before any decoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeaderInfo {
    pub width: u32,
    pub height: u32,
    /// Estimated bytes ffmpeg's decoder allocates for this image (frame buffers, plus
    /// coefficient buffers for progressive JPEG, plus the previous frame for GIF).
    pub decode_bytes: u64,
}

/// Width and height from the container header, without decoding. `None` when the header is
/// truncated or malformed (HEIF/AVIF are left to ffprobe).
pub fn header_dimensions(kind: ImageKind, head: &[u8]) -> Option<(u32, u32)> {
    header_info(kind, head).map(|info| (info.width, info.height))
}

/// Dimensions and decoder memory estimate from the container header (see the module docs).
pub fn header_info(kind: ImageKind, head: &[u8]) -> Option<HeaderInfo> {
    match kind {
        ImageKind::Jpeg => jpeg_info(head),
        ImageKind::Png => png_info(head),
        ImageKind::Webp => webp_info(head),
        ImageKind::Gif => {
            let (width, height) = gif_dimensions(head)?;
            // Decoded as BGRA, and the decoder keeps the previous frame for disposal.
            Some(sized(width, height, 8.0))
        }
        ImageKind::Heif | ImageKind::Avif => None,
    }
}

fn sized(width: u32, height: u32, bytes_per_pixel: f64) -> HeaderInfo {
    let pixels = u64::from(width) * u64::from(height);
    HeaderInfo {
        width,
        height,
        decode_bytes: (pixels as f64 * bytes_per_pixel).ceil() as u64,
    }
}

/// Bytes per pixel of a decoded frame in ffmpeg pixel format `pix_fmt` (as ffprobe names
/// it). Unknown formats count as 8 (the widest common one, 16-bit RGBA).
pub fn pix_fmt_bytes_per_pixel(pix_fmt: &str) -> f64 {
    let name = pix_fmt
        .strip_suffix("le")
        .or_else(|| pix_fmt.strip_suffix("be"))
        .unwrap_or(pix_fmt);
    // Planar YUV: "yuv420p", "yuvj444p", "yuva420p10" …
    let planar = name
        .strip_prefix("yuva")
        .map(|rest| (true, rest))
        .or_else(|| {
            name.strip_prefix("yuvj")
                .or_else(|| name.strip_prefix("yuv"))
                .map(|rest| (false, rest))
        });
    if let Some((alpha, rest)) = planar {
        let (layout, depth) = rest.split_once('p').unwrap_or((rest, ""));
        let samples = match layout {
            "420" | "411" => 1.5,
            "422" | "440" => 2.0,
            "444" => 3.0,
            _ => return 8.0,
        } + if alpha { 1.0 } else { 0.0 };
        let wide = depth.parse::<u32>().is_ok_and(|d| d > 8);
        return samples * if wide { 2.0 } else { 1.0 };
    }
    match name {
        "gray" | "pal8" | "monob" | "monow" => 1.0,
        "nv12" | "nv21" => 1.5,
        "gray10" | "gray12" | "gray14" | "gray16" | "ya8" => 2.0,
        "rgb24" | "bgr24" | "gbrp" | "p010" | "p012" | "p016" => 3.0,
        "rgba" | "bgra" | "argb" | "abgr" | "rgb0" | "bgr0" | "0rgb" | "0bgr" | "gbrap"
        | "ya16" | "grayf32" => 4.0,
        "rgb48" | "bgr48" | "gbrp10" | "gbrp12" | "gbrp16" => 6.0,
        _ => 8.0,
    }
}

fn be16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_be_bytes(
        b.get(at..at + 2)?.try_into().ok()?,
    )))
}

fn le16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_le_bytes(
        b.get(at..at + 2)?.try_into().ok()?,
    )))
}

fn le24(b: &[u8], at: usize) -> Option<u32> {
    let s = b.get(at..at + 3)?;
    Some(u32::from(s[0]) | (u32::from(s[1]) << 8) | (u32::from(s[2]) << 16))
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// Walks JPEG marker segments up to the first start-of-frame and reads it completely
/// (precision, size, components and their sampling factors).
fn jpeg_info(b: &[u8]) -> Option<HeaderInfo> {
    let mut i = 2; // after SOI
    while i + 3 < b.len() {
        if b[i] != 0xFF {
            return None;
        }
        let marker = b[i + 1];
        if marker == 0xFF {
            i += 1; // fill byte
            continue;
        }
        if matches!(marker, 0x01 | 0xD0..=0xD7) {
            i += 2; // stand-alone markers
            continue;
        }
        if marker == 0xDA || marker == 0xD9 {
            return None; // scan data / end of image before any frame header
        }
        let length = be16(b, i + 2)? as usize;
        if length < 2 {
            return None;
        }
        let is_sof = matches!(marker, 0xC0..=0xCF) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
        if is_sof {
            return jpeg_frame(b, i, marker);
        }
        i += 2 + length;
    }
    None
}

/// Parses the SOF segment at `i`. Decoded planes: one per component, subsampled by its
/// sampling factors; progressive JPEGs also keep a 16-bit coefficient per sample.
fn jpeg_frame(b: &[u8], i: usize, marker: u8) -> Option<HeaderInfo> {
    let precision = *b.get(i + 4)?;
    let height = be16(b, i + 5)?;
    let width = be16(b, i + 7)?;
    let count = usize::from(*b.get(i + 9)?);
    if count == 0 || count > 4 {
        return None;
    }
    let factors: Vec<(u32, u32)> = (0..count)
        .map(|c| {
            let hv = *b.get(i + 11 + c * 3)?;
            Some((u32::from(hv >> 4).max(1), u32::from(hv & 0x0F).max(1)))
        })
        .collect::<Option<_>>()?;
    let h_max = factors.iter().map(|f| f.0).max()?;
    let v_max = factors.iter().map(|f| f.1).max()?;
    let samples: u64 = factors
        .iter()
        .map(|&(h, v)| {
            u64::from((width * h).div_ceil(h_max)) * u64::from((height * v).div_ceil(v_max))
        })
        .sum();
    let sample_bytes = if precision > 8 { 2 } else { 1 };
    let progressive = matches!(marker, 0xC2 | 0xC6 | 0xCA | 0xCE);
    let coefficient_bytes = if progressive { 2 } else { 0 };
    Some(HeaderInfo {
        width,
        height,
        decode_bytes: samples * (sample_bytes + coefficient_bytes),
    })
}

fn png_info(b: &[u8]) -> Option<HeaderInfo> {
    if b.get(12..16)? != b"IHDR" {
        return None;
    }
    let (width, height) = (be32(b, 16)?, be32(b, 20)?);
    let depth = *b.get(24)?;
    let channels = match *b.get(25)? {
        0 | 3 => 1.0, // gray, palette (decoded as pal8)
        2 => 3.0,     // RGB
        4 => 2.0,     // gray + alpha
        6 => 4.0,     // RGBA
        _ => return None,
    };
    let sample_bytes = if depth == 16 { 2.0 } else { 1.0 };
    Some(sized(width, height, channels * sample_bytes))
}

fn gif_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    Some((le16(b, 6)?, le16(b, 8)?))
}

/// Lossy WebP decodes to YUV 4:2:0; lossless (and extended files, which may be either or
/// carry alpha) are counted as ARGB.
fn webp_info(b: &[u8]) -> Option<HeaderInfo> {
    match b.get(12..16)? {
        b"VP8 " => {
            if b.get(23..26)? != [0x9D, 0x01, 0x2A] {
                return None;
            }
            Some(sized(le16(b, 26)? & 0x3FFF, le16(b, 28)? & 0x3FFF, 1.5))
        }
        b"VP8L" => {
            if *b.get(20)? != 0x2F {
                return None;
            }
            let bits = u32::from_le_bytes(b.get(21..25)?.try_into().ok()?);
            Some(sized((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, 4.0))
        }
        b"VP8X" => Some(sized(le24(b, 24)? + 1, le24(b, 27)? + 1, 4.0)),
        _ => None,
    }
}

/// Lists the RIFF chunk ids of a WebP file (used to prove that no metadata chunks remain).
pub fn webp_chunks(b: &[u8]) -> Option<Vec<[u8; 4]>> {
    if b.len() < 12 || &b[0..4] != b"RIFF" || &b[8..12] != b"WEBP" {
        return None;
    }
    let mut chunks = Vec::new();
    let mut i = 12;
    while i + 8 <= b.len() {
        let id: [u8; 4] = b[i..i + 4].try_into().ok()?;
        let size = u32::from_le_bytes(b[i + 4..i + 8].try_into().ok()?) as usize;
        chunks.push(id);
        i += 8 + size + (size & 1);
    }
    Some(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_by_magic_bytes() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(ImageKind::Jpeg));
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n...."), Some(ImageKind::Png));
        assert_eq!(sniff(b"RIFF\x10\0\0\0WEBPVP8 "), Some(ImageKind::Webp));
        assert_eq!(sniff(b"GIF89a\x01\0\x01\0"), Some(ImageKind::Gif));
        let heic = b"\0\0\0\x18ftypheic\0\0\0\0mif1heic";
        assert_eq!(sniff(heic), Some(ImageKind::Heif));
        let avif = b"\0\0\0\x1cftypavif\0\0\0\0avifmif1miaf";
        assert_eq!(sniff(avif), Some(ImageKind::Avif));
        // Things that merely claim to be images.
        assert_eq!(sniff(b"<svg xmlns='http://www.w3.org/2000/svg'/>"), None);
        assert_eq!(sniff(b"%PDF-1.7"), None);
        assert_eq!(sniff(b"XXXX\0\0\0\0WEBP"), None, "WEBP without RIFF");
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn png_header() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend_from_slice(&100_000u32.to_be_bytes());
        png.extend_from_slice(&80_000u32.to_be_bytes());
        png.extend_from_slice(&[8, 2, 0, 0, 0]); // 8-bit RGB
        assert_eq!(
            header_dimensions(ImageKind::Png, &png),
            Some((100_000, 80_000))
        );
        assert_eq!(
            header_dimensions(ImageKind::Png, &png[..24]),
            None,
            "no bit depth / colour type: treated as damaged"
        );
        assert_eq!(
            header_dimensions(ImageKind::Png, &png[..18]),
            None,
            "truncated"
        );
    }

    #[test]
    fn jpeg_header_skips_app_segments() {
        let mut jpeg = vec![0xFF, 0xD8];
        jpeg.extend_from_slice(&[0xFF, 0xE1, 0x00, 0x06, b'E', b'x', b'i', b'f']); // APP1
        jpeg.extend_from_slice(&[0xFF, 0xFF]); // fill byte
        jpeg.extend_from_slice(&sof(0xC0, 8, 640, 480, &[0x22, 0x11, 0x11]));
        assert_eq!(header_dimensions(ImageKind::Jpeg, &jpeg), Some((640, 480)));
        assert_eq!(
            header_dimensions(ImageKind::Jpeg, &[0xFF, 0xD8, 0xFF, 0xDA, 0, 2]),
            None
        );
        assert_eq!(
            header_dimensions(ImageKind::Jpeg, &[0xFF, 0xD8, 0x00, 0x00, 0, 0]),
            None
        );
    }

    /// A SOF segment: marker, precision, size and one sampling byte per component.
    fn sof(marker: u8, precision: u8, width: u16, height: u16, sampling: &[u8]) -> Vec<u8> {
        let mut out = vec![0xFF, marker];
        let length = 8 + 3 * sampling.len() as u16;
        out.extend_from_slice(&length.to_be_bytes());
        out.push(precision);
        out.extend_from_slice(&height.to_be_bytes());
        out.extend_from_slice(&width.to_be_bytes());
        out.push(sampling.len() as u8);
        for (id, hv) in sampling.iter().enumerate() {
            out.extend_from_slice(&[id as u8 + 1, *hv, 0]);
        }
        out
    }

    fn jpeg_cost(marker: u8, precision: u8, sampling: &[u8]) -> u64 {
        let mut jpeg = vec![0xFF, 0xD8];
        jpeg.extend_from_slice(&sof(marker, precision, 8000, 6000, sampling));
        header_info(ImageKind::Jpeg, &jpeg).unwrap().decode_bytes
    }

    /// Regression (review finding): the pixel cap ignored bit depth and coding, so a small
    /// 16-bit PNG or a progressive JPEG needed several times the memory of a plain photo.
    #[test]
    fn decode_memory_depends_on_depth_channels_subsampling_and_coding() {
        const MP48: u64 = 48_000_000;
        assert_eq!(
            jpeg_cost(0xC0, 8, &[0x22, 0x11, 0x11]),
            MP48 * 3 / 2,
            "4:2:0"
        );
        assert_eq!(jpeg_cost(0xC0, 8, &[0x11, 0x11, 0x11]), MP48 * 3, "4:4:4");
        assert_eq!(
            jpeg_cost(0xC2, 8, &[0x22, 0x11, 0x11]),
            MP48 * 3 / 2 * 3,
            "progressive keeps coefficients"
        );
        assert_eq!(jpeg_cost(0xC1, 12, &[0x11]), MP48 * 2, "12-bit gray");

        let png = |depth: u8, color: u8| {
            let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
            png.extend_from_slice(&8000u32.to_be_bytes());
            png.extend_from_slice(&6000u32.to_be_bytes());
            png.extend_from_slice(&[depth, color, 0, 0, 0]);
            header_info(ImageKind::Png, &png).map(|i| i.decode_bytes)
        };
        assert_eq!(png(16, 6), Some(MP48 * 8), "16-bit RGBA");
        assert_eq!(png(16, 2), Some(MP48 * 6), "16-bit RGB");
        assert_eq!(png(8, 6), Some(MP48 * 4), "8-bit RGBA");
        assert_eq!(png(8, 3), Some(MP48), "palette");
        assert_eq!(png(8, 9), None, "invalid colour type");

        let gif = header_info(ImageKind::Gif, b"GIF89a\x40\x01\xc8\x00").unwrap();
        assert_eq!(gif.decode_bytes, 320 * 200 * 8);
    }

    #[test]
    fn pixel_formats() {
        for (fmt, bpp) in [
            ("yuv420p", 1.5),
            ("yuvj420p", 1.5),
            ("yuv420p10le", 3.0),
            ("yuv444p12be", 6.0),
            ("yuva420p", 2.5),
            ("yuvj422p", 2.0),
            ("rgba64be", 8.0),
            ("rgb48le", 6.0),
            ("rgba", 4.0),
            ("argb", 4.0),
            ("rgb24", 3.0),
            ("gray", 1.0),
            ("gray16be", 2.0),
            ("pal8", 1.0),
            ("something_new", 8.0),
        ] {
            assert!(
                (pix_fmt_bytes_per_pixel(fmt) - bpp).abs() < f64::EPSILON,
                "{fmt}"
            );
        }
    }

    #[test]
    fn webp_headers() {
        let mut vp8x = b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0".to_vec();
        vp8x.extend_from_slice(&[0x3F, 0x06, 0x00, 0x9F, 0x04, 0x00]); // 1600 x 1184
        assert_eq!(
            header_dimensions(ImageKind::Webp, &vp8x),
            Some((1600, 1184))
        );

        let mut vp8l = b"RIFF\0\0\0\0WEBPVP8L\0\0\0\0\x2f".to_vec();
        let bits: u32 = 255 | (127 << 14); // 256 x 128
        vp8l.extend_from_slice(&bits.to_le_bytes());
        assert_eq!(header_dimensions(ImageKind::Webp, &vp8l), Some((256, 128)));
    }

    #[test]
    fn gif_header() {
        assert_eq!(
            header_dimensions(ImageKind::Gif, b"GIF89a\x40\x01\xc8\x00"),
            Some((320, 200))
        );
    }

    #[test]
    fn lists_webp_chunks() {
        let mut webp = b"RIFF\x1a\0\0\0WEBP".to_vec();
        webp.extend_from_slice(b"VP8X\x0a\0\0\0");
        webp.extend_from_slice(&[0; 10]);
        webp.extend_from_slice(b"EXIF\x01\0\0\0X\0");
        assert_eq!(webp_chunks(&webp).unwrap(), vec![*b"VP8X", *b"EXIF"]);
    }
}
