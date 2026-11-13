//! Volume presence, across every open library (ADR-035).
//!
//! Two separate facts:
//! - **Is the volume mounted?** Kept on the volume row (`volumes.online`).
//!   A volume going away is one UPDATE, not one per media row, and its files
//!   show as *offline* (thumbnail + badge), never as missing.
//! - **Is the file there?** Only checked while its volume is mounted; a miss
//!   marks the row `broken` (shown as *missing*, listed for repair).
//!
//! A background thread polls the mounted volumes and applies the difference
//! to each open library. A library opened later gets [`scan_library`].

use crate::events;
use crate::services::file_watcher;
use crate::services::volume_resolver::{self, VolumeInfo};
use crate::{db, AppResult};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_secs(8);

/// platform_id → mount point, as of the last poll.
static LAST_MOUNTED: Lazy<Mutex<HashMap<String, PathBuf>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub fn start() {
    static STARTED: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));
    let mut g = STARTED.lock();
    if *g {
        return;
    }
    *g = true;
    drop(g);
    std::thread::Builder::new()
        .name("trove-volume-monitor".into())
        .spawn(poll_loop)
        .expect("spawn volume monitor");
}

fn poll_loop() {
    loop {
        std::thread::sleep(POLL_INTERVAL);
        if db::open_ids().is_empty() {
            continue;
        }
        poll_once();
    }
}

fn mounted_now() -> HashMap<String, PathBuf> {
    volume_resolver::invalidate_cache();
    volume_resolver::enumerate_mounted()
        .into_iter()
        .map(|v: VolumeInfo| (v.platform_id, v.mount_point))
        .collect()
}

fn poll_once() {
    let mounted = mounted_now();
    let prev = std::mem::replace(&mut *LAST_MOUNTED.lock(), mounted.clone());
    let appeared: Vec<(&String, &PathBuf)> = mounted.iter().filter(|(k, _)| !prev.contains_key(*k)).collect();
    let disappeared: Vec<&String> = prev.keys().filter(|k| !mounted.contains_key(*k)).collect();
    if appeared.is_empty() && disappeared.is_empty() {
        return;
    }
    for lib in db::open_ids() {
        let mut changed: HashSet<i64> = HashSet::new();
        for (pid, mount) in &appeared {
            match volume_came_online(&lib, pid, mount) {
                Ok(c) => changed.extend(c),
                Err(e) => log::warn!("volume_monitor[{lib}] online {pid}: {e}"),
            }
        }
        for pid in &disappeared {
            match volume_went_offline(&lib, pid) {
                Ok(c) => changed.extend(c),
                Err(e) => log::warn!("volume_monitor[{lib}] offline {pid}: {e}"),
            }
        }
        for conv_id in changed {
            events::emit_conv_changed(events::ConvChanged {
                lib: lib.clone(),
                conv_id,
                added: 0,
                broken: 0,
                renamed: 0,
            });
        }
        events::emit_volumes_changed(&lib);
    }
}

/// Full reconcile of one library against what is mounted right now. Run
/// when a library opens (in the background: it stats every file).
pub fn scan_library(lib: &str) {
    if let Err(e) = scan_library_inner(lib) {
        log::warn!("volume_monitor[{lib}]: scan failed: {e}");
    }
}

fn scan_library_inner(lib: &str) -> AppResult<()> {
    let mounted = mounted_now();
    *LAST_MOUNTED.lock() = mounted.clone();
    upgrade_legacy_platform_ids(lib)?;

    let volumes: Vec<(i64, String)> = db::with_lib(lib, |c| {
        let mut st = c.prepare("SELECT id, platform_id FROM volumes")?;
        let r = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })?;
    db::with_lib(lib, |c| {
        for (id, pid) in &volumes {
            match mounted.get(pid) {
                Some(m) => c.execute(
                    "UPDATE volumes SET online = 1, last_mount = ?1 WHERE id = ?2",
                    params![m.to_string_lossy(), id],
                )?,
                None => c.execute("UPDATE volumes SET online = 0 WHERE id = ?1", params![id])?,
            };
        }
        Ok(())
    })?;
    for (id, pid) in volumes {
        if let Some(m) = mounted.get(&pid) {
            check_files(lib, id, m)?;
        }
    }
    events::emit_volumes_changed(lib);
    Ok(())
}

