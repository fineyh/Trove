use crate::{db, services, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPayload {
    pub id: i64,
    pub kind: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub absolute_path: String,
    pub state: String,
    pub size_bytes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePayload {
    pub id: i64,
    pub conv_id: i64,
    pub caption: Option<String>,
    pub play_count: i64,
    pub created_at: i64,
    pub media: Option<MediaPayload>,
}

fn load_message_row(conn: &rusqlite::Connection, msg_id: i64) -> AppResult<MessagePayload> {
    conn.query_row(
        "SELECT
            m.id, m.conv_id, m.caption, m.play_count, m.created_at,
            md.id, md.kind, md.width, md.height, md.duration_ms,
            md.size_bytes, md.state, v.last_mount, md.relpath
         FROM messages m
         LEFT JOIN media md ON md.id = m.media_id
         LEFT JOIN volumes v ON v.id = md.volume_id
         WHERE m.id = ?1",
        params![msg_id],
        |row| {
            let media_id: Option<i64> = row.get(5)?;
            let media = if let Some(id) = media_id {
                let mount: Option<String> = row.get(12)?;
                let rel: Option<String> = row.get(13)?;
                let abs = match (mount, rel) {
                    (Some(m), Some(r)) => services::volume_resolver::absolute_for(
                        std::path::Path::new(&m),
                        &r,
                    )
                    .to_string_lossy()
                    .to_string(),
                    _ => String::new(),
                };
                Some(MediaPayload {
                    id,
                    kind: row.get(6)?,
                    width: row.get(7)?,
                    height: row.get(8)?,
                    duration_ms: row.get(9)?,
                    size_bytes: row.get(10)?,
                    state: row.get(11)?,
                    absolute_path: abs,
                })
            } else {
                None
            };
            Ok(MessagePayload {
                id: row.get(0)?,
                conv_id: row.get(1)?,
                caption: row.get(2)?,
                play_count: row.get(3)?,
                created_at: row.get(4)?,
                media,
            })
        },
    )
    .map_err(AppError::from)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMessagesArgs {
    pub conv_id: i64,
    #[serde(default)]
    pub before_id: Option<i64>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    100
}

#[tauri::command]
pub fn list_messages(args: ListMessagesArgs) -> AppResult<Vec<MessagePayload>> {
    let strategy: String = db::with_conn(|conn| {
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'missing_file_strategy'",
            [],
            |r| r.get(0),
        )
        .map_err(AppError::from)
    })?;
    let hide_broken = strategy == "hide";

    db::with_conn(|conn| {
        let mut sql = String::from(
            "SELECT m.id FROM messages m
             LEFT JOIN media md ON md.id = m.media_id
             WHERE m.conv_id = ?1",
        );
        if hide_broken {
            sql.push_str(" AND (m.media_id IS NULL OR md.state = 'live')");
        }
        if args.before_id.is_some() {
            sql.push_str(" AND m.id < ?2");
        }
        sql.push_str(" ORDER BY m.created_at ASC, m.id ASC LIMIT ?");
        sql.push_str(if args.before_id.is_some() { "3" } else { "2" });

        let mut stmt = conn.prepare(&sql)?;
        let ids: Vec<i64> = match args.before_id {
            Some(b) => stmt
                .query_map(params![args.conv_id, b, args.limit], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?,
            None => stmt
                .query_map(params![args.conv_id, args.limit], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?,
        };
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            out.push(load_message_row(conn, id)?);
        }
        Ok(out)
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTextArgs {
    pub conv_id: i64,
    pub text: String,
}

#[tauri::command]
pub fn send_text(args: SendTextArgs) -> AppResult<MessagePayload> {
    let text = args.text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::InvalidArg("text is empty".into()));
    }
    let now = chrono::Utc::now().timestamp_millis();
    let msg_id: i64 = db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO messages (conv_id, media_id, caption, play_count, created_at)
             VALUES (?1, NULL, ?2, 0, ?3)",
            params![args.conv_id, text, now],
        )?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, args.conv_id],
        )?;
        Ok::<i64, AppError>(id)
    })?;
    db::with_conn(|conn| load_message_row(conn, msg_id))
}

#[tauri::command]
pub fn increment_play_count(message_id: i64) -> AppResult<i64> {
    db::with_conn(|conn| {
        conn.execute(
            "UPDATE messages SET play_count = play_count + 1 WHERE id = ?1",
            params![message_id],
        )?;
        let n: i64 = conn
            .query_row(
                "SELECT play_count FROM messages WHERE id = ?1",
                params![message_id],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0);
        Ok(n)
    })
}

#[tauri::command]
pub fn delete_message(message_id: i64) -> AppResult<()> {
    db::with_conn(|conn| {
        conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
        Ok(())
    })
}
