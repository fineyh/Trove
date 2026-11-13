pub mod auth;
pub mod backup;
pub mod conversations;
pub mod folders;
pub mod geo;
pub mod health;
pub mod libraries;
pub mod media;
pub mod messages;
pub mod repair;
pub mod search;
pub mod security;
pub mod settings;
pub mod system;
pub mod thumbs;
pub mod updater;
pub mod volumes;

use crate::{AppError, AppResult};

/// Run a heavy command body off the UI thread.
///
/// A sync `#[tauri::command]` executes on the WebView callback thread, so file
/// hashing, a directory walk or Argon2 inside one freezes the window for its
/// whole duration. Wrapping the body here keeps the command's signature and
/// return value while the work happens on Tauri's blocking pool.
pub(crate) async fn run_blocking<T, F>(f: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!("background task failed: {e}")))?
}

/// What happens once a library becomes readable: reconcile its media against
/// the volumes mounted right now, resume its folder watchers, and nudge the
/// thumbnail worker. Detached, because the scan stats every file and must not
/// delay the moment the library appears (ADR-034). Single-flight per library.
pub(crate) fn spawn_library_tasks(lib: String) {
    use once_cell::sync::Lazy;
    use parking_lot::Mutex;
    use std::collections::HashSet;

    static RUNNING: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

    struct Slot(String);
    impl Drop for Slot {
        fn drop(&mut self) {
            RUNNING.lock().remove(&self.0);
        }
    }

    if !RUNNING.lock().insert(lib.clone()) {
        return;
    }
    let name = format!("trove-lib-tasks-{lib}");
    let spawned = std::thread::Builder::new().name(name).spawn(move || {
        let _slot = Slot(lib.clone());
        crate::services::volume_monitor::scan_library(&lib);
        if let Err(e) = conversations::boot_existing_watchers(&lib) {
            log::error!("boot watchers [{lib}]: {e}");
        }
        crate::services::thumbs::wake(&lib);
    });
    if let Err(e) = spawned {
        log::error!("spawn library tasks: {e}");
    }
}

pub(crate) fn spawn_all_library_tasks() {
    for lib in crate::db::open_ids() {
        spawn_library_tasks(lib);
    }
}
