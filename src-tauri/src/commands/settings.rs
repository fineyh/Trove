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
