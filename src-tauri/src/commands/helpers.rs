//! Shared helpers for Tauri command handlers.

use crate::error::AppError;
use crate::git::repository;
use crate::AppState;
use tauri::State;

/// Extract the repo path from state (convenience helper).
pub fn repo_path(state: &State<'_, AppState>) -> Result<String, AppError> {
    let lock = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    lock.as_ref()
        .cloned()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))
}

/// Build profile environment variables from the active profile in AppState.
/// Returns an empty Vec when no profile is active (no-op for git commands).
pub fn get_profile_env(state: &State<'_, AppState>) -> Vec<(String, String)> {
    let profile = state
        .active_profile
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    repository::profile_env(&profile)
}

/// Extract the active profile's ID (for profile-scoped token lookup).
pub fn get_profile_id(state: &State<'_, AppState>) -> Option<String> {
    state
        .active_profile
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|p| p.profile_id.clone()))
}

/// Run a blocking closure on the tokio thread pool instead of the main thread.
///
/// Tauri v2 runs sync `#[tauri::command]` functions on the main thread, which
/// freezes the window during subprocess spawns and git2-rs operations. This
/// helper moves the work off the main thread.
pub async fn offload<F, T>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("Task join error: {e}")))?
}
