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

/// Infer a commit's Change Brief with `claude -p`, replacing whatever brief
/// was there.
#[tauri::command]
pub async fn generate_brief(
    state: State<'_, AppState>,
    model: String,
    commit_id: String,
) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || {
        let claude =
            ai::claude_path().ok_or_else(|| AppError::Other("Claude Code CLI not found".into()))?;
        ai::generate_brief(&path, &claude, &model, &commit_id, &env)
    })
    .await
}

/// Suggest a commit message for the staged diff via `claude -p`; with
/// `write_brief` it also reviews the Change Briefs (agent drafts included).
#[tauri::command]
pub async fn suggest_commit_message(
    state: State<'_, AppState>,
    model: String,
    write_brief: bool,
    with_body: bool,
) -> Result<ai::CommitSuggestion, AppError> {
    let path = repo_path(&state)?;
    offload(move || {
        let claude =
            ai::claude_path().ok_or_else(|| AppError::Other("Claude Code CLI not found".into()))?;
        ai::suggest_commit_message(&path, &claude, &model, write_brief, with_body)
    })
    .await
}
