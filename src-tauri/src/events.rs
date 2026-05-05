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
    pub conv_id: i64,
    pub added: usize,
    pub broken: usize,
}

pub fn emit_conv_changed(payload: ConvChanged) {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("conv:changed", payload);
    }
}

pub fn emit_volumes_changed() {
    if let Some(h) = APP_HANDLE.get() {
        let _ = h.emit("volumes:changed", ());
    }
}
