//! Libraries: list, create, lock/unlock, passwords, key files, moving
//! conversations between them (ADR-038).

use crate::services::keyring::Secret;
use crate::services::session::{self, CreatedLibrary, LibraryInfo};
use crate::services::transfer;
use crate::{AppResult, AppError};
use serde::Deserialize;
use std::path::PathBuf;

#[tauri::command]
pub fn list_libraries() -> AppResult<Vec<LibraryInfo>> {
    session::list_libraries()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibraryArgs {
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[tauri::command]
pub async fn create_library(args: CreateLibraryArgs) -> AppResult<CreatedLibrary> {
    if let Some(p) = &args.password {
        super::security::require_password(p)?;
    }
    super::run_blocking(move || {
        session::create_library(&args.name, args.icon, args.color, args.password.as_deref())
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLibraryArgs {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[tauri::command]
pub fn update_library(args: UpdateLibraryArgs) -> AppResult<()> {
    session::update_library(&args.id, args.name.as_deref(), args.icon, args.color)
}

#[tauri::command]
pub fn reorder_libraries(ids: Vec<String>) -> AppResult<()> {
    session::reorder_libraries(&ids)
}

/// `method`: "password" | "recovery".
#[tauri::command]
pub async fn unlock_library(id: String, secret: String, method: String) -> AppResult<()> {
    super::run_blocking(move || {
        let s = match method.as_str() {
            "recovery" => Secret::Recovery(&secret),
            _ => Secret::Password(&secret),
        };
        session::unlock_library(&id, &s)
    })
    .await
}

#[tauri::command]
pub fn lock_library(id: String) -> AppResult<()> {
    session::lock_library(&id)
}

#[tauri::command]
pub async fn set_library_password(id: String, password: String) -> AppResult<CreatedLibrary> {
    super::security::require_password(&password)?;
    super::run_blocking(move || session::set_library_password(&id, &password)).await
}

#[tauri::command]
pub async fn change_library_password(id: String, old_password: String, new_password: String) -> AppResult<()> {
    super::security::require_password(&new_password)?;
    super::run_blocking(move || session::change_library_password(&id, &old_password, &new_password)).await
}

#[tauri::command]
pub async fn remove_library_password(id: String, password: String) -> AppResult<()> {
    super::run_blocking(move || session::remove_library_password(&id, &password)).await
}

#[tauri::command]
pub async fn reset_library_recovery(id: String, password: String) -> AppResult<String> {
    super::run_blocking(move || session::reset_library_recovery(&id, &password)).await
}

/// Writes a new key file into `dir`; returns its full path.
#[tauri::command]
pub async fn set_library_keyfile(id: String, dir: String) -> AppResult<String> {
    super::run_blocking(move || session::set_library_keyfile(&id, &PathBuf::from(dir))).await
}

#[tauri::command]
pub fn remove_library_keyfile(id: String) -> AppResult<()> {
    session::remove_library_keyfile(&id)
}

#[tauri::command]
pub async fn delete_library(id: String, confirm_name: String) -> AppResult<()> {
    let name = session::list_libraries()?
        .into_iter()
        .find(|l| l.id == id)
        .map(|l| l.name)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    if name.trim() != confirm_name.trim() {
        return Err(AppError::InvalidArg("输入的库名不一致".into()));
    }
    super::run_blocking(move || session::delete_library(&id)).await
}

/// Returns the conversation's id in the target library.
#[tauri::command]
pub async fn move_conversation(from: String, conv_id: i64, to: String) -> AppResult<i64> {
    let res = super::run_blocking(move || {
        let id = transfer::move_conversation(&from, conv_id, &to)?;
        crate::services::thumbs::wake(&to);
        Ok(id)
    })
    .await;
    if res.is_ok() {
        crate::events::emit_libraries_changed();
    }
    res
}
