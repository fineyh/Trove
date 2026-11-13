//! Who is unlocked right now, and the operations that change it (ADR-036/038).
//!
//! Holds the keyring, the application key (while the app is unlocked) and the
//! data key of every open library. Everything that touches the keyring goes
//! through here so the in-memory copy and the file on disk never disagree.

use crate::db;
use crate::services::crypto::SecretKey;
use crate::services::keyring::{self, Keyring, Secret, Slot, SlotKind, WrongSecret};
use crate::{events, AppError, AppResult};
use anyhow::anyhow;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const LEGACY_DB: &str = "trove.db";
/// Where the pre-library plaintext database goes after migration. Kept (not
/// deleted) until the user removes it from the security settings.
pub const LEGACY_PLAIN_COPY: &str = "trove.db.legacy-plain";
const DEFAULT_MAIN_NAME: &str = "主库";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UnlockedBy {
    App,
    Password,
    Recovery,
    Keyfile,
}

struct State {
    data_dir: PathBuf,
    keyring: Keyring,
    ak: Option<SecretKey>,
    /// Data keys of open libraries, and how each was opened.
    keys: HashMap<String, (SecretKey, UnlockedBy)>,
    /// Set when an old `trove.db` was found but couldn't be migrated.
    legacy_problem: Option<String>,
}

static STATE: OnceCell<RwLock<State>> = OnceCell::new();

fn st() -> &'static RwLock<State> {
    STATE.get().expect("session not initialized")
}

fn map_secret_err(e: anyhow::Error) -> AppError {
    if e.downcast_ref::<WrongSecret>().is_some() {
        AppError::InvalidArg(e.to_string())
    } else {
        AppError::Other(e)
    }
}

fn save(s: &State) -> AppResult<()> {
    s.keyring.save(&s.data_dir).map_err(AppError::Other)
}

// ─── boot ───────────────────────────────────────────────────────────────────

/// What went wrong at startup, for the error screen (ADR-045). The screen
/// words each kind itself; `detail` is the raw error, shown folded away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BootErrorKind {
    /// Library files but no keyring.
    KeyringMissing,
    /// Keyring and its mirror both unreadable.
    KeyringDamaged,
    /// Keyring or library written by a newer Trove.
    NewerVersion,
    /// The main library won't open with its key.
    LibraryUnreadable,
    /// The data folder itself can't be read or written.
    DataDir,
    Other,
}

#[derive(Debug, Clone)]
pub struct BootFailure {
    pub kind: BootErrorKind,
    pub detail: String,
}

impl BootFailure {
    fn new(kind: BootErrorKind, e: impl Into<AppError>) -> Self {
        let e = e.into();
        // Wherever it surfaced, "made by a newer version" has one remedy.
        let newer = matches!(&e, AppError::Other(a) if a.downcast_ref::<crate::error::NewerData>().is_some());
        let kind = match (&e, newer) {
            (_, true) => BootErrorKind::NewerVersion,
            (AppError::Io(_), _) => BootErrorKind::DataDir,
            _ => kind,
        };
        let detail = match &e {
            AppError::InvalidArg(s) | AppError::NotFound(s) => s.clone(),
            AppError::Other(a) => format!("{a:#}"),
            other => other.to_string(),
        };
        Self { kind, detail }
    }
}

