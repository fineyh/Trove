//! Recursive media discovery inside a folder.

use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub fn enumerate_media(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_media(e.path()))
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// Single-directory listing (no recursion). Used by the repair flow when the
/// user asked to only look at the file's last-known parent folder.
pub fn enumerate_media_shallow(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| is_media(p))
        .collect()
}

pub fn is_media(path: &Path) -> bool {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    matches!(mime.type_().as_str(), "image" | "video")
}
