mod migrations;

use crate::services::crypto::SecretKey;
use crate::AppResult;
use anyhow::anyhow;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

/// Holds the open SQLite connection. We swap the inner `Option<Connection>`
/// when locking/unlocking — the outer `OnceCell` is only initialized once.
struct DbState {
    conn: Option<Connection>,
    path: PathBuf,
}

static STATE: OnceCell<Mutex<DbState>> = OnceCell::new();

pub fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("trove.db")
}

/// Set up the connection slot without opening anything yet. Call once at app
/// boot. The actual DB open happens via [open_unencrypted] or [open_with_key].
pub fn init_slot(data_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(data_dir)?;
    let path = db_path(data_dir);
    STATE
        .set(Mutex::new(DbState { conn: None, path }))
        .map_err(|_| anyhow!("db already initialized"))?;
    Ok(())
}

fn apply_pragmas(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;",
    )
}

fn apply_key(conn: &Connection, key: &SecretKey) -> rusqlite::Result<()> {
    // SQLCipher accepts a raw 256-bit key as `x'<hex>'`.
    let pragma = format!("PRAGMA key = {};", key.to_sqlcipher_pragma());
    conn.execute_batch(&pragma)?;
    Ok(())
}

/// Verify that the connection can actually read the database. SQLCipher
/// silently accepts any key at PRAGMA-key time; the failure shows up only
/// when you touch a real page.
fn smoke_test(conn: &Connection) -> rusqlite::Result<()> {
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })?;
    Ok(())
}

fn open_connection(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
}

/// Open the DB without a key (no master password configured).
pub fn open_unencrypted() -> AppResult<()> {
    let mut g = STATE.get().expect("db slot not initialized").lock();
    if g.conn.is_some() {
        return Ok(());
    }
    let conn = open_connection(&g.path)?;
    apply_pragmas(&conn)?;
    migrations::run(&conn)?;
    g.conn = Some(conn);
    Ok(())
}

/// Open the DB with a SQLCipher key.
pub fn open_with_key(key: &SecretKey) -> AppResult<()> {
    let mut g = STATE.get().expect("db slot not initialized").lock();
    if g.conn.is_some() {
        return Ok(());
    }
    let conn = open_connection(&g.path)?;
    apply_key(&conn, key)?;
    apply_pragmas(&conn)?;
    smoke_test(&conn)
        .map_err(|_| crate::AppError::InvalidArg("incorrect master password".into()))?;
    migrations::run(&conn)?;
    g.conn = Some(conn);
    Ok(())
}

/// Drop the in-memory connection. The DB file stays on disk; subsequent
/// reads must call [open_unencrypted] / [open_with_key] again.
pub fn close() {
    if let Some(slot) = STATE.get() {
        let mut g = slot.lock();
        g.conn.take();
    }
}

/// Encrypt a previously-unencrypted DB in place using SQLCipher's
/// `sqlcipher_export` flow, then swap the file. Caller must hold the
/// new key (the in-memory connection will be reopened against the
/// rekeyed DB).
pub fn encrypt_inplace(new_key: &SecretKey) -> AppResult<()> {
    let mut g = STATE.get().expect("db slot not initialized").lock();
    let path = g.path.clone();
    // close current
    g.conn.take();
    let encrypted_path = path.with_extension("db.enc");
    if encrypted_path.exists() {
        std::fs::remove_file(&encrypted_path)?;
    }

    // Open the plaintext DB and ATTACH a new encrypted copy.
    let src = open_connection(&path)?;
    apply_pragmas(&src)?;
    let attach = format!(
        "ATTACH DATABASE '{}' AS encrypted KEY {};",
        encrypted_path.to_string_lossy().replace('\'', "''"),
        new_key.to_sqlcipher_pragma()
    );
    src.execute_batch(&attach)?;
    src.execute_batch("SELECT sqlcipher_export('encrypted');")?;
    // Carry over user_version (schema version) so migrations don't re-run.
    let user_version: i64 =
        src.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    src.execute_batch(&format!(
        "PRAGMA encrypted.user_version = {user_version};"
    ))?;
    src.execute_batch("DETACH DATABASE encrypted;")?;
    drop(src);

    // Atomic swap: rename plaintext aside, encrypted into place.
    let backup = path.with_extension("db.preenc");
    if backup.exists() {
        std::fs::remove_file(&backup)?;
    }
    std::fs::rename(&path, &backup)?;
    std::fs::rename(&encrypted_path, &path)?;
    std::fs::remove_file(&backup).ok();

    // Reopen with the new key.
    let conn = open_connection(&path)?;
    apply_key(&conn, new_key)?;
    apply_pragmas(&conn)?;
    smoke_test(&conn)?;
    g.conn = Some(conn);
    Ok(())
}

