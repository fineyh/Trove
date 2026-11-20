//! The info panel's facts that don't travel with every message row
//! (ADR-062): the position itself and what the camera recorded.

use crate::{db, services::exif::Camera, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaDetails {
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// Images only, and only while the file is reachable: read from the file
    /// each time the panel asks, not stored.
    pub camera: Option<Camera>,
}

#[tauri::command]
pub async fn media_details(lib: String, media_id: i64) -> AppResult<MediaDetails> {
    super::run_blocking(move || {
        let row = db::with_lib(&lib, |conn| {
            let row: Option<(Option<f64>, Option<f64>, String)> = conn
                .query_row(
                    "SELECT lat, lon, kind FROM media WHERE id = ?1",
                    params![media_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let path = match &row {
                Some((_, _, kind)) if kind == "image" => super::messages::media_abs_path(conn, media_id)?,
                _ => None,
            };
            Ok(row.map(|r| (r, path)))
        })?;
        let Some(((lat, lon, _), path)) = row else {
            return Err(crate::AppError::NotFound(format!("media #{media_id}")));
        };
        // Outside the library lock: a slow disk mustn't hold up everything else.
        let camera = path.filter(|p| p.exists()).and_then(|p| crate::services::exif::read_camera(&p));
        Ok(MediaDetails { lat, lon, camera })
    })
    .await
}
