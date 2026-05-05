use crate::services::crypto::KdfParams;
use crate::services::vault;
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
    pub unlocked: bool,
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
    let strategy = read_missing_strategy()?;
    let hide_broken = strategy == "hide";

    db::with_conn(|conn| {
        let mut sql = String::from(
            "SELECT
                c.id, c.name, c.avatar_path, c.kind, c.encrypted, c.pinned, c.archived,
                c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM messages m
                    LEFT JOIN media md ON md.id = m.media_id
                    WHERE m.conv_id = c.id
                    AND (?1 = 0 OR m.media_id IS NULL OR md.state = 'live')) AS msg_count,
                (SELECT m.caption FROM messages m
                    LEFT JOIN media md ON md.id = m.media_id
                    WHERE m.conv_id = c.id
                    AND (?1 = 0 OR m.media_id IS NULL OR md.state = 'live')
                    ORDER BY m.created_at DESC LIMIT 1) AS preview,
                (SELECT
                    CASE
                        WHEN m.media_id IS NULL THEN 'text'
                        ELSE COALESCE(md.kind, 'text')
                    END
                 FROM messages m
                 LEFT JOIN media md ON md.id = m.media_id
                 WHERE m.conv_id = c.id
                 AND (?1 = 0 OR m.media_id IS NULL OR md.state = 'live')
                 ORDER BY m.created_at DESC LIMIT 1) AS preview_kind
             FROM conversations c
             WHERE c.archived = 0",
        );
        if hide_broken {
            // Hide a conversation when it has messages but all of them
            // reference broken media — i.e. nothing live to show.
            sql.push_str(
                " AND (
                    (SELECT COUNT(*) FROM messages WHERE conv_id = c.id) = 0
                    OR EXISTS (
                        SELECT 1 FROM messages m
                        LEFT JOIN media md ON md.id = m.media_id
                        WHERE m.conv_id = c.id
                        AND (m.media_id IS NULL OR md.state = 'live')
                    )
                )",
            );
        }
        sql.push_str(" ORDER BY c.pinned DESC, c.updated_at DESC");

        let mut stmt = conn.prepare(&sql)?;
        let hide_param: i64 = if hide_broken { 1 } else { 0 };
        let rows = stmt
            .query_map(params![hide_param], |row| {
                let id: i64 = row.get(0)?;
                let encrypted = row.get::<_, i64>(4)? != 0;
                Ok(Conversation {
                    id,
                    name: row.get(1)?,
                    avatar_path: row.get(2)?,
                    kind: row.get(3)?,
                    encrypted,
                    unlocked: !encrypted || vault::get_conv_key(id).is_some(),
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

fn read_missing_strategy() -> AppResult<String> {
    db::with_conn(|conn| {
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'missing_file_strategy'",
            [],
            |r| r.get::<_, String>(0),
        )
        .or_else(|_| Ok::<_, rusqlite::Error>("hide".to_string()))
        .map_err(AppError::from)
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
    #[serde(default)]
    pub encrypt: bool,
    #[serde(default)]
    pub password: Option<String>,
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

    // Pre-derive encryption material so we don't write a half-baked row
    // if the user enables encryption but provides an empty password.
    let enc_material = if args.encrypt {
        let pwd = args
            .password
            .as_ref()
            .ok_or_else(|| AppError::InvalidArg("password required for encrypted conversation".into()))?;
        if pwd.chars().count() < 4 {
            return Err(AppError::InvalidArg(
                "conversation password must be at least 4 characters".into(),
            ));
        }
        let (kek, salt, params) = vault::fresh_conv_kek_material(pwd)
            .map_err(AppError::from)?;
        let conv_key = vault::fresh_conv_key();
        let aad = b"trove:conv-key:v1";
        let wrapped = crate::services::crypto::wrap_key(&kek, &conv_key, aad)
            .map_err(AppError::from)?;
        Some((wrapped, salt.to_vec(), params, conv_key))
    } else {
        None
    };

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

    let encrypted_flag: i64 = if enc_material.is_some() { 1 } else { 0 };
    let wrapped_blob = enc_material.as_ref().map(|(w, _, _, _)| w.clone());
    let salt_blob = enc_material.as_ref().map(|(_, s, _, _)| s.clone());
    let kdf_mem = enc_material.as_ref().map(|(_, _, p, _)| p.mem_kib as i64);
    let kdf_iters = enc_material.as_ref().map(|(_, _, p, _)| p.iters as i64);
    let kdf_par = enc_material.as_ref().map(|(_, _, p, _)| p.parallelism as i64);

    let conv_id = db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO conversations
                (name, avatar_path, kind, source_volume_id, source_relpath,
                 encrypted, enc_key_wrapped, enc_kdf_salt, enc_kdf_mem, enc_kdf_iters, enc_kdf_par,
                 pinned, archived, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, 0, ?12, ?12)",
            params![
                name,
                args.avatar_path,
                args.kind,
                source_volume_id,
                source_relpath,
                encrypted_flag,
                wrapped_blob,
                salt_blob,
                kdf_mem,
                kdf_iters,
                kdf_par,
                now
            ],
        )?;
        Ok::<i64, AppError>(conn.last_insert_rowid())
    })?;

    if let Some((_, _, _, conv_key)) = enc_material {
        vault::cache_conv_key(conv_id, conv_key);
    }

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockConvArgs {
    pub conv_id: i64,
    pub password: String,
}

#[tauri::command]
pub fn unlock_conversation(args: UnlockConvArgs) -> AppResult<()> {
    let row: Option<(Vec<u8>, Vec<u8>, i64, i64, i64)> = db::with_conn(|conn| {
        conn.query_row(
            "SELECT enc_key_wrapped, enc_kdf_salt, enc_kdf_mem, enc_kdf_iters, enc_kdf_par
             FROM conversations WHERE id = ?1 AND encrypted = 1",
            params![args.conv_id],
            |r| {
                Ok((
                    r.get::<_, Vec<u8>>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::from)
    })?;
    let Some((wrapped, salt, mem, iters, par)) = row else {
        return Err(AppError::NotFound("encrypted conversation".into()));
    };
    let params = KdfParams {
        mem_kib: mem as u32,
        iters: iters as u32,
        parallelism: par as u32,
    };
    let kek = vault::derive_conv_kek(&args.password, &salt, params)
        .map_err(AppError::from)?;
    let conv_key = crate::services::crypto::unwrap_key(&kek, &wrapped, b"trove:conv-key:v1")
        .map_err(|_| AppError::InvalidArg("incorrect conversation password".into()))?;
    vault::cache_conv_key(args.conv_id, conv_key);
    Ok(())
}

#[tauri::command]
pub fn lock_conversation(conv_id: i64) -> AppResult<()> {
    vault::forget_conv_key(conv_id);
    Ok(())
}

#[tauri::command]
pub fn list_unlocked_conversations() -> AppResult<Vec<i64>> {
    Ok(vault::unlocked_conv_ids())
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
