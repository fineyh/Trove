//! Best-effort metadata from media files: GPS position and capture time.
//!
//! - **Images** (incl. iPhone HEIC): EXIF via `kamadak-exif` (pure Rust,
//!   supports JPEG/TIFF/HEIF containers — no native deps,守 ADR-021).
//! - **Videos** (MOV/MP4): we walk the ISO-BMFF box tree by hand (no MP4
//!   crate) for the few atoms we need: `udta/©xyz` (location), Apple's
//!   `meta` creation date, `udta/©day`, and `mvhd`.
//!
//! Capture time (ADR-053) is an instant (UTC ms, for ordering) plus the UTC
//! offset of the place it was taken (for showing the clock time there).
//! Where the file does not say the offset, it comes from the GPS clock, and
//! failing that from this machine's time zone rules on that date.
//!
//! Everything here is best-effort: any parse error or dirty value resolves to
//! `None` so the caller (ingest) never fails because of metadata.

use chrono::{Local, NaiveDate, NaiveDateTime, Offset, TimeZone};
use exif::{In, Tag, Value};
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// When a photo or video was taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Taken {
    /// UTC milliseconds.
    pub at: i64,
    /// Minutes east of UTC at the place it was taken.
    pub offset: i32,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct FileMeta {
    pub geo: Option<(f64, f64)>,
    pub taken: Option<Taken>,
}

/// Read what the file says about itself. `kind` is the media classification
/// (`"image"`/`"video"`/…); other kinds have nothing to read.
pub fn read_meta(path: &Path, kind: &str) -> FileMeta {
    match kind {
        "image" => read_image_meta(path),
        "video" => read_video_meta(path),
        // Recorders that write MP4 (iPhone, most Android) date it like a video.
        "audio" if is_mp4_audio(path) => read_video_meta(path),
        _ => FileMeta::default(),
    }
}

fn is_mp4_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("m4a"))
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

/// 1980-01-01: anything earlier is an unset clock, not a real capture.
const EARLIEST_MS: i64 = 315_532_800_000;

/// A capture time is believable if it is after 1980 and not in the future
/// (a day of slack for clocks that run ahead).
fn plausible(t: Taken) -> Option<Taken> {
    let latest = chrono::Utc::now().timestamp_millis() + 86_400_000;
    (t.at >= EARLIEST_MS && t.at <= latest && t.offset.abs() <= 14 * 60).then_some(t)
}

/// A clock time at a place with a known offset → the instant.
fn from_wall(wall: NaiveDateTime, offset: i32) -> Option<Taken> {
    let utc = wall - chrono::Duration::minutes(offset as i64);
    plausible(Taken { at: utc.and_utc().timestamp_millis(), offset })
}

/// This machine's offset at a given clock time (DST-aware for that date).
fn local_offset_at_wall(wall: NaiveDateTime) -> i32 {
    match Local.from_local_datetime(&wall).earliest() {
        Some(d) => d.offset().fix().local_minus_utc() / 60,
        // The clock time falls in a DST gap: use the offset just after it.
        None => Local.offset_from_utc_datetime(&wall).fix().local_minus_utc() / 60,
    }
}

/// This machine's offset at a given instant.
fn local_offset_at_utc_ms(ms: i64) -> Option<i32> {
    let utc = chrono::DateTime::from_timestamp_millis(ms)?.naive_utc();
    Some(Local.offset_from_utc_datetime(&utc).fix().local_minus_utc() / 60)
}

/// The offset implied by a camera clock and the GPS clock (UTC) at the same
/// moment, rounded to 15 minutes (the GPS fix can be a little stale).
fn offset_from_gps(wall: NaiveDateTime, gps_utc: NaiveDateTime) -> Option<i32> {
    let minutes = (wall - gps_utc).num_seconds() as f64 / 60.0;
    let rounded = ((minutes / 15.0).round() * 15.0) as i32;
    (rounded.abs() <= 14 * 60).then_some(rounded)
}

// --- images (EXIF) ---------------------------------------------------------

fn read_image_meta(path: &Path) -> FileMeta {
    let Some(exif) = File::open(path).ok().and_then(|f| {
        // Reads only the metadata block, not the pixel data.
        exif::Reader::new()
            .read_from_container(&mut BufReader::new(f))
            .ok()
    }) else {
        return FileMeta::default();
    };
    FileMeta { geo: image_geo(&exif), taken: image_taken(&exif) }
}

