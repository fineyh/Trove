//! `repair_media` — user-initiated rescue for a broken media row, plus
//! `list_broken_pointers` — read-side view used by the settings UI.
//!
//! Automatic match: the user picks one of three search scopes. The Plan
//! defaults to `LastFolderOnly` (only the file's original parent folder),
//! which has the highest precision-to-cost ratio.
//!
//! Manual match (`explicit_path`): the user picked a file via a dialog.
//! We verify size + blake3 against the media row before relocating, and
//! return `Mismatch` if it doesn't match (so the user can't accidentally
//! re-bind a media row to an unrelated file).

use crate::events::{self, ConvChanged};
use crate::services::{folder_scanner, hasher, relocate, volume_resolver};
use crate::{db, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_CANDIDATES_PER_ROOT: usize = 5;
const MAX_TOTAL_HASHES: usize = 5000;

#[derive(Debug, Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum RepairScope {
    #[default]
    LastFolderOnly,
    LastFolderRecursive,
    AllMountedVolumes,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairMediaArgs {
    pub media_id: i64,
    #[serde(default)]
    pub scope: RepairScope,
    #[serde(default)]
    pub explicit_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RepairOutcome {
    Repaired { absolute: String },
    NotFound,
    Ambiguous { candidates: Vec<String> },
    Mismatch { reason: String },
}

#[tauri::command]
pub fn repair_media(args: RepairMediaArgs) -> AppResult<RepairOutcome> {
    let target = load_target(args.media_id)?;

    if let Some(explicit) = args.explicit_path.as_ref() {
        return repair_with_explicit(&target, Path::new(explicit));
    }

    repair_with_scope(&target, args.scope)
}

fn repair_with_explicit(target: &Target, path: &Path) -> AppResult<RepairOutcome> {
    if !path.is_file() {
        return Ok(RepairOutcome::Mismatch {
            reason: "选中的不是一个文件".into(),
        });
    }
    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::InvalidArg(format!("无法读取文件: {e}")))?;
    if (meta.len() as i64) != target.size_bytes {
        return Ok(RepairOutcome::Mismatch {
            reason: format!(
                "文件大小不一致：原 {} 字节，选中文件 {} 字节",
                target.size_bytes,
                meta.len()
            ),
        });
    }
    let hash = hasher::blake3_file(path)
        .map_err(|e| AppError::InvalidArg(format!("无法读取文件: {e}")))?;
    if hash != target.blake3 {
        return Ok(RepairOutcome::Mismatch {
            reason: "文件内容（blake3 哈希）与原记录不一致".into(),
        });
    }
    relocate::relocate_media(target.media_id, path)?;
    notify_conversations(target.media_id)?;
    Ok(RepairOutcome::Repaired {
        absolute: path.to_string_lossy().to_string(),
    })
}

fn repair_with_scope(target: &Target, scope: RepairScope) -> AppResult<RepairOutcome> {
    let mut hashes_used = 0usize;
    for root in collect_roots(target, scope) {
        let matches = scan_root(&root, target, scope, &mut hashes_used);
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

fn collect_roots(target: &Target, scope: RepairScope) -> Vec<PathBuf> {
    match scope {
        RepairScope::LastFolderOnly | RepairScope::LastFolderRecursive => {
            last_known_parent(target)
                .into_iter()
                .filter(|p| p.is_dir())
                .collect()
        }
        RepairScope::AllMountedVolumes => {
            let mut roots: Vec<PathBuf> = Vec::new();
            let mut seen: std::collections::HashSet<PathBuf> =
                std::collections::HashSet::new();
            if let Some(p) = last_known_parent(target) {
                if p.is_dir() && seen.insert(p.clone()) {
                    roots.push(p);
                }
            }
            for v in volume_resolver::enumerate_mounted() {
                if seen.insert(v.mount_point.clone()) {
                    roots.push(v.mount_point);
                }
            }
            roots
        }
    }
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

fn last_known_parent(target: &Target) -> Option<PathBuf> {
    let mount = target.last_known_mount.as_ref()?;
    let rel = target.last_known_relpath.as_ref()?;
    let abs = volume_resolver::absolute_for(mount, rel);
    abs.parent().map(PathBuf::from)
}

fn scan_root(
    root: &Path,
    target: &Target,
    scope: RepairScope,
    hashes_used: &mut usize,
) -> Vec<PathBuf> {
    let candidates: Vec<PathBuf> = match scope {
        RepairScope::LastFolderOnly => folder_scanner::enumerate_media_shallow(root),
        RepairScope::LastFolderRecursive | RepairScope::AllMountedVolumes => {
            folder_scanner::enumerate_media(root)
        }
    };
    let mut found = Vec::new();
    for candidate in candidates {
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

// ---------------------------------------------------------------------------
// list_broken_pointers
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenItem {
    pub message_id: i64,
    pub media_id: i64,
    pub kind: String,
    pub thumb_path: Option<String>,
    pub last_known_relpath: Option<String>,
    pub last_known_volume_label: Option<String>,
    pub detected_at: i64,
    pub size_bytes: i64,
    pub message_created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenGroup {
    pub conv_id: i64,
    pub conv_name: String,
    pub items: Vec<BrokenItem>,
}

#[tauri::command]
pub fn list_broken_pointers() -> AppResult<Vec<BrokenGroup>> {
    db::with_conn(|conn| -> AppResult<Vec<BrokenGroup>> {
        let mut stmt = conn.prepare(
            "SELECT
                msg.id, msg.conv_id, msg.created_at,
                md.id, md.kind, md.thumb_path, md.size_bytes,
                bp.detected_at, bp.last_known_relpath,
                v.label,
                c.name
             FROM broken_pointers bp
             JOIN media md ON md.id = bp.media_id
             JOIN messages msg ON msg.media_id = md.id
             JOIN conversations c ON c.id = msg.conv_id
             LEFT JOIN volumes v ON v.id = bp.last_known_volume
             ORDER BY c.name COLLATE NOCASE ASC,
                      msg.conv_id ASC,
                      msg.created_at DESC,
                      msg.id DESC",
        )?;

        type RawRow = (
            i64,            // msg.id
            i64,            // msg.conv_id
            i64,            // msg.created_at
            i64,            // md.id
            String,         // md.kind
            Option<String>, // md.thumb_path
            i64,            // md.size_bytes
            i64,            // bp.detected_at
            Option<String>, // bp.last_known_relpath
            Option<String>, // v.label
            String,         // c.name
        );

        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, Option<String>>(8)?,
                    r.get::<_, Option<String>>(9)?,
                    r.get::<_, String>(10)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<RawRow>>>()?;

        // Group by conv_id while preserving the ORDER BY ordering.
        let mut groups: Vec<BrokenGroup> = Vec::new();
        for row in rows {
            let (
                msg_id,
                conv_id,
                msg_created_at,
                media_id,
                kind,
                thumb_path,
                size_bytes,
                detected_at,
                last_known_relpath,
                last_known_volume_label,
                conv_name,
            ) = row;
            let item = BrokenItem {
                message_id: msg_id,
                media_id,
                kind,
                thumb_path,
                last_known_relpath,
                last_known_volume_label,
                detected_at,
                size_bytes,
                message_created_at: msg_created_at,
            };
            match groups.last_mut() {
                Some(g) if g.conv_id == conv_id => g.items.push(item),
                _ => groups.push(BrokenGroup {
                    conv_id,
                    conv_name,
                    items: vec![item],
                }),
            }
        }
        Ok(groups)
    })
}
