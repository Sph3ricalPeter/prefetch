//! Tauri commands for Git LFS operations.

use crate::error::AppError;
use crate::git::{lfs, types::LfsInfo};
use crate::AppState;
use tauri::State;

/// Helper to get the open repository path from state.
fn repo_path(state: &State<'_, AppState>) -> Result<String, AppError> {
    let lock = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    lock.clone()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))
}

/// Return aggregate LFS info for the open repository.
///
/// Always succeeds — if git-lfs is not installed, `LfsInfo.installed` is false.
#[tauri::command]
pub fn lfs_get_info(state: State<'_, AppState>) -> Result<LfsInfo, AppError> {
    let path = repo_path(&state)?;
    Ok(lfs::lfs_get_info(&path))
}

/// Run `git lfs install --local` to initialise LFS hooks in the repository.
#[tauri::command]
pub fn lfs_initialize(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    lfs::lfs_install(&path)
}

/// Track a new file pattern with LFS (adds an entry to .gitattributes).
#[tauri::command]
pub fn lfs_track_pattern(pattern: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    lfs::lfs_track(&path, &pattern)
}

/// Remove a pattern from LFS tracking (removes the .gitattributes entry).
#[tauri::command]
pub fn lfs_untrack_pattern(
    pattern: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    lfs::lfs_untrack(&path, &pattern)
}

/// Prune unreferenced LFS objects to reclaim disk space.
#[tauri::command]
pub fn lfs_prune_objects(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    lfs::lfs_prune(&path)
}
