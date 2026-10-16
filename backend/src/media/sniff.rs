//! File-type detection from magic bytes (never from the file name or the client's
//! `Content-Type`), and image dimensions read straight from the container headers, so a
//! decompression bomb is rejected before any decoder allocates a frame.

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

/// Width and height from the container header, without decoding. `None` when the header is
/// truncated or malformed (HEIF/AVIF are left to ffprobe).
pub fn header_dimensions(kind: ImageKind, head: &[u8]) -> Option<(u32, u32)> {
    match kind {
        ImageKind::Jpeg => jpeg_dimensions(head),
        ImageKind::Png => png_dimensions(head),
        ImageKind::Webp => webp_dimensions(head),
        ImageKind::Gif => gif_dimensions(head),
        ImageKind::Heif | ImageKind::Avif => None,
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

/// Walks JPEG marker segments up to the first start-of-frame.
fn jpeg_dimensions(b: &[u8]) -> Option<(u32, u32)> {
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
            let height = be16(b, i + 5)?;
            let width = be16(b, i + 7)?;
            return Some((width, height));
        }
        i += 2 + length;
    }
    None
}

fn png_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    if b.get(12..16)? != b"IHDR" {
        return None;
    }
    Some((be32(b, 16)?, be32(b, 20)?))
}

fn gif_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    Some((le16(b, 6)?, le16(b, 8)?))
}

fn webp_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    match b.get(12..16)? {
        b"VP8 " => {
            if b.get(23..26)? != [0x9D, 0x01, 0x2A] {
                return None;
            }
            Some((le16(b, 26)? & 0x3FFF, le16(b, 28)? & 0x3FFF))
        }
        b"VP8L" => {
            if *b.get(20)? != 0x2F {
                return None;
            }
            let bits = u32::from_le_bytes(b.get(21..25)?.try_into().ok()?);
            Some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1))
        }
        b"VP8X" => Some((le24(b, 24)? + 1, le24(b, 27)? + 1)),
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
        assert_eq!(
            header_dimensions(ImageKind::Png, &png),
            Some((100_000, 80_000))
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
        jpeg.extend_from_slice(&[0xC0, 0x00, 0x11, 0x08, 0x01, 0xE0, 0x02, 0x80]); // SOF0 640x480
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
