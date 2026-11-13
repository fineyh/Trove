//! Library connections (ADR-038).
//!
//! Each library is one SQLCipher file, `<data>/libraries/<id>.db`, keyed by
//! its own data key. A library is either open (it has a connection here) or
//! locked (it doesn't) — there is no third state. Every query names the
//! library it runs against; background jobs hold the id and re-resolve it on
//! each call, so locking a library underneath them just makes their next call
//! fail with "locked" instead of touching a closed file.

mod migrations;

use crate::services::crypto::SecretKey;
use crate::{AppError, AppResult};
use once_cell::sync::{Lazy, OnceCell};
use parking_lot::{Mutex, RwLock};
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use zeroize::Zeroizing;


struct Library {
    conn: Mutex<Connection>,
}

static DATA_DIR: OnceCell<PathBuf> = OnceCell::new();
static OPEN: Lazy<RwLock<HashMap<String, Arc<Library>>>> = Lazy::new(|| RwLock::new(HashMap::new()));
/// Id of the main library; set once the keyring is loaded.
static MAIN: OnceCell<RwLock<String>> = OnceCell::new();

pub fn init(data_dir: &Path) -> AppResult<()> {
    // Set first: the boot-error screen still needs the path when the
    // directory can't be created.
    let _ = DATA_DIR.set(data_dir.to_path_buf());
    std::fs::create_dir_all(data_dir.join("libraries"))?;
    Ok(())
}

pub fn data_dir() -> PathBuf {
    DATA_DIR.get().expect("db not initialized").clone()
}

pub fn set_main(id: &str) {
    match MAIN.get() {
        Some(m) => *m.write() = id.to_string(),
        None => {
            let _ = MAIN.set(RwLock::new(id.to_string()));
        }
    }
}

pub fn main_id() -> String {
    MAIN.get().map(|m| m.read().clone()).unwrap_or_default()
}

pub fn lib_path(id: &str) -> PathBuf {
    data_dir().join("libraries").join(format!("{id}.db"))
}

fn key_pragma(verb: &str, key: &SecretKey) -> Zeroizing<String> {
    Zeroizing::new(format!("PRAGMA {verb} = \"x'{}'\";", hex::encode(key.as_bytes())))
}

pub(crate) fn apply_key(conn: &Connection, key: &SecretKey) -> rusqlite::Result<()> {
    conn.execute_batch(&key_pragma("key", key))
}

fn apply_pragmas(conn: &Connection) -> rusqlite::Result<()> {
    // temp_store: sorts and temp indexes stay in memory instead of plaintext
    // temp files. secure_delete: freed pages are zeroed, so moving a
    // conversation out of a library leaves nothing recoverable behind.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;
         PRAGMA secure_delete = ON;",
    )
}

/// SQLCipher accepts any key at `PRAGMA key` time; a wrong one only shows up
/// on the first real page read.
fn smoke_test(conn: &Connection) -> rusqlite::Result<()> {
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
    Ok(())
}

fn connect(path: &Path, key: &SecretKey) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    apply_key(&conn, key)?;
    smoke_test(&conn).map_err(|_| AppError::InvalidArg("库文件无法用这把钥匙打开".into()))?;
    apply_pragmas(&conn)?;
    Ok(conn)
}

/// Open (creating if needed) a library and bring its schema up to date.
pub fn open(id: &str, key: &SecretKey) -> AppResult<()> {
    if is_open(id) {
        return Ok(());
    }
    let conn = connect(&lib_path(id), key)?;
    migrations::run(&conn)?;
    OPEN.write().insert(id.to_string(), Arc::new(Library { conn: Mutex::new(conn) }));
    Ok(())
}

#[cfg(test)]
pub fn run_migrations_for_test(conn: &Connection) {
    migrations::run(conn).unwrap();
}

/// Drop the connection. In-flight queries finish first (they hold the Arc).
pub fn close(id: &str) {
    if let Some(lib) = OPEN.write().remove(id) {
        // Fold the WAL back so no recently written pages linger beside the
        // file longer than they need to (they're encrypted either way).
        let _ = lib.conn.lock().execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
}

pub fn close_all() {
    let ids: Vec<String> = OPEN.read().keys().cloned().collect();
    for id in ids {
        close(&id);
    }
}

pub fn is_open(id: &str) -> bool {
    OPEN.read().contains_key(id)
}

pub fn open_ids() -> Vec<String> {
    OPEN.read().keys().cloned().collect()
}

fn get(id: &str) -> AppResult<Arc<Library>> {
    OPEN.read()
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::Locked(id.to_string()))
}

