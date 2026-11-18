//! Audio recordings (ADR-058): which files count as audio, and their
//! waveform.
//!
//! The waveform is a short row of loudness bars shown in the message bubble.
//! It is made here rather than in the WebView: decoding a two-hour recording
//! with WebAudio holds all of it in memory as PCM (gigabytes), while this
//! decodes packet by packet and keeps one number per chunk.
//!
//! The queue is `media.thumb_scanned` on audio rows (0 to do, 1 done, 2 gave
//! up), the same flag images and videos use for thumbnails; the WebView's
//! thumbnail worker only asks for images and videos, so the two never meet.

use crate::services::volume_resolver;
use crate::{db, events, AppError, AppResult};
use rusqlite::params;
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Extensions taken as audio. A list rather than the MIME type: `mime_guess`
/// also calls MIDI and playlists "audio".
pub const AUDIO_EXTS: &[&str] = &[
    "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "amr", "wma", "aif", "aiff",
];

pub fn is_audio_ext(ext: &str) -> bool {
    AUDIO_EXTS.iter().any(|e| e.eq_ignore_ascii_case(ext))
}

pub fn is_audio(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(is_audio_ext)
}

/// Bars stored per recording. The bubble draws fewer, merging neighbours.
pub const PEAKS: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Analysis {
    pub duration_ms: i64,
    /// `PEAKS` values, 0–255: the loudest sample in each stretch.
    pub peaks: Vec<u8>,
}

/// Decode the whole file once. `None` when no decoder handles it (Opus, AMR,
/// WMA): those still play in the WebView where it can, just without bars.
pub fn analyze(path: &Path) -> Option<Analysis> {
    let file = std::fs::File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .ok()?;
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL)?;
    let track_id = track.id;
    let mut rate = track.codec_params.sample_rate.unwrap_or(0) as u64;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .ok()?;

    // One peak per CHUNK frames, folded down to PEAKS at the end; the frame
    // count isn't known up front for every container.
    const CHUNK: u64 = 4096;
    let mut chunks: Vec<f32> = Vec::new();
    let (mut in_chunk, mut chunk_peak, mut frames) = (0u64, 0f32, 0u64);
    let mut buf: Option<SampleBuffer<f32>> = None;
    let mut bad = 0u32;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(_)) | Err(SymError::ResetRequired) => break,
            Err(_) => return None,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // A damaged packet here and there: skip it. Many in a row: not audio.
            Err(SymError::DecodeError(_)) => {
                bad += 1;
                if bad > 64 && frames == 0 {
                    return None;
                }
                continue;
            }
            Err(_) => break,
        };
        let spec = *decoded.spec();
        if rate == 0 {
            rate = spec.rate as u64;
        }
        let channels = spec.channels.count().max(1);
        let need = decoded.capacity() as u64;
        if buf.as_ref().map_or(true, |b| (b.capacity() as u64) < need * channels as u64) {
            buf = Some(SampleBuffer::new(need, spec));
        }
        let b = buf.as_mut()?;
        b.copy_interleaved_ref(decoded);
        for frame in b.samples().chunks(channels) {
            let v = frame.iter().fold(0f32, |m, s| m.max(s.abs()));
            chunk_peak = chunk_peak.max(v);
            in_chunk += 1;
            if in_chunk == CHUNK {
                chunks.push(chunk_peak);
                in_chunk = 0;
                chunk_peak = 0.0;
            }
        }
        frames += (b.samples().len() / channels) as u64;
    }
    if in_chunk > 0 {
        chunks.push(chunk_peak);
    }
    if frames == 0 || rate == 0 {
        return None;
    }
    Some(Analysis {
        duration_ms: (frames * 1000 / rate) as i64,
        peaks: fold(&chunks, PEAKS),
    })
}

