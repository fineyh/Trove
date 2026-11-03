use crate::services::{crypto, vault};
use crate::{db, events, services, AppError, AppResult};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
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
    // HEIC/HEIF aren't reliably mapped by mime_guess; pin them to "image" so the
    // frontend routes them through the (HEIC-aware) image renderer.
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    if matches!(ext.as_deref(), Some("heic") | Some("heif")) {
        return "image";
    }
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

/// Shown when a second import is attempted while one is still running.
pub(crate) const BUSY: &str = "已有导入任务正在进行，请先等待完成或取消";

/// How many files to get through between progress events. One event per file
/// would flood the IPC channel on a 10k-file folder; 10 keeps the bar smooth.
const PROGRESS_EVERY: usize = 10;

/// Ingest `paths` into `conv_id`, reporting progress and honouring cancel.
///
/// Shared by all three import entry points (manual upload, bulk-from-folder,
/// rescan) so they emit the same event stream and stop the same way. Returns
/// `(imported, cancelled)`; per-file errors are logged and skipped, exactly as
/// before — one unreadable file must not abort a 10k-file scan.
pub(crate) fn ingest_batch(
    conv_id: i64,
    paths: &[PathBuf],
    job: &services::jobs::ImportJob,
    allow_message_dup: bool,
    use_mtime_for_created_at: bool,
    mut on_imported: impl FnMut(&Path, ImportedMessage),
) -> (usize, bool) {
    let total = paths.len();
    let mut imported = 0usize;
    let mut failed = 0usize;
    let mut cancelled = false;

    for (idx, path) in paths.iter().enumerate() {
        if job.cancelled() {
            cancelled = true;
            break;
        }
        if idx % PROGRESS_EVERY == 0 {
            events::emit_import_progress(events::ImportProgress {
                conv_id,
                done: idx,
                total,
                current: path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string()),
                finished: false,
                cancelled: false,
                failed,
            });
        }
        match ingest_one(conv_id, path, allow_message_dup, use_mtime_for_created_at) {
            Ok(Some(msg)) => {
                imported += 1;
                on_imported(path, msg);
            }
            Ok(None) => {}
            Err(e) => {
                failed += 1;
                eprintln!("import failed for {}: {e}", path.display());
            }
        }
    }

    // Always land a final event, cancelled or not, so the UI clears its bar.
    events::emit_import_progress(events::ImportProgress {
        conv_id,
        done: total,
        total,
        current: None,
        finished: true,
        cancelled,
        failed,
    });
    (imported, cancelled)
}

/// Ask the running import to stop at the next file boundary. Safe to call
/// when nothing is running.
#[tauri::command]
pub fn cancel_import() {
    services::jobs::request_cancel();
}

/// Import hand-picked files into a `manual` conversation.
///
/// `async` + `run_blocking` is load-bearing: every file gets a full-content
/// BLAKE3 hash and an EXIF read, which on the WebView callback thread froze
/// the window until the whole batch was done.
#[tauri::command]
pub async fn import_files(args: ImportFilesArgs) -> AppResult<Vec<ImportedMessage>> {
    super::run_blocking(move || import_files_blocking(args)).await
}

fn import_files_blocking(args: ImportFilesArgs) -> AppResult<Vec<ImportedMessage>> {
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

    let job = services::jobs::ImportJob::begin()
        .ok_or_else(|| AppError::InvalidArg(BUSY.into()))?;
    let paths: Vec<PathBuf> = args
        .paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .collect();

    let mut imported = Vec::with_capacity(paths.len());
    ingest_batch(args.conv_id, &paths, &job, true, false, |_, msg| {
        imported.push(msg)
    });

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
    // Best-effort geotag extraction (image EXIF / video ©xyz atom). Done before
    // the DB transaction since it's pure file I/O and must not hold the DB lock.
    let geo = services::exif::read_geotag(path, kind);
    let (lat, lon): (Option<f64>, Option<f64>) = match geo {
        Some((la, lo)) => (Some(la), Some(lo)),
        None => (None, None),
    };
    let filename_caption = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let created_at = if use_mtime_for_created_at { mtime } else { now_ms() };

    let conv_encrypted: bool = db::with_conn(|conn| {
        conn.query_row(
            "SELECT encrypted FROM conversations WHERE id = ?1",
            params![conv_id],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v != 0)
        .map_err(AppError::from)
    })?;
    let (caption_db, iv_db): (String, Option<Vec<u8>>) = if conv_encrypted {
        let key = vault::get_conv_key(conv_id)
            .ok_or_else(|| AppError::InvalidArg("conversation is locked".into()))?;
        let (nonce, ct) =
            crypto::encrypt_caption(&key, &filename_caption).map_err(AppError::from)?;
        let b64 = B64.encode(&ct);
        (b64, Some(nonce))
    } else {
        (filename_caption, None)
    };

    let result = db::with_conn(|conn| -> AppResult<Option<(i64, i64)>> {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM media WHERE volume_id = ?1 AND relpath = ?2",
                params![volume_id, resolved.relpath],
                |r| r.get(0),
            )
            .optional()?;
        let media_id = if let Some(id) = existing {
            // Re-extracting geotag on re-import keeps lat/lon current if the file
            // was edited (e.g. GPS stripped). geo_scanned is set so the backfill
            // pass skips this row.
            conn.execute(
                "UPDATE media SET size_bytes = ?1, mtime = ?2, blake3 = ?3, state = 'live',
                    lat = ?4, lon = ?5, geo_scanned = 1
                 WHERE id = ?6",
                params![size_bytes, mtime, blake3, lat, lon, id],
            )?;
            conn.execute(
                "DELETE FROM broken_pointers WHERE media_id = ?1",
                params![id],
            )?;
            id
        } else {
            conn.execute(
                "INSERT INTO media
                    (volume_id, relpath, size_bytes, mtime, blake3, kind, state,
                     lat, lon, geo_scanned)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'live', ?7, ?8, 1)",
                params![
                    volume_id,
                    resolved.relpath,
                    size_bytes,
                    mtime,
                    blake3,
                    kind,
                    lat,
                    lon
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
            "INSERT INTO messages (conv_id, media_id, caption, caption_iv, play_count, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![conv_id, media_id, caption_db, iv_db, created_at],
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
