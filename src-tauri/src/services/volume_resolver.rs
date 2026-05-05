//! Volume identification and path ↔ (volume, relpath) translation.
//!
//! Phase 3: real platform IDs.
//!
//! - **Windows**: `GetVolumePathNameW` finds the mount root for any path,
//!   then `GetVolumeInformationW` returns the 32-bit volume serial number
//!   and label. Serial only changes on reformat — perfect for USB identity.
//! - **macOS**: TODO — proper `DADiskCopyDescription` integration is
//!   deferred until Phase 4-ish (no Mac in current dev environment).
//!   For now we identify by `/Volumes/<name>` (externals) or "system",
//!   matching the Phase 1 behavior so cross-compile keeps working.
//! - **Linux**: stub.
//!
//! All identification results are memoized in a small in-process cache so
//! repeated calls during a folder scan don't pay the FFI cost each time.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct VolumeInfo {
    pub platform_id: String,
    pub label: String,
    pub mount_point: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ResolvedPath {
    pub platform_id: String,
    pub label: String,
    pub mount_point: PathBuf,
    /// Path relative to `mount_point`, using `/` separators.
    pub relpath: String,
}

static CACHE: Lazy<Mutex<HashMap<PathBuf, VolumeInfo>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Drop the cached identification for a mount point. Call when a volume
/// is unmounted/remounted so the next resolve picks up the new state.
pub fn invalidate_cache() {
    CACHE.lock().clear();
}

/// Identify the volume that owns `mount_root` (which must already be a
/// volume root — drive letter on Windows, `/Volumes/<name>` on macOS, etc).
pub fn identify(mount_root: &Path) -> Result<VolumeInfo, String> {
    let key = mount_root.to_path_buf();
    if let Some(hit) = CACHE.lock().get(&key).cloned() {
        return Ok(hit);
    }
    let info = identify_uncached(mount_root)?;
    CACHE.lock().insert(key, info.clone());
    Ok(info)
}

fn identify_uncached(mount_root: &Path) -> Result<VolumeInfo, String> {
    #[cfg(windows)]
    {
        return windows_impl::identify(mount_root);
    }
    #[cfg(target_os = "macos")]
    {
        return macos_impl::identify(mount_root);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Ok(VolumeInfo {
            platform_id: "linux-root".into(),
            label: "root".into(),
            mount_point: PathBuf::from("/"),
        })
    }
}

/// Resolve any absolute path → its volume + relpath.
pub fn resolve(absolute: &Path) -> Result<ResolvedPath, String> {
    let canonical = dunce::canonicalize(absolute)
        .map_err(|e| format!("canonicalize {}: {e}", absolute.display()))?;

    let mount_root = mount_root_of(&canonical)?;
    let info = identify(&mount_root)?;
    let relpath = strip_mount_prefix(&canonical, &mount_root);

    Ok(ResolvedPath {
        platform_id: info.platform_id,
        label: info.label,
        mount_point: info.mount_point,
        relpath,
    })
}

/// Enumerate every currently-mounted volume on this machine.
pub fn enumerate_mounted() -> Vec<VolumeInfo> {
    #[cfg(windows)]
    {
        return windows_impl::enumerate();
    }
    #[cfg(target_os = "macos")]
    {
        return macos_impl::enumerate();
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        vec![VolumeInfo {
            platform_id: "linux-root".into(),
            label: "root".into(),
            mount_point: PathBuf::from("/"),
        }]
    }
}

/// Joins a volume mount point with a relative path (`/`-separated).
pub fn absolute_for(mount_point: &Path, relpath: &str) -> PathBuf {
    let mut p = mount_point.to_path_buf();
    for seg in relpath.split('/') {
        if !seg.is_empty() {
            p.push(seg);
        }
    }
    p
}

fn mount_root_of(path: &Path) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        return windows_impl::mount_root(path);
    }
    #[cfg(target_os = "macos")]
    {
        return Ok(macos_impl::mount_root(path));
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Ok(PathBuf::from("/"))
    }
}

