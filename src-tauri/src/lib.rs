mod commands;
mod error;
mod events;
mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .setup(|_app| {
            // Future: initialize file watcher, background fetch thread
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
