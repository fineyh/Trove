//! Settings → Backup: export / import `.trovebackup` (see services/backup.rs).
//!
//! Import never deletes: the current keyring and libraries are moved to
//! `<data>/backups/<ts>/`, then the app relaunches so boot runs against the
//! restored files.

use crate::services::{backup, session};
use crate::{db, AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub dest_path: String,
    /// Seal this backup's keyring with its own password. Ignored when a
    /// startup password is set (the backup is protected by that already).
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub dest_path: String,
    pub bytes: u64,
    pub password_protected: bool,
}

#[tauri::command]
pub async fn export_backup(app: AppHandle, args: ExportArgs) -> AppResult<ExportResult> {
    if !session::is_app_unlocked() {
        return Err(AppError::Locked("app".into()));
    }
    let app_version = app.config().version.clone().unwrap_or_else(|| "unknown".into());
    super::run_blocking(move || {
        let pw = args.password.filter(|p| !p.is_empty());
        if let Some(p) = &pw {
            super::security::require_password(p)?;
        }
        let dest = PathBuf::from(&args.dest_path);
        let out = backup::export(&dest, &app_version, pw.as_deref())?;
        Ok(ExportResult {
            dest_path: dest.to_string_lossy().to_string(),
            bytes: out.bytes,
            password_protected: out.password_protected,
        })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportArgs {
    pub source_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Where the replaced data was moved.
    pub backup_dir: String,
    pub password_protected: bool,
    pub libraries: usize,
}

#[tauri::command]
pub async fn import_backup(args: ImportArgs) -> AppResult<ImportResult> {
    super::run_blocking(move || {
        let data_dir = session::data_dir();
        let staged = backup::stage(&PathBuf::from(&args.source_path), &data_dir)?;
        crate::services::file_watcher::stop_all();
        db::close_all();
        let aside = backup::install(&staged, &data_dir)?;
        Ok(ImportResult {
            backup_dir: aside.to_string_lossy().to_string(),
            password_protected: staged.manifest.password_protected,
            libraries: staged.manifest.libraries,
        })
    })
    .await
}
