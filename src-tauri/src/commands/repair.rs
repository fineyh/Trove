//! `repair_media` — user-initiated rescue for a broken media row.
//!
//! Strategy: collect candidate search roots in order of decreasing likelihood
//! (caller hint → last-known parent folder on its volume → every mounted
//! volume), and within each root scan for files matching the row's
//! (size, blake3). The first root that produces matches wins:
//! - exactly 1 match → relocate, return Repaired
//! - ≥2 matches → return Ambiguous so the UI can ask the user to pick one
//! - 0 matches → try the next root
//! - exhausted → NotFound

use crate::events::{self, ConvChanged};
use crate::services::{folder_scanner, hasher, relocate, volume_resolver};
use crate::{db, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const MAX_CANDIDATES_PER_ROOT: usize = 5;
const MAX_TOTAL_HASHES: usize = 5000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairMediaArgs {
    pub media_id: i64,
    #[serde(default)]
    pub hint_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RepairOutcome {
    Repaired { absolute: String },
    NotFound,
    Ambiguous { candidates: Vec<String> },
}

#[tauri::command]
pub fn repair_media(args: RepairMediaArgs) -> AppResult<RepairOutcome> {
    let target = load_target(args.media_id)?;

    let mut roots: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    // 1. Explicit hint.
    if let Some(hint) = args.hint_path.as_ref() {
        let p = PathBuf::from(hint);
        if p.is_dir() && seen.insert(p.clone()) {
            roots.push(p);
        }
    }

    // 2. Last-known parent folder on its (possibly remounted) volume.
    if let Some(last_root) = last_known_parent(&target)? {
        if last_root.is_dir() && seen.insert(last_root.clone()) {
            roots.push(last_root);
        }
    }

    // 3. Every currently-mounted volume as a fallback.
    for v in volume_resolver::enumerate_mounted() {
        if seen.insert(v.mount_point.clone()) {
            roots.push(v.mount_point);
        }
    }

    let mut hashes_used = 0usize;
    for root in roots {
        let matches = scan_root(&root, &target, &mut hashes_used);
        if matches.is_empty() {
            continue;
        }
        if matches.len() == 1 {
            let abs = matches.into_iter().next().unwrap();
            relocate::relocate_media(target.media_id, &abs)?;
            notify_conversations(target.media_id)?;
            return Ok(RepairOutcome::Repaired {
                absolute: abs.to_string_lossy().to_string(),
            });
        }
        let candidates = matches
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        return Ok(RepairOutcome::Ambiguous { candidates });
    }
    Ok(RepairOutcome::NotFound)
}

struct Target {
    media_id: i64,
    size_bytes: i64,
    blake3: String,
    last_known_mount: Option<PathBuf>,
    last_known_relpath: Option<String>,
}

fn load_target(media_id: i64) -> AppResult<Target> {
    db::with_conn(|conn| -> AppResult<Target> {
        type Row = (i64, String, Option<String>, Option<String>);
        let row: Row = conn
            .query_row(
                "SELECT m.size_bytes, m.blake3, lkv.last_mount, bp.last_known_relpath
                 FROM media m
                 LEFT JOIN broken_pointers bp ON bp.media_id = m.id
                 LEFT JOIN volumes lkv ON lkv.id = bp.last_known_volume
                 WHERE m.id = ?1",
                params![media_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("media #{media_id}")))?;
        let (size_bytes, blake3, last_mount, last_known_relpath) = row;
        Ok(Target {
            media_id,
            size_bytes,
            blake3,
            last_known_mount: last_mount.map(PathBuf::from),
            last_known_relpath,
        })
    })
}

fn last_known_parent(target: &Target) -> AppResult<Option<PathBuf>> {
    let Some(mount) = target.last_known_mount.as_ref() else {
        return Ok(None);
    };
    let Some(rel) = target.last_known_relpath.as_ref() else {
        return Ok(None);
    };
    let abs = volume_resolver::absolute_for(mount, rel);
    Ok(abs.parent().map(PathBuf::from))
}

fn scan_root(root: &Path, target: &Target, hashes_used: &mut usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for candidate in folder_scanner::enumerate_media(root) {
        if found.len() >= MAX_CANDIDATES_PER_ROOT {
            break;
        }
        if *hashes_used >= MAX_TOTAL_HASHES {
            break;
        }
        let Ok(meta) = std::fs::metadata(&candidate) else {
            continue;
        };
        if (meta.len() as i64) != target.size_bytes {
            continue;
        }
        let candidate_hash = match hasher::blake3_file(&candidate) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("repair scan hash {} failed: {e}", candidate.display());
                continue;
            }
        };
        *hashes_used += 1;
        if candidate_hash == target.blake3 {
            found.push(candidate);
        }
    }
    found
}

fn notify_conversations(media_id: i64) -> AppResult<()> {
    let conv_ids: Vec<i64> = db::with_conn(|conn| -> AppResult<Vec<i64>> {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT conv_id FROM messages WHERE media_id = ?1",
        )?;
        let r = stmt
            .query_map(params![media_id], |row| row.get::<_, i64>(0))?
            .filter_map(Result::ok)
            .collect();
        Ok(r)
    })?;
    for conv_id in conv_ids {
        events::emit_conv_changed(ConvChanged {
            conv_id,
            added: 0,
            broken: 0,
            renamed: 1,
        });
    }
    Ok(())
}
