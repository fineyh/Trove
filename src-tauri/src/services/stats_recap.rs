//! Month / year recap (ADR-057): what the collection did in a period, to sit
//! beside the viewing numbers from [`super::stats_report`].
//!
//! Capture time is read on the clock where the photo was taken (`taken_at` +
//! `taken_offset`), the same wall-clock convention as viewing spans; import
//! time is a real instant.

use crate::AppResult;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;

/// Pictures on the cover.
const COVERS: usize = 12;
/// Pictures for the busiest day.
const BUSIEST: usize = 6;
/// Places sent back; the count covers all of them.
const PLACES: usize = 40;
/// Grid for "a place": about 25 km.
const PLACE_DEG: f64 = 0.25;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cover {
    pub message_id: i64,
    pub media_id: i64,
    pub conv_id: i64,
    pub kind: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub lat: f64,
    pub lon: f64,
    pub count: i64,
    pub cover: Option<Cover>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Busiest {
    /// Index into the day list.
    pub day: usize,
    pub count: i64,
    pub covers: Vec<Cover>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recap {
    /// Images and videos taken, one per day.
    pub taken: Vec<i64>,
    /// One picture per day it has one for (taken that day).
    pub day_covers: Vec<Option<Cover>>,
    /// Up to [`COVERS`], spread over the period: taken in it (in time order),
    /// topped up with what was added in it.
    pub covers: Vec<Cover>,
    pub busiest: Option<Busiest>,
    /// Largest first, at most [`PLACES`].
    pub places: Vec<Place>,
    pub place_count: i64,
    /// Taken in the period and carrying GPS.
    pub geo_count: i64,
    /// Bytes of the files added in the period.
    pub added_bytes: i64,
    pub new_convs: i64,
}

#[derive(Debug, Clone, Copy)]
struct Item {
    media_id: i64,
    video: bool,
    /// Wall clock (taken) or real instant (added), depending on the query.
    at: i64,
    geo: Option<(f64, f64)>,
    /// Can stand as a picture: has a thumbnail, sits in a shown
    /// conversation, and isn't on a hidden offline disk.
    msg: Option<i64>,
    plays: i64,
}

impl Item {
    fn cover(&self, conv_of: &HashMap<i64, i64>) -> Option<Cover> {
        let m = self.msg?;
        Some(Cover {
            message_id: m,
            media_id: self.media_id,
            conv_id: *conv_of.get(&m)?,
            kind: if self.video { "video" } else { "image" },
        })
    }
}

/// Most played first, then earliest; ties by id so the pick is stable.
fn better(a: &Item, b: &Item) -> bool {
    (b.plays, -b.at, -b.media_id) < (a.plays, -a.at, -a.media_id)
}

fn load(c: &Connection, time: &str, from: i64, to: i64, offset: i64, hide_offline: bool) -> AppResult<Vec<Item>> {
    // `time` is one of two fixed expressions below, never user input.
    let sql = format!(
        "SELECT md.id, md.kind, {time} AS t, md.lat, md.lon,
                EXISTS (SELECT 1 FROM thumbs th WHERE th.media_id = md.id),
                COALESCE(v.online, 1),
                (SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conv_id
                  WHERE m.media_id = md.id AND c.archived = 0 ORDER BY m.id LIMIT 1),
                (SELECT COALESCE(SUM(m.play_count), 0) FROM messages m WHERE m.media_id = md.id)
         FROM media md LEFT JOIN volumes v ON v.id = md.volume_id
         WHERE md.kind IN ('image', 'video')
           AND {time} >= ?1 AND {time} < ?2
           AND EXISTS (SELECT 1 FROM messages m WHERE m.media_id = md.id)"
    );
    let mut stmt = c.prepare(&sql)?;
    let rows = stmt.query_map(params![from, to, offset], |r| {
        let thumb: bool = r.get(5)?;
        let online = r.get::<_, i64>(6)? != 0;
        let msg: Option<i64> = r.get(7)?;
        let lat: Option<f64> = r.get(3)?;
        let lon: Option<f64> = r.get(4)?;
        Ok(Item {
            media_id: r.get(0)?,
            video: r.get::<_, String>(1)? == "video",
            at: r.get(2)?,
            geo: lat.zip(lon),
            msg: msg.filter(|_| thumb && (online || !hide_offline)),
            plays: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

const TAKEN: &str = "(md.taken_at + COALESCE(md.taken_offset, ?3) * 60000)";
/// First time the file entered a conversation.
const ADDED: &str = "(SELECT MIN(m.created_at) FROM messages m WHERE m.media_id = md.id) + 0 * ?3";

fn day_of(days: &[i64], t: i64) -> Option<usize> {
    let n = days.len() - 1;
    if t < days[0] || t >= days[n] {
        return None;
    }
    Some(days.partition_point(|&e| e <= t) - 1)
}

/// The best item in each of `slots` equal stretches of `items` (sorted by time).
fn spread<'a>(items: &[&'a Item], slots: usize) -> Vec<&'a Item> {
    if items.is_empty() || slots == 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for s in 0..slots.min(items.len()) {
        let lo = s * items.len() / slots.min(items.len());
        let hi = (s + 1) * items.len() / slots.min(items.len());
        if let Some(best) = items[lo..hi].iter().copied().reduce(|a, b| if better(b, a) { b } else { a }) {
            out.push(best);
        }
    }
    out
}

/// `days`: day boundaries over the period in wall-clock ms; `utc_days`: the
/// same in real time. `offset`: minutes to assume where a capture time has no
/// offset of its own.
pub fn recap(c: &Connection, days: &[i64], utc_days: &[i64], offset: i64, hide_offline: bool) -> AppResult<Recap> {
    assert!(days.len() >= 2 && days.len() == utc_days.len());
    let n = days.len() - 1;
    let mut taken_items = load(c, TAKEN, days[0], days[n], offset, hide_offline)?;
    taken_items.sort_unstable_by_key(|i| (i.at, i.media_id));
    let mut added_items = load(c, ADDED, utc_days[0], utc_days[n], 0, hide_offline)?;
    added_items.sort_unstable_by_key(|i| (i.at, i.media_id));

    // Which conversation each chosen message is in, for opening it.
    let conv_of: HashMap<i64, i64> = {
        let mut stmt = c.prepare("SELECT id, conv_id FROM messages WHERE id = ?1")?;
        let mut map = HashMap::new();
        for m in taken_items.iter().chain(&added_items).filter_map(|i| i.msg) {
            if let std::collections::hash_map::Entry::Vacant(e) = map.entry(m) {
                e.insert(stmt.query_row([m], |r| r.get::<_, i64>(1))?);
            }
        }
        map
    };

    // Per day.
    let mut taken = vec![0i64; n];
    let mut best: Vec<Option<&Item>> = vec![None; n];
    for it in &taken_items {
        let Some(d) = day_of(days, it.at) else { continue };
        taken[d] += 1;
        if it.msg.is_some() && best[d].map_or(true, |b| better(it, b)) {
            best[d] = Some(it);
        }
    }
    let day_covers = best.iter().map(|b| b.and_then(|i| i.cover(&conv_of))).collect();

    let busiest = (0..n)
        .filter(|&d| taken[d] > 0)
        .max_by_key(|&d| (taken[d], std::cmp::Reverse(d)))
        .map(|d| {
            let mut of_day: Vec<&Item> = taken_items
                .iter()
                .filter(|i| i.msg.is_some() && day_of(days, i.at) == Some(d))
                .collect();
            of_day.sort_by(|a, b| if better(a, b) { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater });
            of_day.truncate(BUSIEST);
            of_day.sort_by_key(|i| i.at);
            Busiest { day: d, count: taken[d], covers: of_day.iter().filter_map(|i| i.cover(&conv_of)).collect() }
        });

    // Cover: taken in the period first, then what was added in it.
    let pictured: Vec<&Item> = taken_items.iter().filter(|i| i.msg.is_some()).collect();
    let mut chosen = spread(&pictured, COVERS);
    if chosen.len() < COVERS {
        let have: std::collections::HashSet<i64> = chosen.iter().map(|i| i.media_id).collect();
        let rest: Vec<&Item> = added_items.iter().filter(|i| i.msg.is_some() && !have.contains(&i.media_id)).collect();
        chosen.extend(spread(&rest, COVERS - chosen.len()));
    }
    let covers = chosen.iter().filter_map(|i| i.cover(&conv_of)).collect();

    // Places: a coarse grid, centred on the mean of what fell in each cell.
    // Per grid cell: lat sum, lon sum, count, best picture.
    type Cell<'a> = (f64, f64, i64, Option<&'a Item>);
    let mut cells: HashMap<(i64, i64), Cell> = HashMap::new();
    let mut geo_count = 0;
    for it in &taken_items {
        let Some((lat, lon)) = it.geo else { continue };
        geo_count += 1;
        let key = ((lat / PLACE_DEG).floor() as i64, (lon / PLACE_DEG).floor() as i64);
        let cell = cells.entry(key).or_insert((0.0, 0.0, 0, None));
        cell.0 += lat;
        cell.1 += lon;
        cell.2 += 1;
        if it.msg.is_some() && cell.3.map_or(true, |b| better(it, b)) {
            cell.3 = Some(it);
        }
    }
    let place_count = cells.len() as i64;
    let mut places: Vec<Place> = cells
        .into_values()
        .map(|(la, lo, k, b)| Place {
            lat: la / k as f64,
            lon: lo / k as f64,
            count: k,
            cover: b.and_then(|i| i.cover(&conv_of)),
        })
        .collect();
    places.sort_by(|a, b| b.count.cmp(&a.count).then(a.lat.total_cmp(&b.lat)).then(a.lon.total_cmp(&b.lon)));
    places.truncate(PLACES);

    let added_bytes: i64 = c.query_row(
        "SELECT COALESCE(SUM(md.size_bytes), 0) FROM media md
         WHERE (SELECT MIN(m.created_at) FROM messages m WHERE m.media_id = md.id) >= ?1
           AND (SELECT MIN(m.created_at) FROM messages m WHERE m.media_id = md.id) < ?2",
        params![utc_days[0], utc_days[n]],
        |r| r.get(0),
    )?;
    let new_convs: i64 = c.query_row(
        "SELECT COUNT(*) FROM conversations WHERE created_at >= ?1 AND created_at < ?2",
        params![utc_days[0], utc_days[n]],
        |r| r.get(0),
    )?;

    Ok(Recap {
        taken,
        day_covers,
        covers,
        busiest,
        places,
        place_count,
        geo_count,
        added_bytes,
        new_convs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 3_600_000;
    const DAY: i64 = 24 * HOUR;
    const D0: i64 = 20_410 * DAY;

    fn lib() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&c);
        c.execute_batch(&format!(
            "INSERT INTO volumes (id, platform_id, online, created_at) VALUES (1, 'v', 1, 0), (2, 'w', 0, 0);
             INSERT INTO conversations (id, name, kind, created_at, updated_at)
               VALUES (1, 'Kyoto', 'manual', {d1}, 0), (2, 'Old', 'manual', 0, 0);
             -- 1: taken day 0 at 23:30 UTC, i.e. day 1 at UTC+9, in Kyoto
             -- 2: taken day 1, Kyoto, played 3 times
             -- 3: taken day 1, Osaka, on an offline disk
             -- 4: no capture time, added day 2
             -- 5: taken before the period
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind, lat, lon, taken_at, taken_offset)
               VALUES (1, 1, 'a.jpg', 100, 0, 'h1', 'image', 35.01, 135.76, {t1}, 540),
                      (2, 1, 'b.mp4', 200, 0, 'h2', 'video', 35.02, 135.77, {t2}, 540),
                      (3, 2, 'c.jpg', 300, 0, 'h3', 'image', 34.69, 135.50, {t2}, 540),
                      (4, 1, 'd.jpg', 400, 0, 'h4', 'image', NULL, NULL, NULL, NULL),
                      (5, 1, 'e.jpg', 500, 0, 'h5', 'image', NULL, NULL, {t0}, 0);
             INSERT INTO thumbs (media_id, data, mime, width, height, created_at)
               SELECT id, x'00', 'image/webp', 1, 1, 0 FROM media;
             INSERT INTO messages (id, conv_id, media_id, caption, play_count, created_at)
               VALUES (10, 1, 1, NULL, 0, {d1}), (11, 1, 2, NULL, 3, {d1}), (12, 1, 3, NULL, 0, {d1}),
                      (13, 1, 4, NULL, 0, {d2}), (14, 2, 5, NULL, 0, 0);",
            d1 = D0 + DAY + HOUR,
            d2 = D0 + 2 * DAY + HOUR,
            t0 = D0 - DAY,
            t1 = D0 + DAY - 30 * 60_000,                       // 23:30 UTC day 0
            t2 = D0 + DAY + 3 * HOUR - 9 * HOUR,               // 03:00 local day 1
        ))
        .unwrap();
        c
    }

    fn days(n: i64) -> Vec<i64> {
        (0..=n).map(|i| D0 + i * DAY).collect()
    }

    #[test]
    fn counts_by_the_clock_where_it_was_taken() {
        let c = lib();
        let d = days(3);
        let r = recap(&c, &d, &d, 0, false).unwrap();
        // Item 1 is 08:30 on day 1 in Kyoto; 2 and 3 on day 1 too.
        assert_eq!(r.taken, vec![0, 3, 0]);
        let b = r.busiest.as_ref().unwrap();
        assert_eq!((b.day, b.count), (1, 3));
        // The most played item stands for the day.
        assert_eq!(r.day_covers[1].map(|c| c.media_id), Some(2));
        assert_eq!(r.day_covers[1].map(|c| c.conv_id), Some(1));
        assert_eq!(r.geo_count, 3);
        assert_eq!(r.place_count, 2);
        assert_eq!(r.places[0].count, 2);
        assert_eq!(r.added_bytes, 100 + 200 + 300 + 400);
        assert_eq!(r.new_convs, 1);
    }

    #[test]
    fn cover_takes_captures_first_then_additions() {
        let c = lib();
        let d = days(3);
        let r = recap(&c, &d, &d, 0, false).unwrap();
        let ids: Vec<i64> = r.covers.iter().map(|c| c.media_id).collect();
        // Taken ones in time order (2 and 3 at 03:00, 1 at 08:30), then the addition.
        assert_eq!(ids, vec![2, 3, 1, 4]);
        // Offline disk hidden: no picture for it, still counted.
        let r = recap(&c, &d, &d, 0, true).unwrap();
        assert_eq!(r.taken[1], 3);
        assert!(!r.covers.iter().any(|c| c.media_id == 3));
        assert!(r.places.iter().all(|p| p.cover.map(|c| c.media_id) != Some(3)));
    }

    #[test]
    fn archived_conversations_give_no_pictures() {
        let c = lib();
        c.execute("UPDATE conversations SET archived = 1 WHERE id = 1", []).unwrap();
        let d = days(3);
        let r = recap(&c, &d, &d, 0, false).unwrap();
        assert_eq!(r.taken[1], 3);
        assert!(r.covers.is_empty());
        assert!(r.day_covers.iter().all(|c| c.is_none()));
    }

    #[test]
    fn spread_keeps_order_and_picks_one_per_stretch() {
        let items: Vec<Item> = (0..10)
            .map(|i| Item { media_id: i, video: false, at: i * 10, geo: None, msg: Some(i), plays: if i == 7 { 5 } else { 0 } })
            .collect();
        let refs: Vec<&Item> = items.iter().collect();
        let got: Vec<i64> = spread(&refs, 2).iter().map(|i| i.media_id).collect();
        assert_eq!(got, vec![0, 7]);
        assert_eq!(spread(&refs, 20).len(), 10);
    }
}
