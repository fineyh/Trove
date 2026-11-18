//! Viewing history (ADR-054).
//!
//! A view is one item open in a viewer (the Lightbox, a popup window, the map
//! viewer). Its spans are the stretches actually watched, written by the
//! frontend every 15 seconds. "How long did I watch today" merges the spans of
//! every view, so two windows playing at once count once; a video's own time
//! is the sum of its own spans.

use crate::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};

/// The longest single span we accept.
const MAX_SPAN_MS: i64 = 24 * 3_600_000;
/// The frontend's clock may run a little ahead of ours.
const FUTURE_SLACK_MS: i64 = 60_000;
/// Real UTC offsets lie within ±14 hours.
const MAX_OFFSET_MIN: i64 = 14 * 60;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Is viewing recorded at all? App-wide, read from the main library. On
/// unless switched off.
pub fn enabled(main: &Connection) -> AppResult<bool> {
    let v: Option<String> = main
        .query_row("SELECT value FROM settings WHERE key = 'view_stats'", [], |r| r.get(0))
        .optional()?;
    Ok(v.as_deref() != Some("off"))
}

fn valid_span(start: i64, end: i64, now: i64) -> bool {
    start > 0 && end >= start && end - start <= MAX_SPAN_MS && end <= now + FUTURE_SLACK_MS
}

/// Has this view become "one play"? Videos and audio: 3 seconds, or 90% of a
/// clip shorter than that. Photos: 1 second.
pub fn counts(kind: &str, watch_ms: i64, duration_ms: Option<i64>) -> bool {
    if kind == "image" {
        return watch_ms >= 1_000;
    }
    let need = match duration_ms {
        Some(d) if d > 0 => (d * 9 / 10).min(3_000),
        _ => 3_000,
    };
    watch_ms >= need
}

