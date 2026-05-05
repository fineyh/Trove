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
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            db::init(&data_dir).expect("failed to initialize database");
            events::init(app.handle().clone());
            if let Err(e) = commands::conversations::boot_existing_watchers() {
                eprintln!("boot_existing_watchers: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::ping,
            commands::conversations::list_conversations,
            commands::conversations::create_conversation,
            commands::conversations::update_conversation,
            commands::conversations::delete_conversation,
            commands::messages::list_messages,
            commands::messages::send_text,
            commands::messages::increment_play_count,
            commands::messages::delete_message,
            commands::media::import_files,
            commands::folders::create_manual_from_folder,
            commands::folders::rescan_folder,
            commands::search::search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trove");
}
