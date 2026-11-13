use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid argument: {0}")]
    InvalidArg(String),

    /// The library isn't open. The frontend matches on the "locked:" prefix.
    #[error("locked: {0}")]
    Locked(String),

    #[error("updater error: {0}")]
    Updater(#[from] tauri_plugin_updater::Error),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Data written by a newer Trove (the keyring, or a library's schema).
/// Carried inside `AppError::Other` so boot can tell it apart (ADR-045).
#[derive(Debug, Error)]
#[error("{what} 版本为 v{found}，当前版本最高支持 v{supported}")]
pub struct NewerData {
    pub what: &'static str,
    pub found: i64,
    pub supported: i64,
}
