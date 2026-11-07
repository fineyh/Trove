//! `.trovebackup` export / import (ADR-036 §7).
//!
//! Format (zip):
//!   manifest.json            — format version, app version, time, flags
//!   keyring.json             — the keyring, possibly re-sealed (see below)
//!   libraries/<id>.db        — every library file, still ciphertext
//!
//! A backup is exactly as protected as the app itself: the library files are
//! encrypted, and the keyring that opens them is either sealed by the startup
//! password or (no startup password) holds the app key in the clear — same
//! as copying the data directory. The export can optionally seal *this
//! backup's* keyring with a password of its own.
//!
//! Media files are never in a backup; it holds the catalogue, not the
//! collection (the UI says so).

use crate::db;
use crate::services::keyring::{AppKey, Keyring};
use crate::services::session;
use crate::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const MANIFEST_NAME: &str = "manifest.json";
pub const FORMAT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub format_version: u32,
    pub app_version: String,
    pub exported_at: u64,
    /// The keyring inside needs a password (startup or backup password).
    pub password_protected: bool,
    pub libraries: usize,
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn zerr(e: impl std::fmt::Display) -> AppError {
    AppError::Other(anyhow::anyhow!("zip: {e}"))
}

pub struct ExportOutcome {
    pub bytes: u64,
    pub password_protected: bool,
}

/// Write a backup of every library to `dest`.
pub fn export(dest: &Path, app_version: &str, backup_password: Option<&str>) -> AppResult<ExportOutcome> {
    let data_dir = session::data_dir();
    let mut keyring = Keyring::load(&data_dir)
        .map_err(AppError::Other)?
        .ok_or_else(|| AppError::NotFound("keyring".into()))?;

    if let (Some(pw), AppKey::Open { .. }) = (backup_password, &keyring.app) {
        let ak = keyring.open_app_key().ok_or_else(|| AppError::Other(anyhow::anyhow!("bad app key")))?;
        keyring.seal_app_without_recovery(&ak, pw).map_err(AppError::Other)?;
    }
    let password_protected = keyring.has_app_password();

    let staging = data_dir.join(format!(".export-tmp-{}", now_epoch_secs()));
    fs::create_dir_all(&staging)?;
    let result = (|| -> AppResult<u64> {
        // Open libraries are snapshotted through SQLCipher (consistent even
        // while being written); locked ones are closed files, copied as-is.
        let mut files: Vec<(String, PathBuf)> = Vec::new();
        for entry in &keyring.libraries {
            let name = format!("libraries/{}.db", entry.id);
            if let Some(key) = session::library_key(&entry.id) {
                let tmp = staging.join(format!("{}.db", entry.id));
                db::snapshot(&entry.id, &tmp, &key)?;
                files.push((name, tmp));
            } else {
                let p = db::lib_path(&entry.id);
                if p.is_file() {
                    files.push((name, p));
                }
            }
        }

        if let Some(parent) = dest.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let mut zip = ZipWriter::new(fs::File::create(dest)?);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let manifest = BackupManifest {
            format_version: FORMAT_VERSION,
            app_version: app_version.to_string(),
            exported_at: now_epoch_secs(),
            password_protected,
            libraries: files.len(),
        };
        zip.start_file(MANIFEST_NAME, opts).map_err(zerr)?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(zerr)?)?;
        zip.start_file(crate::services::keyring::FILE_NAME, opts).map_err(zerr)?;
        zip.write_all(&serde_json::to_vec_pretty(&keyring).map_err(zerr)?)?;
        for (name, path) in files {
            // Ciphertext doesn't compress; don't waste time trying.
            let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            zip.start_file(&name, stored).map_err(zerr)?;
            std::io::copy(&mut fs::File::open(&path)?, &mut zip)?;
        }
        zip.finish().map_err(zerr)?;
        Ok(fs::metadata(dest)?.len())
    })();
    let _ = fs::remove_dir_all(&staging);
    Ok(ExportOutcome { bytes: result?, password_protected })
}

pub struct Staged {
    pub manifest: BackupManifest,
    pub dir: PathBuf,
}

/// Extract and validate a backup into a scratch directory.
pub fn stage(src: &Path, data_dir: &Path) -> AppResult<Staged> {
    let mut zip = ZipArchive::new(fs::File::open(src)?)
        .map_err(|e| AppError::InvalidArg(format!("不是有效的备份文件：{e}")))?;
    let scratch = data_dir.join(format!(".import-tmp-{}", now_epoch_secs()));
    if scratch.exists() {
        fs::remove_dir_all(&scratch)?;
    }
    fs::create_dir_all(scratch.join("libraries"))?;
    let mut manifest: Option<BackupManifest> = None;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(zerr)?;
        let name = entry
            .enclosed_name()
            .ok_or_else(|| AppError::InvalidArg("备份里有不安全的路径".into()))?
            .to_path_buf();
        if entry.is_dir() || name.as_os_str().is_empty() {
            continue;
        }
        let out = scratch.join(&name);
        if let Some(p) = out.parent() {
            fs::create_dir_all(p)?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        if name == Path::new(MANIFEST_NAME) {
            manifest = Some(
                serde_json::from_slice(&buf)
                    .map_err(|e| AppError::InvalidArg(format!("备份清单无法解析：{e}")))?,
            );
        }
        fs::write(&out, &buf)?;
    }
    let manifest = manifest.ok_or_else(|| AppError::InvalidArg("备份里缺少清单".into()))?;
    if manifest.format_version != FORMAT_VERSION {
        let _ = fs::remove_dir_all(&scratch);
        return Err(AppError::InvalidArg(format!(
            "这个备份是旧格式（v{}），当前版本无法导入",
            manifest.format_version
        )));
    }
    let kr = Keyring::load(&scratch)
        .map_err(|e| AppError::InvalidArg(format!("备份里的钥匙环无法读取：{e}")))?
        .ok_or_else(|| AppError::InvalidArg("备份里缺少钥匙环".into()))?;
    if !scratch.join("libraries").join(format!("{}.db", kr.main)).is_file() {
        let _ = fs::remove_dir_all(&scratch);
        return Err(AppError::InvalidArg("备份里缺少主库".into()));
    }
    Ok(Staged { manifest, dir: scratch })
}

/// Move the current keyring + libraries aside to `<data>/backups/<ts>/`
/// (never deleted), then move the staged ones in. All libraries must be
/// closed. The app relaunches afterwards.
pub fn install(staged: &Staged, data_dir: &Path) -> AppResult<PathBuf> {
    let aside = data_dir.join("backups").join(now_epoch_secs().to_string());
    fs::create_dir_all(&aside)?;
    let kr = data_dir.join(crate::services::keyring::FILE_NAME);
    let libs = data_dir.join("libraries");
    if kr.exists() {
        fs::rename(&kr, aside.join(crate::services::keyring::FILE_NAME))?;
    }
    if libs.exists() {
        fs::rename(&libs, aside.join("libraries"))?;
    }
    let res = fs::rename(staged.dir.join("libraries"), &libs)
        .and_then(|_| fs::rename(staged.dir.join(crate::services::keyring::FILE_NAME), &kr));
    if let Err(e) = res {
        // Put the old state back.
        let _ = fs::remove_dir_all(&libs);
        let _ = fs::rename(aside.join("libraries"), &libs);
        let _ = fs::rename(aside.join(crate::services::keyring::FILE_NAME), &kr);
        return Err(e.into());
    }
    let _ = fs::remove_dir_all(&staged.dir);
    Ok(aside)
}