/// Start a view of `message_id`. `None` when the message has no image,
/// video or audio (nothing to record).
pub fn begin(
    c: &Connection,
    message_id: i64,
    surface: &str,
    started_at: i64,
    tz_offset: i64,
) -> AppResult<Option<i64>> {
    if !matches!(surface, "viewer" | "popup" | "map" | "inline") {
        return Err(AppError::InvalidArg(format!("bad surface: {surface}")));
    }
    let row: Option<(Option<i64>, i64, Option<String>)> = c
        .query_row(
            "SELECT m.media_id, m.conv_id, md.kind
             FROM messages m LEFT JOIN media md ON md.id = m.media_id
             WHERE m.id = ?1",
            [message_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((Some(media_id), conv_id, Some(kind))) = row else {
        return Ok(None);
    };
    if !matches!(kind.as_str(), "video" | "image" | "audio") {
        return Ok(None);
    }
    let started_at = started_at.min(now_ms());
    let tz_offset = tz_offset.clamp(-MAX_OFFSET_MIN, MAX_OFFSET_MIN);
    c.execute(
        "INSERT INTO views (message_id, media_id, conv_id, kind, surface, started_at, tz_offset)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![message_id, media_id, conv_id, kind, surface, started_at, tz_offset],
    )?;
    Ok(Some(c.last_insert_rowid()))
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Tick {
    /// The span being watched, or just finished: start and end, UTC ms.
    /// Sent again with a later end while it goes on.
    pub span: Option<(i64, i64)>,
    pub covered_ms: Option<i64>,
    pub last_pos_ms: Option<i64>,
    pub duration_ms: Option<i64>,
}

/// A video or recording just reached "one play"; its message's new count.
#[derive(Debug, PartialEq, Eq)]
pub struct Played {
    pub message_id: i64,
    pub play_count: i64,
}

pub fn tick(c: &Connection, view_id: i64, t: Tick, now: i64) -> AppResult<Option<Played>> {
    let tx = c.unchecked_transaction()?;
    let row: Option<(String, i64, Option<i64>)> = tx
        .query_row(
            "SELECT kind, counted, message_id FROM views WHERE id = ?1",
            [view_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    // Gone: cleared while it was open.
    let Some((kind, counted, message_id)) = row else {
        return Ok(None);
    };

    if let Some((start, end)) = t.span {
        if valid_span(start, end, now) {
            tx.execute(
                "INSERT INTO view_spans (view_id, start_at, end_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(view_id, start_at) DO UPDATE SET end_at = MAX(end_at, excluded.end_at)",
                params![view_id, start, end],
            )?;
        }
    }
    let watch_ms: i64 = tx.query_row(
        "SELECT COALESCE(SUM(end_at - start_at), 0) FROM view_spans WHERE view_id = ?1",
        [view_id],
        |r| r.get(0),
    )?;
    let nonneg = |v: Option<i64>| v.map(|x| x.max(0));
    tx.execute(
        "UPDATE views SET watch_ms = ?2,
                covered_ms = COALESCE(?3, covered_ms),
                last_pos_ms = COALESCE(?4, last_pos_ms),
                duration_ms = COALESCE(?5, duration_ms)
         WHERE id = ?1",
        params![view_id, watch_ms, nonneg(t.covered_ms), nonneg(t.last_pos_ms), nonneg(t.duration_ms)],
    )?;

    let mut played = None;
    let duration: Option<i64> =
        tx.query_row("SELECT duration_ms FROM views WHERE id = ?1", [view_id], |r| r.get(0))?;
    if counted == 0 && counts(&kind, watch_ms, duration) {
        tx.execute("UPDATE views SET counted = 1 WHERE id = ?1", [view_id])?;
        if let (true, Some(mid)) = (kind != "image", message_id) {
            tx.execute("UPDATE messages SET play_count = play_count + 1 WHERE id = ?1", [mid])?;
            let n: Option<i64> = tx
                .query_row("SELECT play_count FROM messages WHERE id = ?1", [mid], |r| r.get(0))
                .optional()?;
            played = n.map(|play_count| Played { message_id: mid, play_count });
        }
    }
    tx.commit()?;
    Ok(played)
}

/// Where to pick a recording up again (ADR-058): the last position of its
/// latest view, unless that was near the start or the end.
pub fn resume_pos(c: &Connection, message_id: i64) -> AppResult<Option<i64>> {
    let row: Option<(Option<i64>, Option<i64>)> = c
        .query_row(
            "SELECT last_pos_ms, duration_ms FROM views WHERE message_id = ?1
             ORDER BY started_at DESC, id DESC LIMIT 1",
            [message_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    const EDGE_MS: i64 = 5_000;
    Ok(match row {
        Some((Some(p), d)) if p >= EDGE_MS && d.map_or(true, |d| p < d - EDGE_MS) => Some(p),
        _ => None,
    })
}

/// The main window was in front and in use from `start` to `end`. Sent again
/// with a later end while it goes on.
pub fn presence(c: &Connection, start: i64, end: i64, tz_offset: i64, now: i64) -> AppResult<()> {
    if !valid_span(start, end, now) {
        return Ok(());
    }
    c.execute(
        "INSERT INTO presence (start_at, end_at, tz_offset) VALUES (?1, ?2, ?3)
         ON CONFLICT(start_at) DO UPDATE SET end_at = MAX(end_at, excluded.end_at)",
        params![start, end, tz_offset.clamp(-MAX_OFFSET_MIN, MAX_OFFSET_MIN)],
    )?;
    Ok(())
}

/// Forget everything this library knows about viewing, play counts included.
pub fn clear(c: &Connection) -> AppResult<()> {
    let tx = c.unchecked_transaction()?;
    tx.execute_batch(
        "DELETE FROM view_spans;
         DELETE FROM views;
         DELETE FROM presence;
         UPDATE messages SET play_count = 0 WHERE play_count <> 0;",
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&c);
        c.execute_batch(
            "PRAGMA foreign_keys = ON;
             INSERT INTO volumes (id, platform_id, created_at) VALUES (1, 'v', 0);
             INSERT INTO conversations (id, name, kind, created_at, updated_at) VALUES (1, 'c', 'manual', 0, 0);
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind, duration_ms)
               VALUES (1, 1, 'a.mp4', 1, 0, 'h1', 'video', 60000),
                      (2, 1, 'b.jpg', 1, 0, 'h2', 'image', NULL),
                      (3, 1, 'c.pdf', 1, 0, 'h3', 'other', NULL),
                      (4, 1, 'd.mp4', 1, 0, 'h4', 'video', 2000);
             INSERT INTO messages (id, conv_id, media_id, caption, created_at)
               VALUES (10, 1, 1, 'a', 0), (11, 1, 2, 'b', 0), (12, 1, 3, 'c', 0),
                      (13, 1, NULL, 'text', 0), (14, 1, 4, 'd', 0);",
        )
        .unwrap();
        c
    }

    const T0: i64 = 1_763_000_000_000;

    fn span(start: i64, end: i64) -> Tick {
        Tick { span: Some((start, end)), ..Tick::default() }
    }

    fn play_count(c: &Connection, id: i64) -> i64 {
        c.query_row("SELECT play_count FROM messages WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn only_images_and_videos_are_recorded() {
        let c = lib();
        assert!(begin(&c, 10, "viewer", T0, 480).unwrap().is_some());
        assert!(begin(&c, 11, "popup", T0, 480).unwrap().is_some());
        assert_eq!(begin(&c, 12, "viewer", T0, 480).unwrap(), None);
        assert_eq!(begin(&c, 13, "viewer", T0, 480).unwrap(), None);
        assert_eq!(begin(&c, 99, "viewer", T0, 480).unwrap(), None);
        assert!(begin(&c, 10, "elsewhere", T0, 480).is_err());
    }

    #[test]
    fn a_growing_span_counts_once_and_a_play_after_three_seconds() {
        let c = lib();
        let v = begin(&c, 10, "viewer", T0, 480).unwrap().unwrap();
        let now = T0 + 100_000;
        assert_eq!(tick(&c, v, span(T0, T0 + 1_000), now).unwrap(), None);
        assert_eq!(play_count(&c, 10), 0);
        // Same span, later end: replaces, not adds.
        let p = tick(&c, v, span(T0, T0 + 3_000), now).unwrap();
        assert_eq!(p, Some(Played { message_id: 10, play_count: 1 }));
        // Paused, then a second span: counted already, no second play.
        assert_eq!(tick(&c, v, span(T0 + 10_000, T0 + 15_000), now).unwrap(), None);
        let w: i64 = c.query_row("SELECT watch_ms FROM views WHERE id = ?1", [v], |r| r.get(0)).unwrap();
        assert_eq!(w, 8_000);
        assert_eq!(play_count(&c, 10), 1);
    }

    #[test]
    fn short_clips_and_photos() {
        assert!(counts("video", 1_800, Some(2_000)));
        assert!(!counts("video", 1_700, Some(2_000)));
        assert!(!counts("video", 2_999, None));
        assert!(counts("image", 1_000, None));

        let c = lib();
        let v = begin(&c, 14, "viewer", T0, 0).unwrap().unwrap();
        let p = tick(&c, v, Tick { span: Some((T0, T0 + 1_900)), duration_ms: Some(2_000), ..Tick::default() }, T0 + 5_000);
        assert_eq!(p.unwrap(), Some(Played { message_id: 14, play_count: 1 }));

        // A photo counts as viewed but has no play count.
        let v = begin(&c, 11, "viewer", T0, 0).unwrap().unwrap();
        assert_eq!(tick(&c, v, span(T0, T0 + 5_000), T0 + 5_000).unwrap(), None);
        let counted: i64 = c.query_row("SELECT counted FROM views WHERE id = ?1", [v], |r| r.get(0)).unwrap();
        assert_eq!(counted, 1);
        assert_eq!(play_count(&c, 11), 0);
    }

    #[test]
    fn bad_spans_are_dropped() {
        let c = lib();
        let v = begin(&c, 10, "viewer", T0, 0).unwrap().unwrap();
        let now = T0 + 10_000;
        tick(&c, v, span(T0 + 5, T0), now).unwrap(); // ends before it starts
        tick(&c, v, span(T0, T0 + 25 * 3_600_000), T0 + 30 * 3_600_000).unwrap(); // too long
        tick(&c, v, span(now + 120_000, now + 130_000), now).unwrap(); // in the future
        let n: i64 = c.query_row("SELECT COUNT(*) FROM view_spans", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn deleting_content_keeps_the_time() {
        let c = lib();
        let v = begin(&c, 10, "viewer", T0, 0).unwrap().unwrap();
        tick(&c, v, span(T0, T0 + 4_000), T0 + 5_000).unwrap();
        c.execute("DELETE FROM conversations WHERE id = 1", []).unwrap();
        let (m, conv, w): (Option<i64>, Option<i64>, i64) = c
            .query_row("SELECT message_id, conv_id, watch_ms FROM views WHERE id = ?1", [v], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((m, conv, w), (None, None, 4_000));
        // A later tick for the gone message still works.
        assert_eq!(tick(&c, v, span(T0, T0 + 4_500), T0 + 5_000).unwrap(), None);
    }

    #[test]
    fn clear_forgets_everything() {
        let c = lib();
        let v = begin(&c, 10, "viewer", T0, 0).unwrap().unwrap();
        tick(&c, v, span(T0, T0 + 4_000), T0 + 5_000).unwrap();
        presence(&c, T0, T0 + 60_000, 0, T0 + 60_000).unwrap();
        presence(&c, T0, T0 + 90_000, 0, T0 + 90_000).unwrap();
        let p: i64 = c.query_row("SELECT end_at - start_at FROM presence", [], |r| r.get(0)).unwrap();
        assert_eq!(p, 90_000);
        clear(&c).unwrap();
        for t in ["views", "view_spans", "presence"] {
            let n: i64 = c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{t}");
        }
        assert_eq!(play_count(&c, 10), 0);
        // A viewer still open after the clear doesn't fail.
        assert_eq!(tick(&c, v, span(T0, T0 + 9_000), T0 + 10_000).unwrap(), None);
    }

    #[test]
    fn the_setting_is_on_unless_off() {
        let c = lib();
        assert!(enabled(&c).unwrap());
        c.execute("INSERT INTO settings(key, value) VALUES ('view_stats', 'off')", []).unwrap();
        assert!(!enabled(&c).unwrap());
    }

    #[test]
    fn resume_from_the_latest_view_unless_at_an_edge() {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&c);
        c.execute_batch(
            "INSERT INTO conversations (id, name, kind, created_at, updated_at) VALUES (1, 'c', 'manual', 0, 0);
             INSERT INTO messages (id, conv_id, created_at) VALUES (1, 1, 0), (2, 1, 0), (3, 1, 0);
             INSERT INTO views (message_id, conv_id, kind, surface, started_at, tz_offset, last_pos_ms, duration_ms) VALUES
               (1, 1, 'audio', 'inline', 1, 0, 90000, 600000),
               (1, 1, 'audio', 'inline', 2, 0, 120000, 600000),
               (2, 1, 'audio', 'inline', 1, 0, 598000, 600000),
               (3, 1, 'audio', 'inline', 1, 0, 2000, 600000);",
        )
        .unwrap();
        assert_eq!(resume_pos(&c, 1).unwrap(), Some(120000), "latest view wins");
        assert_eq!(resume_pos(&c, 2).unwrap(), None, "finished: start over");
        assert_eq!(resume_pos(&c, 3).unwrap(), None, "barely started");
        assert_eq!(resume_pos(&c, 9).unwrap(), None);
    }
}
