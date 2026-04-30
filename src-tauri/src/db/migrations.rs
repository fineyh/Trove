use rusqlite::Connection;

const SCHEMA: &str = include_str!("schema.sql");

pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let user_version: i64 =
        conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if user_version == 0 {
        conn.execute_batch(SCHEMA)?;
        conn.execute_batch("PRAGMA user_version = 1")?;
    }
    Ok(())
}
