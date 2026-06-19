mod commands;
mod db;
mod error;
mod events;
mod services;

pub use error::{AppError, AppResult};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            db::init_slot(&data_dir).expect("init db slot");
            let has_master = services::vault::init(&data_dir).expect("init vault");
            // No master password configured → open the DB right away so the
            // UI doesn't have to wait. Otherwise leave it locked until the
            // user enters their password via `vault_unlock`.
            if !has_master {
                db::open_unencrypted().expect("open unencrypted db");
            }
            events::init(app.handle().clone());
            services::volume_monitor::start();
            if !has_master {
                services::volume_monitor::run_boot_scan();
                if let Err(e) = commands::conversations::boot_existing_watchers() {
                    eprintln!("boot_existing_watchers: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::ping,
            commands::conversations::list_conversations,
            commands::conversations::create_conversation,
            commands::conversations::update_conversation,
            commands::conversations::delete_conversation,
            commands::conversations::unlock_conversation,
            commands::conversations::lock_conversation,
            commands::conversations::list_unlocked_conversations,
            commands::messages::list_messages,
            commands::messages::send_text,
            commands::messages::increment_play_count,
            commands::messages::delete_message,
            commands::media::import_files,
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
            commands::vault::vault_status,
            commands::vault::vault_set_master_password,
            commands::vault::vault_unlock,
            commands::vault::vault_lock,
            commands::vault::vault_change_password,
            commands::vault::vault_remove_master_password,
            commands::volumes::list_volumes,
            commands::volumes::rescan_volumes,
            commands::volumes::forget_volume,
            commands::volumes::get_storage_stats,
            commands::system::open_path,
            commands::system::open_url,
            commands::auth::auth_status,
            commands::auth::google_login,
            commands::auth::logout,
            commands::backup::export_backup,
            commands::backup::import_backup,
            commands::updater::check_for_update,
            commands::updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trove");
}