/// Fold per-chunk peaks into `n` bars (max of each stretch), as 0–255.
fn fold(chunks: &[f32], n: usize) -> Vec<u8> {
    if chunks.is_empty() {
        return vec![0; n];
    }
    (0..n)
        .map(|i| {
            let a = i * chunks.len() / n;
            let b = ((i + 1) * chunks.len() / n).max(a + 1).min(chunks.len());
            let peak = chunks[a.min(chunks.len() - 1)..b].iter().fold(0f32, |m, v| m.max(*v));
            (peak.clamp(0.0, 1.0) * 255.0).round() as u8
        })
        .collect()
}

// --- Queue -------------------------------------------------------------------

static RUNNING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn claim(lib: &str) -> bool {
    let mut guard = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    guard.get_or_insert_with(HashSet::new).insert(lib.to_string())
}

fn release(lib: &str) {
    let mut guard = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(set) = guard.as_mut() {
        set.remove(lib);
    }
}

/// Make the waveforms `lib` is missing, on a thread of its own. A no-op while
/// a pass for that library is running.
pub fn spawn(lib: String) {
    if !db::is_open(&lib) || !claim(&lib) {
        return;
    }
    let spawned = std::thread::Builder::new().name(format!("trove-audio-{lib}")).spawn({
        let lib = lib.clone();
        move || {
            if let Err(e) = run(&lib) {
                log::warn!("waveforms [{lib}]: {e}");
            }
            release(&lib);
        }
    });
    if let Err(e) = spawned {
        log::error!("spawn waveforms: {e}");
        release(&lib);
    }
}

fn run(lib: &str) -> AppResult<()> {
    loop {
        // One at a time: a file can take seconds, and the library may close.
        if !db::is_open(lib) {
            return Ok(());
        }
        let next: Option<(i64, String)> = db::with_lib(lib, |c| {
            use rusqlite::OptionalExtension;
            c.query_row(
                "SELECT md.id, v.last_mount, md.relpath FROM media md
                 JOIN volumes v ON v.id = md.volume_id
                 WHERE md.thumb_scanned = 0 AND md.kind = 'audio'
                   AND md.state = 'live' AND v.online = 1 AND v.last_mount IS NOT NULL
                 ORDER BY md.id DESC LIMIT 1",
                [],
                |r| {
                    let mount: String = r.get(1)?;
                    let rel: String = r.get(2)?;
                    Ok((
                        r.get(0)?,
                        volume_resolver::absolute_for(Path::new(&mount), &rel).to_string_lossy().to_string(),
                    ))
                },
            )
            .optional()
            .map_err(AppError::from)
        })?;
        let Some((id, abs)) = next else { return Ok(()) };
        let path = Path::new(&abs);
        if !path.exists() {
            // Gone since the volume scan: leave it for the missing-file flow.
            db::with_lib(lib, |c| {
                c.execute("UPDATE media SET thumb_scanned = 2 WHERE id = ?1", [id])?;
                Ok(())
            })?;
            continue;
        }
        let result = analyze(path);
        let convs = db::with_lib(lib, |c| store(c, id, result.as_ref()).map_err(AppError::from))?;
        for conv_id in convs {
            events::emit_conv_changed(events::ConvChanged { lib: lib.to_string(), conv_id, added: 0, broken: 0, renamed: 0 });
        }
    }
}

