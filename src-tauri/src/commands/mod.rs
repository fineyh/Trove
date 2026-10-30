pub mod auth;
pub mod backup;
pub mod conversations;
pub mod folders;
pub mod geo;
pub mod health;
pub mod media;
pub mod messages;
pub mod repair;
pub mod search;
pub mod settings;
pub mod system;
pub mod updater;
pub mod vault;
pub mod volumes;

use crate::{AppError, AppResult};

/// Run a heavy command body off the UI thread.
///
/// A sync `#[tauri::command]` executes on the WebView callback thread, so file
/// hashing or a directory walk inside one freezes the window for its whole
/// duration. Wrapping the body here keeps the command's signature and return
/// value exactly as they were while the work happens on Tauri's blocking pool.
pub(crate) async fn run_blocking<T, F>(f: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!("background task failed: {e}")))?
}
