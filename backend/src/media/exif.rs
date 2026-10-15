//! EXIF orientation (tag 0x0112) from JPEG `APP1`, PNG `eXIf` and WebP `EXIF` chunks.
//!
//! ffmpeg 6.1 auto-rotates JPEGs from EXIF, but not PNG/WebP, and the behaviour has changed
//! between ffmpeg releases. To be deterministic on every ffmpeg build, the service runs
//! ffmpeg with `-noautorotate`, reads the orientation itself and applies the matching filter
//! (verified against Pillow's `exif_transpose` for all eight values; see the README).

use super::sniff::ImageKind;

/// Orientation 1–8 as defined by EXIF/TIFF. `None` = absent or invalid (treated as 1).
pub fn orientation(kind: ImageKind, head: &[u8]) -> Option<u16> {
    let tiff = match kind {
        ImageKind::Jpeg => jpeg_exif(head)?,
        ImageKind::Png => png_exif(head)?,
        ImageKind::Webp => webp_exif(head)?,
        ImageKind::Gif | ImageKind::Heif | ImageKind::Avif => return None,
    };
    tiff_orientation(tiff)
}

/// The ffmpeg filter that turns pixels stored with `orientation` upright.
pub const fn filter_for(orientation: u16) -> Option<&'static str> {
    match orientation {
        2 => Some("hflip"),
        3 => Some("hflip,vflip"),
        4 => Some("vflip"),
        5 => Some("transpose=cclock_flip"),
        6 => Some("transpose=clock"),
        7 => Some("transpose=clock_flip"),
        8 => Some("transpose=cclock"),
        _ => None,
    }
}

/// Whether the orientation swaps width and height.
pub const fn swaps_axes(orientation: u16) -> bool {
    matches!(orientation, 5..=8)
}