/// Save one result; returns the conversations showing this file.
fn store(c: &rusqlite::Connection, id: i64, a: Option<&Analysis>) -> rusqlite::Result<Vec<i64>> {
    match a {
        Some(a) => c.execute(
            "UPDATE media SET peaks = ?2, duration_ms = ?3, thumb_scanned = 1 WHERE id = ?1",
            params![id, a.peaks, a.duration_ms],
        )?,
        None => c.execute("UPDATE media SET thumb_scanned = 2 WHERE id = ?1", [id])?,
    };
    let mut st = c.prepare_cached("SELECT DISTINCT conv_id FROM messages WHERE media_id = ?1")?;
    let convs = st.query_map([id], |r| r.get(0))?.collect();
    convs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_by_extension() {
        assert!(is_audio(Path::new("D:/录音/会议.M4A")));
        assert!(is_audio(Path::new("a.amr")));
        assert!(!is_audio(Path::new("song.mid")));
        assert!(!is_audio(Path::new("clip.mp4")));
        assert!(!is_audio(Path::new("noext")));
    }

    #[test]
    fn fold_keeps_the_loudest_of_each_stretch() {
        let chunks = [0.1, 1.0, 0.2, 0.0, 0.5, 0.5];
        assert_eq!(fold(&chunks, 3), vec![255, 51, 128]);
        // Fewer chunks than bars: each chunk repeats.
        assert_eq!(fold(&[0.0, 1.0], 4), vec![0, 0, 255, 255]);
        assert_eq!(fold(&[], 2), vec![0, 0]);
    }

    /// An 8 kHz mono WAV of 16384 frames: the first half silent, then a
    /// full-scale square wave.
    fn wav() -> Vec<u8> {
        let rate = 8000u32;
        let samples: Vec<i16> = (0..16384u32)
            .map(|i| if i < 8192 { 0 } else if i % 2 == 0 { i16::MAX } else { -i16::MAX })
            .collect();
        let data_len = (samples.len() * 2) as u32;
        let mut w = Vec::new();
        w.extend_from_slice(b"RIFF");
        w.extend_from_slice(&(36 + data_len).to_le_bytes());
        w.extend_from_slice(b"WAVEfmt ");
        w.extend_from_slice(&16u32.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes()); // PCM
        w.extend_from_slice(&1u16.to_le_bytes()); // mono
        w.extend_from_slice(&rate.to_le_bytes());
        w.extend_from_slice(&(rate * 2).to_le_bytes());
        w.extend_from_slice(&2u16.to_le_bytes());
        w.extend_from_slice(&16u16.to_le_bytes());
        w.extend_from_slice(b"data");
        w.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            w.extend_from_slice(&s.to_le_bytes());
        }
        w
    }

    #[test]
    fn analyzes_a_wav() {
        let dir = std::env::temp_dir().join(format!("trove-audio-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.wav");
        std::fs::write(&p, wav()).unwrap();
        let a = analyze(&p).expect("wav decodes");
        assert_eq!(a.duration_ms, 2048);
        assert_eq!(a.peaks.len(), PEAKS);
        assert_eq!(a.peaks[0], 0, "starts silent");
        assert!(a.peaks[PEAKS - 1] > 250, "ends loud");

        std::fs::write(&p, b"not audio at all").unwrap();
        assert!(analyze(&p).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_marks_done_or_given_up() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&conn);
        conn.execute_batch(
            "INSERT INTO volumes (id, platform_id, created_at) VALUES (1, 'v', 0);
             INSERT INTO conversations (id, name, kind, created_at, updated_at) VALUES (7, 'c', 'manual', 0, 0);
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind)
               VALUES (1, 1, 'a.m4a', 1, 0, 'h', 'audio'), (2, 1, 'b.amr', 1, 0, 'h', 'audio');
             INSERT INTO messages (conv_id, media_id, created_at) VALUES (7, 1, 0);",
        )
        .unwrap();
        let a = Analysis { duration_ms: 1234, peaks: vec![9; PEAKS] };
        assert_eq!(store(&conn, 1, Some(&a)).unwrap(), vec![7]);
        assert_eq!(store(&conn, 2, None).unwrap(), Vec::<i64>::new());
        let row: (Vec<u8>, i64, i64) = conn
            .query_row("SELECT peaks, duration_ms, thumb_scanned FROM media WHERE id = 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(row, (vec![9; PEAKS], 1234, 1));
        let s: i64 = conn.query_row("SELECT thumb_scanned FROM media WHERE id = 2", [], |r| r.get(0)).unwrap();
        assert_eq!(s, 2);
    }
}
