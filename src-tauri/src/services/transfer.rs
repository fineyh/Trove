//! Move a conversation from one library to another (ADR-038 §5).
//!
//! Copy first, delete second: rows are written to the target in one
//! transaction, and only after that commits is the source deleted (another
//! transaction). A crash in between leaves a duplicate, never a loss. The
//! source has `secure_delete` on, so its freed pages are zeroed.

use crate::{db, AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

struct ConvRow {
    name: String,
    avatar_path: Option<String>,
    kind: String,
    source_volume_id: Option<i64>,
    source_relpath: Option<String>,
    pinned: i64,
    created_at: i64,
    updated_at: i64,
}

struct VolumeRow {
    platform_id: String,
    label: Option<String>,
    last_mount: Option<String>,
    online: i64,
    created_at: i64,
}

struct MediaRow {
    id: i64,
    volume_id: i64,
    relpath: String,
    size_bytes: i64,
    mtime: i64,
    blake3: String,
    kind: String,
    width: Option<i64>,
    height: Option<i64>,
    duration_ms: Option<i64>,
    state: String,
    lat: Option<f64>,
    lon: Option<f64>,
    geo_scanned: i64,
    thumb_scanned: i64,
}

struct MsgRow {
    media_id: Option<i64>,
    caption: Option<String>,
    play_count: i64,
    created_at: i64,
}

struct Snapshot {
    conv: ConvRow,
    volumes: HashMap<i64, VolumeRow>,
    media: Vec<MediaRow>,
    thumbs: Vec<(i64, Vec<u8>, String, i64, i64, i64)>,
    broken: Vec<(i64, i64, Option<i64>, Option<String>)>,
    messages: Vec<MsgRow>,
}

fn read(c: &Connection, conv_id: i64) -> AppResult<Snapshot> {
    let conv = c
        .query_row(
            "SELECT name, avatar_path, kind, source_volume_id, source_relpath, pinned, created_at, updated_at
             FROM conversations WHERE id = ?1",
            [conv_id],
            |r| {
                Ok(ConvRow {
                    name: r.get(0)?,
                    avatar_path: r.get(1)?,
                    kind: r.get(2)?,
                    source_volume_id: r.get(3)?,
                    source_relpath: r.get(4)?,
                    pinned: r.get(5)?,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("conversation #{conv_id}")))?;

    let messages = c
        .prepare("SELECT media_id, caption, play_count, created_at FROM messages WHERE conv_id = ?1 ORDER BY id")?
        .query_map([conv_id], |r| {
            Ok(MsgRow { media_id: r.get(0)?, caption: r.get(1)?, play_count: r.get(2)?, created_at: r.get(3)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let media = c
        .prepare(
            "SELECT id, volume_id, relpath, size_bytes, mtime, blake3, kind, width, height, duration_ms,
                    state, lat, lon, geo_scanned, thumb_scanned
             FROM media WHERE id IN (SELECT media_id FROM messages WHERE conv_id = ?1)",
        )?
        .query_map([conv_id], |r| {
            Ok(MediaRow {
                id: r.get(0)?,
                volume_id: r.get(1)?,
                relpath: r.get(2)?,
                size_bytes: r.get(3)?,
                mtime: r.get(4)?,
                blake3: r.get(5)?,
                kind: r.get(6)?,
                width: r.get(7)?,
                height: r.get(8)?,
                duration_ms: r.get(9)?,
                state: r.get(10)?,
                lat: r.get(11)?,
                lon: r.get(12)?,
                geo_scanned: r.get(13)?,
                thumb_scanned: r.get(14)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let thumbs = c
        .prepare(
            "SELECT media_id, data, mime, width, height, created_at FROM thumbs
             WHERE media_id IN (SELECT media_id FROM messages WHERE conv_id = ?1)",
        )?
        .query_map([conv_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let broken = c
        .prepare(
            "SELECT media_id, detected_at, last_known_volume, last_known_relpath FROM broken_pointers
             WHERE media_id IN (SELECT media_id FROM messages WHERE conv_id = ?1)",
        )?
        .query_map([conv_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut vol_ids: Vec<i64> = media.iter().map(|m| m.volume_id).collect();
    vol_ids.extend(conv.source_volume_id);
    vol_ids.extend(broken.iter().filter_map(|b| b.2));
    vol_ids.sort_unstable();
    vol_ids.dedup();
    let mut volumes = HashMap::new();
    for vid in vol_ids {
        if let Some(v) = c
            .query_row(
                "SELECT platform_id, label, last_mount, online, created_at FROM volumes WHERE id = ?1",
                [vid],
                |r| {
                    Ok(VolumeRow {
                        platform_id: r.get(0)?,
                        label: r.get(1)?,
                        last_mount: r.get(2)?,
                        online: r.get(3)?,
                        created_at: r.get(4)?,
                    })
                },
            )
            .optional()?
        {
            volumes.insert(vid, v);
        }
    }
    Ok(Snapshot { conv, volumes, media, thumbs, broken, messages })
}

fn write(c: &Connection, s: &Snapshot) -> AppResult<i64> {
    let tx = c.unchecked_transaction()?;
    // Volumes are matched by platform id, since the target may know them.
    let mut vmap: HashMap<i64, i64> = HashMap::new();
    for (old, v) in &s.volumes {
        let existing: Option<i64> = tx
            .query_row("SELECT id FROM volumes WHERE platform_id = ?1", [&v.platform_id], |r| r.get(0))
            .optional()?;
        let id = match existing {
            Some(id) => id,
            None => {
                tx.execute(
                    "INSERT INTO volumes (platform_id, label, last_mount, online, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![v.platform_id, v.label, v.last_mount, v.online, v.created_at],
                )?;
                tx.last_insert_rowid()
            }
        };
        vmap.insert(*old, id);
    }
    // Media are matched by (volume, relpath): the same file may already be
    // in the target library through another conversation.
    let mut mmap: HashMap<i64, i64> = HashMap::new();
    for m in &s.media {
        let vid = vmap[&m.volume_id];
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM media WHERE volume_id = ?1 AND relpath = ?2",
                params![vid, m.relpath],
                |r| r.get(0),
            )
            .optional()?;
        let id = match existing {
            Some(id) => id,
            None => {
                tx.execute(
                    "INSERT INTO media (volume_id, relpath, size_bytes, mtime, blake3, kind, width, height,
                        duration_ms, state, lat, lon, geo_scanned, thumb_scanned)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        vid, m.relpath, m.size_bytes, m.mtime, m.blake3, m.kind, m.width, m.height,
                        m.duration_ms, m.state, m.lat, m.lon, m.geo_scanned, m.thumb_scanned
                    ],
                )?;
                tx.last_insert_rowid()
            }
        };
        mmap.insert(m.id, id);
    }
    for (mid, data, mime, w, h, at) in &s.thumbs {
        tx.execute(
            "INSERT OR IGNORE INTO thumbs (media_id, data, mime, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![mmap[mid], data, mime, w, h, at],
        )?;
    }
    for (mid, at, vol, rel) in &s.broken {
        tx.execute(
            "INSERT OR IGNORE INTO broken_pointers (media_id, detected_at, last_known_volume, last_known_relpath)
             VALUES (?1, ?2, ?3, ?4)",
            params![mmap[mid], at, vol.and_then(|v| vmap.get(&v).copied()), rel],
        )?;
    }
    let avatar = match &s.conv.avatar_path {
        Some(a) if a.starts_with("media:") => a[6..]
            .parse::<i64>()
            .ok()
            .and_then(|old| mmap.get(&old))
            .map(|new| format!("media:{new}")),
        other => other.clone(),
    };
    tx.execute(
        "INSERT INTO conversations (name, avatar_path, kind, source_volume_id, source_relpath, pinned, archived, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
        params![
            s.conv.name,
            avatar,
            s.conv.kind,
            s.conv.source_volume_id.and_then(|v| vmap.get(&v).copied()),
            s.conv.source_relpath,
            s.conv.pinned,
            s.conv.created_at,
            s.conv.updated_at
        ],
    )?;
    let conv_id = tx.last_insert_rowid();
    for m in &s.messages {
        tx.execute(
            "INSERT INTO messages (conv_id, media_id, caption, play_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![conv_id, m.media_id.map(|x| mmap[&x]), m.caption, m.play_count, m.created_at],
        )?;
    }
    tx.commit()?;
    Ok(conv_id)
}

fn delete_source(c: &Connection, conv_id: i64) -> AppResult<()> {
    let tx = c.unchecked_transaction()?;
    let media: Vec<i64> = tx
        .prepare("SELECT DISTINCT media_id FROM messages WHERE conv_id = ?1 AND media_id IS NOT NULL")?
        .query_map([conv_id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    tx.execute("DELETE FROM conversations WHERE id = ?1", [conv_id])?;
    for mid in media {
        tx.execute(
            "DELETE FROM media WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM messages WHERE media_id = ?1)",
            [mid],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Returns the conversation's id in the target library.
pub fn move_conversation(from: &str, conv_id: i64, to: &str) -> AppResult<i64> {
    if from == to {
        return Err(AppError::InvalidArg("源库和目标库相同".into()));
    }
    if !db::is_open(to) {
        return Err(AppError::Locked(to.to_string()));
    }
    crate::services::file_watcher::stop(from, conv_id);
    let snap = db::with_lib(from, |c| read(c, conv_id))?;
    let new_id = db::with_lib(to, |c| write(c, &snap))?;
    db::with_lib(from, |c| delete_source(c, conv_id))?;
    if snap.conv.kind == "folder_watch" {
        crate::services::volume_monitor::try_start_watcher(to, new_id);
    }
    Ok(new_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&c);
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        c
    }

    #[test]
    fn moves_rows_and_leaves_no_orphans() {
        let a = lib();
        let b = lib();
        a.execute_batch(
            "INSERT INTO volumes (id, platform_id, label, online, created_at) VALUES (1, 'v', 'D', 1, 0);
             INSERT INTO conversations (id, name, kind, avatar_path, created_at, updated_at) VALUES (1, 'x', 'manual', 'media:5', 0, 0);
             INSERT INTO conversations (id, name, kind, created_at, updated_at) VALUES (2, 'y', 'manual', 0, 0);
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind) VALUES (5, 1, 'a.jpg', 1, 0, 'h', 'image');
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind) VALUES (6, 1, 'b.jpg', 1, 0, 'h2', 'image');
             INSERT INTO thumbs (media_id, data, mime, width, height, created_at) VALUES (5, x'00', 'image/webp', 1, 1, 0);
             INSERT INTO messages (conv_id, media_id, caption, created_at) VALUES (1, 5, 'a', 1), (1, NULL, 'hi', 2);
             INSERT INTO messages (conv_id, media_id, caption, created_at) VALUES (1, 6, 'b', 3), (2, 6, 'b', 3);",
        )
        .unwrap();
        let snap = read(&a, 1).unwrap();
        let new_id = write(&b, &snap).unwrap();
        delete_source(&a, 1).unwrap();

        let n: i64 = b.query_row("SELECT COUNT(*) FROM messages WHERE conv_id = ?1", [new_id], |r| r.get(0)).unwrap();
        assert_eq!(n, 3);
        let thumbs: i64 = b.query_row("SELECT COUNT(*) FROM thumbs", [], |r| r.get(0)).unwrap();
        assert_eq!(thumbs, 1);
        let avatar: String = b.query_row("SELECT avatar_path FROM conversations", [], |r| r.get(0)).unwrap();
        let mid: i64 = b.query_row("SELECT id FROM media WHERE relpath = 'a.jpg'", [], |r| r.get(0)).unwrap();
        assert_eq!(avatar, format!("media:{mid}"));

        // Source: conv 1 gone, media 5 gone (with its thumb), media 6 kept for conv 2.
        let left: Vec<i64> = a.prepare("SELECT id FROM media ORDER BY id").unwrap()
            .query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(left, vec![6]);
        let t: i64 = a.query_row("SELECT COUNT(*) FROM thumbs", [], |r| r.get(0)).unwrap();
        assert_eq!(t, 0);
    }
}
