mod commands;
mod error;
mod events;
mod git;

use std::sync::Mutex;

pub struct AppState {
    pub repo_path: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            repo_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::get_commits,
            commands::repo::get_branches,
            commands::repo::checkout_branch,
            commands::repo::fetch_repo,
            commands::repo::pull_repo,
            commands::repo::push_repo,
            commands::repo::get_file_status,
            commands::repo::get_file_diff,
            commands::repo::stage_files,
            commands::repo::unstage_files,
            commands::repo::create_commit,
        ])
        .setup(|_app| {
            // Future: initialize file watcher, background fetch thread
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
