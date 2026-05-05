//! Volume mount monitor + media live/broken state machine.
//!
//! Two responsibilities:
//!
//! 1. **Boot scan** — once at app startup, walk every `media` row, decide if
//!    its file is currently reachable, and reconcile `media.state` +
//!    `broken_pointers`. Also reconciles `volumes.last_mount` so the latest
//!    drive letter / mount path is always remembered.
//!
//! 2. **Background poller** — every `POLL_INTERVAL`, enumerate mounted
//!    volumes and diff against the last known set. When a known volume
//!    appears or disappears we re-evaluate the media on it and emit a
//!    `vol:changed` event so the UI can refresh.
//!
//! We deliberately keep this poll-based instead of platform-specific mount
//! events (WM_DEVICECHANGE / DiskArbitration callbacks) — far simpler, and
//! the human-visible latency of 5-10s when (un)plugging a USB drive is fine.

use crate::db;
use crate::events;
use crate::services::file_watcher;
use crate::services::volume_resolver::{self, VolumeInfo};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_secs(8);

static LAST_MOUNTED: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

/// Fire the boot scan and spawn the background poller. Idempotent.
pub fn start() {
    static STARTED: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));
    let mut g = STARTED.lock();
    if *g {
        return;
    }
    *g = true;
    drop(g);

    if let Err(e) = boot_scan() {
        eprintln!("volume_monitor: boot scan failed: {e}");
    }

    std::thread::Builder::new()
        .name("trove-volume-monitor".into())
        .spawn(poll_loop)
        .expect("spawn volume monitor");
}

fn poll_loop() {
    loop {
        std::thread::sleep(POLL_INTERVAL);
        if let Err(e) = poll_once() {
            eprintln!("volume_monitor: poll failed: {e}");
        }
    }
}

fn poll_once() -> Result<(), String> {
    volume_resolver::invalidate_cache();
    let mounted = volume_resolver::enumerate_mounted();
    let mounted_ids: HashSet<String> =
        mounted.iter().map(|v| v.platform_id.clone()).collect();

    let prev = {
        let mut g = LAST_MOUNTED.lock();
        let prev = g.clone();
        *g = mounted_ids.clone();
        prev
    };

    let appeared: Vec<&VolumeInfo> = mounted
        .iter()
        .filter(|v| !prev.contains(&v.platform_id))
        .collect();
    let disappeared: Vec<String> =
        prev.difference(&mounted_ids).cloned().collect();

    if appeared.is_empty() && disappeared.is_empty() {
        return Ok(());
    }

    let mut changed_convs: HashSet<i64> = HashSet::new();

    for v in &appeared {
        update_volume_last_mount(&v.platform_id, &v.mount_point)?;
        let convs = volume_came_online(v)?;
        changed_convs.extend(convs);
    }
    for pid in &disappeared {
        let convs = volume_went_offline(pid)?;
        changed_convs.extend(convs);
    }

    for conv_id in changed_convs {
        bump_conversation(conv_id)?;
        events::emit_conv_changed(events::ConvChanged {
            conv_id,
            added: 0,
            broken: 0,
        });
    }
    events::emit_volumes_changed();
    Ok(())
}

/// Initial reconciliation. For every media row, check current file
/// reachability and update state to match reality.
pub fn boot_scan() -> Result<(), String> {
    volume_resolver::invalidate_cache();
    upgrade_legacy_platform_ids()?;
    let mounted = volume_resolver::enumerate_mounted();
    let mut by_pid: HashMap<String, PathBuf> = HashMap::new();
    for v in &mounted {
        by_pid.insert(v.platform_id.clone(), v.mount_point.clone());
        update_volume_last_mount(&v.platform_id, &v.mount_point)?;
    }
    *LAST_MOUNTED.lock() = by_pid.keys().cloned().collect();

    type Row = (i64, i64, String, String, String);
    let rows: Vec<Row> = db::with_conn(|conn| -> rusqlite::Result<Vec<Row>> {
        let mut stmt = conn.prepare(
            "SELECT m.id, v.id, v.platform_id, v.last_mount, m.relpath
             FROM media m JOIN volumes v ON v.id = m.volume_id",
        )?;
        let r = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })
    .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp_millis();
    db::with_conn(|conn| -> Result<(), String> {
        for (media_id, volume_id, pid, last_mount, relpath) in rows {
            let mount = by_pid
                .get(&pid)
                .cloned()
                .unwrap_or_else(|| PathBuf::from(&last_mount));
            let abs = volume_resolver::absolute_for(&mount, &relpath);
            let live = by_pid.contains_key(&pid) && abs.is_file();
            apply_state(conn, media_id, volume_id, &relpath, live, now)?;
        }
        Ok(())
    })?;
    Ok(())
}

