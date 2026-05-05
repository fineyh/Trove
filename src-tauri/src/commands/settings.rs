use crate::{db, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;

const ALLOWED_KEYS: &[&str] = &["missing_file_strategy", "app_locked"];

#[tauri::command]
pub fn get_all_settings() -> AppResult<HashMap<String, String>> {
    db::with_conn(|conn| {
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
    if key == "missing_file_strategy" && value != "hide" && value != "placeholder" {
        return Err(AppError::InvalidArg(format!(
            "missing_file_strategy must be hide|placeholder, got {value}"
        )));
    }
    db::with_conn(|conn| {
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
    db::with_conn(|conn| {
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
