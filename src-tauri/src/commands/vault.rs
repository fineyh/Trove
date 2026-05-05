//! Master-password / vault lifecycle commands.

use crate::services::{crypto::SecretKey, vault};
use crate::{db, AppError, AppResult};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub has_master_password: bool,
    pub unlocked: bool,
}

#[tauri::command]
pub fn vault_status() -> AppResult<VaultStatus> {
    Ok(VaultStatus {
        has_master_password: vault::has_master_password(),
        unlocked: vault::is_unlocked(),
    })
}

fn require_password(password: &str) -> AppResult<()> {
    if password.is_empty() {
        return Err(AppError::InvalidArg("password is empty".into()));
    }
    if password.chars().count() < 6 {
        return Err(AppError::InvalidArg(
            "password must be at least 6 characters".into(),
        ));
    }
    Ok(())
}

/// First-time setup: derive a KEK, write `vault.json`, then encrypt the DB.
#[tauri::command]
pub fn vault_set_master_password(password: String) -> AppResult<()> {
    if vault::has_master_password() {
        return Err(AppError::InvalidArg("master password already set".into()));
    }
    if !vault::is_unlocked() {
        return Err(AppError::InvalidArg("db is locked".into()));
    }
    require_password(&password)?;

    let kek: SecretKey = vault::create_master(&password)
        .map_err(AppError::from)?;
    if let Err(e) = db::encrypt_inplace(&kek) {
        // Roll back the on-disk vault metadata if the DB rekey failed,
        // otherwise the user would be locked out of a still-plaintext DB.
        let _ = vault::drop_master();
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn vault_unlock(password: String) -> AppResult<()> {
    if !vault::has_master_password() {
        return Err(AppError::InvalidArg("no master password set".into()));
    }
    if vault::is_unlocked() {
        return Ok(());
    }
    let kek = vault::derive_and_verify(&password).map_err(|e| {
        AppError::InvalidArg(format!("{}", e))
    })?;
    db::open_with_key(&kek)?;
    vault::store_unlocked(kek);
    crate::services::volume_monitor::run_boot_scan();
    crate::commands::conversations::boot_existing_watchers()?;
    Ok(())
}

#[tauri::command]
pub fn vault_lock() -> AppResult<()> {
    crate::services::file_watcher::stop_all();
    db::close();
    vault::forget_keys();
    Ok(())
}

#[tauri::command]
pub fn vault_change_password(old_password: String, new_password: String) -> AppResult<()> {
    if !vault::has_master_password() {
        return Err(AppError::InvalidArg("no master password set".into()));
    }
    if !vault::is_unlocked() {
        return Err(AppError::InvalidArg("vault is locked".into()));
    }
    require_password(&new_password)?;
    // verify the old password against the on-disk verifier
    let _ = vault::derive_and_verify(&old_password)
        .map_err(|e| AppError::InvalidArg(format!("{}", e)))?;
    let new_kek = vault::rotate_master(&new_password).map_err(AppError::from)?;
    db::rekey(&new_kek)?;
    Ok(())
}

#[tauri::command]
pub fn vault_remove_master_password(password: String) -> AppResult<()> {
    if !vault::has_master_password() {
        return Ok(());
    }
    if !vault::is_unlocked() {
        return Err(AppError::InvalidArg("vault is locked".into()));
    }
    let kek = vault::derive_and_verify(&password)
        .map_err(|e| AppError::InvalidArg(format!("{}", e)))?;
    db::decrypt_inplace(&kek)?;
    vault::drop_master().map_err(AppError::from)?;
    Ok(())
}
