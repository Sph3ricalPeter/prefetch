//! Tauri commands for Claude-assisted features.

use crate::commands::helpers::{offload, repo_path};
use crate::error::AppError;
use crate::git::{ai, types::CommitSuggestion};
use crate::AppState;
use tauri::State;

/// Whether the `claude` CLI is installed. Probed once per app run.
#[tauri::command]
pub async fn ai_available() -> Result<bool, AppError> {
    offload(|| Ok(ai::claude_path().is_some())).await
}

/// Suggest a commit message for the staged diff via `claude -p`.
#[tauri::command]
pub async fn suggest_commit_message(
    state: State<'_, AppState>,
    model: String,
) -> Result<CommitSuggestion, AppError> {
    let path = repo_path(&state)?;
    offload(move || {
        let claude =
            ai::claude_path().ok_or_else(|| AppError::Other("Claude Code CLI not found".into()))?;
        ai::suggest_commit_message(&path, &claude, &model)
    })
    .await
}
