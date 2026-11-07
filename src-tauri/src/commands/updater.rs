//! Tauri auto-updater commands.
//!
//!   - `check_for_update` — non-mutating, returns whether an update is
//!     available on the chosen channel and its notes.
//!   - `install_update` — downloads (reporting progress) + applies, then restarts.
//!   - `app_environment` — version / OS / WebView, for the feedback form.
//!
//! Two channels (ADR-041), picked by `update_channel` in `ui.json`:
//!   - stable: `latest.json` of the newest published non-prerelease release
//!   - beta:   `beta.json` on the fixed `beta-channel` release, which CI points
//!     at whichever published release is newest, prerelease or not
//!
//! Signature verification against the pubkey in tauri.conf.json is done by
//! `tauri-plugin-updater` either way.

use std::time::{Duration, Instant};

use crate::commands::settings::{ui_pref, write_ui_pref};
use crate::{AppError, AppResult};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_updater::{Updater, UpdaterExt};

const STABLE_ENDPOINT: &str = "https://github.com/fineyh/Trove/releases/latest/download/latest.json";
const BETA_ENDPOINT: &str = "https://github.com/fineyh/Trove/releases/download/beta-channel/beta.json";

fn channel() -> &'static str {
    match ui_pref("update_channel").as_deref() {
        Some("beta") => "beta",
        _ => "stable",
    }
}

fn updater_for_channel(app: &AppHandle) -> AppResult<Updater> {
    let endpoint = if channel() == "beta" { BETA_ENDPOINT } else { STABLE_ENDPOINT };
    let url = endpoint
        .parse()
        .map_err(|e| AppError::Other(anyhow::anyhow!("bad endpoint: {e}")))?;
    Ok(app
        .updater_builder()
        .endpoints(vec![url])?
        .timeout(Duration::from_secs(30))
        .build()?)
}

fn current_version(app: &AppHandle) -> String {
    app.config()
        .version
        .clone()
        .unwrap_or_else(|| "unknown".to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    /// `YYYY-MM-DD`
    pub date: Option<String>,
    pub notes: Option<String>,
    pub channel: &'static str,
    /// Unix ms of this check.
    pub checked_at: i64,
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> AppResult<UpdateInfo> {
    let current_version = current_version(&app);
    let channel = channel();
    let result = updater_for_channel(&app)?.check().await?;

    let checked_at = chrono::Utc::now().timestamp_millis();
    // Only successful checks count towards "checked today".
    if let Err(e) = write_ui_pref("update_last_check", &checked_at.to_string()) {
        eprintln!("[updater] could not record last check: {e}");
    }

    Ok(match result {
        Some(u) => UpdateInfo {
            available: true,
            current_version,
            latest_version: Some(u.version.clone()),
            date: u.date.map(|d| d.date().to_string()),
            notes: u.body.clone(),
            channel,
            checked_at,
        },
        None => UpdateInfo {
            available: false,
            current_version,
            latest_version: None,
            date: None,
            notes: None,
            channel,
            checked_at,
        },
    })
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum DownloadEvent {
    /// `total` is None when the server sends no Content-Length.
    Progress { downloaded: u64, total: Option<u64> },
    /// Download done, installer starting. The app exits / restarts next.
    Installing,
}

#[tauri::command]
pub async fn install_update(app: AppHandle, on_event: Channel<DownloadEvent>) -> AppResult<()> {
    let Some(update) = updater_for_channel(&app)?.check().await? else {
        return Err(AppError::InvalidArg("no update available".into()));
    };

    let mut downloaded: u64 = 0;
    let mut last_sent = Instant::now() - Duration::from_secs(1);
    let progress = on_event.clone();
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                // A few hundred thousand tiny chunks would flood the IPC.
                if last_sent.elapsed() >= Duration::from_millis(100) || Some(downloaded) == total {
                    last_sent = Instant::now();
                    let _ = progress.send(DownloadEvent::Progress { downloaded, total });
                }
            },
            || {
                let _ = on_event.send(DownloadEvent::Installing);
            },
        )
        .await?;
    app.restart();
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEnvironment {
    pub version: String,
    pub channel: &'static str,
    pub os: String,
    pub arch: &'static str,
    pub webview: Option<String>,
}

/// What a bug report needs to say about this machine. Nothing from the libraries.
#[tauri::command]
pub fn app_environment(app: AppHandle) -> AppEnvironment {
    let platform = match tauri_plugin_os::platform() {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    };
    AppEnvironment {
        version: current_version(&app),
        channel: channel(),
        os: format!("{platform} {}", tauri_plugin_os::version()),
        arch: tauri_plugin_os::arch(),
        webview: tauri::webview_version().ok(),
    }
}