/// Load the keyring (creating it, or migrating the pre-library `trove.db`,
/// on first run) and open everything that opens without a password.
/// Returns true when the app is unlocked after boot.
pub fn boot(data_dir: &Path) -> Result<bool, BootFailure> {
    use BootErrorKind as K;
    db::init(data_dir).map_err(|e| BootFailure::new(K::DataDir, e))?;
    let mut legacy_problem = None;
    let loaded = Keyring::load_or_restore(data_dir).map_err(|e| BootFailure::new(K::KeyringDamaged, e))?;
    let (keyring, fresh_ak) = match loaded {
        Some((kr, restored)) => {
            if restored {
                log::warn!("keyring.json was missing or damaged; restored from {}", keyring::BACKUP_NAME);
            }
            (kr, None)
        }
        None => {
            // Library files with no keyring at all: making a fresh one would
            // look like an empty first run while the real libraries sit
            // there unopenable. Stop and say so instead.
            let n = library_file_count(data_dir);
            if n > 0 {
                return Err(BootFailure {
                    kind: K::KeyringMissing,
                    detail: format!("{} 不存在；libraries 中有 {n} 个库文件", keyring::FILE_NAME),
                });
            }
            first_run(data_dir, &mut legacy_problem).map_err(|e| BootFailure::new(K::Other, e))?
        }
    };
    db::set_main(&keyring.main);
    let ak = fresh_ak.or_else(|| keyring.open_app_key());
    STATE
        .set(RwLock::new(State {
            data_dir: data_dir.to_path_buf(),
            keyring,
            ak: None,
            keys: HashMap::new(),
            legacy_problem,
        }))
        .map_err(|_| BootFailure::new(K::Other, anyhow!("session already initialized")))?;

    match ak {
        Some(ak) => {
            open_app_libraries(ak).map_err(|e| BootFailure::new(K::LibraryUnreadable, e))?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// No keyring and no libraries: create both (migrating an old `trove.db`).
fn first_run(data_dir: &Path, legacy_problem: &mut Option<String>) -> AppResult<(Keyring, Option<SecretKey>)> {
    let (kr, ak, dek) = Keyring::fresh().map_err(AppError::Other)?;
    if let Err(e) = migrate_legacy(data_dir, &kr.main, &dek) {
        *legacy_problem = Some(e);
    }
    // The library file exists (migrated or empty); only now does the
    // keyring that can open it get written.
    db::set_main(&kr.main);
    db::open(&kr.main, &dek)?;
    db::with_main(|c| {
        c.execute(
            "INSERT OR IGNORE INTO libraries (id, name, sort, created_at) VALUES (?1, ?2, 0, ?3)",
            params![kr.main, DEFAULT_MAIN_NAME, now_ms()],
        )?;
        Ok(())
    })?;
    kr.save(data_dir).map_err(AppError::Other)?;
    db::close(&kr.main);
    Ok((kr, Some(ak)))
}

/// First run after upgrading: copy the old plaintext `trove.db` into the new
/// encrypted main library. Returns a user-facing problem description when
/// there is an old database we can't use (the new main library then starts
/// empty and the old file is left exactly where it was).
fn migrate_legacy(data_dir: &Path, main: &str, dek: &SecretKey) -> Result<(), String> {
    let legacy = data_dir.join(LEGACY_DB);
    if !legacy.is_file() {
        return Ok(());
    }
    if data_dir.join("vault.json").is_file() {
        return Err("旧版数据库设置过主密码，无法自动迁移。请用旧版本解除主密码后再升级。".into());
    }
    let mut header = [0u8; 16];
    let readable = std::fs::File::open(&legacy)
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut header))
        .is_ok();
    if !readable || &header != b"SQLite format 3\0" {
        return Err("发现无法识别的旧数据库 trove.db（可能是加密格式），已原样保留，没有迁移。".into());
    }
    db::import_plaintext(&legacy, main, dek).map_err(|e| format!("迁移旧数据库失败：{e}"))?;
    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", legacy.to_string_lossy()));
        if from.exists() {
            let to = data_dir.join(format!("{LEGACY_PLAIN_COPY}{suffix}"));
            let _ = std::fs::rename(&from, &to);
        }
    }
    Ok(())
}

fn library_file_count(data_dir: &Path) -> usize {
    std::fs::read_dir(data_dir.join("libraries"))
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "db"))
                .count()
        })
        .unwrap_or(0)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn open_app_libraries(ak: SecretKey) -> AppResult<()> {
    let ids = st().read().keyring.app_libraries();
    let mut opened = Vec::new();
    for id in ids {
        let dek = st()
            .read()
            .keyring
            .unwrap_with_app(&id, &ak)
            .map_err(AppError::Other)?;
        match db::open(&id, &dek) {
            Ok(()) => opened.push((id, dek)),
            Err(e) => {
                // One bad library must not keep the app shut; the main one must.
                if id == db::main_id() {
                    return Err(e);
                }
                log::warn!("open library {id}: {e}");
            }
        }
    }
    let mut s = st().write();
    s.ak = Some(ak);
    for (id, dek) in opened {
        s.keys.insert(id, (dek, UnlockedBy::App));
    }
    drop(s);
    ensure_library_rows()?;
    Ok(())
}

