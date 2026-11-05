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

/// The two things that must happen once the DB becomes readable: reconcile
/// every media row against the volumes actually mounted right now, and resume
/// a watcher for each `folder_watch` conversation.
///
/// Both used to run *inline* — inside `vault_unlock` and inside `setup()` —
/// which is what made unlocking feel slow. Neither has anything to do with
/// whether the password was right, but together they can take seconds (probing
/// every drive letter, then one `stat` per media row) while holding the thread
/// that paints the window. Detached, the library appears the moment the key is
/// accepted and the scan's verdict arrives later as a `volumes:changed` event.
///
/// Single-flight: a lock/unlock cycle must not leave two scans writing the
/// same rows. The guard is RAII so a panic in either task can't wedge the slot.
pub(crate) fn spawn_boot_tasks() {
    use std::sync::atomic::{AtomicBool, Ordering};

    static RUNNING: AtomicBool = AtomicBool::new(false);

    struct Slot;
    impl Drop for Slot {
        fn drop(&mut self) {
            RUNNING.store(false, Ordering::SeqCst);
        }
    }

    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("trove-boot-tasks".into())
        .spawn(|| {
            let _slot = Slot;
            crate::services::volume_monitor::run_boot_scan();
            if let Err(e) = conversations::boot_existing_watchers() {
                eprintln!("boot_existing_watchers: {e}");
            }
        });
    if let Err(e) = spawned {
        eprintln!("spawn boot tasks: {e}");
        RUNNING.store(false, Ordering::SeqCst);
    }
}
