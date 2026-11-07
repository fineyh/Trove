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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Media reaches the WebView only through this protocol, by id
        // (ADR-037). The handler does file I/O, so it runs off the IPC thread.
        .register_asynchronous_uri_scheme_protocol("trove", |_ctx, request, responder| {
            std::thread::spawn(move || {
                responder.respond(services::protocol::handle(request));
            });
        })
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            purge_webview_profile_if_requested(app);
            events::init(app.handle().clone());
            let unlocked = services::session::boot(&data_dir).expect("open libraries");
            services::volume_monitor::start();
            services::session::start_keyfile_watcher();
            if unlocked {
                commands::spawn_all_library_tasks();
            }
            // Created here rather than in tauri.conf.json so it can be
            // incognito: no history or disk cache written by the WebView.
            let main = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Trove")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .incognito(true);
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