/// The keyring is the source of truth for which libraries exist; make sure
/// every one has a row (name) in the main library, and drop rows for
/// libraries the keyring no longer knows.
fn ensure_library_rows() -> AppResult<()> {
    let ids: Vec<String> = st().read().keyring.libraries.iter().map(|l| l.id.clone()).collect();
    let main = db::main_id();
    db::with_main(|c| {
        let now = now_ms();
        for (i, id) in ids.iter().enumerate() {
            let name = if *id == main { DEFAULT_MAIN_NAME.to_string() } else { format!("库 {}", i + 1) };
            c.execute(
                "INSERT OR IGNORE INTO libraries (id, name, sort, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, i as i64, now],
            )?;
        }
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        c.execute(
            &format!("DELETE FROM libraries WHERE id NOT IN ({placeholders})"),
            rusqlite::params_from_iter(ids.iter()),
        )?;
        Ok(())
    })
}

// ─── app-level lock ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    pub app_password: bool,
    pub app_unlocked: bool,
    pub app_recovery: bool,
    pub main_library: String,
    /// The plaintext pre-migration database is still on disk.
    pub legacy_plain_copy: bool,
    pub legacy_problem: Option<String>,
}

pub fn status() -> SecurityStatus {
    let s = st().read();
    SecurityStatus {
        app_password: s.keyring.has_app_password(),
        app_unlocked: s.ak.is_some(),
        app_recovery: s.keyring.app_has_recovery(),
        main_library: s.keyring.main.clone(),
        legacy_plain_copy: s.data_dir.join(LEGACY_PLAIN_COPY).exists(),
        legacy_problem: s.legacy_problem.clone(),
    }
}

/// Works after a failed boot too (import from backup needs it there).
pub fn data_dir() -> PathBuf {
    db::data_dir()
}

// ─── failed boot ────────────────────────────────────────────────────────────

/// Why `boot` failed. The window still opens and shows only this, with ways
/// out (open the data folder, restore a backup); nothing else may run, since
/// the session was never set up.
static BOOT_ERROR: OnceCell<BootFailure> = OnceCell::new();

pub fn set_boot_error(f: BootFailure) {
    let _ = BOOT_ERROR.set(f);
}

pub fn boot_error() -> Option<BootFailure> {
    BOOT_ERROR.get().cloned()
}

pub fn is_app_unlocked() -> bool {
    st().read().ak.is_some()
}

pub fn unlock_app(secret: &Secret) -> AppResult<()> {
    if is_app_unlocked() {
        return Ok(());
    }
    let ak = st().read().keyring.unlock_app(secret).map_err(map_secret_err)?;
    open_app_libraries(ak)
}

/// Lock everything: every library closes and the AK is forgotten. Only
/// meaningful with a startup password (otherwise the AK is on disk anyway).
pub fn lock_app() -> AppResult<()> {
    if !st().read().keyring.has_app_password() {
        return Err(AppError::InvalidArg("没有设置启动密码，无法锁定应用".into()));
    }
    crate::services::file_watcher::stop_all();
    db::close_all();
    let mut s = st().write();
    s.keys.clear();
    s.ak = None;
    drop(s);
    events::emit_security_changed();
    Ok(())
}

fn require_ak() -> AppResult<SecretKey> {
    st().read()
        .ak
        .clone()
        .ok_or_else(|| AppError::Locked("app".into()))
}

/// Turn on the startup password. Returns the recovery code (show once).
pub fn set_app_password(password: &str) -> AppResult<String> {
    let ak = require_ak()?;
    let mut s = st().write();
    if s.keyring.has_app_password() {
        return Err(AppError::InvalidArg("已经设置了启动密码".into()));
    }
    let mut kr = s.keyring.clone();
    let code = kr.seal_app(&ak, password).map_err(AppError::Other)?;
    s.keyring = kr;
    save(&s)?;
    Ok(code)
}

fn verify_app_password(password: &str) -> AppResult<()> {
    st().read()
        .keyring
        .unlock_app(&Secret::Password(password))
        .map(|_| ())
        .map_err(map_secret_err)
}

pub fn change_app_password(old: &str, new: &str) -> AppResult<()> {
    let ak = require_ak()?;
    verify_app_password(old)?;
    let mut s = st().write();
    let mut kr = s.keyring.clone();
    kr.change_app_password(&ak, new).map_err(AppError::Other)?;
    s.keyring = kr;
    save(&s)
}

