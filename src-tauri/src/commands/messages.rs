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
    pub size_bytes: i64,
    /// Lower-case extension, so the UI can pick a decoder (HEIC) without
    /// ever seeing the path. Paths stay in Rust: media reaches the WebView
    /// through `trove://` by id (ADR-037).
    pub ext: String,
    /// "ok" | "offline" (volume not mounted) | "missing" (volume mounted,
    /// file gone) — ADR-035.
    pub status: String,
    pub has_thumb: bool,
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

/// Columns every message query selects, in the order [`row_to_message`] reads.
const MESSAGE_COLUMNS: &str = "
    m.id, m.conv_id, m.caption, m.play_count, m.created_at,
    md.id, md.kind, md.width, md.height, md.duration_ms, md.size_bytes,
    md.relpath, md.state, COALESCE(v.online, 0),
    EXISTS (SELECT 1 FROM thumbs t WHERE t.media_id = md.id)";

const MESSAGE_FROM: &str = "
    FROM messages m
    LEFT JOIN media md ON md.id = m.media_id
    LEFT JOIN volumes v ON v.id = md.volume_id";

pub(crate) fn media_status(state: &str, online: bool) -> &'static str {
    if !online {
        "offline"
    } else if state == "broken" {
        "missing"
    } else {
        "ok"
    }
}

