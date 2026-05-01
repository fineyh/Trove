use crate::{db, AppResult};
use rusqlite::params;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub conv_id: i64,
    pub conv_name: String,
    pub message_id: Option<i64>,
    pub snippet: String,
    pub created_at: Option<i64>,
}

#[tauri::command]
pub fn search(query: String) -> AppResult<Vec<SearchHit>> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let pattern = format!("%{}%", q.to_lowercase());

    db::with_conn(|conn| {
        let mut hits: Vec<SearchHit> = Vec::new();

        // Conversations by name (LIKE — handles CJK better than FTS5 default).
        let mut conv_stmt = conn.prepare(
            "SELECT id, name FROM conversations
             WHERE archived = 0 AND lower(name) LIKE ?1
             ORDER BY updated_at DESC LIMIT 20",
        )?;
        for row in conv_stmt.query_map(params![pattern], |r| {
            Ok(SearchHit {
                conv_id: r.get(0)?,
                conv_name: r.get(1)?,
                message_id: None,
                snippet: r.get(1)?,
                created_at: None,
            })
        })? {
            hits.push(row?);
        }

        // Messages by caption.
        let mut msg_stmt = conn.prepare(
            "SELECT m.id, m.conv_id, m.caption, m.created_at, c.name
             FROM messages m
             JOIN conversations c ON c.id = m.conv_id
             WHERE c.archived = 0 AND m.caption IS NOT NULL AND lower(m.caption) LIKE ?1
             ORDER BY m.created_at DESC LIMIT 50",
        )?;
        for row in msg_stmt.query_map(params![pattern], |r| {
            let caption: String = r.get(2)?;
            Ok(SearchHit {
                conv_id: r.get(1)?,
                conv_name: r.get(4)?,
                message_id: Some(r.get(0)?),
                snippet: caption,
                created_at: Some(r.get(3)?),
            })
        })? {
            hits.push(row?);
        }
        Ok(hits)
    })
}