pub fn remove_app_password(password: &str) -> AppResult<()> {
    let ak = require_ak()?;
    verify_app_password(password)?;
    let mut s = st().write();
    s.keyring.unseal_app(&ak);
    save(&s)
}

pub fn reset_app_recovery(password: &str) -> AppResult<String> {
    let ak = require_ak()?;
    verify_app_password(password)?;
    let mut s = st().write();
    let mut kr = s.keyring.clone();
    let code = kr.reset_app_recovery(&ak).map_err(AppError::Other)?;
    s.keyring = kr;
    save(&s)?;
    Ok(code)
}

pub fn delete_legacy_copy() -> AppResult<()> {
    let dir = data_dir();
    for suffix in ["", "-wal", "-shm"] {
        let p = dir.join(format!("{LEGACY_PLAIN_COPY}{suffix}"));
        if p.exists() {
            std::fs::remove_file(&p)?;
        }
    }
    Ok(())
}

// ─── libraries ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_main: bool,
    /// Has its own password (doesn't open with the app).
    pub encrypted: bool,
    pub unlocked: bool,
    pub unlocked_by: Option<UnlockedBy>,
    pub has_recovery: bool,
    pub keyfile_path: Option<String>,
}

pub fn list_libraries() -> AppResult<Vec<LibraryInfo>> {
    let rows: Vec<(String, String, Option<String>, Option<String>)> = db::with_main(|c| {
        let mut stmt = c.prepare("SELECT id, name, icon, color FROM libraries ORDER BY sort, created_at")?;
        let r = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })?;
    let s = st().read();
    let main = s.keyring.main.clone();
    Ok(rows
        .into_iter()
        .filter_map(|(id, name, icon, color)| {
            let entry = s.keyring.library(&id)?;
            let open = s.keys.get(&id);
            Some(LibraryInfo {
                is_main: id == main,
                encrypted: !entry.is_normal(),
                unlocked: open.is_some(),
                unlocked_by: open.map(|(_, by)| *by),
                has_recovery: entry.has(SlotKind::Recovery),
                keyfile_path: entry.keyfile().map(|(_, _, p)| p.to_string()),
                id,
                name,
                icon,
                color,
            })
        })
        .collect())
}

