use crate::{db, services, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: i64,
    pub name: String,
    pub avatar_path: Option<String>,
    pub kind: String,
    pub encrypted: bool,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
    pub preview: Option<String>,
    pub preview_kind: Option<String>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[tauri::command]
pub fn list_conversations() -> AppResult<Vec<Conversation>> {
    db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT
                c.id, c.name, c.avatar_path, c.kind, c.encrypted, c.pinned, c.archived,
                c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM messages m WHERE m.conv_id = c.id) AS msg_count,
                (SELECT m.caption FROM messages m WHERE m.conv_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
                (SELECT
                    CASE
                        WHEN m.media_id IS NULL THEN 'text'
                        ELSE COALESCE((SELECT kind FROM media WHERE id = m.media_id), 'text')
                    END
                 FROM messages m WHERE m.conv_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview_kind
             FROM conversations c
             WHERE c.archived = 0
             ORDER BY c.pinned DESC, c.updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    avatar_path: row.get(2)?,
                    kind: row.get(3)?,
                    encrypted: row.get::<_, i64>(4)? != 0,
                    pinned: row.get::<_, i64>(5)? != 0,
                    archived: row.get::<_, i64>(6)? != 0,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    message_count: row.get(9)?,
                    preview: row.get(10)?,
                    preview_kind: row.get(11)?,
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
pub fn create_conversation(args: CreateConversationArgs) -> AppResult<i64> {
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
            return Err(AppError::InvalidArg(format!(
                "not a directory: {}",
                raw.display()
            )));
        }
        let resolved = services::volume_resolver::resolve(raw)
            .map_err(|e| AppError::InvalidArg(e))?;
        let vid = ensure_volume(&resolved.platform_id, &resolved.label, &resolved.mount_point)?;
        watch_root = Some(services::volume_resolver::absolute_for(
            &resolved.mount_point,
            &resolved.relpath,
        ));
        (Some(vid), Some(resolved.relpath))
    } else {
        watch_root = None;
        (None, None)
    };

    let conv_id = db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO conversations
                (name, avatar_path, kind, source_volume_id, source_relpath,
                 encrypted, enc_key_wrapped, pinned, archived, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, 0, 0, ?6, ?6)",
            params![
                name,
                args.avatar_path,
                args.kind,
                source_volume_id,
                source_relpath,
                now
            ],
        )?;
        Ok::<i64, AppError>(conn.last_insert_rowid())
    })?;

    if let Some(root) = watch_root {
        let paths = services::folder_scanner::enumerate_media(&root);
        for p in paths {
            if let Err(e) = super::media::ingest_one(conv_id, &p, false, true) {
                eprintln!("folder_watch initial scan: {e}");
            }
        }
        if let Err(e) = services::file_watcher::start(conv_id, root) {
            eprintln!("folder_watch start watcher: {e}");
        }
    }

    Ok(conv_id)
}

pub(crate) fn ensure_volume(
    platform_id: &str,
    label: &str,
    mount_point: &std::path::Path,
) -> AppResult<i64> {
    let mount_str = mount_point.to_string_lossy().to_string();
    let now = now_ms();
    db::with_conn(|conn| {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM volumes WHERE platform_id = ?1",
                params![platform_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            conn.execute(
                "UPDATE volumes SET last_mount = ?1 WHERE id = ?2",
                params![mount_str, id],
            )?;
            return Ok(id);
        }
        conn.execute(
            "INSERT INTO volumes (platform_id, label, last_mount, created_at)
             VALUES (?1, ?2, ?3, ?4)",
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
pub fn update_conversation(args: UpdateConversationArgs) -> AppResult<()> {
    let now = now_ms();
    db::with_conn(|conn| {
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

#[tauri::command]
pub fn delete_conversation(id: i64) -> AppResult<()> {
    services::file_watcher::stop(id);
    db::with_conn(|conn| {
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    })
}

/// Iterate every existing folder_watch conversation and start a watcher for
/// it. Called once at app boot so live updates resume after restart.
pub fn boot_existing_watchers() -> AppResult<()> {
    let rows: Vec<(i64, String, String)> =
        db::with_conn(|conn| -> AppResult<Vec<(i64, String, String)>> {
            let mut stmt = conn.prepare(
                "SELECT c.id, v.last_mount, c.source_relpath
                 FROM conversations c
                 JOIN volumes v ON v.id = c.source_volume_id
                 WHERE c.kind = 'folder_watch' AND c.archived = 0",
            )?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })?;
    for (conv_id, mount, relpath) in rows {
        let root =
            services::volume_resolver::absolute_for(std::path::Path::new(&mount), &relpath);
        if !root.is_dir() {
            // volume not currently mounted — leave watcher off
            continue;
        }
        if let Err(e) = services::file_watcher::start(conv_id, root) {
            eprintln!("boot watcher #{conv_id}: {e}");
        }
    }
    Ok(())
}
