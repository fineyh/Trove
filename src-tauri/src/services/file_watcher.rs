//! Per-conversation folder watcher with debounced batching.
//!
//! For each `folder_watch` conversation we spawn a `notify` watcher and a
//! companion thread that collects events for `DEBOUNCE_MS` then commits them
//! in a single pass. Drops of `WatcherEntry` close the inner channel which
//! causes the worker thread to exit on its own.

use crate::commands::media;
use crate::events::{self, ConvChanged};
use crate::services::{folder_scanner, hasher, relocate, volume_resolver};
use crate::{db, AppResult};
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
/// Hard cap on hash comparisons during a single flush. Prevents pathological
/// bulk renames from blocking the watcher thread for too long; any unmatched
/// removes fall through to `mark_broken` and can be recovered via `repair_media`.
const MAX_RELOCATE_HASHES: usize = 64;

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
    let mut broken = 0usize;
    let mut renamed = 0usize;

    // Phase 1: detect rename pairs (remove ∩ create with matching size + blake3).
    // Each successful pair drains both sides out of the pending sets.
    let pairs = pair_renames(pending);
    for (old_path, new_path) in pairs {
        match handle_rename(&old_path, &new_path) {
            Ok(true) => renamed += 1,
            Ok(false) => {
                // Pair couldn't be relocated (e.g. old row not in DB or
                // refused merge); treat as raw create + remove instead.
                pending.creates.insert(new_path);
                pending.removes.insert(old_path);
            }
            Err(e) => {
                eprintln!(
                    "watcher rename {} → {} failed: {e}",
                    old_path.display(),
                    new_path.display()
                );
                pending.creates.insert(new_path);
                pending.removes.insert(old_path);
            }
        }
    }

    // Phase 2: process creates as regular ingests.
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

    // Phase 3: modifies re-ingest in place (idempotent for unchanged files).
    for p in pending.modifies.drain() {
        if !p.is_file() {
            continue;
        }
        if let Err(e) = media::ingest_one(conv_id, &p, false, true) {
            eprintln!("watcher modify ingest failed for {}: {e}", p.display());
        }
    }

    // Phase 4: for each remaining removed path, first try to relocate it by
    // hash within the conv root; only mark broken if relocation fails.
    let mut hashes_used = 0usize;
    for p in pending.removes.drain() {
        match try_relocate_removed(conv_id, &p, &mut hashes_used) {
            Ok(true) => renamed += 1,
            Ok(false) => match mark_broken(&p) {
                Ok(true) => broken += 1,
                Ok(false) => {}
                Err(e) => eprintln!("watcher mark_broken failed for {}: {e}", p.display()),
            },
            Err(e) => {
                eprintln!("watcher try_relocate_removed failed for {}: {e}", p.display());
                if let Err(e2) = mark_broken(&p) {
                    eprintln!("watcher mark_broken fallback failed: {e2}");
                }
            }
        }
    }

    if added > 0 || broken > 0 || renamed > 0 {
        let now = chrono::Utc::now().timestamp_millis();
        let _ = db::with_conn(|conn| -> AppResult<()> {
            conn.execute(
                "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
                params![now, conv_id],
            )?;
            Ok(())
        });
        events::emit_conv_changed(ConvChanged {
            conv_id,
            added,
            broken,
            renamed,
        });
    }
}

/// Look up a media row by absolute path. Returns (media_id, size_bytes,
/// blake3) if found. Resolves the parent via `volume_resolver` and uses
/// (platform_id, relpath) for the lookup — identical to `mark_broken`.
fn lookup_media_by_path(path: &Path) -> AppResult<Option<(i64, i64, String)>> {
    let parent = path
        .parent()
        .ok_or_else(|| crate::AppError::InvalidArg("no parent".into()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| crate::AppError::InvalidArg("no file name".into()))?
        .to_string_lossy()
        .to_string();
    let parent_resolved = volume_resolver::resolve(parent)
        .map_err(crate::AppError::InvalidArg)?;
    let relpath = if parent_resolved.relpath.is_empty() {
        file_name
    } else {
        format!("{}/{}", parent_resolved.relpath, file_name)
    };
    db::with_conn(|conn| -> AppResult<Option<(i64, i64, String)>> {
        Ok(conn
            .query_row(
                "SELECT m.id, m.size_bytes, m.blake3 FROM media m
                 JOIN volumes v ON v.id = m.volume_id
                 WHERE v.platform_id = ?1 AND m.relpath = ?2",
                params![parent_resolved.platform_id, relpath],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?)
    })
}

/// Pair pending removes with pending creates by (size, blake3). On match,
/// drain both sides out and return the pair. Capped by MAX_RELOCATE_HASHES.
fn pair_renames(pending: &mut Pending) -> Vec<(PathBuf, PathBuf)> {
    if pending.removes.is_empty() || pending.creates.is_empty() {
        return Vec::new();
    }

    // Snapshot DB-side metadata for every remove candidate up front.
    // (size, blake3) -> remove path
    let mut by_sig: HashMap<(i64, String), PathBuf> = HashMap::new();
    for p in pending.removes.iter() {
        match lookup_media_by_path(p) {
            Ok(Some((_id, size, blake3))) => {
                by_sig.insert((size, blake3), p.clone());
            }
            Ok(None) => {}
            Err(e) => eprintln!("pair_renames lookup {} failed: {e}", p.display()),
        }
    }
    if by_sig.is_empty() {
        return Vec::new();
    }

    let removed_sizes: HashSet<i64> = by_sig.keys().map(|(s, _)| *s).collect();

    let mut pairs = Vec::new();
    let mut hashed = 0usize;
    let creates_snapshot: Vec<PathBuf> = pending.creates.iter().cloned().collect();
    for new_path in creates_snapshot {
        if hashed >= MAX_RELOCATE_HASHES {
            break;
        }
        if !new_path.is_file() {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&new_path) else {
            continue;
        };
        let size = meta.len() as i64;
        if !removed_sizes.contains(&size) {
            continue;
        }
        let new_hash = match hasher::blake3_file(&new_path) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("pair_renames hash {} failed: {e}", new_path.display());
                continue;
            }
        };
        hashed += 1;
        if let Some(old_path) = by_sig.remove(&(size, new_hash)) {
            pending.creates.remove(&new_path);
            pending.removes.remove(&old_path);
            pairs.push((old_path, new_path));
        }
    }
    pairs
}

