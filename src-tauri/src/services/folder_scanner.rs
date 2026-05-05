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

pub fn is_media(path: &Path) -> bool {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    matches!(mime.type_().as_str(), "image" | "video")
}
