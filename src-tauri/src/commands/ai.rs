//! Tauri commands for Claude-assisted features.

use crate::commands::helpers::{get_profile_env, offload, repo_path};
use crate::error::AppError;
use crate::git::ai;
use crate::AppState;
use tauri::State;

/// Whether the `claude` CLI is installed. Probed once per app run.
#[tauri::command]
pub async fn ai_available() -> Result<bool, AppError> {
    offload(|| Ok(ai::claude_path().is_some())).await
}

/// Infer a Change Brief with `claude -p` for the working changes (`commit_id`
/// None) or a commit, replacing whatever brief was there.
#[tauri::command]
pub async fn generate_brief(
    state: State<'_, AppState>,
    model: String,
    commit_id: Option<String>,
) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || {
        let claude =
            ai::claude_path().ok_or_else(|| AppError::Other("Claude Code CLI not found".into()))?;
        ai::generate_brief(&path, &claude, &model, commit_id.as_deref(), &env)
    })
    .await
}

/// Suggest a commit message for the staged diff via `claude -p`.
#[tauri::command]
pub async fn suggest_commit_message(
    state: State<'_, AppState>,
    model: String,
) -> Result<ai::CommitSuggestion, AppError> {
    let path = repo_path(&state)?;
    offload(move || {
        let claude =
            ai::claude_path().ok_or_else(|| AppError::Other("Claude Code CLI not found".into()))?;
        ai::suggest_commit_message(&path, &claude, &model)
    })
    .await
}
