use crate::{db, services, AppResult};
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumePayload {
    pub id: i64,
    pub platform_id: String,
    pub label: String,
    pub last_mount: Option<String>,
    pub current_mount: Option<String>,
    pub online: bool,
    pub media_count: i64,
    pub broken_count: i64,
}

#[tauri::command]
pub fn list_volumes() -> AppResult<Vec<VolumePayload>> {
    let mounted = services::volume_resolver::enumerate_mounted();
    let mounted_map: HashMap<String, String> = mounted
        .into_iter()
        .map(|v| (v.platform_id, v.mount_point.to_string_lossy().to_string()))
        .collect();

    db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT v.id, v.platform_id, v.label, v.last_mount,
                    (SELECT COUNT(*) FROM media WHERE volume_id = v.id) AS total,
                    (SELECT COUNT(*) FROM media WHERE volume_id = v.id AND state = 'broken') AS broken
             FROM volumes v
             ORDER BY v.id",
        )?;
        let rows = stmt
            .query_map([], |row| {
                let pid: String = row.get(1)?;
                let current = mounted_map.get(&pid).cloned();
                let online = current.is_some();
                Ok(VolumePayload {
                    id: row.get(0)?,
                    platform_id: pid,
                    label: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    last_mount: row.get(3)?,
                    current_mount: current,
                    online,
                    media_count: row.get(4)?,
                    broken_count: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn rescan_volumes() -> AppResult<()> {
    services::volume_monitor::boot_scan().map_err(crate::AppError::InvalidArg)?;
    Ok(())
}

#[tauri::command]
pub fn forget_volume(id: i64) -> AppResult<()> {
    db::with_conn(|conn| {
        conn.execute("DELETE FROM volumes WHERE id = ?1", params![id])?;
        Ok(())
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeStat {
    pub volume_id: i64,
    pub label: String,
    pub media_count: i64,
    pub size_bytes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub data_dir: String,
    pub total_media: i64,
    pub total_bytes: i64,
    pub by_volume: Vec<VolumeStat>,
}

#[tauri::command]
pub fn get_storage_stats() -> AppResult<StorageStats> {
    let data_dir = services::vault::data_dir()
        .to_string_lossy()
        .into_owned();

    db::with_conn(|conn| {
        let (total_media, total_bytes) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(size_bytes), 0) FROM media",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;

        let mut stmt = conn.prepare(
            "SELECT v.id, v.label,
                    (SELECT COUNT(*) FROM media WHERE volume_id = v.id) AS cnt,
                    (SELECT COALESCE(SUM(size_bytes), 0) FROM media WHERE volume_id = v.id) AS sz
             FROM volumes v
             ORDER BY v.id",
        )?;
        let by_volume = stmt
            .query_map([], |row| {
                Ok(VolumeStat {
                    volume_id: row.get(0)?,
                    label: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    media_count: row.get(2)?,
                    size_bytes: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(StorageStats {
            data_dir,
            total_media,
            total_bytes,
            by_volume,
        })
    })
}
