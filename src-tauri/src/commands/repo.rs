use crate::background::BackgroundFetcher;
use crate::error::AppError;
use crate::events;
use crate::git::{
    repository,
    types::{BranchInfo, FileDiff, FileStatus, GraphData, StashInfo, TagInfo},
};
use crate::watcher::RepoWatcher;
use crate::AppState;
use tauri::{Emitter, State};

#[tauri::command]
pub fn open_repo(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    // Verify it's a valid git repo by trying to open it
    let _repo = git2::Repository::open(&path)?;
    let name = repository::repo_name(&path);

    // Update repo path
    {
        let mut repo_path = state
            .repo_path
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *repo_path = Some(path.clone());
    }

    // Start file watcher for the new repo (drops old watcher if any)
    {
        let mut watcher_lock = state
            .watcher
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *watcher_lock = None; // Drop old watcher first
        match RepoWatcher::start(&path, app.clone()) {
            Ok(w) => *watcher_lock = Some(w),
            Err(e) => eprintln!("Warning: failed to start file watcher: {e}"),
        }
    }

    // Start background fetcher for the new repo (drops old fetcher if any)
    {
        let mut fetcher_lock = state
            .fetcher
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *fetcher_lock = None; // Drop old fetcher first
        *fetcher_lock = Some(BackgroundFetcher::start(path, app));
    }

    Ok(name)
}

#[tauri::command]
pub fn get_commits(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<GraphData, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::walk_commits(path, limit.unwrap_or(10_000))
}

#[tauri::command]
pub fn get_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::list_branches(path)
}

#[tauri::command]
pub fn checkout_branch(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::checkout_branch(path, &name)
}

#[tauri::command]
pub fn create_branch(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;
    repository::create_branch(path, &name)
}

#[tauri::command]
pub fn fetch_repo(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::fetch_all(path, |progress| {
        app.emit(events::GIT_PROGRESS, progress).ok();
    })
}

#[tauri::command]
pub fn pull_repo(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::pull(path, |progress| {
        app.emit(events::GIT_PROGRESS, progress).ok();
    })
}

#[tauri::command]
pub fn push_repo(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::push(path, |progress| {
        app.emit(events::GIT_PROGRESS, progress).ok();
    })
}

#[tauri::command]
pub fn get_file_status(state: State<'_, AppState>) -> Result<Vec<FileStatus>, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::get_status(path)
}

#[tauri::command]
pub fn get_file_diff(
    file_path: String,
    staged: bool,
    state: State<'_, AppState>,
) -> Result<FileDiff, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::get_file_diff(path, &file_path, staged)
}

#[tauri::command]
pub fn stage_files(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::stage_files(path, &paths)
}

#[tauri::command]
pub fn unstage_files(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::unstage_files(path, &paths)
}

#[tauri::command]
pub fn create_commit(
    message: String,
    amend: bool,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::create_commit(path, &message, amend)
}

#[tauri::command]
pub fn get_commit_files(
    commit_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileStatus>, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::get_commit_files(path, &commit_id)
}

#[tauri::command]
pub fn get_commit_file_diff(
    commit_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<FileDiff, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::get_commit_file_diff(path, &commit_id, &file_path)
}

#[tauri::command]
pub fn get_stashes(state: State<'_, AppState>) -> Result<Vec<StashInfo>, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::list_stashes(path)
}

#[tauri::command]
pub fn stash_save(message: Option<String>, state: State<'_, AppState>) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::stash_push(path, message.as_deref())
}

#[tauri::command]
pub fn stash_pop(index: usize, state: State<'_, AppState>) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::stash_pop(path, index)
}

#[tauri::command]
pub fn stash_drop(index: usize, state: State<'_, AppState>) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::stash_drop(path, index)
}

#[tauri::command]
pub fn get_stash_files(
    index: usize,
    state: State<'_, AppState>,
) -> Result<Vec<FileStatus>, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::get_stash_files(path, index)
}

#[tauri::command]
pub fn get_stash_file_diff(
    index: usize,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<FileDiff, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::get_stash_file_diff(path, index, &file_path)
}

#[tauri::command]
pub fn get_tags(state: State<'_, AppState>) -> Result<Vec<TagInfo>, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;
    repository::list_tags(path)
}

#[tauri::command]
pub fn create_tag(
    name: String,
    commit: Option<String>,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;
    repository::create_tag(path, &name, commit.as_deref(), message.as_deref())
}

#[tauri::command]
pub fn delete_tag(name: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;
    repository::delete_tag(path, &name)
}

#[tauri::command]
pub fn push_tag(name: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;
    repository::push_tag(path, &name)
}
