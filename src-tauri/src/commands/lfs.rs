//! Tauri commands for Git LFS operations.

use crate::commands::helpers::{offload, repo_path};
use crate::error::AppError;
use crate::git::{lfs, types::LfsInfo};
use crate::AppState;
use tauri::State;
use tracing::instrument;

/// Lightweight check: does this repo use LFS?
///
/// Pure file reads (<1ms) — no subprocess spawns.
#[instrument(skip(state))]
#[tauri::command]
pub async fn lfs_check_initialized(state: State<'_, AppState>) -> Result<LfsInfo, AppError> {
    let path = repo_path(&state)?;
    offload(move || {
        let initialized = lfs::is_lfs_initialized(&path);
        Ok(LfsInfo {
            installed: true,
            initialized,
            version: None,
            tracked_patterns: Vec::new(),
            file_count: 0,
            total_size: 0,
        })
    })
    .await
}

/// Return aggregate LFS info for the open repository.
///
/// Expensive: spawns multiple `git lfs` subprocesses (~2-5s on Windows).
/// Only call when the user explicitly opens the LFS panel.
#[instrument(skip(state))]
#[tauri::command]
pub async fn lfs_get_info(state: State<'_, AppState>) -> Result<LfsInfo, AppError> {
    let path = repo_path(&state)?;
    offload(move || Ok(lfs::lfs_get_info(&path))).await
}

/// Run `git lfs install --local` to initialise LFS hooks in the repository.
#[tauri::command]
pub async fn lfs_initialize(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || lfs::lfs_install(&path)).await
}

/// Track a new file pattern with LFS (adds an entry to .gitattributes).
#[tauri::command]
pub async fn lfs_track_pattern(
    pattern: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || lfs::lfs_track(&path, &pattern)).await
}

/// Remove a pattern from LFS tracking (removes the .gitattributes entry).
#[tauri::command]
pub async fn lfs_untrack_pattern(
    pattern: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || lfs::lfs_untrack(&path, &pattern)).await
}

/// Prune unreferenced LFS objects to reclaim disk space.
#[tauri::command]
pub async fn lfs_prune_objects(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || lfs::lfs_prune(&path)).await
}
