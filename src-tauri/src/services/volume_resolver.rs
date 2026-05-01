//! Phase 1 volume resolver — placeholder identification.
//!
//! Real volume identification (Windows GetVolumeInformationW, macOS DADiskUUID)
//! lands in Phase 3. For now we identify the volume by its mount root:
//!   - Windows: drive letter, e.g. "C:"  → platform_id "win-letter-C"
//!   - macOS:   /Volumes/<name> for externals, "/" for the system volume
//!
//! This is good enough to develop the rest of the app against; the trait makes
//! the v3 swap a one-file change.

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ResolvedPath {
    /// Stable identifier for the volume (uniqueness target: per physical device).
    pub platform_id: String,
    /// Human-readable label (drive letter, volume name).
    pub label: String,
    /// Current mount point on this machine.
    pub mount_point: PathBuf,
    /// Path *relative to* the mount point.
    pub relpath: String,
}

pub fn resolve(absolute: &Path) -> Result<ResolvedPath, String> {
    let canonical = dunce::canonicalize(absolute)
        .map_err(|e| format!("canonicalize {}: {e}", absolute.display()))?;

    #[cfg(windows)]
    {
        return resolve_windows(&canonical);
    }

    #[cfg(target_os = "macos")]
    {
        return resolve_macos(&canonical);
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let mount = PathBuf::from("/");
        let rel = canonical
            .strip_prefix(&mount)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        Ok(ResolvedPath {
            platform_id: "linux-root".into(),
            label: "root".into(),
            mount_point: mount,
            relpath: rel,
        })
    }
}

#[cfg(windows)]
fn resolve_windows(path: &Path) -> Result<ResolvedPath, String> {
    let mut comps = path.components();
    let prefix = comps.next().ok_or_else(|| "empty path".to_string())?;
    match prefix {
        Component::Prefix(p) => {
            use std::path::Prefix;
            match p.kind() {
                Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                    let letter_char = (letter as char).to_ascii_uppercase();
                    let mount = PathBuf::from(format!("{letter_char}:\\"));
                    let rel = path
                        .strip_prefix(&mount)
                        .or_else(|_| path.strip_prefix(format!("{letter_char}:/")))
                        .or_else(|_| path.strip_prefix(format!("{letter_char}:")))
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_else(|_| String::new());
                    Ok(ResolvedPath {
                        platform_id: format!("win-letter-{letter_char}"),
                        label: format!("{letter_char}:"),
                        mount_point: mount,
                        relpath: rel,
                    })
                }
                Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => {
                    let server = server.to_string_lossy().to_string();
                    let share = share.to_string_lossy().to_string();
                    let mount = PathBuf::from(format!(r"\\{server}\{share}"));
                    let rel = path
                        .strip_prefix(&mount)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_default();
                    Ok(ResolvedPath {
                        platform_id: format!("win-unc-{server}-{share}"),
                        label: format!(r"\\{server}\{share}"),
                        mount_point: mount,
                        relpath: rel,
                    })
                }
                _ => Err(format!("unsupported windows prefix: {prefix:?}")),
            }
        }
        _ => Err("expected windows path with drive prefix".into()),
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos(path: &Path) -> Result<ResolvedPath, String> {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix("/Volumes/") {
        let (name, sub) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i + 1..]),
            None => (rest, ""),
        };
        Ok(ResolvedPath {
            platform_id: format!("macos-vol-{name}"),
            label: name.to_string(),
            mount_point: PathBuf::from(format!("/Volumes/{name}")),
            relpath: sub.to_string(),
        })
    } else {
        let rel = s.trim_start_matches('/').to_string();
        Ok(ResolvedPath {
            platform_id: "macos-system".into(),
            label: "Macintosh HD".into(),
            mount_point: PathBuf::from("/"),
            relpath: rel,
        })
    }
}

/// Joins a volume mount point with a relative path.
pub fn absolute_for(mount_point: &Path, relpath: &str) -> PathBuf {
    let mut p = mount_point.to_path_buf();
    for seg in relpath.split('/') {
        if !seg.is_empty() {
            p.push(seg);
        }
    }
    p
}
