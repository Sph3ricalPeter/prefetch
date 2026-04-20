mod background;
mod commands;
mod error;
mod events;
mod git;
mod watcher;

use std::sync::Mutex;

use background::BackgroundFetcher;
use watcher::RepoWatcher;

pub struct AppState {
    pub repo_path: Mutex<Option<String>>,
    pub watcher: Mutex<Option<RepoWatcher>>,
    pub fetcher: Mutex<Option<BackgroundFetcher>>,
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
            watcher: Mutex::new(None),
            fetcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::get_commits,
            commands::repo::get_branches,
            commands::repo::checkout_branch,
            commands::repo::create_branch,
            commands::repo::fetch_repo,
            commands::repo::pull_repo,
            commands::repo::push_repo,
            commands::repo::get_file_status,
            commands::repo::get_file_diff,
            commands::repo::stage_files,
            commands::repo::unstage_files,
            commands::repo::create_commit,
            commands::repo::get_commit_files,
            commands::repo::get_commit_file_diff,
            commands::repo::get_stashes,
            commands::repo::stash_save,
            commands::repo::stash_pop,
            commands::repo::stash_drop,
            commands::repo::get_stash_files,
            commands::repo::get_stash_file_diff,
            commands::repo::get_tags,
            commands::repo::create_tag,
            commands::repo::delete_tag,
            commands::repo::push_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
