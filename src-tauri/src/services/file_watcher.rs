//! Per-conversation folder watcher with debounced batching.
//!
//! For each `folder_watch` conversation we spawn a `notify` watcher and a
//! companion thread that collects events for `DEBOUNCE_MS` then commits them
//! in a single pass. Drops of `WatcherEntry` close the inner channel which
//! causes the worker thread to exit on its own.

use crate::commands::media;
use crate::db;
use crate::events::{self, ConvChanged};
use crate::services::folder_scanner;
use crate::services::volume_resolver;
use notify::{
    event::ModifyKind, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

const DEBOUNCE_MS: u64 = 500;
const IDLE_TICK: Duration = Duration::from_secs(60);

#[allow(dead_code)]
struct WatcherEntry {
    conv_id: i64,
    root: PathBuf,
    watcher: RecommendedWatcher,
}

static WATCHERS: Lazy<Mutex<HashMap<i64, WatcherEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn start(conv_id: i64, root: PathBuf) -> Result<(), String> {
    if !root.is_dir() {
        return Err(format!("watch root not a directory: {}", root.display()));
    }
    let mut guard = WATCHERS.lock();
    if guard.contains_key(&conv_id) {
        return Ok(());
    }

    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, notify::Config::default())
        .map_err(|e| format!("create watcher: {e}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {}: {e}", root.display()))?;

    let root_clone = root.clone();
    std::thread::Builder::new()
        .name(format!("trove-watch-{conv_id}"))
        .spawn(move || debounce_loop(conv_id, root_clone, rx))
        .map_err(|e| format!("spawn watcher thread: {e}"))?;

    guard.insert(
        conv_id,
        WatcherEntry {
            conv_id,
            root,
            watcher,
        },
    );
    Ok(())
}

pub fn stop(conv_id: i64) {
    WATCHERS.lock().remove(&conv_id);
}

pub fn stop_all() {
    WATCHERS.lock().clear();
}

#[derive(Default)]
struct Pending {
    creates: HashSet<PathBuf>,
    modifies: HashSet<PathBuf>,
    removes: HashSet<PathBuf>,
}

fn debounce_loop(conv_id: i64, root: PathBuf, rx: Receiver<notify::Result<Event>>) {
    let debounce = Duration::from_millis(DEBOUNCE_MS);
    let mut pending = Pending::default();
    let mut deadline: Option<Instant> = None;

    loop {
        let timeout = match deadline {
            Some(d) => d.saturating_duration_since(Instant::now()),
            None => IDLE_TICK,
        };
        match rx.recv_timeout(timeout) {
            Ok(Ok(ev)) => {
                handle_event(ev, &mut pending);
                deadline = Some(Instant::now() + debounce);
            }
            Ok(Err(_e)) => { /* notify backend error, ignore and continue */ }
            Err(RecvTimeoutError::Timeout) => {
                if deadline.is_some() {
                    flush(conv_id, &root, &mut pending);
                    deadline = None;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn handle_event(ev: Event, pending: &mut Pending) {
    match ev.kind {
        EventKind::Create(_) => {
            for p in ev.paths {
                if folder_scanner::is_media(&p) {
                    pending.removes.remove(&p);
                    pending.creates.insert(p);
                }
            }
        }
        EventKind::Modify(ModifyKind::Data(_)) => {
            for p in ev.paths {
                if folder_scanner::is_media(&p) {
                    pending.modifies.insert(p);
                }
            }
        }
        EventKind::Modify(ModifyKind::Name(_)) => {
            for p in ev.paths {
                if !folder_scanner::is_media(&p) {
                    continue;
                }
                if p.exists() {
                    pending.removes.remove(&p);
                    pending.creates.insert(p);
                } else {
                    pending.creates.remove(&p);
                    pending.removes.insert(p);
                }
            }
        }
        EventKind::Remove(_) => {
            for p in ev.paths {
                pending.creates.remove(&p);
                pending.modifies.remove(&p);
                pending.removes.insert(p);
            }
        }
        _ => {}
    }
}

fn flush(conv_id: i64, _root: &Path, pending: &mut Pending) {
    let mut added = 0usize;
    for p in pending.creates.drain() {
        if !p.is_file() {
            continue;
        }
        match media::ingest_one(conv_id, &p, false, true) {
            Ok(Some(_)) => added += 1,
            Ok(None) => {}
            Err(e) => eprintln!("watcher ingest failed for {}: {e}", p.display()),
        }
    }
    for p in pending.modifies.drain() {
        if !p.is_file() {
            continue;
        }
        if let Err(e) = media::ingest_one(conv_id, &p, false, true) {
            eprintln!("watcher modify ingest failed for {}: {e}", p.display());
        }
    }
    let mut broken = 0usize;
    for p in pending.removes.drain() {
        match mark_broken(&p) {
            Ok(true) => broken += 1,
            Ok(false) => {}
            Err(e) => eprintln!("watcher mark_broken failed for {}: {e}", p.display()),
        }
    }
    if added > 0 || broken > 0 {
        let now = chrono::Utc::now().timestamp_millis();
        let _ = db::with_conn(|conn| {
            conn.execute(
                "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
                params![now, conv_id],
            )
        });
        events::emit_conv_changed(ConvChanged {
            conv_id,
            added,
            broken,
        });
    }
}

/// Mark the media row corresponding to `path` as broken. Returns `Ok(true)`
/// when a row was matched. The file may already be gone, so we resolve via
/// the parent directory and append the file name back onto its relpath.
fn mark_broken(path: &Path) -> Result<bool, String> {
    let parent = path.parent().ok_or_else(|| "no parent".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "no file name".to_string())?
        .to_string_lossy()
        .to_string();
    let parent_resolved = volume_resolver::resolve(parent)?;
    let relpath = if parent_resolved.relpath.is_empty() {
        file_name
    } else {
        format!("{}/{}", parent_resolved.relpath, file_name)
    };

    db::with_conn(|conn| -> Result<bool, String> {
        let id: Option<i64> = conn
            .query_row(
                "SELECT m.id FROM media m JOIN volumes v ON v.id = m.volume_id
                 WHERE v.platform_id = ?1 AND m.relpath = ?2",
                params![parent_resolved.platform_id, relpath],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(id) = id else { return Ok(false) };
        conn.execute(
            "UPDATE media SET state = 'broken' WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO broken_pointers
                (media_id, detected_at, last_known_volume, last_known_relpath)
             SELECT id, ?1, volume_id, relpath FROM media WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    })
}
