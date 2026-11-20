//! Favorites and tags (ADR-063). Both belong to the file, not the message:
//! the same file in two conversations is one favorite with one set of tags.

use super::messages::{row_to_message, MessagePayload, MESSAGE_COLUMNS, MESSAGE_FROM};
use crate::{db, AppError, AppResult};
use rusqlite::{params, Connection};
use serde::Serialize;

/// Longest tag, in characters. A tag is a word or two, not a caption.
const TAG_MAX: usize = 40;

#[tauri::command]
pub fn set_favorite(lib: String, media_id: i64, favorite: bool) -> AppResult<()> {
    let now = chrono::Utc::now().timestamp_millis();
    db::with_lib(&lib, |conn| {
        let n = if favorite {
            // Already a favorite keeps its time: the favorites view is ordered by it.
            conn.execute(
                "UPDATE media SET favorited_at = COALESCE(favorited_at, ?1) WHERE id = ?2",
                params![now, media_id],
            )?
        } else {
            conn.execute("UPDATE media SET favorited_at = NULL WHERE id = ?1", params![media_id])?
        };
        if n == 0 {
            return Err(AppError::NotFound(format!("media {media_id}")));
        }
        Ok(())
    })
}

/// Every favorite in the space, newest favorite first, each as one of its
/// messages (the oldest), so the UI can treat it like any other item.
#[tauri::command]
pub fn list_favorites(lib: String) -> AppResult<Vec<MessagePayload>> {
    let hide = super::conversations::hide_offline(&lib)? as i64;
    db::with_lib(&lib, |conn| {
        let sql = format!(
            "SELECT {MESSAGE_COLUMNS} {MESSAGE_FROM}
             WHERE md.favorited_at IS NOT NULL
               AND m.id = (SELECT MIN(m2.id) FROM messages m2 WHERE m2.media_id = md.id)
               AND (?1 = 0 OR v.online = 1)
             ORDER BY md.favorited_at DESC, md.id DESC"
        );
        let rows = conn
            .prepare(&sql)?
            .query_map(params![hide], row_to_message)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

/// The tags in use, most used first: what the tag field suggests.
#[tauri::command]
pub fn list_tags(lib: String) -> AppResult<Vec<TagCount>> {
    db::with_lib(&lib, |conn| {
        let rows = conn
            .prepare(
                "SELECT t.name, COUNT(*) AS n FROM tags t JOIN media_tags mt ON mt.tag_id = t.id
                 GROUP BY t.id ORDER BY n DESC, t.name",
            )?
            .query_map([], |r| Ok(TagCount { name: r.get(0)?, count: r.get(1)? }))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    })
}

/// One file's tags, in the order they were added.
#[tauri::command]
pub fn media_tags(lib: String, media_id: i64) -> AppResult<Vec<String>> {
    db::with_lib(&lib, |conn| tags_of(conn, media_id))
}

/// Returns the file's tags after adding. A name that differs only in case
/// from an existing tag is that tag.
#[tauri::command]
pub fn add_media_tag(lib: String, media_id: i64, name: String) -> AppResult<Vec<String>> {
    let name = normalize(&name)?;
    let now = chrono::Utc::now().timestamp_millis();
    db::with_lib(&lib, |conn| {
        let tx = conn.unchecked_transaction()?;
        // A leftover name from deleted files mustn't decide the case of a new one.
        drop_unused_tags(&tx)?;
        tx.execute("INSERT OR IGNORE INTO tags (name, created_at) VALUES (?1, ?2)", params![name, now])?;
        let n = tx.execute(
            "INSERT OR IGNORE INTO media_tags (media_id, tag_id, created_at)
             SELECT md.id, t.id, ?3 FROM media md, tags t WHERE md.id = ?1 AND t.name = ?2",
            params![media_id, name, now],
        )?;
        if n == 0 && !tx.query_row("SELECT EXISTS (SELECT 1 FROM media WHERE id = ?1)", [media_id], |r| r.get::<_, bool>(0))? {
            return Err(AppError::NotFound(format!("media {media_id}")));
        }
        let out = tags_of(&tx, media_id)?;
        tx.commit()?;
        Ok(out)
    })
}

/// Returns the file's tags after removing. A tag no file has any more is gone.
#[tauri::command]
pub fn remove_media_tag(lib: String, media_id: i64, name: String) -> AppResult<Vec<String>> {
    db::with_lib(&lib, |conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM media_tags WHERE media_id = ?1 AND tag_id IN (SELECT id FROM tags WHERE name = ?2)",
            params![media_id, name.trim()],
        )?;
        drop_unused_tags(&tx)?;
        let out = tags_of(&tx, media_id)?;
        tx.commit()?;
        Ok(out)
    })
}

fn tags_of(conn: &Connection, media_id: i64) -> AppResult<Vec<String>> {
    Ok(conn
        .prepare(
            "SELECT t.name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
             WHERE mt.media_id = ?1 ORDER BY mt.created_at, t.id",
        )?
        .query_map([media_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Tags whose last file was untagged or deleted (deleting a file cascades
/// to its `media_tags` but leaves the name behind).
pub(crate) fn drop_unused_tags(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM media_tags)", [])?;
    Ok(())
}

/// One line, single spaces, not empty, not too long.
fn normalize(name: &str) -> AppResult<String> {
    let s = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() {
        return Err(AppError::InvalidArg("tag is empty".into()));
    }
    Ok(s.chars().take(TAG_MAX).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations_for_test(&c);
        c.execute_batch(
            "PRAGMA foreign_keys = ON;
             INSERT INTO volumes (id, platform_id, label, online, created_at) VALUES (1, 'v', 'D', 1, 0);
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind)
               VALUES (1, 1, 'a.jpg', 1, 0, 'h', 'image'), (2, 1, 'b.jpg', 1, 0, 'h2', 'image');",
        )
        .unwrap();
        c
    }

    fn add(c: &Connection, media: i64, name: &str, at: i64) {
        let name = normalize(name).unwrap();
        c.execute("INSERT OR IGNORE INTO tags (name, created_at) VALUES (?1, ?2)", params![name, at]).unwrap();
        c.execute(
            "INSERT OR IGNORE INTO media_tags (media_id, tag_id, created_at) SELECT ?1, id, ?3 FROM tags WHERE name = ?2",
            params![media, name, at],
        )
        .unwrap();
    }

    #[test]
    fn names_are_one_trimmed_line() {
        assert_eq!(normalize("  海边 \n 日落 ").unwrap(), "海边 日落");
        assert!(normalize(" \t ").is_err());
        assert_eq!(normalize(&"x".repeat(100)).unwrap().chars().count(), TAG_MAX);
    }

    #[test]
    fn case_variants_are_one_tag_in_added_order() {
        let c = lib();
        add(&c, 1, "Sea", 1);
        add(&c, 1, "cat", 2);
        add(&c, 1, "sea", 3);
        assert_eq!(tags_of(&c, 1).unwrap(), vec!["Sea", "cat"]);
    }

    #[test]
    fn unused_tags_go_away() {
        let c = lib();
        add(&c, 1, "sea", 1);
        add(&c, 2, "sea", 1);
        add(&c, 2, "cat", 2);
        c.execute("DELETE FROM media WHERE id = 2", []).unwrap();
        drop_unused_tags(&c).unwrap();
        let left: Vec<String> = c
            .prepare("SELECT name FROM tags")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(left, vec!["sea"]);
    }
}
