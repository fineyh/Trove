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

/// Open a web/mail URL in the OS default browser. Used by the frontend's
/// external-link interceptor so clicking a link (e.g. the map's OpenStreetMap
/// attribution) opens the browser instead of navigating the app's WebView
/// away with no way back. Restricted to http(s)/mailto so we never hand an
/// arbitrary string to the OS opener.
#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    let allowed = url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("mailto:");
    if !allowed {
        return Err(AppError::InvalidArg(format!("unsupported url scheme: {url}")));
    }

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("explorer");
        c.arg(&url);
        c
    };

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    };

    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };

    cmd.spawn()
        .map_err(|e| AppError::InvalidArg(format!("open url failed: {e}")))?;
    Ok(())
}
