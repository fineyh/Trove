use rusqlite::Connection;

const SCHEMA_LATEST: &str = include_str!("schema.sql");

const V1_TO_V2: &str = "
ALTER TABLE conversations ADD COLUMN enc_kdf_salt BLOB;
ALTER TABLE conversations ADD COLUMN enc_kdf_mem INTEGER;
ALTER TABLE conversations ADD COLUMN enc_kdf_iters INTEGER;
ALTER TABLE conversations ADD COLUMN enc_kdf_par INTEGER;
";

const V2_TO_V3: &str = "
ALTER TABLE identity ADD COLUMN picture_url TEXT;
";

pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let mut user_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if user_version == 0 {
        conn.execute_batch(SCHEMA_LATEST)?;
        conn.execute_batch("PRAGMA user_version = 3")?;
        user_version = 3;
    }
    if user_version < 2 {
        conn.execute_batch(V1_TO_V2)?;
        conn.execute_batch("PRAGMA user_version = 2")?;
        user_version = 2;
    }
    if user_version < 3 {
        conn.execute_batch(V2_TO_V3)?;
        conn.execute_batch("PRAGMA user_version = 3")?;
    }
    Ok(())
}
