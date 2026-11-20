//! Thumbnail queue, Rust side (ADR-037).
//!
//! Thumbnails are made by the WebView (it already decodes every format we
//! show, including HEIC and video first frames) and handed back here to be
//! stored in the library's `thumbs` table. Rust owns the queue: it is just
//! `media.thumb_scanned = 0`, so it survives restarts and is resumable by
//! construction. `wake` nudges the frontend worker when new work appears.

use crate::{db, events, AppResult};
use rusqlite::params;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbJob {
    pub media_id: i64,
    pub kind: String,
    pub ext: String,
}

/// Tell the frontend's worker there may be new work in `lib`, and make any
/// missing audio waveforms (ADR-058).
pub fn wake(lib: &str) {
    events::emit_thumbs_wake(lib);
    crate::services::audio::spawn(lib.to_string());
}

/// Next jobs: images and videos whose file is reachable right now. Offline
/// and missing rows stay queued and are picked up once their volume returns.
pub fn next_batch(lib: &str, limit: i64) -> AppResult<Vec<ThumbJob>> {
    db::with_lib(lib, |c| {
        let mut st = c.prepare(
            "SELECT md.id, md.kind, md.relpath FROM media md
             JOIN volumes v ON v.id = md.volume_id
             WHERE md.thumb_scanned = 0 AND md.kind IN ('image', 'video')
               AND md.state = 'live' AND v.online = 1
             ORDER BY md.id DESC
             LIMIT ?1",
        )?;
        let r = st
            .query_map(params![limit], |r| {
                let rel: String = r.get(2)?;
                Ok(ThumbJob {
                    media_id: r.get(0)?,
                    kind: r.get(1)?,
                    ext: crate::commands::messages::ext_of(&rel),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })
}

/// Bumped whenever video covers are picked differently, so covers made the
/// old way are remade once (old ones keep showing until the new one lands).
const VIDEO_COVER_REV: &str = "2";

/// Run on open: requeue finished video covers if they predate `VIDEO_COVER_REV`.
pub fn requeue_stale_video_covers(c: &rusqlite::Connection) -> rusqlite::Result<()> {
    use rusqlite::OptionalExtension;
    let have: Option<String> = c
        .query_row("SELECT value FROM settings WHERE key = 'video_cover_rev'", [], |r| r.get(0))
        .optional()?;
    if have.as_deref() == Some(VIDEO_COVER_REV) {
        return Ok(());
    }
    let tx = c.unchecked_transaction()?;
    tx.execute("UPDATE media SET thumb_scanned = 0 WHERE kind = 'video' AND thumb_scanned = 1", [])?;
    tx.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES ('video_cover_rev', ?1)",
        [VIDEO_COVER_REV],
    )?;
    tx.commit()
}

pub fn remaining(lib: &str) -> AppResult<i64> {
    db::with_lib(lib, |c| {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM media md JOIN volumes v ON v.id = md.volume_id
             WHERE md.thumb_scanned = 0 AND md.kind IN ('image', 'video')
               AND md.state = 'live' AND v.online = 1",
            [],
            |r| r.get(0),
        )?)
    })
}

pub struct Put<'a> {
    pub media_id: i64,
    pub data: &'a [u8],
    pub mime: &'a str,
    pub width: i64,
    pub height: i64,
    /// Dimensions of the original, learned while decoding it.
    pub orig_width: Option<i64>,
    pub orig_height: Option<i64>,
    pub duration_ms: Option<i64>,
}

pub fn put(lib: &str, p: Put) -> AppResult<()> {
    if p.data.is_empty() || p.data.len() > 512 * 1024 {
        return fail(lib, p.media_id);
    }
    let now = chrono::Utc::now().timestamp_millis();
    db::with_lib(lib, |c| {
        let tx = c.unchecked_transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO thumbs (media_id, data, mime, width, height, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![p.media_id, p.data, p.mime, p.width, p.height, now],
        )?;
        tx.execute(
            "UPDATE media SET thumb_scanned = 1,
                width = COALESCE(?2, width), height = COALESCE(?3, height),
                duration_ms = COALESCE(?4, duration_ms)
             WHERE id = ?1",
            params![p.media_id, p.orig_width, p.orig_height, p.duration_ms],
        )?;
        tx.commit()?;
        Ok(())
    })
}

/// The WebView couldn't decode it; don't retry until the file changes.
pub fn fail(lib: &str, media_id: i64) -> AppResult<()> {
    db::with_lib(lib, |c| {
        c.execute("UPDATE media SET thumb_scanned = 2 WHERE id = ?1", params![media_id])?;
        Ok(())
    })
}

pub fn get(lib: &str, media_id: i64) -> AppResult<Option<(Vec<u8>, String)>> {
    use rusqlite::OptionalExtension;
    db::with_lib(lib, |c| {
        Ok(c.query_row(
            "SELECT data, mime FROM thumbs WHERE media_id = ?1",
            params![media_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
    })
}

#[derive(Debug, Serialize)]
pub struct ThumbsStatus {
    pub remaining: i64,
}

#[allow(dead_code)]
pub fn status(lib: &str) -> AppResult<ThumbsStatus> {
    Ok(ThumbsStatus { remaining: remaining(lib)? })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn video_covers_are_requeued_once() {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&c);
        c.execute_batch(
            "INSERT INTO volumes (id, platform_id, online, created_at) VALUES (1, 'v', 1, 0);
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind, thumb_scanned)
               VALUES (1, 1, 'a.mp4', 1, 0, 'a', 'video', 1),
                      (2, 1, 'b.jpg', 1, 0, 'b', 'image', 1),
                      (3, 1, 'c.mp4', 1, 0, 'c', 'video', 2);",
        )
        .unwrap();
        let scanned = |id: i64| -> i64 {
            c.query_row("SELECT thumb_scanned FROM media WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        super::requeue_stale_video_covers(&c).unwrap();
        assert_eq!((scanned(1), scanned(2), scanned(3)), (0, 1, 2));
        c.execute("UPDATE media SET thumb_scanned = 1 WHERE id = 1", []).unwrap();
        super::requeue_stale_video_covers(&c).unwrap();
        assert_eq!(scanned(1), 1);
    }
}
