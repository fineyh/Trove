//! Map feature: query geotagged media + backfill GPS for pre-existing rows.
//!
//! Geotags are written at import time by [`crate::services::exif`] via
//! `ingest_one`. Media imported before this feature existed has `geo_scanned =
//! 0`; [`backfill_geotags`] scans those rows once (lazily, on first map open)
//! so old libraries light up too.

use crate::services::{exif, volume_resolver};
use crate::{db, events, AppError, AppResult};
use rusqlite::params;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// One geotagged item shown on the map. Mirrors `MediaPayload`'s camelCase
/// convention. `available` is false when the source volume's mount is unknown
/// (the coordinate is still valid, but the file can't be previewed right now).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeotaggedMedia {
    pub media_id: i64,
    pub lat: f64,
    pub lon: f64,
    pub kind: String,
    pub ext: String,
    /// "ok" | "offline" | "missing" — same meaning as on messages.
    pub status: String,
    pub has_thumb: bool,
    pub conv_id: i64,
    pub message_id: i64,
    pub created_at: i64,
}

/// The map shows one library at a time: a locked library isn't open, so its
/// locations can't surface here at all.
#[tauri::command]
pub fn list_geotagged_media(lib: String) -> AppResult<Vec<GeotaggedMedia>> {
    let hide = super::conversations::hide_offline(&lib)?;
    db::with_lib(&lib, |conn| {
        // A media row can be referenced by several conversations. Order by
        // media id so rows for the same media are contiguous; in Rust we pick
        // the first reference whose conversation is currently accessible.
        let mut stmt = conn.prepare(
            "SELECT md.id, md.lat, md.lon, md.kind, md.state, v.online, md.relpath,
                    m.id AS msg_id, m.conv_id, m.created_at,
                    EXISTS (SELECT 1 FROM thumbs t WHERE t.media_id = md.id)
             FROM media md
             JOIN volumes v ON v.id = md.volume_id
             JOIN messages m ON m.media_id = md.id
             JOIN conversations c ON c.id = m.conv_id
             WHERE md.lat IS NOT NULL AND md.lon IS NOT NULL
               AND c.archived = 0
             ORDER BY md.id ASC, m.id ASC",
        )?;

        struct Row {
            media_id: i64,
            lat: f64,
            lon: f64,
            kind: String,
            state: String,
            online: bool,
            relpath: String,
            msg_id: i64,
            conv_id: i64,
            created_at: i64,
            has_thumb: bool,
        }

        let rows = stmt.query_map([], |r| {
            Ok(Row {
                media_id: r.get(0)?,
                lat: r.get(1)?,
                lon: r.get(2)?,
                kind: r.get(3)?,
                state: r.get(4)?,
                online: r.get::<_, i64>(5)? != 0,
                relpath: r.get(6)?,
                msg_id: r.get(7)?,
                conv_id: r.get(8)?,
                created_at: r.get(9)?,
                has_thumb: r.get::<_, i64>(10)? != 0,
            })
        })?;

        let mut out: Vec<GeotaggedMedia> = Vec::new();
        let mut current: Option<i64> = None;
        let mut chosen = false;

        for row in rows {
            let row = row?;
            if current != Some(row.media_id) {
                current = Some(row.media_id);
                chosen = false;
            }
            if chosen || (hide && !row.online) {
                continue;
            }
            chosen = true;
            out.push(GeotaggedMedia {
                media_id: row.media_id,
                lat: row.lat,
                lon: row.lon,
                kind: row.kind,
                ext: super::messages::ext_of(&row.relpath),
                status: super::messages::media_status(&row.state, row.online).to_string(),
                has_thumb: row.has_thumb,
                conv_id: row.conv_id,
                message_id: row.msg_id,
                created_at: row.created_at,
            });
        }
        Ok(out)
    })
}

static BACKFILL_RUNNING: AtomicBool = AtomicBool::new(false);

const BACKFILL_BATCH: usize = 200;

/// Scan media that was never checked for a geotag (`geo_scanned = 0`) and fill
/// in lat/lon from the file. Runs on a background thread so the command returns
/// immediately; emits `geo:backfill-done` when finished. Idempotent — a second
/// call while one is in flight is a no-op.
#[tauri::command]
pub fn backfill_geotags(lib: String) -> AppResult<()> {
    if !db::is_open(&lib) {
        return Ok(());
    }
    if BACKFILL_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(()); // already running
    }
    std::thread::spawn(move || {
        let updated = run_backfill(&lib).unwrap_or(0);
        BACKFILL_RUNNING.store(false, Ordering::SeqCst);
        events::emit_geo_backfill_done(&lib, updated);
    });
    Ok(())
}

struct Candidate {
    id: i64,
    abs: String,
    kind: String,
}

fn run_backfill(lib: &str) -> AppResult<usize> {
    let mut cursor: i64 = 0;
    let mut total_updated = 0usize;

    loop {
        // 1. Pull a batch of unscanned candidates (cursor keeps progress so
        //    offline files we can't read don't get re-fetched this run).
        let batch: Vec<Candidate> = db::with_lib(lib, |conn| {
            let mut stmt = conn.prepare(
                "SELECT md.id, v.last_mount, md.relpath, md.kind
                 FROM media md JOIN volumes v ON v.id = md.volume_id
                 WHERE md.geo_scanned = 0 AND md.state = 'live' AND v.online = 1
                   AND md.kind IN ('image', 'video')
                   AND v.last_mount IS NOT NULL
                   AND md.id > ?1
                 ORDER BY md.id ASC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![cursor, BACKFILL_BATCH as i64], |r| {
                let id: i64 = r.get(0)?;
                let mount: String = r.get(1)?;
                let relpath: String = r.get(2)?;
                let kind: String = r.get(3)?;
                let abs = volume_resolver::absolute_for(Path::new(&mount), &relpath)
                    .to_string_lossy()
                    .to_string();
                Ok(Candidate { id, abs, kind })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(AppError::from)
        })?;

        if batch.is_empty() {
            break;
        }
        cursor = batch.last().map(|c| c.id).unwrap_or(cursor);

        // 2. Read geotags outside the DB lock (pure file I/O).
        //    Only files that actually exist get marked scanned; offline files
        //    keep geo_scanned = 0 so a later run (volume mounted) retries them.
        let mut writes: Vec<(i64, Option<(f64, f64)>)> = Vec::new();
        for c in &batch {
            let path = Path::new(&c.abs);
            if !path.exists() {
                continue;
            }
            writes.push((c.id, exif::read_geotag(path, &c.kind)));
        }

        if writes.is_empty() {
            continue;
        }

        // 3. Commit the batch in a single transaction (short lock hold).
        let batch_updated = db::with_lib(lib, |conn| {
            conn.execute_batch("BEGIN")?;
            let mut n = 0usize;
            for (id, geo) in &writes {
                match geo {
                    Some((lat, lon)) => {
                        conn.execute(
                            "UPDATE media SET lat = ?1, lon = ?2, geo_scanned = 1 WHERE id = ?3",
                            params![lat, lon, id],
                        )?;
                        n += 1;
                    }
                    None => {
                        conn.execute(
                            "UPDATE media SET geo_scanned = 1 WHERE id = ?1",
                            params![id],
                        )?;
                    }
                }
            }
            conn.execute_batch("COMMIT")?;
            Ok(n)
        })?;
        total_updated += batch_updated;
    }

    Ok(total_updated)
}
