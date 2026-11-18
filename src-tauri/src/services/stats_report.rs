//! Reading viewing history back: the statistics page (ADR-056).
//!
//! Ranges and buckets are given as *wall-clock* milliseconds: the local clock
//! time written as if it were UTC (`Date.UTC(y, m, d)`). A span watched at
//! 21:00 in Tokyo lands in the 21:00 bucket wherever it is read later, because
//! each span carries the offset it was recorded with.
//!
//! Total time merges every span first (in real time), so two windows playing
//! at once count once. A conversation's time merges its own spans the same
//! way; an item's time is the plain sum of its spans.

use crate::AppResult;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;

const HOUR_MS: i64 = 3_600_000;
/// Wall clock and UTC differ by at most this much.
const MAX_OFFSET_MS: i64 = 14 * HOUR_MS;
const TOP_ITEMS: usize = 6;
const TOP_CONVS: usize = 6;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketStat {
    pub total_ms: i64,
    pub video_ms: i64,
    pub image_ms: i64,
    pub audio_ms: i64,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Added {
    pub image: i64,
    pub video: i64,
    pub audio: i64,
    pub other: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopItem {
    pub message_id: i64,
    pub media_id: Option<i64>,
    pub conv_id: i64,
    pub conv_name: String,
    pub kind: String,
    pub name: String,
    pub has_thumb: bool,
    pub watch_ms: i64,
    pub plays: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopConv {
    pub conv_id: i64,
    pub name: String,
    pub watch_ms: i64,
    pub plays: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    /// Merged time over the whole range.
    pub total_ms: i64,
    /// One per bucket (`edges.len() - 1`).
    pub buckets: Vec<BucketStat>,
    /// Merged time by local hour of day, over the whole range.
    pub hours: [i64; 24],
    /// Views that reached "one play" (photos: seen ≥ 1 s), by when they started.
    pub plays: i64,
    pub top_items: Vec<TopItem>,
    pub top_convs: Vec<TopConv>,
    /// Images / videos / audio / files added, one per bucket (by import time).
    pub added: Vec<Added>,
    /// Items in the space before the range started.
    pub items_before: i64,
    /// Any viewing recorded in this space at all.
    pub has_history: bool,
}

#[derive(Debug, Clone, Copy)]
struct Span {
    start: i64,
    end: i64,
    off_ms: i64,
    kind: Kind,
    message_id: Option<i64>,
    conv_id: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Image,
    Video,
    Audio,
}

impl Kind {
    fn of(s: &str) -> Kind {
        match s {
            "video" => Kind::Video,
            "audio" => Kind::Audio,
            _ => Kind::Image,
        }
    }
}

/// Merge overlapping spans in real time. A merged stretch keeps the offset of
/// the span that opened it.
fn merge<'a>(spans: impl Iterator<Item = &'a Span>) -> Vec<(i64, i64, i64)> {
    let mut v: Vec<(i64, i64, i64)> = spans.map(|s| (s.start, s.end, s.off_ms)).collect();
    v.sort_unstable();
    let mut out: Vec<(i64, i64, i64)> = Vec::with_capacity(v.len());
    for (s, e, o) in v {
        match out.last_mut() {
            Some(last) if s <= last.1 => last.1 = last.1.max(e),
            _ => out.push((s, e, o)),
        }
    }
    out
}

fn overlap(a: i64, b: i64, lo: i64, hi: i64) -> i64 {
    (b.min(hi) - a.max(lo)).max(0)
}

/// Add the wall-clock stretch `[a, b)` into `buckets` cut by `edges`.
fn add_to_buckets(a: i64, b: i64, edges: &[i64], mut put: impl FnMut(usize, i64)) {
    for i in 0..edges.len() - 1 {
        let d = overlap(a, b, edges[i], edges[i + 1]);
        if d > 0 {
            put(i, d);
        }
    }
}

fn add_to_hours(a: i64, b: i64, hours: &mut [i64; 24]) {
    let mut t = a;
    while t < b {
        let next = (t.div_euclid(HOUR_MS) + 1) * HOUR_MS;
        let end = next.min(b);
        hours[t.div_euclid(HOUR_MS).rem_euclid(24) as usize] += end - t;
        t = end;
    }
}

fn load_spans(c: &Connection, from: i64, to: i64) -> AppResult<Vec<Span>> {
    // Wall clock = UTC + offset, so a span inside [from, to) in wall time
    // lies within this real-time window.
    let mut stmt = c.prepare(
        "SELECT s.start_at, s.end_at, v.tz_offset, v.kind, v.message_id, v.conv_id
         FROM view_spans s JOIN views v ON v.id = s.view_id
         WHERE s.start_at < ?2 AND s.end_at > ?1",
    )?;
    let rows = stmt.query_map(params![from - MAX_OFFSET_MS, to + MAX_OFFSET_MS], |r| {
        Ok(Span {
            start: r.get(0)?,
            end: r.get(1)?,
            off_ms: r.get::<_, i64>(2)? * 60_000,
            kind: Kind::of(&r.get::<_, String>(3)?),
            message_id: r.get(4)?,
            conv_id: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// `edges`: bucket boundaries in wall-clock ms, ascending, at least two.
/// `utc_edges`: the same boundaries in real time, for import times (which
/// carry no offset of their own). `hide_offline`: leave items on offline
/// disks out of the lists.
pub fn overview(c: &Connection, edges: &[i64], utc_edges: &[i64], hide_offline: bool) -> AppResult<Overview> {
    assert!(edges.len() >= 2 && edges.len() == utc_edges.len());
    let (from, to) = (edges[0], edges[edges.len() - 1]);
    let spans = load_spans(c, from, to)?;
    let n = edges.len() - 1;

    // Totals: everything merged, then each kind merged on its own.
    let mut buckets = vec![BucketStat::default(); n];
    let mut hours = [0i64; 24];
    let mut total_ms = 0;
    for (s, e, o) in merge(spans.iter()) {
        let (a, b) = ((s + o).max(from), (e + o).min(to));
        if a >= b {
            continue;
        }
        total_ms += b - a;
        add_to_hours(a, b, &mut hours);
        add_to_buckets(a, b, edges, |i, d| buckets[i].total_ms += d);
    }
    for kind in [Kind::Video, Kind::Image, Kind::Audio] {
        for (s, e, o) in merge(spans.iter().filter(|s| s.kind == kind)) {
            add_to_buckets(s + o, e + o, edges, |i, d| match kind {
                Kind::Video => buckets[i].video_ms += d,
                Kind::Image => buckets[i].image_ms += d,
                Kind::Audio => buckets[i].audio_ms += d,
            });
        }
    }

    // Per item (plain sum) and per conversation (merged).
    let mut item_ms: HashMap<i64, i64> = HashMap::new();
    let mut by_conv: HashMap<i64, Vec<Span>> = HashMap::new();
    for s in &spans {
        let d = overlap(s.start + s.off_ms, s.end + s.off_ms, from, to);
        if d == 0 {
            continue;
        }
        if let Some(m) = s.message_id {
            *item_ms.entry(m).or_default() += d;
        }
        if let Some(cv) = s.conv_id {
            by_conv.entry(cv).or_default().push(*s);
        }
    }
    let conv_ms: HashMap<i64, i64> = by_conv
        .into_iter()
        .map(|(cv, ss)| {
            let ms = merge(ss.iter()).iter().map(|&(s, e, o)| overlap(s + o, e + o, from, to)).sum();
            (cv, ms)
        })
        .collect();

    // Plays, by when the view started (wall clock).
    let mut item_plays: HashMap<i64, i64> = HashMap::new();
    let mut conv_plays: HashMap<i64, i64> = HashMap::new();
    let mut plays = 0;
    {
        let mut stmt = c.prepare(
            "SELECT message_id, conv_id FROM views
             WHERE counted = 1 AND started_at + tz_offset * 60000 >= ?1
               AND started_at + tz_offset * 60000 < ?2",
        )?;
        let rows = stmt.query_map(params![from, to], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?))
        })?;
        for row in rows {
            let (m, cv) = row?;
            plays += 1;
            if let Some(m) = m {
                *item_plays.entry(m).or_default() += 1;
            }
            if let Some(cv) = cv {
                *conv_plays.entry(cv).or_default() += 1;
            }
        }
    }

    let top_items = top_items(c, &item_ms, &item_plays, hide_offline)?;
    let top_convs = top_convs(c, &conv_ms, &conv_plays)?;

    // Growth: media messages by import time.
    let mut added = vec![Added::default(); n];
    {
        let mut stmt = c.prepare(
            "SELECT m.created_at, md.kind FROM messages m JOIN media md ON md.id = m.media_id
             WHERE m.created_at >= ?1 AND m.created_at < ?2",
        )?;
        let rows = stmt.query_map(params![utc_edges[0], utc_edges[n]], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (t, kind) = row?;
            let i = utc_edges.partition_point(|&e| e <= t).saturating_sub(1).min(n - 1);
            match kind.as_str() {
                "image" => added[i].image += 1,
                "video" => added[i].video += 1,
                "audio" => added[i].audio += 1,
                _ => added[i].other += 1,
            }
        }
    }
    let items_before: i64 = c.query_row(
        "SELECT COUNT(*) FROM messages WHERE media_id IS NOT NULL AND created_at < ?1",
        [utc_edges[0]],
        |r| r.get(0),
    )?;
    let has_history: bool = c.query_row("SELECT EXISTS (SELECT 1 FROM views)", [], |r| r.get(0))?;

    Ok(Overview {
        total_ms,
        buckets,
        hours,
        plays,
        top_items,
        top_convs,
        added,
        items_before,
        has_history,
    })
}

/// Longest first, then most plays; ties by id so the order is stable.
fn ranked(ms: &HashMap<i64, i64>, plays: &HashMap<i64, i64>) -> Vec<(i64, i64, i64)> {
    let mut v: Vec<(i64, i64, i64)> = ms
        .iter()
        .map(|(&id, &w)| (id, w, plays.get(&id).copied().unwrap_or(0)))
        .collect();
    v.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(b.2.cmp(&a.2)).then(a.0.cmp(&b.0)));
    v
}

fn file_name(relpath: &str) -> &str {
    relpath.rsplit(['/', '\\']).next().unwrap_or(relpath)
}

fn top_items(
    c: &Connection,
    ms: &HashMap<i64, i64>,
    plays: &HashMap<i64, i64>,
    hide_offline: bool,
) -> AppResult<Vec<TopItem>> {
    let mut stmt = c.prepare(
        "SELECT m.media_id, m.conv_id, c.name, md.kind, m.caption, md.relpath,
                EXISTS (SELECT 1 FROM thumbs t WHERE t.media_id = md.id),
                COALESCE(v.online, 1)
         FROM messages m
         JOIN conversations c ON c.id = m.conv_id
         LEFT JOIN media md ON md.id = m.media_id
         LEFT JOIN volumes v ON v.id = md.volume_id
         WHERE m.id = ?1 AND c.archived = 0",
    )?;
    let mut out = Vec::new();
    for (id, watch_ms, n) in ranked(ms, plays) {
        if out.len() == TOP_ITEMS {
            break;
        }
        let row = stmt.query_row([id], |r| {
            Ok((
                r.get::<_, Option<i64>>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, bool>(6)?,
                r.get::<_, i64>(7)? != 0,
            ))
        });
        let (media_id, conv_id, conv_name, kind, caption, relpath, has_thumb, online) = match row {
            Ok(r) => r,
            Err(rusqlite::Error::QueryReturnedNoRows) => continue,
            Err(e) => return Err(e.into()),
        };
        // The file itself is gone from the message: nothing to show or open.
        let (Some(kind), Some(relpath)) = (kind, relpath) else { continue };
        if hide_offline && !online {
            continue;
        }
        let name = caption
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| file_name(&relpath).to_string());
        out.push(TopItem {
            message_id: id,
            media_id,
            conv_id,
            conv_name,
            kind,
            name,
            has_thumb,
            watch_ms,
            plays: n,
        });
    }
    Ok(out)
}

fn top_convs(c: &Connection, ms: &HashMap<i64, i64>, plays: &HashMap<i64, i64>) -> AppResult<Vec<TopConv>> {
    let mut stmt = c.prepare("SELECT name FROM conversations WHERE id = ?1 AND archived = 0")?;
    let mut out = Vec::new();
    for (id, watch_ms, n) in ranked(ms, plays) {
        if out.len() == TOP_CONVS {
            break;
        }
        match stmt.query_row([id], |r| r.get::<_, String>(0)) {
            Ok(name) => out.push(TopConv { conv_id: id, name, watch_ms, plays: n }),
            Err(rusqlite::Error::QueryReturnedNoRows) => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(out)
}

// ─── One item's history (message right-click → 观看记录) ────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewEntry {
    pub started_at: i64,
    pub tz_offset: i64,
    pub watch_ms: i64,
    pub surface: String,
    pub counted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemHistory {
    pub total_ms: i64,
    pub plays: i64,
    /// Newest first, at most [`HISTORY_LIMIT`].
    pub views: Vec<ViewEntry>,
    /// All views, when `views` was cut short.
    pub view_count: i64,
}

pub const HISTORY_LIMIT: i64 = 200;

pub fn item_history(c: &Connection, message_id: i64) -> AppResult<ItemHistory> {
    let (total_ms, plays, view_count): (i64, i64, i64) = c.query_row(
        "SELECT COALESCE(SUM(watch_ms), 0), COALESCE(SUM(counted), 0), COUNT(*)
         FROM views WHERE message_id = ?1",
        [message_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let mut stmt = c.prepare(
        "SELECT started_at, tz_offset, watch_ms, surface, counted FROM views
         WHERE message_id = ?1 ORDER BY started_at DESC, id DESC LIMIT ?2",
    )?;
    let views = stmt
        .query_map(params![message_id, HISTORY_LIMIT], |r| {
            Ok(ViewEntry {
                started_at: r.get(0)?,
                tz_offset: r.get(1)?,
                watch_ms: r.get(2)?,
                surface: r.get(3)?,
                counted: r.get::<_, i64>(4)? != 0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ItemHistory { total_ms, plays, views, view_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::stats;

    const DAY: i64 = 24 * HOUR_MS;
    /// 2025-11-18 00:00 UTC: in the past, so `begin` doesn't clamp it to now.
    const D0: i64 = 20_410 * DAY;

    fn lib() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&c);
        c.execute_batch(
            "PRAGMA foreign_keys = ON;
             INSERT INTO volumes (id, platform_id, online, created_at) VALUES (1, 'v', 1, 0), (2, 'w', 0, 0);
             INSERT INTO conversations (id, name, kind, created_at, updated_at)
               VALUES (1, 'Kyoto', 'manual', 0, 0), (2, 'Cats', 'manual', 0, 0);
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind, duration_ms)
               VALUES (1, 1, 'clips/a.mp4', 1, 0, 'h1', 'video', 60000),
                      (2, 1, 'b.jpg', 1, 0, 'h2', 'image', NULL),
                      (3, 2, 'c.mp4', 1, 0, 'h3', 'video', 60000);
             INSERT INTO messages (id, conv_id, media_id, caption, created_at)
               VALUES (10, 1, 1, NULL, 0), (11, 1, 2, 'Temple', 0), (12, 2, 3, 'Cat', 0);",
        )
        .unwrap();
        c
    }

    /// A view of `msg` with one span `[start, end)` (UTC), at offset `off` minutes.
    fn watch(c: &Connection, msg: i64, start: i64, end: i64, off: i64) {
        let v = stats::begin(c, msg, "viewer", start, off).unwrap().unwrap();
        let t = stats::Tick { span: Some((start, end)), ..Default::default() };
        stats::tick(c, v, t, end + 1).unwrap();
    }

    fn day_edges(days: i64) -> Vec<i64> {
        (0..=days).map(|i| D0 + i * DAY).collect()
    }

    const MIN: i64 = 60_000;

    #[test]
    fn overlapping_windows_count_once_but_each_item_keeps_its_time() {
        let c = lib();
        // 10:00–10:10 video, 10:05–10:20 photo, same day, UTC.
        watch(&c, 10, D0 + 10 * HOUR_MS, D0 + 10 * HOUR_MS + 10 * MIN, 0);
        watch(&c, 11, D0 + 10 * HOUR_MS + 5 * MIN, D0 + 10 * HOUR_MS + 20 * MIN, 0);
        let e = day_edges(1);
        let o = overview(&c, &e, &e, false).unwrap();
        assert_eq!(o.total_ms, 20 * MIN);
        assert_eq!(o.buckets[0], BucketStat { total_ms: 20 * MIN, video_ms: 10 * MIN, image_ms: 15 * MIN, audio_ms: 0 });
        assert_eq!(o.hours[10], 20 * MIN);
        assert_eq!(o.hours.iter().sum::<i64>(), 20 * MIN);
        let items: Vec<(i64, i64)> = o.top_items.iter().map(|i| (i.message_id, i.watch_ms)).collect();
        assert_eq!(items, vec![(11, 15 * MIN), (10, 10 * MIN)]);
        // Both in one conversation: merged there too.
        assert_eq!(o.top_convs.len(), 1);
        assert_eq!(o.top_convs[0].watch_ms, 20 * MIN);
        assert_eq!(o.top_convs[0].plays, 2);
        assert_eq!(o.plays, 2);
        // No caption: the file name.
        assert_eq!(o.top_items[1].name, "a.mp4");
        assert_eq!(o.top_items[0].name, "Temple");
    }

    #[test]
    fn days_and_hours_follow_the_clock_where_it_was_watched() {
        let c = lib();
        // 23:30–00:30 UTC across midnight, watched at UTC+9: 08:30–09:30 local next day.
        watch(&c, 10, D0 + DAY - 30 * MIN, D0 + DAY + 30 * MIN, 9 * 60);
        let e = day_edges(2);
        let o = overview(&c, &e, &e, false).unwrap();
        assert_eq!(o.buckets[0].total_ms, 0);
        assert_eq!(o.buckets[1].total_ms, HOUR_MS);
        assert_eq!((o.hours[8], o.hours[9]), (30 * MIN, 30 * MIN));

        // Same at UTC: split over the two days.
        let c = lib();
        watch(&c, 10, D0 + DAY - 30 * MIN, D0 + DAY + 30 * MIN, 0);
        let o = overview(&c, &e, &e, false).unwrap();
        assert_eq!((o.buckets[0].total_ms, o.buckets[1].total_ms), (30 * MIN, 30 * MIN));
        assert_eq!((o.hours[23], o.hours[0]), (30 * MIN, 30 * MIN));
    }

    #[test]
    fn only_the_part_inside_the_range_counts() {
        let c = lib();
        watch(&c, 10, D0 - 10 * MIN, D0 + 20 * MIN, 0);
        let e = day_edges(1);
        let o = overview(&c, &e, &e, false).unwrap();
        assert_eq!(o.total_ms, 20 * MIN);
        assert_eq!(o.top_items[0].watch_ms, 20 * MIN);
        // Started before the range: its play belongs to the day before.
        assert_eq!(o.plays, 0);
    }

    #[test]
    fn lists_skip_offline_when_hidden_and_deleted_content() {
        let c = lib();
        watch(&c, 12, D0 + HOUR_MS, D0 + 2 * HOUR_MS, 0);
        watch(&c, 10, D0 + 3 * HOUR_MS, D0 + 3 * HOUR_MS + MIN, 0);
        let e = day_edges(1);
        assert_eq!(overview(&c, &e, &e, false).unwrap().top_items[0].message_id, 12);
        let o = overview(&c, &e, &e, true).unwrap();
        assert_eq!(o.top_items.iter().map(|i| i.message_id).collect::<Vec<_>>(), vec![10]);

        // Deleted: the time stays in the total, the item leaves the lists.
        c.execute("DELETE FROM conversations WHERE id = 2", []).unwrap();
        let o = overview(&c, &e, &e, false).unwrap();
        assert_eq!(o.total_ms, HOUR_MS + MIN);
        assert_eq!(o.top_items.len(), 1);
        assert_eq!(o.top_convs.iter().map(|c| c.conv_id).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn growth_counts_imports_per_bucket() {
        let c = lib();
        c.execute_batch(&format!(
            "UPDATE messages SET created_at = {} WHERE id = 10;
             UPDATE messages SET created_at = {} WHERE id = 11;
             UPDATE messages SET created_at = {} WHERE id = 12;",
            D0 - 1,
            D0 + DAY + 5,
            D0 + DAY + 6,
        ))
        .unwrap();
        let e = day_edges(2);
        let o = overview(&c, &e, &e, false).unwrap();
        assert_eq!(o.items_before, 1);
        assert_eq!(o.added[0], Added::default());
        assert_eq!(o.added[1], Added { image: 1, video: 1, audio: 0, other: 0 });
        assert!(!o.has_history);
    }

    #[test]
    fn one_items_history() {
        let c = lib();
        watch(&c, 10, D0, D0 + 2_000, 60); // under 3 s: viewed, not a play
        watch(&c, 10, D0 + HOUR_MS, D0 + HOUR_MS + 5_000, 60);
        let h = item_history(&c, 10).unwrap();
        assert_eq!((h.total_ms, h.plays, h.view_count), (7_000, 1, 2));
        assert_eq!(h.views[0].started_at, D0 + HOUR_MS);
        assert!(h.views[0].counted && !h.views[1].counted);
        assert_eq!(h.views[0].surface, "viewer");
        assert_eq!(item_history(&c, 11).unwrap().view_count, 0);
    }

    #[test]
    fn hours_wrap_for_times_before_1970_and_split_on_the_hour() {
        let mut h = [0; 24];
        add_to_hours(-30 * MIN, 30 * MIN, &mut h);
        assert_eq!((h[23], h[0]), (30 * MIN, 30 * MIN));
    }
}