fn check_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::InvalidArg("库名不能为空".into()));
    }
    Ok(n.chars().take(40).collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedLibrary {
    pub id: String,
    pub recovery_code: Option<String>,
}

pub fn create_library(
    name: &str,
    icon: Option<String>,
    color: Option<String>,
    password: Option<&str>,
) -> AppResult<CreatedLibrary> {
    let name = check_name(name)?;
    let ak = require_ak()?;
    let id = keyring::random_id();
    let dek = SecretKey::random();
    let (slots, code, by) = match password {
        Some(pw) => {
            let p = keyring::password_slot(&id, pw, &dek).map_err(AppError::Other)?;
            let (r, code) = keyring::recovery_slot(&id, &dek).map_err(AppError::Other)?;
            (vec![p, r], Some(code), UnlockedBy::Password)
        }
        None => (
            vec![keyring::app_slot(&id, &ak, &dek).map_err(AppError::Other)?],
            None,
            UnlockedBy::App,
        ),
    };
    db::open(&id, &dek)?;
    {
        let mut s = st().write();
        s.keyring.libraries.push(keyring::LibraryEntry { id: id.clone(), slots });
        if let Err(e) = save(&s) {
            s.keyring.libraries.retain(|l| l.id != id);
            drop(s);
            db::close(&id);
            let _ = db::delete_files(&id);
            return Err(e);
        }
        s.keys.insert(id.clone(), (dek, by));
    }
    let sort: i64 = db::with_main(|c| {
        Ok(c.query_row("SELECT COALESCE(MAX(sort), 0) + 1 FROM libraries", [], |r| r.get(0))?)
    })?;
    db::with_main(|c| {
        c.execute(
            "INSERT OR REPLACE INTO libraries (id, name, icon, color, sort, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, icon, color, sort, now_ms()],
        )?;
        Ok(())
    })?;
    events::emit_libraries_changed();
    Ok(CreatedLibrary { id, recovery_code: code })
}

pub fn update_library(id: &str, name: Option<&str>, icon: Option<String>, color: Option<String>) -> AppResult<()> {
    let name = name.map(check_name).transpose()?;
    db::with_main(|c| {
        if let Some(n) = name {
            c.execute("UPDATE libraries SET name = ?1 WHERE id = ?2", params![n, id])?;
        }
        if let Some(i) = icon {
            c.execute("UPDATE libraries SET icon = ?1 WHERE id = ?2", params![i, id])?;
        }
        if let Some(col) = color {
            c.execute("UPDATE libraries SET color = ?1 WHERE id = ?2", params![col, id])?;
        }
        Ok(())
    })?;
    events::emit_libraries_changed();
    Ok(())
}

pub fn reorder_libraries(ids: &[String]) -> AppResult<()> {
    db::with_main(|c| {
        for (i, id) in ids.iter().enumerate() {
            c.execute("UPDATE libraries SET sort = ?1 WHERE id = ?2", params![i as i64, id])?;
        }
        Ok(())
    })?;
    events::emit_libraries_changed();
    Ok(())
}

pub fn unlock_library(id: &str, secret: &Secret) -> AppResult<()> {
    require_ak()?;
    if db::is_open(id) {
        return Ok(());
    }
    let dek = st().read().keyring.unwrap_with(id, secret).map_err(map_secret_err)?;
    let by = match secret {
        Secret::Password(_) => UnlockedBy::Password,
        Secret::Recovery(_) => UnlockedBy::Recovery,
        Secret::Keyfile(_) => UnlockedBy::Keyfile,
    };
    db::open(id, &dek)?;
    st().write().keys.insert(id.to_string(), (dek, by));
    crate::commands::spawn_library_tasks(id.to_string());
    events::emit_libraries_changed();
    Ok(())
}

/// Lock one encrypted library. Normal libraries open and close with the app.
pub fn lock_library(id: &str) -> AppResult<()> {
    let normal = st()
        .read()
        .keyring
        .library(id)
        .map(|l| l.is_normal())
        .ok_or_else(|| AppError::NotFound(format!("library {id}")))?;
    if normal {
        return Err(AppError::InvalidArg("这个库没有设置密码，随应用一起打开".into()));
    }
    crate::services::file_watcher::stop_library(id);
    db::close(id);
    st().write().keys.remove(id);
    events::emit_libraries_changed();
    Ok(())
}

pub fn library_key(id: &str) -> Option<SecretKey> {
    st().read().keys.get(id).map(|(k, _)| k.clone())
}

fn require_open(id: &str) -> AppResult<SecretKey> {
    library_key(id).ok_or_else(|| AppError::Locked(id.to_string()))
}

/// Give a normal library its own password. The contents are re-encrypted
/// into a new file under a new data key and a new id, and the keyring swap
/// is the single atomic step: until it lands the old library is untouched,
/// after it the old file is just garbage. A copy of the old keyring therefore
/// can't open anything written from now on.
pub fn set_library_password(id: &str, password: &str) -> AppResult<CreatedLibrary> {
    if id == db::main_id() {
        return Err(AppError::InvalidArg("主库跟随应用；要保护主库请设置启动密码".into()));
    }
    require_open(id)?;
    let new_id = keyring::random_id();
    let new_dek = SecretKey::random();
    let p = keyring::password_slot(&new_id, password, &new_dek).map_err(AppError::Other)?;
    let (r, code) = keyring::recovery_slot(&new_id, &new_dek).map_err(AppError::Other)?;

    crate::services::file_watcher::stop_library(id);
    db::snapshot(id, &db::lib_path(&new_id), &new_dek)?;
    swap_library(id, &new_id, vec![p, r], new_dek, UnlockedBy::Password)?;
    Ok(CreatedLibrary { id: new_id, recovery_code: Some(code) })
}

/// Replace library `old` by `new` (already written to disk) everywhere.
fn swap_library(old: &str, new: &str, slots: Vec<Slot>, dek: SecretKey, by: UnlockedBy) -> AppResult<()> {
    {
        let mut s = st().write();
        let mut kr = s.keyring.clone();
        let entry = kr.library_mut(old).map_err(AppError::Other)?;
        entry.id = new.to_string();
        entry.slots = slots;
        s.keyring = kr;
        if let Err(e) = save(&s) {
            drop(s);
            let _ = db::delete_files(new);
            return Err(e);
        }
        s.keys.remove(old);
    }
    db::close(old);
    let _ = db::delete_files(old);
    db::open(new, &dek)?;
    st().write().keys.insert(new.to_string(), (dek, by));
    db::with_main(|c| {
        c.execute("UPDATE libraries SET id = ?1 WHERE id = ?2", params![new, old])?;
        Ok(())
    })?;
    crate::commands::spawn_library_tasks(new.to_string());
    events::emit_libraries_changed();
    Ok(())
}

pub fn change_library_password(id: &str, old: &str, new: &str) -> AppResult<()> {
    let dek = require_open(id)?;
    let mut s = st().write();
    s.keyring.unwrap_with(id, &Secret::Password(old)).map_err(map_secret_err)?;
    let mut kr = s.keyring.clone();
    let entry = kr.library_mut(id).map_err(AppError::Other)?;
    entry.slots.retain(|sl| sl.kind() != SlotKind::Password);
    entry
        .slots
        .insert(0, keyring::password_slot(id, new, &dek).map_err(AppError::Other)?);
    s.keyring = kr;
    save(&s)
}

pub fn reset_library_recovery(id: &str, password: &str) -> AppResult<String> {
    let dek = require_open(id)?;
    let mut s = st().write();
    s.keyring.unwrap_with(id, &Secret::Password(password)).map_err(map_secret_err)?;
    let mut kr = s.keyring.clone();
    let entry = kr.library_mut(id).map_err(AppError::Other)?;
    entry.slots.retain(|sl| sl.kind() != SlotKind::Recovery);
    let (r, code) = keyring::recovery_slot(id, &dek).map_err(AppError::Other)?;
    entry.slots.push(r);
    s.keyring = kr;
    save(&s)?;
    Ok(code)
}

/// Encrypted → normal. Weakening needs no new data key.
pub fn remove_library_password(id: &str, password: &str) -> AppResult<()> {
    let ak = require_ak()?;
    let dek = require_open(id)?;
    let mut s = st().write();
    s.keyring.unwrap_with(id, &Secret::Password(password)).map_err(map_secret_err)?;
    let mut kr = s.keyring.clone();
    let entry = kr.library_mut(id).map_err(AppError::Other)?;
    entry.slots = vec![keyring::app_slot(id, &ak, &dek).map_err(AppError::Other)?];
    s.keyring = kr;
    save(&s)?;
    s.keys.insert(id.to_string(), (dek, UnlockedBy::App));
    drop(s);
    events::emit_libraries_changed();
    Ok(())
}

/// Create a key file in `dir` and add a `keyfile` slot for it. The library
/// must already have a password (so losing the file never loses the library).
pub fn set_library_keyfile(id: &str, dir: &Path) -> AppResult<String> {
    let dek = require_open(id)?;
    {
        let s = st().read();
        let entry = s.keyring.library(id).ok_or_else(|| AppError::NotFound(id.into()))?;
        if !entry.has(SlotKind::Password) {
            return Err(AppError::InvalidArg("先给库设置密码，再添加钥匙文件".into()));
        }
    }
    if !dir.is_dir() {
        return Err(AppError::InvalidArg(format!("不是文件夹：{}", dir.display())));
    }
    let name: String = db::with_main(|c| {
        Ok(c.query_row("SELECT name FROM libraries WHERE id = ?1", [id], |r| r.get(0))
            .unwrap_or_else(|_| "library".into()))
    })?;
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{} - Trove.trovekey", safe.trim()));
    let bytes = keyring::new_key_file_bytes();
    std::fs::write(&path, &bytes)?;
    let resolved = crate::services::volume_resolver::resolve(&path).map_err(AppError::InvalidArg)?;
    let last_path = path.to_string_lossy().to_string();
    let slot = keyring::keyfile_slot(id, &bytes, &dek, resolved.platform_id, resolved.relpath, last_path.clone())
        .map_err(AppError::Other)?;
    let mut s = st().write();
    let mut kr = s.keyring.clone();
    let entry = kr.library_mut(id).map_err(AppError::Other)?;
    entry.slots.retain(|sl| sl.kind() != SlotKind::Keyfile);
    entry.slots.push(slot);
    s.keyring = kr;
    if let Err(e) = save(&s) {
        let _ = std::fs::remove_file(&path);
        return Err(e);
    }
    if let Some(k) = s.keys.get_mut(id) {
        k.1 = UnlockedBy::Keyfile;
    }
    drop(s);
    events::emit_libraries_changed();
    Ok(last_path)
}

pub fn remove_library_keyfile(id: &str) -> AppResult<()> {
    let mut s = st().write();
    let mut kr = s.keyring.clone();
    kr.library_mut(id)
        .map_err(AppError::Other)?
        .slots
        .retain(|sl| sl.kind() != SlotKind::Keyfile);
    s.keyring = kr;
    save(&s)?;
    if let Some(k) = s.keys.get_mut(id) {
        if k.1 == UnlockedBy::Keyfile {
            k.1 = UnlockedBy::Password;
        }
    }
    drop(s);
    events::emit_libraries_changed();
    Ok(())
}

/// Delete a library for good. It must be open (proof the user can open it).
pub fn delete_library(id: &str) -> AppResult<()> {
    if id == db::main_id() {
        return Err(AppError::InvalidArg("主库不能删除".into()));
    }
    require_open(id)?;
    crate::services::file_watcher::stop_library(id);
    {
        let mut s = st().write();
        let mut kr = s.keyring.clone();
        kr.libraries.retain(|l| l.id != id);
        s.keyring = kr;
        save(&s)?;
        s.keys.remove(id);
    }
    db::close(id);
    db::delete_files(id)?;
    db::with_main(|c| {
        c.execute("DELETE FROM libraries WHERE id = ?1", [id])?;
        Ok(())
    })?;
    events::emit_libraries_changed();
    Ok(())
}

// ─── key files ──────────────────────────────────────────────────────────────

/// One pass of the key-file watcher: a key file that appeared opens its
/// library, one that disappeared locks the libraries it had opened. Polling
/// rather than mount events, because a Cryptomator drive can appear and
/// disappear without the OS telling anyone in a way we can hook portably.
pub fn poll_keyfiles() {
    if !is_app_unlocked() {
        return;
    }
    let entries: Vec<(String, String, String, String)> = {
        let s = st().read();
        s.keyring
            .libraries
            .iter()
            .filter_map(|l| {
                l.keyfile()
                    .map(|(v, r, p)| (l.id.clone(), v.to_string(), r.to_string(), p.to_string()))
            })
            .collect()
    };
    if entries.is_empty() {
        return;
    }
    for (id, volume, relpath, last_path) in entries {
        let path = locate_keyfile(&volume, &relpath, &last_path);
        let open_by = st().read().keys.get(&id).map(|(_, by)| *by);
        match (path, open_by) {
            (Some(p), None) => {
                if let Ok(bytes) = std::fs::read(&p) {
                    if let Err(e) = unlock_library(&id, &Secret::Keyfile(&bytes)) {
                        log::warn!("keyfile unlock {id}: {e}");
                    }
                }
            }
            (None, Some(UnlockedBy::Keyfile)) => {
                let _ = lock_library(&id);
            }
            _ => {}
        }
    }
}

fn locate_keyfile(volume: &str, relpath: &str, last_path: &str) -> Option<PathBuf> {
    let mounted = crate::services::volume_resolver::enumerate_mounted();
    if let Some(v) = mounted.iter().find(|v| v.platform_id == volume) {
        let p = crate::services::volume_resolver::absolute_for(&v.mount_point, relpath);
        if p.is_file() {
            return Some(p);
        }
    }
    let p = PathBuf::from(last_path);
    p.is_file().then_some(p)
}

pub fn start_keyfile_watcher() {
    let _ = std::thread::Builder::new()
        .name("trove-keyfiles".into())
        .spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            poll_keyfiles();
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::NewerData;

    #[test]
    fn boot_failures_are_classified_and_worded_plainly() {
        let newer = BootFailure::new(
            BootErrorKind::LibraryUnreadable,
            AppError::Other(NewerData { what: "库 schema", found: 7, supported: 6 }.into()),
        );
        assert_eq!(newer.kind, BootErrorKind::NewerVersion);

        let io = BootFailure::new(BootErrorKind::KeyringDamaged, std::io::Error::other("denied"));
        assert_eq!(io.kind, BootErrorKind::DataDir);

        let key = BootFailure::new(BootErrorKind::LibraryUnreadable, AppError::InvalidArg("库文件无法用这把钥匙打开".into()));
        assert_eq!(key.kind, BootErrorKind::LibraryUnreadable);
        assert_eq!(key.detail, "库文件无法用这把钥匙打开", "no \"invalid argument:\" prefix");
    }
}
