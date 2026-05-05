use crate::{db, services, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn folder_basename(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateManualFromFolderArgs {
    pub folder_path: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportResult {
    pub conv_id: i64,
    pub imported: usize,
}

/// Create a `manual` conversation seeded with every media file inside
/// `folder_path` (recursive). After creation the conversation behaves
/// identically to a hand-built manual conversation — no watcher attaches.
#[tauri::command]
pub fn create_manual_from_folder(
    args: CreateManualFromFolderArgs,
) -> AppResult<BulkImportResult> {
    let folder = PathBuf::from(&args.folder_path);
    if !folder.is_dir() {
        return Err(AppError::InvalidArg(format!(
            "not a directory: {}",
            folder.display()
        )));
    }
    let name = args
        .name
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| folder_basename(&folder));

    let now = now_ms();
    let conv_id: i64 = db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO conversations
                (name, avatar_path, kind, source_volume_id, source_relpath,
                 encrypted, enc_key_wrapped, pinned, archived, created_at, updated_at)
             VALUES (?1, NULL, 'manual', NULL, NULL, 0, NULL, 0, 0, ?2, ?2)",
            params![name, now],
        )?;
        Ok::<i64, AppError>(conn.last_insert_rowid())
    })?;

    let paths = services::folder_scanner::enumerate_media(&folder);
    let mut imported = 0usize;
    let mut first_image_abs: Option<String> = None;
    for p in paths {
        match super::media::ingest_one(conv_id, &p, true, true) {
            Ok(Some(msg)) => {
                imported += 1;
                if first_image_abs.is_none() {
                    let mime = mime_guess::from_path(&p).first_or_octet_stream();
                    if mime.type_().as_str() == "image" {
                        first_image_abs = Some(msg.absolute_path);
                    }
                }
            }
            Ok(None) => {}
            Err(e) => eprintln!("bulk import failed for {}: {e}", p.display()),
        }
    }

    if let Some(avatar) = first_image_abs {
        let touch = now_ms();
        let _ = db::with_conn(|conn| {
            conn.execute(
                "UPDATE conversations SET avatar_path = ?1, updated_at = ?2 WHERE id = ?3",
                params![avatar, touch, conv_id],
            )
        });
    }

    Ok(BulkImportResult { conv_id, imported })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanResult {
    pub added: usize,
}

/// Manually re-scan a folder_watch conversation. Useful when the watcher
/// missed events (it was offline, large directory dump, etc.).
#[tauri::command]
pub fn rescan_folder(conv_id: i64) -> AppResult<RescanResult> {
    let row: Option<(String, String, i64)> = db::with_conn(|conn| {
        conn.query_row(
            "SELECT v.last_mount, c.source_relpath, c.source_volume_id
             FROM conversations c JOIN volumes v ON v.id = c.source_volume_id
             WHERE c.id = ?1 AND c.kind = 'folder_watch'",
            params![conv_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(AppError::from)
    })?;
    let (mount, relpath, _vid) = row.ok_or_else(|| {
        AppError::NotFound(format!("folder_watch conversation #{conv_id} not found"))
    })?;
    let root = services::volume_resolver::absolute_for(Path::new(&mount), &relpath);
    if !root.is_dir() {
        return Err(AppError::InvalidArg(format!(
            "watched folder is not present: {}",
            root.display()
        )));
    }
    let paths = services::folder_scanner::enumerate_media(&root);
    let mut added = 0usize;
    for p in paths {
        match super::media::ingest_one(conv_id, &p, false, true) {
            Ok(Some(_)) => added += 1,
            Ok(None) => {}
            Err(e) => eprintln!("rescan ingest failed for {}: {e}", p.display()),
        }
    }
    if added > 0 {
        let now = now_ms();
        let _ = db::with_conn(|conn| {
            conn.execute(
                "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
                params![now, conv_id],
            )
        });
    }
    Ok(RescanResult { added })
}
