//! Tauri commands for Change Briefs (#84).

use crate::commands::helpers::{
    get_profile_env, get_profile_id, offload, refresh_forge_token, repo_path,
};
use crate::error::AppError;
use crate::git::brief::{self, Brief, IntentMark, WipBriefs};
use crate::AppState;
use std::collections::HashMap;
use tauri::State;

/// Agent drafts describing the working changes.
#[tauri::command]
pub async fn get_wip_briefs(state: State<'_, AppState>) -> Result<WipBriefs, AppError> {
    let path = repo_path(&state)?;
    offload(move || brief::read_wip(&path)).await
}

/// The brief note on a commit, if one was attached.
#[tauri::command]
pub async fn get_commit_brief(
    commit_id: String,
    state: State<'_, AppState>,
) -> Result<Option<Vec<Brief>>, AppError> {
    let path = repo_path(&state)?;
    offload(move || brief::read_note(&path, &commit_id)).await
}

/// Commits with a brief note, to their intents' risk (graph heat).
#[tauri::command]
pub async fn get_brief_marks(
    state: State<'_, AppState>,
) -> Result<HashMap<String, Vec<IntentMark>>, AppError> {
    let path = repo_path(&state)?;
    offload(move || brief::note_marks(&path)).await
}

/// Note HEAD with the drafts it covers. Separate from `create_commit` so a
/// failure here is reported without making the commit look failed.
#[tauri::command]
pub async fn attach_commit_brief(state: State<'_, AppState>) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || brief::attach_wip(&path, &env)).await
}

#[tauri::command]
pub async fn get_brief_sync(state: State<'_, AppState>) -> Result<bool, AppError> {
    let path = repo_path(&state)?;
    offload(move || brief::sync_enabled(&path)).await
}

#[tauri::command]
pub async fn set_brief_sync(enabled: bool, state: State<'_, AppState>) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || brief::set_sync_enabled(&path, enabled)).await
}

/// Fetch (and with `push`, publish) brief notes; no-op unless the repo opted in.
#[tauri::command]
pub async fn sync_briefs(push: bool, state: State<'_, AppState>) -> Result<(), AppError> {
    refresh_forge_token(&state).await;
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    let pid = get_profile_id(&state);
    offload(move || brief::sync_notes(&path, push, &env, pid.as_deref())).await
}