/// Run `f` against library `id`. Fails with [`AppError::Locked`] when the
/// library isn't open.
pub fn with_lib<F, R>(id: &str, f: F) -> AppResult<R>
where
    F: FnOnce(&Connection) -> AppResult<R>,
{
    let lib = get(id)?;
    let conn = lib.conn.lock();
    f(&conn)
}

/// The main library holds app-wide state: settings, identity, library list.
pub fn with_main<F, R>(f: F) -> AppResult<R>
where
    F: FnOnce(&Connection) -> AppResult<R>,
{
    with_lib(&main_id(), f)
}

/// Copy a plaintext SQLite file into a new encrypted library file. The
/// source is left as it was; the caller decides what happens to it.
pub fn import_plaintext(src: &Path, id: &str, key: &SecretKey) -> AppResult<()> {
    let dst = lib_path(id);
    if dst.exists() {
        return Err(AppError::InvalidArg(format!("library file already exists: {id}")));
    }
    if !src.is_file() {
        return Err(AppError::NotFound(src.to_string_lossy().to_string()));
    }
    // CREATE is for the attached target: an ATTACHed database is opened with
    // the main connection's flags, so without it SQLite can't create `dst`
    // and the export fails with "unable to open database".
    let conn = Connection::open_with_flags(
        src,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    // Fold the WAL in first so the export sees every committed row.
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let attach = Zeroizing::new(format!(
        "ATTACH DATABASE '{}' AS lib KEY \"x'{}'\";",
        dst.to_string_lossy().replace('\'', "''"),
        hex::encode(key.as_bytes())
    ));
    conn.execute_batch(&attach)?;
    let res = conn.execute_batch(&format!(
        "SELECT sqlcipher_export('lib'); PRAGMA lib.user_version = {user_version};"
    ));
    conn.execute_batch("DETACH DATABASE lib;")?;
    if let Err(e) = res {
        drop(conn);
        let _ = std::fs::remove_file(&dst);
        return Err(e.into());
    }
    Ok(())
}

/// Remove a library file and its WAL / SHM companions. The library must be
/// closed first.
pub fn delete_files(id: &str) -> AppResult<()> {
    let p = lib_path(id);
    for suffix in ["", "-wal", "-shm"] {
        let f = PathBuf::from(format!("{}{suffix}", p.to_string_lossy()));
        if f.exists() {
            std::fs::remove_file(&f)?;
        }
    }
    Ok(())
}

/// Write a consistent copy of an open library to `dst`, encrypted under
/// `key` (normally the library's own key). `sqlcipher_export` rather than
/// `VACUUM INTO`, whose output encryption SQLCipher doesn't promise.
pub fn snapshot(id: &str, dst: &Path, key: &SecretKey) -> AppResult<()> {
    if dst.exists() {
        std::fs::remove_file(dst)?;
    }
    with_lib(id, |conn| {
        let user_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let attach = Zeroizing::new(format!(
            "ATTACH DATABASE '{}' AS snap KEY \"x'{}'\";",
            dst.to_string_lossy().replace('\'', "''"),
            hex::encode(key.as_bytes())
        ));
        conn.execute_batch(&attach)?;
        let res = conn.execute_batch(&format!(
            "SELECT sqlcipher_export('snap'); PRAGMA snap.user_version = {user_version};"
        ));
        conn.execute_batch("DETACH DATABASE snap;")?;
        res?;
        Ok(())
    })
}

#[cfg(test)]
mod import_tests {
    use super::*;

    /// The first-run migration exports the old plaintext `trove.db` into a
    /// library file that doesn't exist yet. It once failed on every machine:
    /// the attached target inherits the source connection's open flags, and
    /// without CREATE SQLite can't make the file.
    #[test]
    fn import_plaintext_creates_the_encrypted_library() {
        let dir = std::env::temp_dir().join(format!("trove-import-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        init(&dir).unwrap();
        std::fs::create_dir_all(data_dir().join("libraries")).unwrap();

        let src = dir.join("plain.db");
        let c = Connection::open(&src).unwrap();
        c.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE t (x);
             INSERT INTO t VALUES (1), (2), (3);
             PRAGMA user_version = 5;",
        )
        .unwrap();
        drop(c);

        let id = format!("import-{}", std::process::id());
        let key = SecretKey::random();
        import_plaintext(&src, &id, &key).unwrap();

        let conn = connect(&lib_path(&id), &key).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0)).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!((n, v), (3, 5));
        drop(conn);

        let mut header = [0u8; 16];
        std::io::Read::read_exact(&mut std::fs::File::open(lib_path(&id)).unwrap(), &mut header).unwrap();
        assert_ne!(&header, b"SQLite format 3 ", "library file must be encrypted");
        let _ = delete_files(&id);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
