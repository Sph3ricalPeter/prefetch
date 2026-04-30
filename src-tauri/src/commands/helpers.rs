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

/// Validate that a user-supplied relative path resolves to a location inside
/// the repository root. Returns the canonical absolute path on success.
///
/// Uses `dunce::canonicalize` on Windows to avoid `\\?\` UNC prefix issues.
/// For paths that don't exist on disk yet (new files), we canonicalize the
/// parent directory and verify the result stays within the repo.
pub fn validate_repo_path(repo_root: &str, file_path: &str) -> Result<String, AppError> {
    let repo_canonical = dunce::canonicalize(repo_root)
        .map_err(|e| AppError::Other(format!("Cannot resolve repo path: {e}")))?;
    let joined = std::path::Path::new(&repo_canonical).join(file_path);

    // Try canonicalizing the full path (works when the file exists).
    // If it doesn't exist, canonicalize the parent and append the file name.
    let resolved = if joined.exists() {
        dunce::canonicalize(&joined)
            .map_err(|e| AppError::Other(format!("Cannot resolve path: {e}")))?
    } else if let Some(parent) = joined.parent() {
        let parent_canon = dunce::canonicalize(parent)
            .map_err(|e| AppError::Other(format!("Cannot resolve parent path: {e}")))?;
        match joined.file_name() {
            Some(name) => parent_canon.join(name),
            None => {
                return Err(AppError::PathTraversal(file_path.to_string()));
            }
        }
    } else {
        return Err(AppError::PathTraversal(file_path.to_string()));
    };

    if !resolved.starts_with(&repo_canonical) {
        return Err(AppError::PathTraversal(file_path.to_string()));
    }

    Ok(resolved.to_string_lossy().to_string())
}

/// Validate a batch of relative paths. Returns early on the first invalid path.
pub fn validate_repo_paths(repo_root: &str, paths: &[String]) -> Result<(), AppError> {
    for p in paths {
        validate_repo_path(repo_root, p)?;
    }
    Ok(())
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
