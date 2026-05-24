//! `.trovebackup` export / import.
//!
//! Format (zip):
//!   manifest.json — schema + app version + epoch + flags
//!   db.sqlite     — verbatim copy of trove.db (encrypted databases stay
//!                    encrypted — the consumer must know the master pwd)
//!   thumbs/...    — cached thumbnails if present
//!
//! Export keeps the live DB connection open and runs
//! `PRAGMA wal_checkpoint(TRUNCATE)` first so the file on disk is a
//! consistent snapshot. Import moves the current files aside to
//! `<data_dir>/backups/<ts>/` before overwriting, so a failed import can
//! always be rolled back manually.

use crate::{db, AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const MANIFEST_NAME: &str = "manifest.json";
pub const DB_NAME: &str = "db.sqlite";
pub const VAULT_NAME: &str = "vault.json";
pub const THUMBS_DIR: &str = "thumbs";
pub const BACKUP_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub schema_version: u32,
    pub app_version: String,
    pub exported_at: u64,
    pub db_encrypted: bool,
    pub includes_thumbs: bool,
    /// Whether the vault.json was bundled. When true, the importer can
    /// restore a fully-functional encrypted DB *and* know which master
    /// password verifies it.
    pub includes_vault: bool,
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Run a WAL checkpoint so the main DB file contains every committed page.
pub fn checkpoint_db() -> AppResult<()> {
    db::with_conn(|conn| {
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    })
}

/// Write a `.trovebackup` zip to `dest`.
pub fn write_backup_zip(
    dest: &Path,
    data_dir: &Path,
    app_version: &str,
    db_encrypted: bool,
) -> AppResult<u64> {
    let db_path = data_dir.join("trove.db");
    if !db_path.is_file() {
        return Err(AppError::NotFound(format!(
            "trove.db not found at {}",
            db_path.display()
        )));
    }

    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let file = fs::File::create(dest)?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let vault_path = data_dir.join(VAULT_NAME);
    let thumbs_path = data_dir.join(THUMBS_DIR);
    let includes_vault = vault_path.is_file();
    let includes_thumbs = thumbs_path.is_dir();

    let manifest = BackupManifest {
        schema_version: BACKUP_SCHEMA_VERSION,
        app_version: app_version.to_string(),
        exported_at: now_epoch_secs(),
        db_encrypted,
        includes_thumbs,
        includes_vault,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| AppError::Other(anyhow::anyhow!("manifest json: {e}")))?;

    zip.start_file(MANIFEST_NAME, opts)
        .map_err(|e| AppError::Other(anyhow::anyhow!("zip start manifest: {e}")))?;
    zip.write_all(&manifest_bytes)?;

    zip.start_file(DB_NAME, opts)
        .map_err(|e| AppError::Other(anyhow::anyhow!("zip start db: {e}")))?;
    let mut db_file = fs::File::open(&db_path)?;
    std::io::copy(&mut db_file, &mut zip)?;

    if includes_vault {
        zip.start_file(VAULT_NAME, opts)
            .map_err(|e| AppError::Other(anyhow::anyhow!("zip start vault: {e}")))?;
        let mut vf = fs::File::open(&vault_path)?;
        std::io::copy(&mut vf, &mut zip)?;
    }

    if includes_thumbs {
        for entry in fs::read_dir(&thumbs_path)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name();
            let arcname = format!("{}/{}", THUMBS_DIR, name.to_string_lossy());
            zip.start_file(&arcname, opts)
                .map_err(|e| AppError::Other(anyhow::anyhow!("zip start {arcname}: {e}")))?;
            let mut f = fs::File::open(entry.path())?;
            std::io::copy(&mut f, &mut zip)?;
        }
    }

    let writer = zip
        .finish()
        .map_err(|e| AppError::Other(anyhow::anyhow!("zip finish: {e}")))?;
    drop(writer);

    let size = fs::metadata(dest)?.len();
    Ok(size)
}

#[derive(Debug)]
pub struct ParsedBackup {
    pub manifest: BackupManifest,
    pub temp_dir: PathBuf,
}