fn strip_mount_prefix(path: &Path, mount_root: &Path) -> String {
    path.strip_prefix(mount_root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

// ----------------------------- Windows -----------------------------

#[cfg(windows)]
mod windows_impl {
    use super::VolumeInfo;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};
    use windows_sys::Win32::Storage::FileSystem::{
        GetLogicalDriveStringsW, GetVolumeInformationW, GetVolumePathNameW,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn from_wide_nul(buf: &[u16]) -> String {
        let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        std::ffi::OsString::from_wide(&buf[..n])
            .to_string_lossy()
            .into_owned()
    }

    pub fn mount_root(path: &Path) -> Result<PathBuf, String> {
        let wide_in: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut buf = [0u16; 260];
        let ok = unsafe {
            GetVolumePathNameW(wide_in.as_ptr(), buf.as_mut_ptr(), buf.len() as u32)
        };
        if ok == 0 {
            return Err(format!(
                "GetVolumePathNameW failed for {}",
                path.display()
            ));
        }
        Ok(PathBuf::from(from_wide_nul(&buf)))
    }

    pub fn identify(mount_root: &Path) -> Result<VolumeInfo, String> {
        let mut root_str = mount_root.to_string_lossy().to_string();
        if !root_str.ends_with('\\') {
            root_str.push('\\');
        }
        let wide_root = to_wide(&root_str);

        let mut name_buf = [0u16; 256];
        let mut serial: u32 = 0;
        let mut max_comp_len: u32 = 0;
        let mut fs_flags: u32 = 0;
        let mut fs_name = [0u16; 64];

        let ok = unsafe {
            GetVolumeInformationW(
                wide_root.as_ptr(),
                name_buf.as_mut_ptr(),
                name_buf.len() as u32,
                &mut serial,
                &mut max_comp_len,
                &mut fs_flags,
                fs_name.as_mut_ptr(),
                fs_name.len() as u32,
            )
        };
        if ok == 0 {
            // Drive may exist but be unreadable (empty CD/DVD slot, etc).
            // Fall back to drive-letter identification so we don't crash.
            let letter = root_str.chars().next().unwrap_or('?');
            return Ok(VolumeInfo {
                platform_id: format!("win-letter-{letter}"),
                label: format!("{letter}:"),
                mount_point: PathBuf::from(&root_str),
            });
        }

        let serial_hex = format!("{:08X}", serial);
        let label_raw = from_wide_nul(&name_buf);
        let letter = root_str.chars().next().unwrap_or('?').to_ascii_uppercase();
        let label = if label_raw.is_empty() {
            format!("{letter}:")
        } else {
            format!("{label_raw} ({letter}:)")
        };
        Ok(VolumeInfo {
            platform_id: format!("win-serial-{serial_hex}"),
            label,
            mount_point: PathBuf::from(&root_str),
        })
    }

    pub fn enumerate() -> Vec<VolumeInfo> {
        let mut buf = [0u16; 1024];
        let n = unsafe { GetLogicalDriveStringsW(buf.len() as u32, buf.as_mut_ptr()) };
        if n == 0 {
            return Vec::new();
        }
        let slice = &buf[..n as usize];
        let mut roots = Vec::new();
        for chunk in slice.split(|&c| c == 0).filter(|c| !c.is_empty()) {
            roots.push(from_wide_nul(chunk));
        }
        let mut out = Vec::with_capacity(roots.len());
        for r in roots {
            if let Ok(info) = identify(Path::new(&r)) {
                out.push(info);
            }
        }
        out
    }
}

// ------------------------------ macOS ------------------------------

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::VolumeInfo;
    use std::path::{Path, PathBuf};

    pub fn mount_root(path: &Path) -> PathBuf {
        let s = path.to_string_lossy();
        if let Some(rest) = s.strip_prefix("/Volumes/") {
            let name = match rest.find('/') {
                Some(i) => &rest[..i],
                None => rest,
            };
            PathBuf::from(format!("/Volumes/{name}"))
        } else {
            PathBuf::from("/")
        }
    }

    /// TODO: replace with `DADiskCopyDescription` for stable cross-mount IDs.
    /// Volume name is good enough while we don't have a Mac to test on.
    pub fn identify(mount_root: &Path) -> Result<VolumeInfo, String> {
        let s = mount_root.to_string_lossy();
        if let Some(name) = s.strip_prefix("/Volumes/") {
            Ok(VolumeInfo {
                platform_id: format!("macos-vol-{name}"),
                label: name.to_string(),
                mount_point: mount_root.to_path_buf(),
            })
        } else {
            Ok(VolumeInfo {
                platform_id: "macos-system".into(),
                label: "Macintosh HD".into(),
                mount_point: PathBuf::from("/"),
            })
        }
    }

    pub fn enumerate() -> Vec<VolumeInfo> {
        let mut out = vec![VolumeInfo {
            platform_id: "macos-system".into(),
            label: "Macintosh HD".into(),
            mount_point: PathBuf::from("/"),
        }];
        if let Ok(read) = std::fs::read_dir("/Volumes") {
            for entry in read.flatten() {
                if entry.path().is_dir() {
                    if let Ok(info) = identify(&entry.path()) {
                        out.push(info);
                    }
                }
            }
        }
        out
    }
}
