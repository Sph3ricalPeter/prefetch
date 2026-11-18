//! Tauri commands for change stories (#93). A story is part of a brief, so
//! these only read; Summarize and Generate brief write them.

use crate::commands::helpers::{offload, repo_path};
use crate::error::AppError;
use crate::git::story::{self, Story};
use crate::AppState;
use tauri::State;

/// A commit's story from its brief note; null when no brief there tells one.
#[tauri::command]
pub async fn get_commit_story(
    commit_id: String,
    state: State<'_, AppState>,
) -> Result<Option<Story>, AppError> {
    let path = repo_path(&state)?;
    offload(move || story::read_commit(&path, &commit_id)).await
}

/// The working changes' story from the drafts; null when no draft tells one
/// or nothing is uncommitted.
#[tauri::command]
pub async fn get_worktree_story(state: State<'_, AppState>) -> Result<Option<Story>, AppError> {
    let path = repo_path(&state)?;
    offload(move || story::read_worktree(&path)).await
}
