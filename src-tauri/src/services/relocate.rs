//! Shared media-row relocation used by the watcher (rename / cut-paste
//! detection) and by the `repair_media` command.
//!
//! Three outcomes:
//! - `Moved` — the destination slot was free; we updated volume_id + relpath.
//! - `Merged { absorbed_media_id }` — the destination already had a media row
//!   with the same blake3+size, so we re-pointed every `messages.media_id`
//!   from the old row to the existing one and dropped the old row.
//! - `AlreadyAtTarget` — old and new resolve to the same (volume_id, relpath).
//!
//! When the destination is occupied by a media row whose hash differs, we
//! refuse the move so the caller can surface a meaningful error.

use crate::services::volume_resolver;
use crate::{db, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RelocateOutcome {
    Moved,
    Merged { absorbed_media_id: i64 },
    AlreadyAtTarget,
}

/// Move `media_id` to wherever `new_path` lives. `new_path` must point at an
/// existing file (caller is responsible for that — we don't sanity-check
/// because the watcher path has already proven the file exists).
pub fn relocate_media(media_id: i64, new_path: &Path) -> AppResult<RelocateOutcome> {
    let parent = new_path
        .parent()
        .ok_or_else(|| AppError::InvalidArg("new_path has no parent".into()))?;
    let resolved = volume_resolver::resolve(parent).map_err(AppError::InvalidArg)?;
    let file_name = new_path
        .file_name()
        .ok_or_else(|| AppError::InvalidArg("new_path has no file name".into()))?
        .to_string_lossy()
        .to_string();
    let new_relpath = if resolved.relpath.is_empty() {
        file_name
    } else {
        format!("{}/{}", resolved.relpath, file_name)
    };

    let now = chrono::Utc::now().timestamp_millis();
    let mount_str = resolved.mount_point.to_string_lossy().to_string();

    db::with_conn(|conn| -> AppResult<RelocateOutcome> {
        // Snapshot old row.
        type OldRow = (i64, String, i64, String);
        let old: OldRow = conn
            .query_row(
                "SELECT volume_id, relpath, size_bytes, blake3 FROM media WHERE id = ?1",
                params![media_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("media #{media_id}")))?;
        let (old_volume_id, old_relpath, old_size, old_blake3) = old;

        // Ensure target volume row exists / is up-to-date.
        let new_volume_id: i64 = {
            let existing: Option<i64> = conn
                .query_row(
                    "SELECT id FROM volumes WHERE platform_id = ?1",
                    params![resolved.platform_id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(id) = existing {
                conn.execute(
                    "UPDATE volumes SET last_mount = ?1 WHERE id = ?2",
                    params![mount_str, id],
                )?;
                id
            } else {
                conn.execute(
                    "INSERT INTO volumes (platform_id, label, last_mount, created_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![resolved.platform_id, resolved.label, mount_str, now],
                )?;
                conn.last_insert_rowid()
            }
        };

        // No-op?
        if new_volume_id == old_volume_id && new_relpath == old_relpath {
            // Still good to mark live + drop any stale broken_pointer row.
            conn.execute(
                "UPDATE media SET state = 'live' WHERE id = ?1 AND state != 'live'",
                params![media_id],
            )?;
            conn.execute(
                "DELETE FROM broken_pointers WHERE media_id = ?1",
                params![media_id],
            )?;
            return Ok(RelocateOutcome::AlreadyAtTarget);
        }

        // Is the destination occupied?
        type DestRow = (i64, i64, String);
        let dest: Option<DestRow> = conn
            .query_row(
                "SELECT id, size_bytes, blake3 FROM media WHERE volume_id = ?1 AND relpath = ?2",
                params![new_volume_id, new_relpath],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;

        if let Some((dest_id, dest_size, dest_blake3)) = dest {
            if dest_id == media_id {
                // Same row already there (shouldn't happen — we checked
                // (volume_id, relpath) above — but guard anyway).
                return Ok(RelocateOutcome::AlreadyAtTarget);
            }
            if dest_size == old_size && dest_blake3 == old_blake3 {
                // Merge old → dest. Repoint messages, drop broken_pointers,
                // delete old row.
                conn.execute(
                    "UPDATE messages SET media_id = ?1 WHERE media_id = ?2",
                    params![dest_id, media_id],
                )?;
                conn.execute(
                    "DELETE FROM broken_pointers WHERE media_id = ?1",
                    params![media_id],
                )?;
                conn.execute(
                    "DELETE FROM broken_pointers WHERE media_id = ?1",
                    params![dest_id],
                )?;
                conn.execute(
                    "UPDATE media SET state = 'live' WHERE id = ?1 AND state != 'live'",
                    params![dest_id],
                )?;
                conn.execute("DELETE FROM media WHERE id = ?1", params![media_id])?;
                return Ok(RelocateOutcome::Merged {
                    absorbed_media_id: media_id,
                });
            }
            return Err(AppError::InvalidArg(format!(
                "destination occupied by different file (media #{dest_id})"
            )));
        }

        // Free destination → straight relocate.
        conn.execute(
            "UPDATE media SET volume_id = ?1, relpath = ?2, state = 'live' WHERE id = ?3",
            params![new_volume_id, new_relpath, media_id],
        )?;
        conn.execute(
            "DELETE FROM broken_pointers WHERE media_id = ?1",
            params![media_id],
        )?;
        Ok(RelocateOutcome::Moved)
    })
}