/// Relocate `media_id` (looked up from `old_path`) to `new_path`.
/// Returns `Ok(true)` if a row was moved/merged/found-already-at-target.
fn handle_rename(old_path: &Path, new_path: &Path) -> AppResult<bool> {
    let Some((media_id, _, _)) = lookup_media_by_path(old_path)? else {
        return Ok(false);
    };
    relocate::relocate_media(media_id, new_path)?;
    Ok(true)
}

/// Look in the conv's source root for a file matching (size, blake3) of the
/// removed media. If found, relocate. Hash budget is shared across the flush
/// via `hashes_used`.
fn try_relocate_removed(
    conv_id: i64,
    removed_path: &Path,
    hashes_used: &mut usize,
) -> AppResult<bool> {
    if *hashes_used >= MAX_RELOCATE_HASHES {
        return Ok(false);
    }
    let Some((media_id, size, blake3)) = lookup_media_by_path(removed_path)? else {
        return Ok(false);
    };
    let Some(root) = conv_root(conv_id)? else {
        return Ok(false);
    };
    let candidates = folder_scanner::enumerate_media(&root);
    for candidate in candidates {
        if *hashes_used >= MAX_RELOCATE_HASHES {
            break;
        }
        // Skip the now-gone old path if it happens to surface (it shouldn't).
        if candidate == removed_path {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&candidate) else {
            continue;
        };
        if (meta.len() as i64) != size {
            continue;
        }
        let candidate_hash = match hasher::blake3_file(&candidate) {
            Ok(h) => h,
            Err(e) => {
                eprintln!(
                    "try_relocate_removed hash {} failed: {e}",
                    candidate.display()
                );
                continue;
            }
        };
        *hashes_used += 1;
        if candidate_hash == blake3 {
            relocate::relocate_media(media_id, &candidate)?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Resolve a folder_watch conversation's current source root to an absolute
/// path. Returns `None` for manual conversations or when the source volume is
/// not currently mounted.
fn conv_root(conv_id: i64) -> AppResult<Option<PathBuf>> {
    let row: Option<(String, String, String)> = db::with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT c.kind, COALESCE(v.last_mount, ''), COALESCE(c.source_relpath, '')
                 FROM conversations c
                 LEFT JOIN volumes v ON v.id = c.source_volume_id
                 WHERE c.id = ?1",
                params![conv_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?)
    })?;
    let Some((kind, mount, relpath)) = row else {
        return Ok(None);
    };
    if kind != "folder_watch" || mount.is_empty() {
        return Ok(None);
    }
    let root = volume_resolver::absolute_for(Path::new(&mount), &relpath);
    if !root.is_dir() {
        return Ok(None);
    }
    Ok(Some(root))
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

    db::with_conn(|conn| -> AppResult<bool> {
        let id: Option<i64> = conn
            .query_row(
                "SELECT m.id FROM media m JOIN volumes v ON v.id = m.volume_id
                 WHERE v.platform_id = ?1 AND m.relpath = ?2",
                params![parent_resolved.platform_id, relpath],
                |r| r.get(0),
            )
            .optional()?;
        let Some(id) = id else { return Ok(false) };
        conn.execute(
            "UPDATE media SET state = 'broken' WHERE id = ?1",
            params![id],
        )?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO broken_pointers
                (media_id, detected_at, last_known_volume, last_known_relpath)
             SELECT id, ?1, volume_id, relpath FROM media WHERE id = ?2",
            params![now, id],
        )?;
        Ok(true)
    })
    .map_err(|e| e.to_string())
}
