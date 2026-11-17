//! Map feature: query geotagged media.
//!
//! Geotags are written at import time by `ingest_one`, and for older rows by
//! [`crate::services::meta_backfill`], which emits `geo:backfill-done`.

use crate::{db, AppResult};
use serde::Serialize;

/// One geotagged item shown on the map. Mirrors `MediaPayload`'s camelCase
/// convention. `available` is false when the source volume's mount is unknown
/// (the coordinate is still valid, but the file can't be previewed right now).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeotaggedMedia {
    pub media_id: i64,
    pub lat: f64,
    pub lon: f64,
    pub kind: String,
    pub ext: String,
    /// "ok" | "offline" | "missing" — same meaning as on messages.
    pub status: String,
    pub has_thumb: bool,
    pub conv_id: i64,
    pub message_id: i64,
    pub created_at: i64,
    pub taken_at: Option<i64>,
    pub taken_offset: Option<i32>,
}

/// The map shows one library at a time: a locked library isn't open, so its
/// locations can't surface here at all.
#[tauri::command]
pub fn list_geotagged_media(lib: String) -> AppResult<Vec<GeotaggedMedia>> {
    let hide = super::conversations::hide_offline(&lib)?;
    db::with_lib(&lib, |conn| {
        // A media row can be referenced by several conversations. Order by
        // media id so rows for the same media are contiguous; in Rust we pick
        // the first reference whose conversation is currently accessible.
        let mut stmt = conn.prepare(
            "SELECT md.id, md.lat, md.lon, md.kind, md.state, v.online, md.relpath,
                    m.id AS msg_id, m.conv_id, m.created_at,
                    EXISTS (SELECT 1 FROM thumbs t WHERE t.media_id = md.id),
                    md.taken_at, md.taken_offset
             FROM media md
             JOIN volumes v ON v.id = md.volume_id
             JOIN messages m ON m.media_id = md.id
             JOIN conversations c ON c.id = m.conv_id
             WHERE md.lat IS NOT NULL AND md.lon IS NOT NULL
               AND c.archived = 0
             ORDER BY md.id ASC, m.id ASC",
        )?;

        struct Row {
            media_id: i64,
            lat: f64,
            lon: f64,
            kind: String,
            state: String,
            online: bool,
            relpath: String,
            msg_id: i64,
            conv_id: i64,
            created_at: i64,
            has_thumb: bool,
            taken_at: Option<i64>,
            taken_offset: Option<i32>,
        }

        let rows = stmt.query_map([], |r| {
            Ok(Row {
                media_id: r.get(0)?,
                lat: r.get(1)?,
                lon: r.get(2)?,
                kind: r.get(3)?,
                state: r.get(4)?,
                online: r.get::<_, i64>(5)? != 0,
                relpath: r.get(6)?,
                msg_id: r.get(7)?,
                conv_id: r.get(8)?,
                created_at: r.get(9)?,
                has_thumb: r.get::<_, i64>(10)? != 0,
                taken_at: r.get(11)?,
                taken_offset: r.get(12)?,
            })
        })?;

        let mut out: Vec<GeotaggedMedia> = Vec::new();
        let mut current: Option<i64> = None;
        let mut chosen = false;

        for row in rows {
            let row = row?;
            if current != Some(row.media_id) {
                current = Some(row.media_id);
                chosen = false;
            }
            if chosen || (hide && !row.online) {
                continue;
            }
            chosen = true;
            out.push(GeotaggedMedia {
                media_id: row.media_id,
                lat: row.lat,
                lon: row.lon,
                kind: row.kind,
                ext: super::messages::ext_of(&row.relpath),
                status: super::messages::media_status(&row.state, row.online).to_string(),
                has_thumb: row.has_thumb,
                conv_id: row.conv_id,
                message_id: row.msg_id,
                created_at: row.created_at,
                taken_at: row.taken_at,
                taken_offset: row.taken_offset,
            });
        }
        Ok(out)
    })
}