/// Extract `.trovebackup` into a fresh temp directory under `<data_dir>/.import-tmp-<ts>/`,
/// validate the manifest, return paths so the caller can move the files into place.
pub fn read_backup_zip(src: &Path, data_dir: &Path) -> AppResult<ParsedBackup> {
    let f = fs::File::open(src)?;
    let mut zip = ZipArchive::new(f)
        .map_err(|e| AppError::InvalidArg(format!("not a valid zip: {e}")))?;

    let scratch = data_dir.join(format!(".import-tmp-{}", now_epoch_secs()));
    if scratch.exists() {
        fs::remove_dir_all(&scratch)?;
    }
    fs::create_dir_all(&scratch)?;

    let mut manifest: Option<BackupManifest> = None;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| AppError::InvalidArg(format!("zip entry {i}: {e}")))?;
        let name = entry
            .enclosed_name()
            .ok_or_else(|| AppError::InvalidArg("zip contains unsafe path".into()))?
            .to_path_buf();
        if name.as_os_str().is_empty() {
            continue;
        }
        let out_path = scratch.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(p) = out_path.parent() {
            fs::create_dir_all(p)?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        if name == Path::new(MANIFEST_NAME) {
            manifest = Some(serde_json::from_slice(&buf).map_err(|e| {
                AppError::InvalidArg(format!("manifest parse: {e}"))
            })?);
        }
        fs::write(&out_path, &buf)?;
    }

    let manifest = manifest.ok_or_else(|| {
        AppError::InvalidArg(format!("backup missing {MANIFEST_NAME}"))
    })?;
    if manifest.schema_version != BACKUP_SCHEMA_VERSION {
        return Err(AppError::InvalidArg(format!(
            "unsupported backup schema_version: {}",
            manifest.schema_version
        )));
    }
    if !scratch.join(DB_NAME).is_file() {
        return Err(AppError::InvalidArg(format!("backup missing {DB_NAME}")));
    }

    Ok(ParsedBackup {
        manifest,
        temp_dir: scratch,
    })
}

/// Move trove.db / vault.json / thumbs/ aside into `<data_dir>/backups/<ts>/`.
/// Returns the backup dir so the caller can include it in the response.
pub fn move_aside_current(data_dir: &Path) -> AppResult<PathBuf> {
    let backup_dir = data_dir.join("backups").join(now_epoch_secs().to_string());
    fs::create_dir_all(&backup_dir)?;

    for name in [DB_NAME_LIVE, VAULT_NAME] {
        let src = data_dir.join(name);
        if src.exists() {
            fs::rename(&src, backup_dir.join(name))?;
        }
    }
    // WAL/SHM siblings if they linger after the close
    for sibling in ["trove.db-wal", "trove.db-shm"] {
        let src = data_dir.join(sibling);
        if src.exists() {
            fs::rename(&src, backup_dir.join(sibling))?;
        }
    }
    let thumbs = data_dir.join(THUMBS_DIR);
    if thumbs.is_dir() {
        fs::rename(&thumbs, backup_dir.join(THUMBS_DIR))?;
    }

    Ok(backup_dir)
}

const DB_NAME_LIVE: &str = "trove.db";

/// Copy extracted files into `data_dir`. Caller is responsible for having
/// already closed the DB connection and called [move_aside_current].
pub fn install_extracted(data_dir: &Path, extracted: &Path) -> AppResult<u64> {
    let db_src = extracted.join(DB_NAME);
    fs::copy(&db_src, data_dir.join(DB_NAME_LIVE))?;
    let db_bytes = fs::metadata(data_dir.join(DB_NAME_LIVE))?.len();

    let vault_src = extracted.join(VAULT_NAME);
    if vault_src.is_file() {
        fs::copy(&vault_src, data_dir.join(VAULT_NAME))?;
    }

    let thumbs_src = extracted.join(THUMBS_DIR);
    if thumbs_src.is_dir() {
        let thumbs_dst = data_dir.join(THUMBS_DIR);
        fs::create_dir_all(&thumbs_dst)?;
        for entry in fs::read_dir(&thumbs_src)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                fs::copy(entry.path(), thumbs_dst.join(entry.file_name()))?;
            }
        }
    }

    Ok(db_bytes)
}

pub fn cleanup_temp(path: &Path) {
    let _ = fs::remove_dir_all(path);
}
