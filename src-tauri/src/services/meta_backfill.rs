//! Read the GPS position and capture time of media that was never read
//! (`meta_scanned = 0`): rows from before these features, and files that
//! were offline when they were read last.
//!
//! New media is read at import time by `ingest_one`; this pass covers the
//! rest. It runs when a library opens and when a disk comes online, in the
//! background, one run per library at a time.
//!
//! A message dated by its file (a synced folder, or a conversation made from
//! a folder — its date equals the file's mtime) moves to the capture time
//! once that is known (ADR-053). A message sent "now" keeps its date.

use crate::services::{exif, volume_resolver};
use crate::{db, events, AppError, AppResult};
use rusqlite::params;
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

/// Libraries with a pass in flight.
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

/// Run the pass for `lib` on this thread. A no-op when one is already running
/// for that library (or it is not open).
pub fn run(lib: &str) {
    if !db::is_open(lib) || !claim(lib) {
        return;
    }
    match run_inner(lib) {
        Ok((geo, convs)) => {
            for conv_id in convs {
                events::emit_conv_changed(events::ConvChanged {
                    lib: lib.to_string(),
                    conv_id,
                    added: 0,
                    broken: 0,
                    renamed: 0,
                });
            }
            events::emit_geo_backfill_done(lib, geo);
        }
        Err(e) => log::warn!("meta backfill [{lib}]: {e}"),
    }
    release(lib);
}

/// [`run`] on its own thread.
pub fn spawn(lib: String) {
    if let Err(e) = std::thread::Builder::new()
        .name(format!("trove-meta-{lib}"))
        .spawn(move || run(&lib))
    {
        log::error!("spawn meta backfill: {e}");
    }
}

const BATCH: i64 = 200;

struct Candidate {
    id: i64,
    abs: String,
    kind: String,
}

/// Returns how many rows gained a position, and the conversations whose
/// messages changed.
fn run_inner(lib: &str) -> AppResult<(usize, HashSet<i64>)> {
    let mut cursor: i64 = 0;
    let mut geo_found = 0usize;
    let mut convs: HashSet<i64> = HashSet::new();

    loop {
        // 1. A batch of unread rows on mounted disks (the cursor keeps
        //    unreadable files from being fetched again in this run).
        let batch: Vec<Candidate> = db::with_lib(lib, |conn| {
            let mut stmt = conn.prepare(
                "SELECT md.id, v.last_mount, md.relpath, md.kind
                 FROM media md JOIN volumes v ON v.id = md.volume_id
                 WHERE md.meta_scanned = 0 AND md.state = 'live' AND v.online = 1
                   AND v.last_mount IS NOT NULL
                   AND md.id > ?1
                 ORDER BY md.id ASC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![cursor, BATCH], |r| {
                let mount: String = r.get(1)?;
                let relpath: String = r.get(2)?;
                Ok(Candidate {
                    id: r.get(0)?,
                    abs: volume_resolver::absolute_for(Path::new(&mount), &relpath)
                        .to_string_lossy()
                        .to_string(),
                    kind: r.get(3)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(AppError::from)
        })?;
        let Some(last) = batch.last() else { break };
        cursor = last.id;

        // 2. Read files outside the DB lock. Only files that exist count as
        //    read; the rest stay 0 and are tried when their disk is back.
        let reads: Vec<(i64, exif::FileMeta)> = batch
            .iter()
            .filter(|c| Path::new(&c.abs).exists())
            .map(|c| (c.id, exif::read_meta(Path::new(&c.abs), &c.kind)))
            .collect();
        if reads.is_empty() {
            continue;
        }

        // 3. One transaction per batch (short lock hold).
        db::with_lib(lib, |conn| -> AppResult<()> {
            let tx = conn.unchecked_transaction()?;
            for (id, meta) in &reads {
                write(&tx, *id, meta, &mut convs)?;
                if meta.geo.is_some() {
                    geo_found += 1;
                }
            }
            tx.commit()?;
            Ok(())
        })?;
    }

    Ok((geo_found, convs))
}

/// Store what was read for one media row; collect the conversations to refresh.
fn write(
    conn: &rusqlite::Connection,
    id: i64,
    meta: &exif::FileMeta,
    convs: &mut HashSet<i64>,
) -> rusqlite::Result<()> {
    let (lat, lon) = (meta.geo.map(|g| g.0), meta.geo.map(|g| g.1));
    let (at, offset) = (meta.taken.map(|t| t.at), meta.taken.map(|t| t.offset));
    conn.execute(
        "UPDATE media SET lat = ?1, lon = ?2, taken_at = ?3, taken_offset = ?4, meta_scanned = 1
         WHERE id = ?5",
        params![lat, lon, at, offset, id],
    )?;
    let Some(at) = at else { return Ok(()) };
    // A message dated by its file moves to the capture time.
    conn.execute(
        "UPDATE messages SET created_at = ?1
         WHERE media_id = ?2
           AND (created_at = (SELECT mtime FROM media WHERE id = ?2)
                OR conv_id IN (SELECT id FROM conversations WHERE kind = 'folder_watch'))",
        params![at, id],
    )?;
    // Every conversation showing it refreshes: the viewer shows the capture
    // time even where the order does not change.
    let mut st = conn.prepare_cached("SELECT DISTINCT conv_id FROM messages WHERE media_id = ?1")?;
    for conv in st.query_map(params![id], |r| r.get::<_, i64>(0))? {
        convs.insert(conv?);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_pass_per_library() {
        assert!(claim("meta-test-a"));
        assert!(!claim("meta-test-a"), "same library: already running");
        assert!(claim("meta-test-b"), "another library is independent");
        release("meta-test-a");
        assert!(claim("meta-test-a"), "free again after release");
        release("meta-test-a");
        release("meta-test-b");
    }

    #[test]
    fn only_messages_dated_by_their_file_move() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&conn);
        conn.execute_batch(
            "INSERT INTO volumes (id, platform_id, label, last_mount, created_at) VALUES (1, 'v', 'D', 'D:\', 0);
             INSERT INTO conversations (id, name, kind, created_at, updated_at) VALUES
               (1, '聊天', 'manual', 0, 0), (2, '同步', 'folder_watch', 0, 0);
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind)
               VALUES (1, 1, 'a.jpg', 1, 5000, 'h', 'image');
             -- sent now / made from a folder (dated by mtime) / synced folder (mtime changed since)
             INSERT INTO messages (id, conv_id, media_id, created_at) VALUES
               (1, 1, 1, 9000), (2, 1, 1, 5000), (3, 2, 1, 4000);",
        )
        .unwrap();
        let meta = exif::FileMeta {
            geo: None,
            taken: Some(exif::Taken { at: 1234, offset: 540 }),
        };
        let mut convs = HashSet::new();
        write(&conn, 1, &meta, &mut convs).unwrap();

        let dates: Vec<i64> = conn
            .prepare("SELECT created_at FROM messages ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(dates, vec![9000, 1234, 1234]);
        assert_eq!(convs, HashSet::from([1, 2]));
        let (at, off, scanned): (i64, i64, i64) = conn
            .query_row("SELECT taken_at, taken_offset, meta_scanned FROM media", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((at, off, scanned), (1234, 540, 1));
    }
}