pub(crate) fn ext_of(relpath: &str) -> String {
    std::path::Path::new(relpath)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn row_to_message(row: &rusqlite::Row) -> rusqlite::Result<MessagePayload> {
    let media_id: Option<i64> = row.get(5)?;
    let media = match media_id {
        Some(id) => {
            let relpath: String = row.get(11)?;
            let state: String = row.get(12)?;
            let online = row.get::<_, i64>(13)? != 0;
            Some(MediaPayload {
                id,
                kind: row.get(6)?,
                width: row.get(7)?,
                height: row.get(8)?,
                duration_ms: row.get(9)?,
                size_bytes: row.get(10)?,
                ext: ext_of(&relpath),
                status: media_status(&state, online).to_string(),
                has_thumb: row.get::<_, i64>(14)? != 0,
            })
        }
        None => None,
    };
    Ok(MessagePayload {
        id: row.get(0)?,
        conv_id: row.get(1)?,
        caption: row.get(2)?,
        play_count: row.get(3)?,
        created_at: row.get(4)?,
        media,
    })
}

fn load_message_row(conn: &rusqlite::Connection, msg_id: i64) -> AppResult<MessagePayload> {
    let sql = format!("SELECT {MESSAGE_COLUMNS} {MESSAGE_FROM} WHERE m.id = ?1");
    Ok(conn.query_row(&sql, params![msg_id], row_to_message)?)
}

/// Cursor for paging *backwards* (toward older messages).
///
/// Composite on purpose: `created_at` is not monotonic with `id`, because
/// folder scans and the watcher store the file's mtime (see `ingest_one`), so
/// an older photo imported later gets a higher id. An id-only cursor would
/// skip or repeat rows around every such boundary.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCursor {
    pub created_at: i64,
    pub id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMessagesArgs {
    pub conv_id: i64,
    /// Omit for the first page, which is the *newest* `limit` messages. To
    /// load more, pass the oldest message the UI currently holds.
    #[serde(default)]
    pub before: Option<MessageCursor>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    60
}

/// The paging query, newest-first, returning whole rows in one statement
/// (it used to fetch ids, then run one 4-table JOIN per id — todo 4.1).
///
/// Params: `?1` conv_id, `?2`/`?3` the cursor (created_at, id), `?4` limit,
/// `?5` hide-offline flag. The cursor comparison is a row-value `<` written
/// out longhand — `?2`/`?3` are `i64::MAX` on the first page, which no real
/// row can match, so one statement serves every page.
///
/// `media_only` narrows the page to messages that carry media: the sequence
/// the fullscreen viewer and the profile drawer's grid page over.
fn page_sql(media_only: bool) -> String {
    let mut sql = format!(
        "SELECT {MESSAGE_COLUMNS} {MESSAGE_FROM}
         WHERE m.conv_id = ?1
           AND (m.created_at < ?2 OR (m.created_at = ?2 AND m.id < ?3))
           AND (?5 = 0 OR m.media_id IS NULL OR v.online = 1)"
    );
    if media_only {
        sql.push_str(" AND m.media_id IS NOT NULL");
    }
    sql.push_str(" ORDER BY m.created_at DESC, m.id DESC LIMIT ?4");
    sql
}

fn fetch_page(
    lib: &str,
    conv_id: i64,
    before: Option<&MessageCursor>,
    limit: i64,
    media_only: bool,
) -> AppResult<Vec<MessagePayload>> {
    let hide = super::conversations::hide_offline(lib)? as i64;
    let (cursor_ts, cursor_id) = before
        .map(|c| (c.created_at, c.id))
        .unwrap_or((i64::MAX, i64::MAX));
    db::with_lib(lib, |conn| {
        let mut stmt = conn.prepare(&page_sql(media_only))?;
        let mut rows: Vec<MessagePayload> = stmt
            .query_map(params![conv_id, cursor_ts, cursor_id, limit, hide], row_to_message)?
            .collect::<rusqlite::Result<_>>()?;
        rows.reverse();
        Ok(rows)
    })
}

/// One page of a conversation, oldest → newest, cut from the newest end.
#[tauri::command]
pub fn list_messages(lib: String, args: ListMessagesArgs) -> AppResult<Vec<MessagePayload>> {
    fetch_page(&lib, args.conv_id, args.before.as_ref(), args.limit, false)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConvMediaArgs {
    pub conv_id: i64,
    #[serde(default)]
    pub before: Option<MessageCursor>,
    #[serde(default = "default_media_limit")]
    pub limit: i64,
}

fn default_media_limit() -> i64 {
    80
}

/// One page of a conversation's media messages, oldest -> newest.
#[tauri::command]
pub fn list_conv_media(lib: String, args: ListConvMediaArgs) -> AppResult<Vec<MessagePayload>> {
    fetch_page(&lib, args.conv_id, args.before.as_ref(), args.limit, true)
}

/// Fetch specific messages (e.g. the ones an import just created).
#[tauri::command]
pub fn get_messages(lib: String, ids: Vec<i64>) -> AppResult<Vec<MessagePayload>> {
    db::with_lib(&lib, |conn| {
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Ok(m) = load_message_row(conn, id) {
                out.push(m);
            }
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
pub fn send_text(lib: String, args: SendTextArgs) -> AppResult<MessagePayload> {
    let text = args.text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::InvalidArg("text is empty".into()));
    }
    let now = chrono::Utc::now().timestamp_millis();
    db::with_lib(&lib, |conn| {
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
        load_message_row(conn, id)
    })
}

#[tauri::command]
pub fn increment_play_count(lib: String, message_id: i64) -> AppResult<i64> {
    db::with_lib(&lib, |conn| {
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

/// Resolve the on-disk absolute path of a media row from its volume's last
/// known mount. Stays in Rust; the WebView never sees it.
pub(crate) fn media_abs_path(
    conn: &rusqlite::Connection,
    media_id: i64,
) -> AppResult<Option<std::path::PathBuf>> {
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
        Some((Some(mount), rel)) => Some(services::volume_resolver::absolute_for(
            std::path::Path::new(&mount),
            &rel,
        )),
        _ => None,
    })
}

#[tauri::command]
pub fn delete_message(lib: String, message_id: i64, delete_file: bool) -> AppResult<()> {
    db::with_lib(&lib, |conn| {
        let media_id: Option<i64> = conn
            .query_row(
                "SELECT media_id FROM messages WHERE id = ?1",
                params![message_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
        if let Some(mid) = media_id {
            let still_referenced: i64 = conn.query_row(
                "SELECT COUNT(*) FROM messages WHERE media_id = ?1",
                params![mid],
                |r| r.get(0),
            )?;
            if still_referenced == 0 {
                // Orphaned now. If asked, move the original to the recycle bin
                // first; an unreachable file just leaves the DB cleanup to run.
                if delete_file {
                    if let Some(path) = media_abs_path(conn, mid)? {
                        if path.exists() {
                            if let Err(e) = trash::delete(&path) {
                                eprintln!("trash::delete failed for {}: {e}", path.display());
                            }
                        }
                    }
                }
                // CASCADE clears broken_pointers and thumbs.
                conn.execute("DELETE FROM media WHERE id = ?1", params![mid])?;
            }
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::{page_sql, row_to_message};
    use rusqlite::{params, Connection};

    /// `created_at` deliberately does NOT follow `id`: ids 4 and 5 carry the
    /// two oldest timestamps, the way a folder scan writes mtimes after a
    /// conversation already has hand-added messages. Ids 2 and 3 share a
    /// timestamp, which is what forces the cursor to be a pair.
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE volumes (id INTEGER PRIMARY KEY, online INTEGER NOT NULL);
             CREATE TABLE media (id INTEGER PRIMARY KEY, volume_id INTEGER, kind TEXT, width INTEGER,
                                 height INTEGER, duration_ms INTEGER, size_bytes INTEGER,
                                 relpath TEXT, state TEXT NOT NULL);
             CREATE TABLE thumbs (media_id INTEGER PRIMARY KEY);
             CREATE TABLE messages (
               id INTEGER PRIMARY KEY, conv_id INTEGER NOT NULL, media_id INTEGER,
               caption TEXT, play_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL
             );
             INSERT INTO volumes VALUES (1, 0), (2, 1);
             INSERT INTO media VALUES (1, 1, 'image', NULL, NULL, NULL, 1, 'a.HEIC', 'live');",
        )
        .unwrap();
        let rows = [
            (1i64, 500i64, None),
            (2, 300, None),
            (3, 300, None),
            (4, 100, None),
            (5, 200, Some(1i64)), // media on an offline volume
            (6, 700, None),
            (7, 900, None),
        ];
        for (id, ts, media) in rows {
            conn.execute(
                "INSERT INTO messages (id, conv_id, media_id, created_at) VALUES (?1, 1, ?2, ?3)",
                params![id, media, ts],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO messages (id, conv_id, media_id, created_at) VALUES (99, 2, NULL, 800)",
            [],
        )
        .unwrap();
        conn
    }

    fn page_opts(
        conn: &Connection,
        hide: bool,
        media_only: bool,
        cursor: Option<(i64, i64)>,
        limit: i64,
    ) -> Vec<i64> {
        let (ts, id) = cursor.unwrap_or((i64::MAX, i64::MAX));
        let mut stmt = conn.prepare(&page_sql(media_only)).unwrap();
        let mut ids: Vec<i64> = stmt
            .query_map(params![1i64, ts, id, limit, hide as i64], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        ids.reverse();
        ids
    }

    fn page(conn: &Connection, hide: bool, cursor: Option<(i64, i64)>, limit: i64) -> Vec<i64> {
        page_opts(conn, hide, false, cursor, limit)
    }

    fn cursor_of(conn: &Connection, msg_id: i64) -> (i64, i64) {
        let ts: i64 = conn
            .query_row(
                "SELECT created_at FROM messages WHERE id = ?1",
                params![msg_id],
                |r| r.get(0),
            )
            .unwrap();
        (ts, msg_id)
    }

    #[test]
    fn first_page_is_the_newest_messages() {
        assert_eq!(page(&fixture(), false, None, 3), vec![1, 6, 7]);
    }

    #[test]
    fn walking_back_covers_every_row_exactly_once() {
        let conn = fixture();
        let mut seen: Vec<i64> = Vec::new();
        let mut cursor = None;
        loop {
            let got = page(&conn, false, cursor, 2);
            if got.is_empty() {
                break;
            }
            cursor = Some(cursor_of(&conn, got[0]));
            let mut next = got;
            next.extend(seen);
            seen = next;
        }
        assert_eq!(seen, vec![4, 5, 2, 3, 1, 6, 7]);
    }

    #[test]
    fn tied_timestamps_do_not_repeat_or_skip() {
        let conn = fixture();
        assert_eq!(page(&conn, false, Some((500, 1)), 1), vec![3]);
        assert_eq!(page(&conn, false, Some(cursor_of(&conn, 3)), 1), vec![2]);
    }

    #[test]
    fn hide_offline_drops_only_offline_media_rows() {
        assert_eq!(page(&fixture(), true, None, 10), vec![4, 2, 3, 1, 6, 7]);
    }

    #[test]
    fn missing_files_are_never_hidden() {
        let conn = fixture();
        conn.execute_batch(
            "INSERT INTO media VALUES (2, 2, 'image', NULL, NULL, NULL, 1, 'b.jpg', 'broken');
             INSERT INTO messages (id, conv_id, media_id, created_at) VALUES (20, 1, 2, 950);",
        )
        .unwrap();
        assert!(page(&conn, true, None, 10).contains(&20));
    }

    #[test]
    fn other_conversations_never_leak_in() {
        assert!(!page(&fixture(), false, None, 10).contains(&99));
    }

    #[test]
    fn media_only_keeps_just_the_media_rows() {
        let conn = fixture();
        assert_eq!(page_opts(&conn, false, true, None, 10), vec![5]);
        assert_eq!(page_opts(&conn, true, true, None, 10), Vec::<i64>::new());
    }

    #[test]
    fn rows_carry_status_and_extension_not_paths() {
        let conn = fixture();
        let mut stmt = conn.prepare(&page_sql(true)).unwrap();
        let msgs: Vec<_> = stmt
            .query_map(params![1i64, i64::MAX, i64::MAX, 10i64, 0i64], row_to_message)
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let m = msgs[0].media.as_ref().unwrap();
        assert_eq!(
            (m.status.as_str(), m.ext.as_str(), m.has_thumb),
            ("offline", "heic", false)
        );
    }
}
