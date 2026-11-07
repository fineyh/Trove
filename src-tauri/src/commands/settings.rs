use crate::{db, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;

/// App-wide settings, stored in the main library.
const ALLOWED_KEYS: &[&str] = &[
    "offline_content",
    "repair_default_scope",
    "idle_lock_minutes",
    "map_tiles",
];

#[tauri::command]
pub fn get_all_settings() -> AppResult<HashMap<String, String>> {
    db::with_main(|conn| {
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn set_setting(key: String, value: String) -> AppResult<()> {
    if !ALLOWED_KEYS.contains(&key.as_str()) {
        return Err(AppError::InvalidArg(format!("unknown setting key: {key}")));
    }
    let ok = match key.as_str() {
        "offline_content" => matches!(value.as_str(), "show" | "hide"),
        "idle_lock_minutes" => matches!(value.as_str(), "0" | "5" | "15" | "30" | "60"),
        "map_tiles" => matches!(value.as_str(), "online" | "off"),
        _ => true,
    };
    if !ok {
        return Err(AppError::InvalidArg(format!("bad value for {key}: {value}")));
    }
    if key == "repair_default_scope"
        && value != "last_folder_only"
        && value != "last_folder_recursive"
        && value != "all_volumes"
    {
        return Err(AppError::InvalidArg(format!(
            "repair_default_scope must be last_folder_only|last_folder_recursive|all_volumes, got {value}"
        )));
    }
    db::with_main(|conn| {
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_setting(key: String) -> AppResult<Option<String>> {
    db::with_main(|conn| {
        let v: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v)
    })
}

// ─── UI preferences ─────────────────────────────────────────────────────────
//
// App-level preferences that don't belong to any library: theme and update
// settings. Kept outside the libraries in a plain `ui.json` so the lock /
// unlock screens can use them before anything is decrypted. Nothing here is
// private.

const UI_FILE: &str = "ui.json";

fn ui_path() -> std::path::PathBuf {
    crate::services::session::data_dir().join(UI_FILE)
}

fn read_ui() -> serde_json::Map<String, serde_json::Value> {
    std::fs::read(ui_path())
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

/// One value from `ui.json`, for the backend's own use.
pub(crate) fn ui_pref(key: &str) -> Option<String> {
    read_ui().get(key).and_then(|v| v.as_str()).map(str::to_string)
}

#[tauri::command]
pub fn get_ui_prefs() -> HashMap<String, String> {
    read_ui()
        .into_iter()
        .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
        .collect()
}

#[tauri::command]
pub fn set_ui_pref(key: String, value: String) -> AppResult<()> {
    let ok = match key.as_str() {
        "theme" => matches!(value.as_str(), "system" | "light" | "dark"),
        "update_channel" => matches!(value.as_str(), "stable" | "beta"),
        "update_auto" => matches!(value.as_str(), "on" | "off"),
        _ => false,
    };
    if !ok {
        return Err(AppError::InvalidArg(format!("bad ui pref {key}={value}")));
    }
    write_ui_pref(&key, &value)
}

/// Write without validation; callers inside the backend only.
pub(crate) fn write_ui_pref(key: &str, value: &str) -> AppResult<()> {
    let mut map = read_ui();
    map.insert(key.to_string(), serde_json::Value::String(value.to_string()));
    let bytes = serde_json::to_vec_pretty(&serde_json::Value::Object(map))
        .map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let path = ui_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
