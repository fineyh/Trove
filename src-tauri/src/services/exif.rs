//! Best-effort GPS extraction from media files.
//!
//! - **Images** (incl. iPhone HEIC): standard EXIF GPS IFD via `kamadak-exif`
//!   (pure Rust, supports JPEG/TIFF/HEIF containers — no native deps,守 ADR-021).
//! - **Videos** (MOV/MP4): the QuickTime `moov/udta/©xyz` atom holds an ISO 6709
//!   location string. We walk the ISO-BMFF box tree by hand (no MP4 crate) since
//!   we only need one nested atom.
//!
//! Everything here is best-effort: any parse error, missing GPS, or dirty value
//! resolves to `None` so the caller (ingest) never fails because of geotagging.

use exif::{In, Tag, Value};
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// Read a `(lat, lon)` pair in decimal degrees, or `None` if the file has no
/// usable location. `kind` is the media classification (`"image"`/`"video"`/…).
pub fn read_geotag(path: &Path, kind: &str) -> Option<(f64, f64)> {
    match kind {
        "image" => read_image_geotag(path),
        "video" => read_video_geotag(path),
        _ => None,
    }
}

/// Reject obviously bogus coordinates (out of range, or the (0,0) null island
/// that some buggy encoders emit when GPS is actually absent).
fn valid_coord(lat: f64, lon: f64) -> Option<(f64, f64)> {
    if !lat.is_finite() || !lon.is_finite() {
        return None;
    }
    if lat.abs() > 90.0 || lon.abs() > 180.0 {
        return None;
    }
    if lat == 0.0 && lon == 0.0 {
        return None;
    }
    Some((lat, lon))
}

// --- images (EXIF) ---------------------------------------------------------

fn read_image_geotag(path: &Path) -> Option<(f64, f64)> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    // Reads only the metadata/EXIF block, not the pixel data.
    let exif = exif::Reader::new()
        .read_from_container(&mut reader)
        .ok()?;
    let lat = gps_coord(&exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, b'S')?;
    let lon = gps_coord(&exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, b'W')?;
    valid_coord(lat, lon)
}

/// Convert a GPS coordinate (degrees/minutes/seconds rationals + N/S/E/W ref)
/// to a signed decimal degree. `neg_ref` is the hemisphere letter that flips the
/// sign (`b'S'` for latitude, `b'W'` for longitude).
fn gps_coord(exif: &exif::Exif, coord_tag: Tag, ref_tag: Tag, neg_ref: u8) -> Option<f64> {
    let field = exif.get_field(coord_tag, In::PRIMARY)?;
    let dms = match &field.value {
        Value::Rational(v) if v.len() >= 3 => {
            v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0
        }
        _ => return None,
    };
    let mut dec = dms;
    if let Some(rf) = exif.get_field(ref_tag, In::PRIMARY) {
        if let Value::Ascii(a) = &rf.value {
            if let Some(letter) = a.first().and_then(|s| s.first()) {
                if letter.to_ascii_uppercase() == neg_ref {
                    dec = -dec;
                }
            }
        }
    }
    Some(dec)
}

// --- videos (MOV/MP4 ©xyz atom) --------------------------------------------

fn read_video_geotag(path: &Path) -> Option<(f64, f64)> {
    let file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let mut reader = BufReader::new(file);

    let (moov_s, moov_e) = find_box(&mut reader, 0, len, b"moov").ok()??;
    let (udta_s, udta_e) = find_box(&mut reader, moov_s, moov_e, b"udta").ok()??;
    let xyz = [0xA9u8, b'x', b'y', b'z'];
    let (xyz_s, xyz_e) = find_box(&mut reader, udta_s, udta_e, &xyz).ok()??;

    // ©xyz payload layout: [u16 string length][u16 language code][string bytes].
    let content_len = (xyz_e.saturating_sub(xyz_s)) as usize;
    if content_len < 4 || content_len > 4096 {
        return None;
    }
    reader.seek(SeekFrom::Start(xyz_s)).ok()?;
    let mut buf = vec![0u8; content_len];
    reader.read_exact(&mut buf).ok()?;
    let declared = u16::from_be_bytes([buf[0], buf[1]]) as usize;
    let end = (4 + declared).min(content_len).max(4);
    let s = std::str::from_utf8(&buf[4..end]).ok()?;
    parse_iso6709(s)
}

/// Iterate the ISO-BMFF boxes in `[start, end)` and return the `(content_start,
/// content_end)` of the first box whose 4-byte type equals `target`. Handles the
/// 32-bit size, 64-bit `largesize` (size == 1), and "to end of file" (size == 0)
/// encodings. Bails on malformed sizes rather than looping.
fn find_box<R: Read + Seek>(
    r: &mut R,
    start: u64,
    end: u64,
    target: &[u8; 4],
) -> io::Result<Option<(u64, u64)>> {
    let mut pos = start;
    while pos + 8 <= end {
        r.seek(SeekFrom::Start(pos))?;
        let mut header = [0u8; 8];
        if r.read_exact(&mut header).is_err() {
            break;
        }
        let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
        let btype = [header[4], header[5], header[6], header[7]];

        let (content_start, box_end) = if size32 == 1 {
            let mut large = [0u8; 8];
            if r.read_exact(&mut large).is_err() {
                break;
            }
            (pos + 16, pos + u64::from_be_bytes(large))
        } else if size32 == 0 {
            (pos + 8, end) // extends to the end of the enclosing region
        } else {
            (pos + 8, pos + size32)
        };

        // Guard against malformed sizes that would loop forever or overrun.
        if box_end <= content_start || box_end > end {
            break;
        }
        if &btype == target {
            return Ok(Some((content_start, box_end)));
        }
        pos = box_end;
    }
    Ok(None)
}

/// Parse an ISO 6709 location string (e.g. `+37.7858-122.4064/` or
/// `+27.5916+086.5640+8850.000/`). Latitude first, longitude second; altitude
/// (if present) is ignored.
fn parse_iso6709(s: &str) -> Option<(f64, f64)> {
    let s = s.trim().trim_end_matches('/');
    if s.is_empty() {
        return None;
    }
    // Split into signed numeric tokens: a new token starts at every '+'/'-'
    // that isn't the very first character.
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    for (i, c) in s.char_indices() {
        if (c == '+' || c == '-') && i != 0 && !cur.is_empty() {
            parts.push(std::mem::take(&mut cur));
        }
        cur.push(c);
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    let lat: f64 = parts.first()?.parse().ok()?;
    let lon: f64 = parts.get(1)?.parse().ok()?;
    valid_coord(lat, lon)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso6709_lat_lon() {
        assert_eq!(parse_iso6709("+37.7858-122.4064/"), Some((37.7858, -122.4064)));
    }

    #[test]
    fn iso6709_with_altitude() {
        let p = parse_iso6709("+27.5916+086.5640+8850.000/").unwrap();
        assert!((p.0 - 27.5916).abs() < 1e-6);
        assert!((p.1 - 86.5640).abs() < 1e-6);
    }

    #[test]
    fn iso6709_null_island_rejected() {
        assert_eq!(parse_iso6709("+00.0000+000.0000/"), None);
    }

    #[test]
    fn iso6709_garbage_rejected() {
        assert_eq!(parse_iso6709("not a coordinate"), None);
        assert_eq!(parse_iso6709(""), None);
    }
}
