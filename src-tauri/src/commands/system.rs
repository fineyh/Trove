use crate::{AppError, AppResult};
use std::path::PathBuf;
use std::process::Command;

/// Open a directory or file in the OS file manager / default handler.
///
/// We don't use `plugin-shell`'s `open()` because its default scope rejects
/// arbitrary local paths and configuring per-path scopes is more brittle
/// than just shelling out here.
#[tauri::command]
pub fn open_path(path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::NotFound(format!("path not found: {path}")));
    }

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("explorer");
        c.arg(&p);
        c
    };

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&p);
        c
    };

    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&p);
        c
    };

    cmd.spawn()
        .map_err(|e| AppError::InvalidArg(format!("spawn file manager failed: {e}")))?;
    Ok(())
}