/// Stat every file of one mounted volume and record live / missing.
/// Returns the conversations whose rows changed state.
fn check_files(lib: &str, volume_id: i64, mount: &Path) -> AppResult<HashSet<i64>> {
    let rows: Vec<(i64, String, String)> = db::with_lib(lib, |c| {
        let mut st = c.prepare("SELECT id, relpath, state FROM media WHERE volume_id = ?1")?;
        let r = st
            .query_map(params![volume_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })?;
    // The stats happen outside the lock; only the flips go back in.
    let flips: Vec<(i64, String, bool)> = rows
        .into_iter()
        .filter_map(|(id, rel, state)| {
            let live = volume_resolver::absolute_for(mount, &rel).is_file();
            ((state == "live") != live).then_some((id, rel, live))
        })
        .collect();
    if flips.is_empty() {
        return Ok(HashSet::new());
    }
    let now = chrono::Utc::now().timestamp_millis();
    db::with_lib(lib, |c| {
        let tx = c.unchecked_transaction()?;
        let mut convs = HashSet::new();
        for (id, rel, live) in &flips {
            if *live {
                tx.execute("UPDATE media SET state = 'live' WHERE id = ?1", params![id])?;
                tx.execute("DELETE FROM broken_pointers WHERE media_id = ?1", params![id])?;
            } else {
                tx.execute("UPDATE media SET state = 'broken' WHERE id = ?1", params![id])?;
                tx.execute(
                    "INSERT OR REPLACE INTO broken_pointers
                        (media_id, detected_at, last_known_volume, last_known_relpath)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![id, now, volume_id, rel],
                )?;
            }
            let mut st = tx.prepare_cached("SELECT DISTINCT conv_id FROM messages WHERE media_id = ?1")?;
            for conv in st.query_map(params![id], |r| r.get::<_, i64>(0))? {
                convs.insert(conv?);
            }
        }
        tx.commit()?;
        Ok(convs)
    })
}

fn volume_id(lib: &str, platform_id: &str) -> AppResult<Option<i64>> {
    db::with_lib(lib, |c| {
        Ok(c
            .query_row("SELECT id FROM volumes WHERE platform_id = ?1", params![platform_id], |r| r.get(0))
            .optional()?)
    })
}

fn volume_came_online(lib: &str, platform_id: &str, mount: &Path) -> AppResult<HashSet<i64>> {
    let Some(vid) = volume_id(lib, platform_id)? else {
        return Ok(HashSet::new());
    };
    db::with_lib(lib, |c| {
        c.execute(
            "UPDATE volumes SET online = 1, last_mount = ?1 WHERE id = ?2",
            params![mount.to_string_lossy(), vid],
        )?;
        Ok(())
    })?;
    check_files(lib, vid, mount)?;
    let convs = conversations_using_volume(lib, vid)?;
    for conv_id in &convs {
        try_start_watcher(lib, *conv_id);
    }
    Ok(convs)
}

fn volume_went_offline(lib: &str, platform_id: &str) -> AppResult<HashSet<i64>> {
    let Some(vid) = volume_id(lib, platform_id)? else {
        return Ok(HashSet::new());
    };
    db::with_lib(lib, |c| {
        c.execute("UPDATE volumes SET online = 0 WHERE id = ?1", params![vid])?;
        Ok(())
    })?;
    let convs = conversations_using_volume(lib, vid)?;
    for conv_id in &convs {
        file_watcher::stop(lib, *conv_id);
    }
    Ok(convs)
}

fn conversations_using_volume(lib: &str, volume_id: i64) -> AppResult<HashSet<i64>> {
    db::with_lib(lib, |c| {
        let mut st = c.prepare(
            "SELECT DISTINCT m.conv_id FROM messages m
             JOIN media md ON md.id = m.media_id
             WHERE md.volume_id = ?1
             UNION
             SELECT id FROM conversations WHERE source_volume_id = ?1",
        )?;
        let r = st
            .query_map(params![volume_id], |r| r.get::<_, i64>(0))?
            .filter_map(Result::ok)
            .collect();
        Ok(r)
    })
}

/// Older builds stored a weaker platform id; when the volume is mounted we
/// can compute the real one and fold duplicates together.
fn upgrade_legacy_platform_ids(lib: &str) -> AppResult<()> {
    type Row = (i64, String, Option<String>);
    let rows: Vec<Row> = db::with_lib(lib, |c| {
        let mut st = c.prepare("SELECT id, platform_id, last_mount FROM volumes")?;
        let r = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })?;
    for (id, stored_pid, last_mount) in rows {
        let Some(mount_str) = last_mount else { continue };
        let mount_path = PathBuf::from(&mount_str);
        if !mount_path.exists() {
            continue;
        }
        let Ok(real) = volume_resolver::identify(&mount_path) else { continue };
        if real.platform_id == stored_pid {
            continue;
        }
        db::with_lib(lib, |c| {
            let conflict: Option<i64> = c
                .query_row(
                    "SELECT id FROM volumes WHERE platform_id = ?1 AND id != ?2",
                    params![real.platform_id, id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(other) = conflict {
                c.execute("UPDATE media SET volume_id = ?1 WHERE volume_id = ?2", params![other, id])?;
                c.execute(
                    "UPDATE conversations SET source_volume_id = ?1 WHERE source_volume_id = ?2",
                    params![other, id],
                )?;
                c.execute("DELETE FROM volumes WHERE id = ?1", params![id])?;
            } else {
                c.execute(
                    "UPDATE volumes SET platform_id = ?1, label = ?2 WHERE id = ?3",
                    params![real.platform_id, real.label, id],
                )?;
            }
            Ok(())
        })?;
    }
    Ok(())
}

pub fn try_start_watcher(lib: &str, conv_id: i64) {
    let row: Option<(String, String, String)> = db::with_lib(lib, |c| {
        Ok(c
            .query_row(
                "SELECT c.kind, COALESCE(v.last_mount, ''), COALESCE(c.source_relpath, '')
                 FROM conversations c
                 LEFT JOIN volumes v ON v.id = c.source_volume_id
                 WHERE c.id = ?1 AND c.archived = 0",
                params![conv_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?)
    })
    .ok()
    .flatten();
    let Some((kind, mount, relpath)) = row else { return };
    if kind != "folder_watch" || mount.is_empty() {
        return;
    }
    let root = volume_resolver::absolute_for(Path::new(&mount), &relpath);
    if !root.is_dir() {
        return;
    }
    if let Err(e) = file_watcher::start(lib, conv_id, root) {
        log::warn!("volume_monitor: watcher {lib}#{conv_id}: {e}");
    }
}