fn image_geo(exif: &exif::Exif) -> Option<(f64, f64)> {
    let lat = gps_coord(exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, b'S')?;
    let lon = gps_coord(exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, b'W')?;
    valid_coord(lat, lon)
}

fn ascii<'a>(exif: &'a exif::Exif, tag: Tag) -> Option<&'a [u8]> {
    match &exif.get_field(tag, In::PRIMARY)?.value {
        Value::Ascii(v) => v.first().map(|s| s.as_slice()),
        _ => None,
    }
}

fn image_taken(exif: &exif::Exif) -> Option<Taken> {
    // The original capture first; "digitized" is the same moment for a
    // camera and the scan time for a scanned print.
    let tags = [
        (Tag::DateTimeOriginal, Tag::OffsetTimeOriginal, Tag::SubSecTimeOriginal),
        (Tag::DateTimeDigitized, Tag::OffsetTimeDigitized, Tag::SubSecTimeDigitized),
    ];
    for (dt_tag, off_tag, sub_tag) in tags {
        let Some(mut dt) = ascii(exif, dt_tag).and_then(|b| exif::DateTime::from_ascii(b).ok()) else {
            continue;
        };
        if let Some(b) = ascii(exif, off_tag) {
            let _ = dt.parse_offset(b);
        }
        if let Some(b) = ascii(exif, sub_tag) {
            let _ = dt.parse_subsec(b);
        }
        let Some(wall) = NaiveDate::from_ymd_opt(dt.year as i32, dt.month as u32, dt.day as u32)
            .and_then(|d| {
                d.and_hms_nano_opt(
                    dt.hour as u32,
                    dt.minute as u32,
                    dt.second as u32,
                    dt.nanosecond.unwrap_or(0),
                )
            })
        else {
            continue;
        };
        let offset = dt
            .offset
            .map(i32::from)
            .or_else(|| gps_utc(exif).and_then(|g| offset_from_gps(wall, g)))
            .unwrap_or_else(|| local_offset_at_wall(wall));
        if let Some(t) = from_wall(wall, offset) {
            return Some(t);
        }
    }
    None
}

/// The GPS clock (always UTC): `GPSDateStamp` "YYYY:MM:DD" + `GPSTimeStamp`
/// hours / minutes / seconds as rationals.
fn gps_utc(exif: &exif::Exif) -> Option<NaiveDateTime> {
    let date = std::str::from_utf8(ascii(exif, Tag::GPSDateStamp)?).ok()?;
    let date = NaiveDate::parse_from_str(date.trim(), "%Y:%m:%d").ok()?;
    let hms = match &exif.get_field(Tag::GPSTimeStamp, In::PRIMARY)?.value {
        Value::Rational(v) if v.len() >= 3 => {
            v[0].to_f64() * 3600.0 + v[1].to_f64() * 60.0 + v[2].to_f64()
        }
        _ => return None,
    };
    if !hms.is_finite() || !(0.0..86_401.0).contains(&hms) {
        return None;
    }
    Some(date.and_hms_opt(0, 0, 0)? + chrono::Duration::milliseconds((hms * 1000.0) as i64))
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

// --- videos (MOV/MP4 atoms) ------------------------------------------------

fn read_video_meta(path: &Path) -> FileMeta {
    let Ok(file) = File::open(path) else {
        return FileMeta::default();
    };
    let Ok(len) = file.metadata().map(|m| m.len()) else {
        return FileMeta::default();
    };
    let mut r = BufReader::new(file);
    let Some((moov_s, moov_e)) = find_box(&mut r, 0, len, b"moov").ok().flatten() else {
        return FileMeta::default();
    };
    let udta = find_box(&mut r, moov_s, moov_e, b"udta").ok().flatten();

    let geo = udta
        .and_then(|(s, e)| udta_string(&mut r, s, e, b'x', b'y', b'z'))
        .and_then(|s| parse_iso6709(&s));

    // Apple's creation date carries the offset; ©day sometimes does; mvhd is
    // UTC only, so its offset comes from this machine's zone rules.
    let taken = apple_creation_date(&mut r, moov_s, moov_e)
        .and_then(|s| parse_iso8601(&s))
        .or_else(|| {
            udta.and_then(|(s, e)| udta_string(&mut r, s, e, b'd', b'a', b'y'))
                .and_then(|s| parse_iso8601(&s))
        })
        .or_else(|| {
            let at = mvhd_creation_ms(&mut r, moov_s, moov_e)?;
            plausible(Taken { at, offset: local_offset_at_utc_ms(at)? })
        });

    FileMeta { geo, taken }
}

/// A `udta/©xxx` string atom: [u16 string length][u16 language][bytes].
fn udta_string<R: Read + Seek>(r: &mut R, start: u64, end: u64, a: u8, b: u8, c: u8) -> Option<String> {
    let (s, e) = find_box(r, start, end, &[0xA9, a, b, c]).ok()??;
    let content_len = e.saturating_sub(s) as usize;
    if !(4..=4096).contains(&content_len) {
        return None;
    }
    let buf = read_at(r, s, content_len)?;
    let declared = u16::from_be_bytes([buf[0], buf[1]]) as usize;
    let end = (4 + declared).min(content_len).max(4);
    Some(std::str::from_utf8(&buf[4..end]).ok()?.to_string())
}

fn read_at<R: Read + Seek>(r: &mut R, pos: u64, len: usize) -> Option<Vec<u8>> {
    r.seek(SeekFrom::Start(pos)).ok()?;
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).ok()?;
    Some(buf)
}