fn apply_state(
    conn: &rusqlite::Connection,
    media_id: i64,
    volume_id: i64,
    relpath: &str,
    live: bool,
    now: i64,
) -> Result<(), String> {
    if live {
        conn.execute(
            "UPDATE media SET state = 'live' WHERE id = ?1 AND state != 'live'",
            params![media_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM broken_pointers WHERE media_id = ?1",
            params![media_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE media SET state = 'broken' WHERE id = ?1 AND state != 'broken'",
            params![media_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO broken_pointers
                (media_id, detected_at, last_known_volume, last_known_relpath)
             VALUES (?1, ?2, ?3, ?4)",
            params![media_id, now, volume_id, relpath],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn volume_came_online(v: &VolumeInfo) -> Result<HashSet<i64>, String> {
    let mount = v.mount_point.clone();
    let pid = v.platform_id.clone();
    let now = chrono::Utc::now().timestamp_millis();

    let media_rows: Vec<(i64, String)> =
        db::with_conn(|conn| -> rusqlite::Result<Vec<(i64, String)>> {
            let mut stmt = conn.prepare(
                "SELECT m.id, m.relpath FROM media m
                 JOIN volumes v ON v.id = m.volume_id
                 WHERE v.platform_id = ?1",
            )?;
            let r = stmt
                .query_map(params![pid], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(r)
        })
        .map_err(|e| e.to_string())?;

    let volume_id_opt: Option<i64> = db::with_conn(|conn| {
        conn.query_row(
            "SELECT id FROM volumes WHERE platform_id = ?1",
            params![pid],
            |r| r.get(0),
        )
        .ok()
    });
    let Some(volume_id) = volume_id_opt else {
        return Ok(HashSet::new());
    };

    db::with_conn(|conn| -> Result<(), String> {
        for (mid, rel) in &media_rows {
            let abs = volume_resolver::absolute_for(&mount, rel);
            apply_state(conn, *mid, volume_id, rel, abs.is_file(), now)?;
        }
        Ok(())
    })?;

    let convs = conversations_using_volume(volume_id)?;

    // Restart watchers on folder_watch convos whose source just appeared.
    for conv_id in &convs {
        try_start_watcher(*conv_id)?;
    }

    Ok(convs)
}

fn volume_went_offline(platform_id: &str) -> Result<HashSet<i64>, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let volume_id_opt: Option<i64> = db::with_conn(|conn| {
        conn.query_row(
            "SELECT id FROM volumes WHERE platform_id = ?1",
            params![platform_id],
            |r| r.get(0),
        )
        .ok()
    });
    let Some(volume_id) = volume_id_opt else {
        return Ok(HashSet::new());
    };

    let media_rows: Vec<(i64, String)> =
        db::with_conn(|conn| -> rusqlite::Result<Vec<(i64, String)>> {
            let mut stmt = conn.prepare(
                "SELECT id, relpath FROM media WHERE volume_id = ?1",
            )?;
            let r = stmt
                .query_map(params![volume_id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(r)
        })
        .map_err(|e| e.to_string())?;

    db::with_conn(|conn| -> Result<(), String> {
        for (mid, rel) in &media_rows {
            apply_state(conn, *mid, volume_id, rel, false, now)?;
        }
        Ok(())
    })?;

    let convs = conversations_using_volume(volume_id)?;
    for conv_id in &convs {
        file_watcher::stop(*conv_id);
    }
    Ok(convs)
}

fn conversations_using_volume(volume_id: i64) -> Result<HashSet<i64>, String> {
    db::with_conn(|conn| -> Result<HashSet<i64>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT conv_id FROM messages m
                 JOIN media md ON md.id = m.media_id
                 WHERE md.volume_id = ?1
                 UNION
                 SELECT id FROM conversations WHERE source_volume_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let r = stmt
            .query_map(params![volume_id], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(r)
    })
}

fn update_volume_last_mount(platform_id: &str, mount: &Path) -> Result<(), String> {
    let mount_str = mount.to_string_lossy().to_string();
    db::with_conn(|conn| {
        conn.execute(
            "UPDATE volumes SET last_mount = ?1 WHERE platform_id = ?2",
            params![mount_str, platform_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

fn bump_conversation(conv_id: i64) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    db::with_conn(|conn| {
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conv_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Phase 2 stored placeholder platform IDs like `win-letter-C`. After the
/// Phase 3 rewrite, the resolver returns `win-serial-XXXXXXXX`. This walks
/// existing volume rows; if a row's `last_mount` is currently mounted and
/// the resolver disagrees with the stored `platform_id`, we re-id the row
/// (or merge into an already-correct row).
fn upgrade_legacy_platform_ids() -> Result<(), String> {
    type Row = (i64, String, Option<String>);
    let rows: Vec<Row> = db::with_conn(|conn| -> rusqlite::Result<Vec<Row>> {
        let mut stmt =
            conn.prepare("SELECT id, platform_id, last_mount FROM volumes")?;
        let r = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })
    .map_err(|e| e.to_string())?;

    for (id, stored_pid, last_mount) in rows {
        let Some(mount_str) = last_mount else { continue };
        let mount_path = PathBuf::from(&mount_str);
        if !mount_path.exists() {
            continue;
        }
        let real = match volume_resolver::identify(&mount_path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if real.platform_id == stored_pid {
            continue;
        }
        db::with_conn(|conn| -> Result<(), String> {
            let conflict: Option<i64> = conn
                .query_row(
                    "SELECT id FROM volumes WHERE platform_id = ?1 AND id != ?2",
                    params![real.platform_id, id],
                    |r| r.get(0),
                )
                .ok();
            if let Some(other_id) = conflict {
                conn.execute(
                    "UPDATE media SET volume_id = ?1 WHERE volume_id = ?2",
                    params![other_id, id],
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE conversations SET source_volume_id = ?1
                     WHERE source_volume_id = ?2",
                    params![other_id, id],
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    "DELETE FROM volumes WHERE id = ?1",
                    params![id],
                )
                .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "UPDATE volumes SET platform_id = ?1, label = ?2 WHERE id = ?3",
                    params![real.platform_id, real.label, id],
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        })?;
    }
    Ok(())
}

fn try_start_watcher(conv_id: i64) -> Result<(), String> {
    let row: Option<(String, String, String)> = db::with_conn(|conn| {
        conn.query_row(
            "SELECT c.kind, COALESCE(v.last_mount, ''), COALESCE(c.source_relpath, '')
             FROM conversations c
             LEFT JOIN volumes v ON v.id = c.source_volume_id
             WHERE c.id = ?1",
            params![conv_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()
    });
    let Some((kind, mount, relpath)) = row else { return Ok(()) };
    if kind != "folder_watch" || mount.is_empty() {
        return Ok(());
    }
    let root = volume_resolver::absolute_for(Path::new(&mount), &relpath);
    if !root.is_dir() {
        return Ok(());
    }
    if let Err(e) = file_watcher::start(conv_id, root) {
        eprintln!("volume_monitor: restart watcher #{conv_id}: {e}");
    }
    Ok(())
}
