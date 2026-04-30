mod migrations;

use crate::AppResult;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();
static DB_PATH: OnceCell<PathBuf> = OnceCell::new();

pub fn init(data_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(data_dir)?;
    let path = data_dir.join("trove.db");
    let conn = Connection::open(&path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;",
    )?;
    migrations::run(&conn)?;
    DB.set(Mutex::new(conn))
        .map_err(|_| anyhow::anyhow!("db already initialized"))?;
    DB_PATH
        .set(path)
        .map_err(|_| anyhow::anyhow!("db path already set"))?;
    Ok(())
}

pub fn with_conn<F, R>(f: F) -> R
where
    F: FnOnce(&Connection) -> R,
{
    let lock = DB.get().expect("db not initialized").lock();
    f(&lock)
}