/// Seconds between 1904-01-01 (QuickTime epoch) and 1970-01-01.
const QT_EPOCH_OFFSET: u64 = 2_082_844_800;

/// `moov/mvhd` creation time as UTC ms. Zero means "not set".
fn mvhd_creation_ms<R: Read + Seek>(r: &mut R, start: u64, end: u64) -> Option<i64> {
    let (s, e) = find_box(r, start, end, b"mvhd").ok()??;
    let head = read_at(r, s, (e - s).min(12) as usize)?;
    let secs = match head.first()? {
        0 if head.len() >= 8 => u32::from_be_bytes(head[4..8].try_into().ok()?) as u64,
        1 if head.len() >= 12 => u64::from_be_bytes(head[4..12].try_into().ok()?),
        _ => return None,
    };
    let unix = secs.checked_sub(QT_EPOCH_OFFSET)?;
    i64::try_from(unix).ok()?.checked_mul(1000)
}

const APPLE_CREATION_KEY: &[u8] = b"com.apple.quicktime.creationdate";

/// iPhone videos: `moov/meta` holds a `keys` list and an `ilst` whose child
/// box types are 1-based indexes into it; the value sits in a `data` box.
fn apple_creation_date<R: Read + Seek>(r: &mut R, start: u64, end: u64) -> Option<String> {
    let (ms, me) = find_box(r, start, end, b"meta").ok()??;
    // QuickTime `meta` has no version/flags; the MP4 one does. Try both.
    let (keys, ilst) = [ms, ms + 4].into_iter().find_map(|s| {
        let keys = find_box(r, s, me, b"keys").ok()??;
        let ilst = find_box(r, s, me, b"ilst").ok()??;
        Some((keys, ilst))
    })?;

    let keys_len = (keys.1 - keys.0) as usize;
    if !(8..=65_536).contains(&keys_len) {
        return None;
    }
    let buf = read_at(r, keys.0, keys_len)?;
    let count = u32::from_be_bytes(buf[4..8].try_into().ok()?) as usize;
    let mut pos = 8usize;
    let mut index = None;
    for i in 0..count {
        let size = u32::from_be_bytes(buf.get(pos..pos + 4)?.try_into().ok()?) as usize;
        if size < 8 || pos + size > buf.len() {
            return None;
        }
        if &buf[pos + 8..pos + size] == APPLE_CREATION_KEY {
            index = Some(i as u32 + 1);
            break;
        }
        pos += size;
    }
    let item = find_box(r, ilst.0, ilst.1, &index?.to_be_bytes()).ok()??;
    let (ds, de) = find_box(r, item.0, item.1, b"data").ok()??;
    // data: [u32 type][u32 locale][value]
    let len = (de - ds) as usize;
    if !(9..=256).contains(&len) {
        return None;
    }
    let data = read_at(r, ds, len)?;
    Some(std::str::from_utf8(&data[8..]).ok()?.trim_end_matches('\0').to_string())
}

