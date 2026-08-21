use crate::commands::helpers::{offload, repo_path};
use crate::error::AppError;
use crate::git::{repository, types::WorktreeInfo, worktree};
use crate::AppState;
use tauri::State;
use tracing::instrument;

#[instrument(skip(state))]
#[tauri::command]
pub async fn list_worktrees(state: State<'_, AppState>) -> Result<Vec<WorktreeInfo>, AppError> {
    let path = repo_path(&state)?;
    offload(move || worktree::list_worktrees(&path)).await
}

/// Suggested path for a new worktree tracking `branch` — a sibling of the repo.
#[tauri::command]
pub async fn suggest_worktree_path(
    branch: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    Ok(worktree::suggest_worktree_path(&path, &branch))
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn add_worktree(
    worktree_path: String,
    branch: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || worktree::add_worktree(&path, &worktree_path, &branch)).await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn remove_worktree(
    worktree_path: String,
    force: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || {
        // Resolve against the repo's own worktree list so an arbitrary path
        // from the frontend can never reach `worktree remove`.
        let resolved = worktree::resolve_worktree(&path, &worktree_path)?;
        worktree::remove_worktree(&path, &resolved, force)
    })
    .await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn prune_worktrees(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || worktree::prune_worktrees(&path)).await
}

/// Reveal a worktree in the OS file explorer.
///
/// Worktrees live outside the repository root, so this can't go through
/// `show_in_folder`, whose `validate_repo_path` rejects anything outside it.
#[instrument(skip(state))]
#[tauri::command]
pub async fn show_worktree_in_folder(
    worktree_path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || {
        let resolved = worktree::resolve_worktree(&path, &worktree_path)?;
        repository::show_in_folder(&resolved)
    })
    .await
}