/// Decrypt a SQLCipher-encrypted DB into plaintext (used when the user
/// removes their master password).
pub fn decrypt_inplace(current_key: &SecretKey) -> AppResult<()> {
    let mut g = STATE.get().expect("db slot not initialized").lock();
    let path = g.path.clone();
    g.conn.take();
    let plain_path = path.with_extension("db.dec");
    if plain_path.exists() {
        std::fs::remove_file(&plain_path)?;
    }

    let src = open_connection(&path)?;
    apply_key(&src, current_key)?;
    apply_pragmas(&src)?;
    smoke_test(&src)?;

    let attach = format!(
        "ATTACH DATABASE '{}' AS plaintext KEY '';",
        plain_path.to_string_lossy().replace('\'', "''"),
    );
    src.execute_batch(&attach)?;
    src.execute_batch("SELECT sqlcipher_export('plaintext');")?;
    let user_version: i64 =
        src.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    src.execute_batch(&format!(
        "PRAGMA plaintext.user_version = {user_version};"
    ))?;
    src.execute_batch("DETACH DATABASE plaintext;")?;
    drop(src);

    let backup = path.with_extension("db.predec");
    if backup.exists() {
        std::fs::remove_file(&backup)?;
    }
    std::fs::rename(&path, &backup)?;
    std::fs::rename(&plain_path, &path)?;
    std::fs::remove_file(&backup).ok();

    let conn = open_connection(&path)?;
    apply_pragmas(&conn)?;
    smoke_test(&conn)?;
    g.conn = Some(conn);
    Ok(())
}

/// Re-key an already-encrypted DB to a new key. Cheap (rewrites only
/// the page-key headers, not the data).
pub fn rekey(new_key: &SecretKey) -> AppResult<()> {
    let g = STATE.get().expect("db slot not initialized").lock();
    let conn = g
        .conn
        .as_ref()
        .ok_or_else(|| crate::AppError::InvalidArg("db is locked".into()))?;
    let pragma = format!("PRAGMA rekey = {};", new_key.to_sqlcipher_pragma());
    conn.execute_batch(&pragma)?;
    Ok(())
}

pub fn is_open() -> bool {
    STATE
        .get()
        .map(|s| s.lock().conn.is_some())
        .unwrap_or(false)
}

/// Run a closure with the current connection. Returns `AppError::InvalidArg`
/// when the vault is locked — callers can `?`-propagate it so the UI gets a
/// clean error instead of the process aborting (Tauri sync commands run in
/// the WebView2 `extern "system"` callback, which can't unwind across FFI).
pub fn with_conn<F, R>(f: F) -> AppResult<R>
where
    F: FnOnce(&Connection) -> AppResult<R>,
{
    let g = STATE.get().expect("db slot not initialized").lock();
    let conn = g
        .conn
        .as_ref()
        .ok_or_else(|| crate::AppError::InvalidArg("vault is locked".into()))?;
    f(conn)
}

/// Like `with_conn` but returns `None` when locked instead of an error.
#[allow(dead_code)]
pub fn try_with_conn<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&Connection) -> R,
{
    let g = STATE.get().expect("db slot not initialized").lock();
    g.conn.as_ref().map(f)
}
