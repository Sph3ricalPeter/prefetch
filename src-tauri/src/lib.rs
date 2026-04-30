mod background;
mod commands;
mod error;
mod events;
mod git;
mod oauth;
mod tracing_setup;
mod watcher;

use std::collections::HashMap;
use std::sync::Mutex;

use background::BackgroundFetcher;
use git::profile::ActiveProfile;
use git::types::PrInfo;
use watcher::RepoWatcher;

pub struct AppState {
    pub repo_path: Mutex<Option<String>>,
    pub active_profile: Mutex<Option<ActiveProfile>>,
    pub watcher: Mutex<Option<RepoWatcher>>,
    pub fetcher: Mutex<Option<BackgroundFetcher>>,
    /// In-memory cache of branch name → PR info (or None if no open PR).
    /// Cleared on each successful fetch/pull.
    pub pr_cache: Mutex<HashMap<String, Option<PrInfo>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_setup::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Config has decorations:true + titleBarStyle:Overlay for macOS
            // traffic lights. On Windows/Linux we disable decorations so the
            // custom HTML titlebar is used instead.
            #[cfg(not(target_os = "macos"))]
            {
                use tauri::Manager;
                let window = app
                    .get_webview_window("main")
                    .expect("main window not found");
                window.set_decorations(false)?;
                // Re-enforce minimum size after disabling decorations — the
                // config value alone is not always honoured on Windows without
                // native chrome.
                window.set_min_size(Some(tauri::LogicalSize::new(960.0, 600.0)))?;
            }
            // Suppress unused variable warning on macOS
            let _ = app;
            Ok(())
        })
        .manage(AppState {
            repo_path: Mutex::new(None),
            active_profile: Mutex::new(None),
            watcher: Mutex::new(None),
            fetcher: Mutex::new(None),
            pr_cache: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::get_commits,
            commands::repo::get_branches,
            commands::repo::checkout_branch,
            commands::repo::force_checkout_branch,
            commands::repo::reset_branch_to_remote,
            commands::repo::create_branch,
            commands::repo::fetch_repo,
            commands::repo::pull_repo,
            commands::repo::push_repo,
            commands::repo::force_push_repo,
            commands::repo::get_file_status,
            commands::repo::get_file_diff,
            commands::repo::resolve_conflict_ours,
            commands::repo::resolve_conflict_theirs,
            commands::repo::discard_files,
            commands::repo::discard_all_changes,
            commands::repo::stage_files,
            commands::repo::unstage_files,
            commands::repo::stage_patch,
            commands::repo::unstage_patch,
            commands::repo::get_conflict_contents,
            commands::repo::resolve_conflict_manual,
            commands::repo::create_commit,
            commands::repo::get_commit_files,
            commands::repo::get_commit_file_diff,
            commands::repo::get_stashes,
            commands::repo::stash_save,
            commands::repo::stash_pop,
            commands::repo::stash_drop,
            commands::repo::stash_apply,
            commands::repo::get_stash_files,
            commands::repo::get_stash_file_diff,
            commands::repo::get_tags,
            commands::repo::create_tag,
            commands::repo::delete_tag,
            commands::repo::push_tag,
            commands::repo::get_undo_action,
            commands::repo::undo_last,
            commands::repo::reset_to_commit,
            commands::repo::cherry_pick,
            commands::repo::rebase_onto,
            commands::repo::merge_branch,
            commands::repo::get_merge_message,
            commands::repo::delete_branch,
            commands::repo::get_conflict_state,
            commands::repo::get_rebase_progress,
            commands::repo::abort_operation,
            commands::repo::continue_operation,
            // Context menu actions (v0.6)
            commands::repo::revert_commit,
            commands::repo::checkout_detached,
            commands::repo::create_branch_at,
            commands::repo::rename_branch,
            commands::repo::delete_remote_branch,
            commands::repo::set_upstream,
            commands::repo::stash_push_files,
            commands::repo::show_in_folder,
            commands::repo::open_in_default_editor,
            commands::repo::delete_file,
            commands::repo::get_git_identity,
            // Forge (GitHub / GitLab)
            commands::forge::get_forge_status,
            commands::forge::save_forge_token,
            commands::forge::delete_forge_token,
            commands::forge::check_profile_token,
            commands::forge::get_pr_for_branch,
            commands::forge::clear_pr_cache,
            commands::forge::start_oauth_flow,
            commands::forge::cancel_oauth_flow,
            commands::forge::open_url,
            // Profiles
            commands::profile::set_active_profile,
            commands::profile::get_active_profile,
            // LFS
            commands::lfs::lfs_check_initialized,
            commands::lfs::lfs_get_info,
            commands::lfs::lfs_initialize,
            commands::lfs::lfs_track_pattern,
            commands::lfs::lfs_untrack_pattern,
            commands::lfs::lfs_prune_objects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