fn jpeg_exif(b: &[u8]) -> Option<&[u8]> {
    let mut i = 2;
    while i + 4 <= b.len() {
        if b[i] != 0xFF {
            return None;
        }
        let marker = b[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if matches!(marker, 0x01 | 0xD0..=0xD7) {
            i += 2;
            continue;
        }
        if matches!(marker, 0xDA | 0xD9) {
            return None;
        }
        let length = usize::from(u16::from_be_bytes([b[i + 2], b[i + 3]]));
        if length < 2 {
            return None;
        }
        let data = b.get(i + 4..(i + 2 + length).min(b.len()))?;
        if marker == 0xE1 && data.starts_with(b"Exif\0\0") {
            return Some(&data[6..]);
        }
        i += 2 + length;
    }
    None
}

fn png_exif(b: &[u8]) -> Option<&[u8]> {
    let mut i = 8;
    while i + 8 <= b.len() {
        let length = u32::from_be_bytes(b[i..i + 4].try_into().ok()?) as usize;
        let kind = &b[i + 4..i + 8];
        if kind == b"eXIf" {
            return b.get(i + 8..i + 8 + length);
        }
        if kind == b"IDAT" || kind == b"IEND" {
            return None; // eXIf must precede the image data to be honoured
        }
        i = i.checked_add(12 + length)?;
    }
    None
}

fn webp_exif(b: &[u8]) -> Option<&[u8]> {
    if b.len() < 12 || &b[0..4] != b"RIFF" || &b[8..12] != b"WEBP" {
        return None;
    }
    let mut i = 12;
    while i + 8 <= b.len() {
        let id = &b[i..i + 4];
        let size = u32::from_le_bytes(b[i + 4..i + 8].try_into().ok()?) as usize;
        if id == b"EXIF" {
            let data = b.get(i + 8..i + 8 + size)?;
            // Some writers keep the JPEG-style "Exif\0\0" prefix.
            return Some(data.strip_prefix(b"Exif\0\0").unwrap_or(data));
        }
        i = i.checked_add(8 + size + (size & 1))?;
    }
    None
}

/// Reads tag 0x0112 from IFD0 of a TIFF structure.
fn tiff_orientation(t: &[u8]) -> Option<u16> {
    let little = match t.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |at: usize| -> Option<u16> {
        let bytes: [u8; 2] = t.get(at..at + 2)?.try_into().ok()?;
        Some(if little { u16::from_le_bytes(bytes) } else { u16::from_be_bytes(bytes) })
    };
    let u32_at = |at: usize| -> Option<u32> {
        let bytes: [u8; 4] = t.get(at..at + 4)?.try_into().ok()?;
        Some(if little { u32::from_le_bytes(bytes) } else { u32::from_be_bytes(bytes) })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let ifd = u32_at(4)? as usize;
    let count = usize::from(u16_at(ifd)?);
    for n in 0..count.min(512) {
        let entry = ifd + 2 + n * 12;
        if u16_at(entry)? == 0x0112 {
            // SHORT (type 3), count 1: the value sits in the first two bytes of the field.
            if u16_at(entry + 2)? != 3 {
                return None;
            }
            let value = u16_at(entry + 8)?;
            return (1..=8).contains(&value).then_some(value);
        }
    }
    None
}

/// Builds a minimal little-endian TIFF block holding only an orientation tag.
fn tiff_with_orientation(orientation: u16) -> Vec<u8> {
    let mut t = Vec::with_capacity(26);
    t.extend_from_slice(b"II");
    t.extend_from_slice(&42u16.to_le_bytes());
    t.extend_from_slice(&8u32.to_le_bytes()); // IFD0 offset
    t.extend_from_slice(&1u16.to_le_bytes()); // one entry
    t.extend_from_slice(&0x0112u16.to_le_bytes());
    t.extend_from_slice(&3u16.to_le_bytes()); // SHORT
    t.extend_from_slice(&1u32.to_le_bytes());
    t.extend_from_slice(&orientation.to_le_bytes());
    t.extend_from_slice(&[0, 0]);
    t.extend_from_slice(&0u32.to_le_bytes()); // no next IFD
    t
}

/// Returns a copy of `jpeg` with an EXIF `APP1` segment carrying `orientation` (plus a GPS-like
/// marker string so tests can prove metadata is stripped). Used by the startup self-test and
/// the test suite.
pub fn jpeg_with_orientation(jpeg: &[u8], orientation: u16) -> Option<Vec<u8>> {
    if !jpeg.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut payload = b"Exif\0\0".to_vec();
    payload.extend_from_slice(&tiff_with_orientation(orientation));
    payload.extend_from_slice(b"CIVPMS-SECRET-GPS-14.5995N-120.9842E");
    let length = u16::try_from(payload.len() + 2).ok()?;
    let mut out = Vec::with_capacity(jpeg.len() + payload.len() + 4);
    out.extend_from_slice(&jpeg[..2]);
    out.extend_from_slice(&[0xFF, 0xE1]);
    out.extend_from_slice(&length.to_be_bytes());
    out.extend_from_slice(&payload);
    out.extend_from_slice(&jpeg[2..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOI_SOF: [u8; 12] = [0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x08, 0x08, 0x00, 0x10, 0x00, 0x20, 0x00];

    #[test]
    fn reads_injected_jpeg_orientation() {
        for value in 1..=8 {
            let jpeg = jpeg_with_orientation(&SOI_SOF, value).unwrap();
            assert_eq!(orientation(ImageKind::Jpeg, &jpeg), Some(value));
        }
        assert_eq!(orientation(ImageKind::Jpeg, &SOI_SOF), None);
    }

    #[test]
    fn reads_big_endian_tiff() {
        let tiff = [b'M', b'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
        assert_eq!(tiff_orientation(&tiff), Some(6));
    }

    #[test]
    fn rejects_out_of_range_and_garbage() {
        let jpeg = jpeg_with_orientation(&SOI_SOF, 9).unwrap();
        assert_eq!(orientation(ImageKind::Jpeg, &jpeg), None);
        assert_eq!(tiff_orientation(b"XX\0\0"), None);
        assert_eq!(tiff_orientation(b""), None);
    }

    #[test]
    fn reads_png_and_webp_chunks() {
        let tiff = tiff_with_orientation(8);
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(&(tiff.len() as u32).to_be_bytes());
        png.extend_from_slice(b"eXIf");
        png.extend_from_slice(&tiff);
        png.extend_from_slice(&[0, 0, 0, 0]); // crc (not checked)
        assert_eq!(orientation(ImageKind::Png, &png), Some(8));

        let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
        webp.extend_from_slice(b"EXIF");
        let mut data = b"Exif\0\0".to_vec();
        data.extend_from_slice(&tiff_with_orientation(3));
        webp.extend_from_slice(&(data.len() as u32).to_le_bytes());
        webp.extend_from_slice(&data);
        assert_eq!(orientation(ImageKind::Webp, &webp), Some(3));
    }

    #[test]
    fn filters_cover_all_orientations() {
        assert_eq!(filter_for(1), None);
        assert_eq!(filter_for(6), Some("transpose=clock"));
        assert!((2..=8).all(|o| filter_for(o).is_some()));
        assert!(swaps_axes(6) && swaps_axes(8) && !swaps_axes(3));
    }
}
