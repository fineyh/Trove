use crate::services::crypto;
use crate::services::vault;
use crate::{db, services, AppError, AppResult};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Read the encryption flag for a conversation. Returns `None` for
/// non-encrypted convs (so callers can skip the cipher path entirely).
fn conv_encryption(conn: &rusqlite::Connection, conv_id: i64) -> AppResult<Option<i64>> {
    let v: Option<i64> = conn
        .query_row(
            "SELECT encrypted FROM conversations WHERE id = ?1",
            params![conv_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v.filter(|f| *f != 0).map(|_| conv_id))
}

/// Resolve caption display value for a fetched row. For locked encrypted
/// conversations we return a sentinel so the UI can render "🔒 unlock".
fn render_caption(
    conv_id: i64,
    encrypted: bool,
    caption: Option<String>,
    iv: Option<Vec<u8>>,
) -> Option<String> {
    if !encrypted {
        return caption;
    }
    let key = match vault::get_conv_key(conv_id) {
        Some(k) => k,
        None => return None, // locked — caller's `encrypted` flag tells UI why
    };
    let (Some(c), Some(n)) = (caption, iv) else {
        return None;
    };
    let raw = match B64.decode(&c) {
        Ok(v) => v,
        Err(_) => return None,
    };
    crypto::decrypt_caption(&key, &n, &raw).ok()
}

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
    let row = conn
        .query_row(
            "SELECT
                m.id, m.conv_id, m.caption, m.caption_iv, m.play_count, m.created_at,
                md.id, md.kind, md.width, md.height, md.duration_ms,
                md.size_bytes, md.state, v.last_mount, md.relpath,
                c.encrypted
             FROM messages m
             JOIN conversations c ON c.id = m.conv_id
             LEFT JOIN media md ON md.id = m.media_id
             LEFT JOIN volumes v ON v.id = md.volume_id
             WHERE m.id = ?1",
            params![msg_id],
            |row| {
                let id: i64 = row.get(0)?;
                let conv_id: i64 = row.get(1)?;
                let caption: Option<String> = row.get(2)?;
                let iv: Option<Vec<u8>> = row.get(3)?;
                let play_count: i64 = row.get(4)?;
                let created_at: i64 = row.get(5)?;
                let media_id: Option<i64> = row.get(6)?;
                let media = if let Some(mid) = media_id {
                    let mount: Option<String> = row.get(13)?;
                    let rel: Option<String> = row.get(14)?;
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
                        id: mid,
                        kind: row.get(7)?,
                        width: row.get(8)?,
                        height: row.get(9)?,
                        duration_ms: row.get(10)?,
                        size_bytes: row.get(11)?,
                        state: row.get(12)?,
                        absolute_path: abs,
                    })
                } else {
                    None
                };
                let encrypted: bool = row.get::<_, i64>(15)? != 0;
                Ok((id, conv_id, caption, iv, play_count, created_at, media, encrypted))
            },
        )
        .map_err(AppError::from)?;

    let (id, conv_id, raw_caption, iv, play_count, created_at, media, encrypted) = row;
    let display_caption = render_caption(conv_id, encrypted, raw_caption, iv);
    Ok(MessagePayload {
        id,
        conv_id,
        caption: display_caption,
        play_count,
        created_at,
        media,
    })
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
    let encrypted = db::with_conn(|conn| conv_encryption(conn, args.conv_id))?;
    let (caption_db, iv_db): (String, Option<Vec<u8>>) = if encrypted.is_some() {
        let key = vault::get_conv_key(args.conv_id)
            .ok_or_else(|| AppError::InvalidArg("conversation is locked".into()))?;
        let (nonce, ct) = crypto::encrypt_caption(&key, &text).map_err(AppError::from)?;
        let b64 = B64.encode(&ct);
        (b64, Some(nonce))
    } else {
        (text, None)
    };

    let now = chrono::Utc::now().timestamp_millis();
    let msg_id: i64 = db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO messages (conv_id, media_id, caption, caption_iv, play_count, created_at)
             VALUES (?1, NULL, ?2, ?3, 0, ?4)",
            params![args.conv_id, caption_db, iv_db, now],
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

/// Resolve the on-disk absolute path for a media row, if its volume's last
/// known mount is recorded. Used before deleting the row so we can move the
/// original file to the OS recycle bin when the caller opts in.
fn media_abs_path(conn: &rusqlite::Connection, media_id: i64) -> AppResult<Option<String>> {
    let row: Option<(Option<String>, String)> = conn
        .query_row(
            "SELECT v.last_mount, md.relpath
             FROM media md JOIN volumes v ON v.id = md.volume_id
             WHERE md.id = ?1",
            params![media_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(match row {
        Some((Some(mount), rel)) => Some(
            services::volume_resolver::absolute_for(std::path::Path::new(&mount), &rel)
                .to_string_lossy()
                .to_string(),
        ),
        _ => None,
    })
}

#[tauri::command]
pub fn delete_message(message_id: i64, delete_file: bool) -> AppResult<()> {
    db::with_conn(|conn| {
        let media_id: Option<i64> = conn
            .query_row(
                "SELECT media_id FROM messages WHERE id = ?1",
                params![message_id],
                |r| r.get(0),
            )
            .optional()?;
        conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
        if let Some(mid) = media_id {
            let still_referenced: i64 = conn.query_row(
                "SELECT COUNT(*) FROM messages WHERE media_id = ?1",
                params![mid],
                |r| r.get(0),
            )?;
            if still_referenced == 0 {
                // The media is now orphaned. If the caller asked to remove the
                // original too, move it to the recycle bin before dropping the
                // row. Best-effort: a missing/unreachable file (e.g. broken
                // volume not mounted) just leaves the DB cleanup to proceed.
                if delete_file {
                    if let Some(abs) = media_abs_path(conn, mid)? {
                        let path = std::path::Path::new(&abs);
                        if path.exists() {
                            if let Err(e) = trash::delete(path) {
                                eprintln!("trash::delete failed for {abs}: {e}");
                            }
                        }
                    }
                }
                // CASCADE clears the matching broken_pointers row automatically.
                conn.execute("DELETE FROM media WHERE id = ?1", params![mid])?;
            }
        }
        Ok(())
    })
}
