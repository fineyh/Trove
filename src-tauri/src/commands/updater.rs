//! Tauri auto-updater commands.
//!
//! Two surfaces:
//!   - `check_for_update` — non-mutating, returns whether an update is
//!     available and its metadata.
//!   - `install_update` — downloads + applies, then restarts.
//!
//! Both call into `tauri-plugin-updater` which handles signature
//! verification against the pubkey in tauri.conf.json.

use crate::{AppError, AppResult};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub date: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> AppResult<UpdateInfo> {
    let current_version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let updater = app.updater()?;
    let result = updater.check().await?;

    Ok(match result {
        Some(u) => UpdateInfo {
            available: true,
            current_version,
            latest_version: Some(u.version.clone()),
            date: u.date.map(|d| d.to_string()),
            notes: u.body.clone(),
        },
        None => UpdateInfo {
            available: false,
            current_version,
            latest_version: None,
            date: None,
            notes: None,
        },
    })
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    let updater = app.updater()?;
    let Some(update) = updater.check().await? else {
        return Err(AppError::InvalidArg("no update available".into()));
    };
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await?;
    app.restart();
}
