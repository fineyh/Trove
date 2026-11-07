//! Backend → frontend event emitter.
//!
//! The watcher and other background services need to push updates without
//! holding a `tauri::AppHandle` directly. We stash the handle once during
//! `setup` and provide typed helpers.

use once_cell::sync::OnceCell;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

pub fn init(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvChanged {
    pub lib: String,
    pub conv_id: i64,
    pub added: usize,
    pub broken: usize,
    #[serde(default)]
    pub renamed: usize,
}

pub fn emit_conv_changed(payload: ConvChanged) {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("conv:changed", payload);
    }
}

pub fn emit_volumes_changed(lib: &str) {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("volumes:changed", lib);
    }
}

/// The set of libraries, their names, or which of them are open changed.
pub fn emit_libraries_changed() {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("libraries:changed", ());
    }
}

/// The app was locked (or its password settings changed).
pub fn emit_security_changed() {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("security:changed", ());
    }
}

/// New thumbnail work may exist in `lib`; the frontend worker resumes.
pub fn emit_thumbs_wake(lib: &str) {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("thumbs:wake", lib);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoBackfillDone {
    pub lib: String,
    pub updated: usize,
}

pub fn emit_geo_backfill_done(lib: &str, updated: usize) {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("geo:backfill-done", GeoBackfillDone { lib: lib.to_string(), updated });
    }
}

/// Progress of a running import / folder scan. Emitted from the blocking
/// thread that does the work, throttled by the caller (one event per N files),
/// with `finished` marking the last one so the UI can clear its progress bar
/// even when the job was cut short.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub lib: String,
    pub conv_id: i64,
    pub done: usize,
    /// 0 while still enumerating the folder (UI shows an indeterminate bar).
    pub total: usize,
    /// Name of the file being hashed — the slow part, worth showing.
    pub current: Option<String>,
    pub finished: bool,
    pub cancelled: bool,
    /// Files that errored out. One bad file never stops the batch, so without
    /// this the UI has no way to say "97 imported, 3 failed" and the failures
    /// stay invisible to the user.
    pub failed: usize,
}

pub fn emit_import_progress(payload: ImportProgress) {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("import:progress", payload);
    }
}
