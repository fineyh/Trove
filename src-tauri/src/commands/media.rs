use crate::{db, services, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMessage {
    pub message_id: i64,
    pub media_id: i64,
    pub absolute_path: String,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn classify(path: &Path) -> &'static str {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    match mime.type_().as_str() {
        "image" => "image",
        "video" => "video",
        _ => "other",
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFilesArgs {
    pub conv_id: i64,
    pub paths: Vec<String>,
}

#[tauri::command]
pub fn import_files(args: ImportFilesArgs) -> AppResult<Vec<ImportedMessage>> {
    if args.paths.is_empty() {
        return Ok(vec![]);
    }
    let kind: String = db::with_conn(|conn| {
        conn.query_row(
            "SELECT kind FROM conversations WHERE id = ?1",
            params![args.conv_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)
    })?;
    if kind == "folder_watch" {
        return Err(AppError::InvalidArg(
            "folder_watch conversations don't accept manual uploads".into(),
        ));
    }

    let mut imported = Vec::with_capacity(args.paths.len());
    for raw in &args.paths {
        let path = PathBuf::from(raw);
        if !path.is_file() {
            continue;
        }
        if let Some(imp) = ingest_one(args.conv_id, &path, true, false)? {
            imported.push(imp);
        }
    }

    if !imported.is_empty() {
        let now = now_ms();
        db::with_conn(|conn| -> AppResult<()> {
            conn.execute(
                "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
                params![now, args.conv_id],
            )?;
            Ok(())
        })?;
    }

    Ok(imported)
}

/// Insert a media file into the DB and (optionally) attach a message to a
/// conversation. Used by manual uploads, bulk-from-folder, and the watcher.
///
/// `allow_message_dup`:
///   - `true`  → always create a new `messages` row (manual upload semantics)
///   - `false` → only create a message if no existing message in this conv
///               already references the same media (folder scan / watcher)
///
/// `use_mtime_for_created_at`:
///   - `false` → use wall-clock now (composer "I'm sending this right now")
///   - `true`  → use the file's mtime (folder scans / watcher — preserves
///               chronological order of an imported collection)
///
/// Returns `None` when the file was an exact duplicate skipped by the dedup
/// path; `Some` when a fresh message was created.
pub(crate) fn ingest_one(
    conv_id: i64,
    path: &Path,
    allow_message_dup: bool,
    use_mtime_for_created_at: bool,
) -> AppResult<Option<ImportedMessage>> {
    let resolved = services::volume_resolver::resolve(path).map_err(AppError::InvalidArg)?;
    let volume_id = super::conversations::ensure_volume(
        &resolved.platform_id,
        &resolved.label,
        &resolved.mount_point,
    )?;

    let metadata = std::fs::metadata(path)?;
    let size_bytes = metadata.len() as i64;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(now_ms);
    let blake3 = services::hasher::blake3_file(path)?;
    let kind = classify(path);
    let filename_caption = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let created_at = if use_mtime_for_created_at { mtime } else { now_ms() };

    let result = db::with_conn(|conn| -> AppResult<Option<(i64, i64)>> {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM media WHERE volume_id = ?1 AND relpath = ?2",
                params![volume_id, resolved.relpath],
                |r| r.get(0),
            )
            .optional()?;
        let media_id = if let Some(id) = existing {
            conn.execute(
                "UPDATE media SET size_bytes = ?1, mtime = ?2, blake3 = ?3, state = 'live'
                 WHERE id = ?4",
                params![size_bytes, mtime, blake3, id],
            )?;
            conn.execute(
                "DELETE FROM broken_pointers WHERE media_id = ?1",
                params![id],
            )?;
            id
        } else {
            conn.execute(
                "INSERT INTO media
                    (volume_id, relpath, size_bytes, mtime, blake3, kind, state)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'live')",
                params![
                    volume_id,
                    resolved.relpath,
                    size_bytes,
                    mtime,
                    blake3,
                    kind
                ],
            )?;
            conn.last_insert_rowid()
        };

        if !allow_message_dup {
            let already: Option<i64> = conn
                .query_row(
                    "SELECT id FROM messages WHERE conv_id = ?1 AND media_id = ?2 LIMIT 1",
                    params![conv_id, media_id],
                    |r| r.get(0),
                )
                .optional()?;
            if already.is_some() {
                return Ok(None);
            }
        }

        conn.execute(
            "INSERT INTO messages (conv_id, media_id, caption, play_count, created_at)
             VALUES (?1, ?2, ?3, 0, ?4)",
            params![conv_id, media_id, filename_caption, created_at],
        )?;
        let msg_id = conn.last_insert_rowid();
        Ok(Some((media_id, msg_id)))
    })?;

    let Some((media_id, message_id)) = result else {
        return Ok(None);
    };

    let absolute = services::volume_resolver::absolute_for(&resolved.mount_point, &resolved.relpath)
        .to_string_lossy()
        .to_string();

    Ok(Some(ImportedMessage {
        message_id,
        media_id,
        absolute_path: absolute,
    }))
}
