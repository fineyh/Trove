mod commands;
mod db;
mod error;
mod events;
mod services;

pub use error::{AppError, AppResult};

use tauri::Manager;

/// Wipe the WebView profile (history, disk cache) if the user asked for it.
/// Must run before any WebView exists: WebView2 keeps the files locked.
fn purge_webview_profile_if_requested(app: &tauri::App) {
    let (Ok(data), Ok(local)) = (app.path().app_data_dir(), app.path().app_local_data_dir()) else {
        return;
    };
    let marker = data.join(commands::security::PURGE_MARKER);
    if marker.exists() {
        let _ = std::fs::remove_dir_all(local.join("EBWebView"));
        let _ = std::fs::remove_file(marker);
    }
}

/// Log file in the OS log dir (6.1, ADR-048): a release build has no console,
/// so this is the only trace a bug report can carry. Small and rotated; the
/// call sites keep file paths and captions out of it, since the libraries
/// themselves are encrypted.
fn log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
    let mut targets = vec![Target::new(TargetKind::LogDir { file_name: Some("trove".into()) })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(log::LevelFilter::Info)
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("wry", log::LevelFilter::Warn)
        .level_for("notify", log::LevelFilter::Warn)
        .level_for("reqwest", log::LevelFilter::Warn)
        .level_for("hyper", log::LevelFilter::Warn)
        .max_file_size(1_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(2))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Must be the first plugin: a second launch exits here, before it opens
    // any library or starts a watcher, and wakes the running window (1.2).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));
    builder
        .plugin(log_plugin())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Media reaches the WebView only through this protocol, by id
        // (ADR-037). The handler does file I/O, so it runs on a small worker
        // pool off the IPC thread (R4.10).
        .register_asynchronous_uri_scheme_protocol("trove", |_ctx, request, responder| {
            services::protocol::dispatch(request, responder);
        })
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            log::info!("Trove {} starting", app.package_info().version);
            purge_webview_profile_if_requested(app);
            events::init(app.handle().clone());
            // A failed boot must not end the process: a release build has no
            // console, so the user would see nothing at all. Open the window
            // anyway and let it show the error (R4.1).
            match services::session::boot(&data_dir) {
                Ok(unlocked) => {
                    services::volume_monitor::start();
                    services::session::start_keyfile_watcher();
                    if unlocked {
                        commands::spawn_all_library_tasks();
                    }
                }
                Err(f) => {
                    log::error!("boot failed ({:?}): {}", f.kind, f.detail);
                    services::session::set_boot_error(f);
                }
            }
            // Created here rather than in tauri.conf.json so it can be
            // incognito: no history or disk cache written by the WebView.
            let main = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Trove")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .incognito(true)
                // Lets the frontend's own edit menu read the clipboard for
                // 粘贴 without a WebView permission prompt (ADR-047).
                .enable_clipboard_access();
            // No system title bar: the panes' own headers are the title bar
            // and the window buttons are drawn by the frontend (ADR-043).
            // macOS keeps its traffic lights over the content instead.
            #[cfg(target_os = "macos")]
            let main = main
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
            #[cfg(not(target_os = "macos"))]
            let main = main.decorations(false);
            main.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::ping,
            commands::security::boot_error,
            commands::security::security_status,
            commands::security::app_unlock,
            commands::security::app_lock,
            commands::security::app_set_password,
            commands::security::app_change_password,
            commands::security::app_remove_password,
            commands::security::app_reset_recovery,
            commands::security::delete_legacy_copy,
            commands::security::schedule_webview_purge,
            commands::libraries::list_libraries,
            commands::libraries::create_library,
            commands::libraries::update_library,
            commands::libraries::reorder_libraries,
            commands::libraries::unlock_library,
            commands::libraries::lock_library,
            commands::libraries::set_library_password,
            commands::libraries::change_library_password,
            commands::libraries::remove_library_password,
            commands::libraries::reset_library_recovery,
            commands::libraries::set_library_keyfile,
            commands::libraries::remove_library_keyfile,
            commands::libraries::delete_library,
            commands::libraries::move_conversation,
            commands::conversations::list_conversations,
            commands::conversations::create_conversation,
            commands::conversations::update_conversation,
            commands::conversations::delete_conversation,
            commands::messages::list_messages,
            commands::messages::list_conv_media,
            commands::messages::get_messages,
            commands::messages::send_text,
            commands::messages::increment_play_count,
            commands::messages::delete_message,
            commands::media::import_files,
            commands::media::cancel_import,
            commands::folders::create_manual_from_folder,
            commands::folders::rescan_folder,
            commands::geo::list_geotagged_media,
            commands::geo::backfill_geotags,
            commands::repair::repair_media,
            commands::repair::list_broken_pointers,
            commands::search::search,
            commands::settings::get_all_settings,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::get_ui_prefs,
            commands::settings::set_ui_pref,
            commands::thumbs::thumbs_next,
            commands::thumbs::thumbs_remaining,
            commands::thumbs::thumbs_put,
            commands::thumbs::thumbs_fail,
            commands::volumes::list_volumes,
            commands::volumes::rescan_volumes,
            commands::volumes::forget_volume,
            commands::volumes::get_storage_stats,
            commands::system::open_path,
            commands::system::open_log_dir,
            commands::system::open_url,
            commands::system::open_media,
            commands::system::reveal_media,
            commands::system::media_path_for_copy,
            commands::auth::auth_status,
            commands::auth::google_login,
            commands::auth::logout,
            commands::backup::export_backup,
            commands::backup::import_backup,
            commands::updater::check_for_update,
            commands::updater::install_update,
            commands::updater::app_environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trove");
}
