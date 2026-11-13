use crate::{db, AppError, AppResult};
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

/// Open the folder holding Trove's log files (6.1).
#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> AppResult<()> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| AppError::Other(anyhow::anyhow!("resolve log dir: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    open_path(dir.to_string_lossy().to_string())
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

fn media_path(lib: &str, media_id: i64) -> AppResult<PathBuf> {
    let p = db::with_lib(lib, |c| super::messages::media_abs_path(c, media_id))?
        .ok_or_else(|| AppError::NotFound(format!("media #{media_id}")))?;
    if !p.exists() {
        return Err(AppError::NotFound("文件不在原位置（所在的盘没连接，或文件已被移走）".into()));
    }
    Ok(p)
}

/// Open a media file with the system's default application. By id, so the
/// path never has to travel through the WebView.
#[tauri::command]
pub fn open_media(lib: String, media_id: i64) -> AppResult<()> {
    let p = media_path(&lib, media_id)?;
    open_path(p.to_string_lossy().to_string())
}

/// Show a media file selected in the system file manager.
#[tauri::command]
pub fn reveal_media(lib: String, media_id: i64) -> AppResult<()> {
    let p = media_path(&lib, media_id)?;
    #[cfg(target_os = "windows")]
    let res = Command::new("explorer").arg(format!("/select,{}", p.display())).spawn();
    #[cfg(target_os = "macos")]
    let res = Command::new("open").arg("-R").arg(&p).spawn();
    #[cfg(target_os = "linux")]
    let res = Command::new("xdg-open").arg(p.parent().unwrap_or(&p)).spawn();
    res.map_err(|e| AppError::InvalidArg(format!("spawn file manager failed: {e}")))?;
    Ok(())
}

/// Copy a media file's full path to the clipboard is done in the UI; this
/// just hands the path over on explicit request.
#[tauri::command]
pub fn media_path_for_copy(lib: String, media_id: i64) -> AppResult<String> {
    let p = db::with_lib(&lib, |c| super::messages::media_abs_path(c, media_id))?
        .ok_or_else(|| AppError::NotFound(format!("media #{media_id}")))?;
    Ok(p.to_string_lossy().to_string())
}
