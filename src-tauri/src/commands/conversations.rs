use crate::{db, services, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: i64,
    pub name: String,
    pub has_avatar: bool,
    pub kind: String,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
    pub preview: Option<String>,
    pub preview_kind: Option<String>,
    /// folder_watch: the source folder's volume isn't mounted.
    pub source_offline: bool,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// `offline_content = hide` keeps media on unmounted volumes out of view.
/// Missing files (volume mounted, file gone) are never hidden (ADR-035).
/// App-wide setting, so it lives in the main library.
pub(crate) fn hide_offline(_lib: &str) -> AppResult<bool> {
    let v: Option<String> = db::with_main(|c| {
        Ok(c
            .query_row("SELECT value FROM settings WHERE key = 'offline_content'", [], |r| r.get(0))
            .optional()?)
    })?;
    Ok(v.as_deref() == Some("hide"))
}

/// SQL predicate (over `md` = media, `v` = its volume) for "this message is
/// visible". `?1` is the hide-offline flag.
pub(crate) const VISIBLE: &str = "(?1 = 0 OR m.media_id IS NULL OR v.online = 1)";

#[tauri::command]
pub fn list_conversations(lib: String) -> AppResult<Vec<Conversation>> {
    let hide = hide_offline(&lib)? as i64;
    db::with_lib(&lib, |conn| {
        let sql = format!(
            "SELECT
                c.id, c.name, c.avatar_path IS NOT NULL, c.kind, c.pinned, c.archived,
                c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM messages m
                    LEFT JOIN media md ON md.id = m.media_id
                    LEFT JOIN volumes v ON v.id = md.volume_id
                    WHERE m.conv_id = c.id AND {VISIBLE}) AS msg_count,
                (SELECT m.caption FROM messages m
                    LEFT JOIN media md ON md.id = m.media_id
                    LEFT JOIN volumes v ON v.id = md.volume_id
                    WHERE m.conv_id = c.id AND {VISIBLE}
                    ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
                (SELECT CASE WHEN m.media_id IS NULL THEN 'text' ELSE COALESCE(md.kind, 'text') END
                    FROM messages m
                    LEFT JOIN media md ON md.id = m.media_id
                    LEFT JOIN volumes v ON v.id = md.volume_id
                    WHERE m.conv_id = c.id AND {VISIBLE}
                    ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview_kind,
                (c.kind = 'folder_watch' AND COALESCE(sv.online, 0) = 0) AS source_offline
             FROM conversations c
             LEFT JOIN volumes sv ON sv.id = c.source_volume_id
             WHERE c.archived = 0
             ORDER BY c.pinned DESC, c.updated_at DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![hide], |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    has_avatar: row.get::<_, i64>(2)? != 0,
                    kind: row.get(3)?,
                    pinned: row.get::<_, i64>(4)? != 0,
                    archived: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                    message_count: row.get(8)?,
                    preview: row.get(9)?,
                    preview_kind: row.get(10)?,
                    source_offline: row.get::<_, i64>(11)? != 0,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationArgs {
    pub name: String,
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub source_path: Option<String>,
}

fn default_kind() -> String {
    "manual".into()
}

#[tauri::command]
pub async fn create_conversation(lib: String, args: CreateConversationArgs) -> AppResult<i64> {
    super::run_blocking(move || create_conversation_blocking(&lib, args)).await
}

fn create_conversation_blocking(lib: &str, args: CreateConversationArgs) -> AppResult<i64> {
    let name = args.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::InvalidArg("conversation name is empty".into()));
    }
    if !matches!(args.kind.as_str(), "manual" | "folder_watch") {
        return Err(AppError::InvalidArg(format!("invalid kind: {}", args.kind)));
    }
    let now = now_ms();

    let watch_root: Option<PathBuf>;
    let (source_volume_id, source_relpath) = if args.kind == "folder_watch" {
        let path = args
            .source_path
            .as_ref()
            .ok_or_else(|| AppError::InvalidArg("folder_watch needs source_path".into()))?;
        let raw = std::path::Path::new(path);
        if !raw.is_dir() {
            return Err(AppError::InvalidArg(format!("not a directory: {}", raw.display())));
        }
        let resolved = services::volume_resolver::resolve(raw).map_err(AppError::InvalidArg)?;
        let vid = ensure_volume(lib, &resolved.platform_id, &resolved.label, &resolved.mount_point)?;
        watch_root = Some(services::volume_resolver::absolute_for(&resolved.mount_point, &resolved.relpath));
        (Some(vid), Some(resolved.relpath))
    } else {
        watch_root = None;
        (None, None)
    };

    let conv_id = db::with_lib(lib, |conn| {
        conn.execute(
            "INSERT INTO conversations
                (name, avatar_path, kind, source_volume_id, source_relpath,
                 pinned, archived, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6, ?6)",
            params![name, args.avatar_path, args.kind, source_volume_id, source_relpath, now],
        )?;
        Ok::<i64, AppError>(conn.last_insert_rowid())
    })?;

    if let Some(root) = watch_root {
        let paths = services::folder_scanner::enumerate_media(&root);
        for p in paths {
            if let Err(e) = super::media::ingest_one(lib, conv_id, &p, false, true) {
                log::warn!("folder_watch initial scan: {e}");
            }
        }
        if let Err(e) = services::file_watcher::start(lib, conv_id, root) {
            log::warn!("folder_watch start watcher: {e}");
        }
        services::thumbs::wake(lib);
    }

    Ok(conv_id)
}

pub(crate) fn ensure_volume(
    lib: &str,
    platform_id: &str,
    label: &str,
    mount_point: &std::path::Path,
) -> AppResult<i64> {
    let mount_str = mount_point.to_string_lossy().to_string();
    let now = now_ms();
    db::with_lib(lib, |conn| {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM volumes WHERE platform_id = ?1",
                params![platform_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            conn.execute(
                "UPDATE volumes SET last_mount = ?1, online = 1 WHERE id = ?2",
                params![mount_str, id],
            )?;
            return Ok(id);
        }
        conn.execute(
            "INSERT INTO volumes (platform_id, label, last_mount, online, created_at)
             VALUES (?1, ?2, ?3, 1, ?4)",
            params![platform_id, label, mount_str, now],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConversationArgs {
    pub id: i64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub archived: Option<bool>,
}

#[tauri::command]
pub fn update_conversation(lib: String, args: UpdateConversationArgs) -> AppResult<()> {
    let now = now_ms();
    db::with_lib(&lib, |conn| {
        if let Some(name) = &args.name {
            conn.execute(
                "UPDATE conversations SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![name, now, args.id],
            )?;
        }
        if let Some(avatar) = &args.avatar_path {
            conn.execute(
                "UPDATE conversations SET avatar_path = ?1, updated_at = ?2 WHERE id = ?3",
                params![avatar, now, args.id],
            )?;
        }
        if let Some(pinned) = args.pinned {
            conn.execute(
                "UPDATE conversations SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
                params![pinned as i64, now, args.id],
            )?;
        }
        if let Some(archived) = args.archived {
            conn.execute(
                "UPDATE conversations SET archived = ?1, updated_at = ?2 WHERE id = ?3",
                params![archived as i64, now, args.id],
            )?;
        }
        Ok(())
    })
}

/// Delete a conversation, and the media rows (with their thumbnails) that no
/// other conversation still uses — otherwise every deleted conversation left
/// orphan rows and orphan thumbnails behind (todo 4.6).
#[tauri::command]
pub fn delete_conversation(lib: String, id: i64) -> AppResult<()> {
    services::file_watcher::stop(&lib, id);
    db::with_lib(&lib, |conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "CREATE TEMP TABLE IF NOT EXISTS _gone (id INTEGER PRIMARY KEY)",
            [],
        )?;
        tx.execute("DELETE FROM _gone", [])?;
        tx.execute(
            "INSERT OR IGNORE INTO _gone SELECT media_id FROM messages WHERE conv_id = ?1 AND media_id IS NOT NULL",
            params![id],
        )?;
        tx.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        tx.execute(
            "DELETE FROM media WHERE id IN (SELECT id FROM _gone)
               AND NOT EXISTS (SELECT 1 FROM messages WHERE media_id = media.id)",
            [],
        )?;
        tx.execute("DELETE FROM _gone", [])?;
        tx.commit()?;
        Ok(())
    })
}

/// Start a watcher for every folder_watch conversation of `lib` whose source
/// is mounted. Run whenever a library opens.
pub fn boot_existing_watchers(lib: &str) -> AppResult<()> {
    let ids: Vec<i64> = db::with_lib(lib, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id FROM conversations WHERE kind = 'folder_watch' AND archived = 0",
        )?;
        let r = stmt
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })?;
    for id in ids {
        services::volume_monitor::try_start_watcher(lib, id);
    }
    Ok(())
}
