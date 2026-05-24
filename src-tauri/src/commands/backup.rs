//! Settings → Backup: export / import .trovebackup.
//!
//! Export does a WAL checkpoint then copies the live trove.db (and
//! vault.json + thumbs/ if present) into a zip.
//!
//! Import:
//!   1. Validate the zip + manifest
//!   2. Close the DB connection
//!   3. Move current trove.db / vault.json / thumbs/ aside to
//!      <data_dir>/backups/<unix_ts>/  (safety net — never destructive)
//!   4. Copy extracted files into place
//!   5. Return — the frontend triggers an app restart via plugin-process
//!      because reopening the DB needs to re-run the vault flow.

use crate::services::{backup, vault};
use crate::{db, AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub dest_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub dest_path: String,
    pub bytes: u64,
    pub includes_vault: bool,
    pub db_encrypted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportArgs {
    pub source_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub backup_dir: String,
    pub restored_db_bytes: u64,
    pub includes_vault: bool,
    pub db_encrypted: bool,
}

#[tauri::command]
pub fn export_backup(app: AppHandle, args: ExportArgs) -> AppResult<ExportResult> {
    if !vault::is_unlocked() {
        return Err(AppError::InvalidArg(
            "vault is locked — unlock the master password before exporting".into(),
        ));
    }

    backup::checkpoint_db()?;

    let data_dir = vault::data_dir();
    let dest = PathBuf::from(&args.dest_path);
    let app_version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let db_encrypted = vault::has_master_password();

    let bytes = backup::write_backup_zip(&dest, &data_dir, &app_version, db_encrypted)?;

    Ok(ExportResult {
        dest_path: dest.to_string_lossy().to_string(),
        bytes,
        includes_vault: db_encrypted,
        db_encrypted,
    })
}

#[tauri::command]
pub fn import_backup(args: ImportArgs) -> AppResult<ImportResult> {
    let data_dir = vault::data_dir();
    let src = PathBuf::from(&args.source_path);

    // 1. Validate + extract.
    let parsed = backup::read_backup_zip(&src, &data_dir)?;

    // 2. Close the live DB so we can replace the file.
    crate::services::file_watcher::stop_all();
    db::close();

    // 3. Move current state aside.
    let backup_dir = match backup::move_aside_current(&data_dir) {
        Ok(p) => p,
        Err(e) => {
            backup::cleanup_temp(&parsed.temp_dir);
            return Err(e);
        }
    };

    // 4. Install the extracted files.
    let restored_db_bytes = match backup::install_extracted(&data_dir, &parsed.temp_dir) {
        Ok(n) => n,
        Err(e) => {
            // Best-effort rollback: move files back from backup_dir.
            let _ = rollback_from(&data_dir, &backup_dir);
            backup::cleanup_temp(&parsed.temp_dir);
            return Err(e);
        }
    };

    // 5. Cleanup the extraction temp.
    backup::cleanup_temp(&parsed.temp_dir);

    // 6. Wipe vault in-memory state. The frontend is expected to relaunch
    //    the app so init() / boot_scan run cleanly against the new files.
    vault::forget_keys();

    Ok(ImportResult {
        backup_dir: backup_dir.to_string_lossy().to_string(),
        restored_db_bytes,
        includes_vault: parsed.manifest.includes_vault,
        db_encrypted: parsed.manifest.db_encrypted,
    })
}

fn rollback_from(data_dir: &std::path::Path, backup_dir: &std::path::Path) -> std::io::Result<()> {
    for name in ["trove.db", "vault.json", "trove.db-wal", "trove.db-shm"] {
        let src = backup_dir.join(name);
        if src.exists() {
            let _ = std::fs::rename(&src, data_dir.join(name));
        }
    }
    let thumbs = backup_dir.join("thumbs");
    if thumbs.is_dir() {
        let _ = std::fs::rename(&thumbs, data_dir.join("thumbs"));
    }
    Ok(())
}
