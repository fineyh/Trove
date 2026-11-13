//! Startup password, app lock, recovery code (ADR-036).
//!
//! Every command that derives a key runs through `run_blocking`: Argon2id is
//! deliberately slow and must never sit on the thread that paints the window
//! (ADR-034).

use crate::services::keyring::Secret;
use crate::services::session::{self, BootErrorKind, SecurityStatus};
use crate::{AppError, AppResult};
use serde::Serialize;

pub(crate) fn require_password(password: &str) -> AppResult<()> {
    if password.chars().count() < 6 {
        return Err(AppError::InvalidArg("密码至少 6 个字符".into()));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootError {
    pub kind: BootErrorKind,
    pub detail: String,
    pub data_dir: String,
}

/// Set when startup failed; the frontend asks this before anything else.
#[tauri::command]
pub fn boot_error() -> Option<BootError> {
    session::boot_error().map(|f| BootError {
        kind: f.kind,
        detail: f.detail,
        data_dir: session::data_dir().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn security_status() -> AppResult<SecurityStatus> {
    if let Some(f) = session::boot_error() {
        return Err(AppError::Other(anyhow::anyhow!(f.detail)));
    }
    Ok(session::status())
}

/// `method`: "password" | "recovery".
#[tauri::command]
pub async fn app_unlock(secret: String, method: String) -> AppResult<()> {
    super::run_blocking(move || {
        let s = match method.as_str() {
            "recovery" => Secret::Recovery(&secret),
            _ => Secret::Password(&secret),
        };
        session::unlock_app(&s)
    })
    .await?;
    super::spawn_all_library_tasks();
    Ok(())
}

#[tauri::command]
pub fn app_lock() -> AppResult<()> {
    session::lock_app()
}

/// Returns the recovery code; the UI shows it once.
#[tauri::command]
pub async fn app_set_password(password: String) -> AppResult<String> {
    require_password(&password)?;
    super::run_blocking(move || session::set_app_password(&password)).await
}

#[tauri::command]
pub async fn app_change_password(old_password: String, new_password: String) -> AppResult<()> {
    require_password(&new_password)?;
    super::run_blocking(move || session::change_app_password(&old_password, &new_password)).await
}

#[tauri::command]
pub async fn app_remove_password(password: String) -> AppResult<()> {
    super::run_blocking(move || session::remove_app_password(&password)).await
}

#[tauri::command]
pub async fn app_reset_recovery(password: String) -> AppResult<String> {
    super::run_blocking(move || session::reset_app_recovery(&password)).await
}

/// Remove the plaintext pre-migration database left from the upgrade.
#[tauri::command]
pub fn delete_legacy_copy() -> AppResult<()> {
    session::delete_legacy_copy()
}

/// Ask for the WebView's profile directory (history, cache) to be wiped on
/// the next start — it can't be deleted while the WebView is running. Older
/// versions left media paths in there (ADR-037).
#[tauri::command]
pub fn schedule_webview_purge() -> AppResult<()> {
    let marker = session::data_dir().join(PURGE_MARKER);
    std::fs::write(marker, b"1")?;
    Ok(())
}

pub const PURGE_MARKER: &str = "purge-webview-profile";