/// Parse an ISO 8601 date-time that states its offset, e.g.
/// `2019-05-03T20:01:02+0900`, `2019-05-03T20:01:02+09:00`, `...Z`.
/// Without an offset it is not useful here (mvhd already gives the instant).
fn parse_iso8601(s: &str) -> Option<Taken> {
    let s = s.trim();
    let dt = chrono::DateTime::parse_from_rfc3339(s)
        .or_else(|_| chrono::DateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f%z"))
        .or_else(|_| chrono::DateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%z"))
        .ok()?;
    plausible(Taken {
        at: dt.timestamp_millis(),
        offset: dt.offset().local_minus_utc() / 60,
    })
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
    use std::io::Cursor;

    fn wall(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

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

    #[test]
    fn a_tokyo_evening_keeps_its_clock_time() {
        // 20:00 in Tokyo is 11:00 UTC; shown back as 20:00 wherever you are.
        let t = from_wall(wall("2019-05-03 20:00:00"), 540).unwrap();
        assert_eq!(t.at, wall("2019-05-03 11:00:00").and_utc().timestamp_millis());
        assert_eq!(t.offset, 540);
    }

    #[test]
    fn gps_clock_gives_the_offset() {
        let w = wall("2019-05-03 20:00:10");
        assert_eq!(offset_from_gps(w, wall("2019-05-03 11:00:00")), Some(540));
        // A fix a few minutes stale still rounds to the zone.
        assert_eq!(offset_from_gps(w, wall("2019-05-03 10:56:00")), Some(540));
        // India is +5:30.
        assert_eq!(offset_from_gps(w, wall("2019-05-03 14:30:00")), Some(330));
        // A GPS clock a day off is not an offset.
        assert_eq!(offset_from_gps(w, wall("2019-05-02 11:00:00")), None);
    }

    #[test]
    fn iso8601_with_and_without_colon() {
        let a = parse_iso8601("2019-05-03T20:01:02+0900").unwrap();
        let b = parse_iso8601("2019-05-03T20:01:02+09:00").unwrap();
        assert_eq!(a, b);
        assert_eq!(a.offset, 540);
        assert_eq!(a.at, wall("2019-05-03 11:01:02").and_utc().timestamp_millis());
        assert_eq!(parse_iso8601("2019-05-03T11:01:02Z").unwrap().offset, 0);
        assert_eq!(parse_iso8601("2019-05-03T20:01:02.123-0430").unwrap().offset, -270);
    }

    #[test]
    fn unset_clocks_are_rejected() {
        assert_eq!(parse_iso8601("1904-01-01T00:00:00Z"), None);
        assert_eq!(from_wall(wall("1970-01-01 00:00:00"), 0), None);
        assert_eq!(parse_iso8601("2019-05-03"), None, "no time, no offset");
    }

    fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(kind);
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn mvhd_v0_creation_time() {
        // 2019-05-03 11:00:00 UTC
        let unix = wall("2019-05-03 11:00:00").and_utc().timestamp() as u64;
        let mut body = vec![0u8, 0, 0, 0];
        body.extend_from_slice(&((unix + QT_EPOCH_OFFSET) as u32).to_be_bytes());
        body.extend_from_slice(&[0u8; 8]);
        let file = boxed(b"moov", &boxed(b"mvhd", &body));
        let mut r = Cursor::new(file.clone());
        let ms = mvhd_creation_ms(&mut r, 8, file.len() as u64).unwrap();
        assert_eq!(ms, unix as i64 * 1000);
    }

    #[test]
    fn apple_creation_date_from_keys_and_ilst() {
        let mut keys = vec![0u8, 0, 0, 0];
        keys.extend_from_slice(&2u32.to_be_bytes());
        for k in [&b"com.apple.quicktime.make"[..], APPLE_CREATION_KEY] {
            keys.extend_from_slice(&((k.len() + 8) as u32).to_be_bytes());
            keys.extend_from_slice(b"mdta");
            keys.extend_from_slice(k);
        }
        let mut data = vec![0u8, 0, 0, 1, 0, 0, 0, 0];
        data.extend_from_slice(b"2019-05-03T20:01:02+0900");
        let mut make = vec![0u8, 0, 0, 1, 0, 0, 0, 0];
        make.extend_from_slice(b"Apple");
        let mut ilst = boxed(&1u32.to_be_bytes(), &boxed(b"data", &make));
        ilst.extend(boxed(&2u32.to_be_bytes(), &boxed(b"data", &data)));
        let mut meta = boxed(b"hdlr", &[0u8; 24]);
        meta.extend(boxed(b"keys", &keys));
        meta.extend(boxed(b"ilst", &ilst));
        let file = boxed(b"moov", &boxed(b"meta", &meta));
        let mut r = Cursor::new(file.clone());
        let s = apple_creation_date(&mut r, 8, file.len() as u64).unwrap();
        assert_eq!(s, "2019-05-03T20:01:02+0900");
    }
}
