use crate::{db, AppResult};
use serde::Serialize;

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
    pub updated_at: i64,
}

#[tauri::command]
pub fn list_conversations() -> AppResult<Vec<Conversation>> {
    db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, avatar_path, kind, encrypted, pinned, archived, updated_at
             FROM conversations
             WHERE archived = 0
             ORDER BY pinned DESC, updated_at DESC",
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
                    updated_at: row.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}
