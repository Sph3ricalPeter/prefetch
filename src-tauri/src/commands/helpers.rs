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
    // If it doesn't exist (deleted files/folders), walk up the directory tree
    // until we find an existing ancestor, canonicalize it, and append the rest.
    let resolved = if joined.exists() {
        dunce::canonicalize(&joined)
            .map_err(|e| AppError::Other(format!("Cannot resolve path: {e}")))?
    } else {
        // Collect path components that don't exist on disk, walking upward.
        let mut missing_parts = Vec::new();
        let mut ancestor = joined.as_path();
        loop {
            if ancestor.exists() {
                break;
            }
            match (ancestor.file_name(), ancestor.parent()) {
                (Some(name), Some(parent)) => {
                    missing_parts.push(name.to_os_string());
                    ancestor = parent;
                }
                _ => {
                    return Err(AppError::PathTraversal(file_path.to_string()));
                }
            }
        }
        let mut result = dunce::canonicalize(ancestor)
            .map_err(|e| AppError::Other(format!("Cannot resolve ancestor path: {e}")))?;
        // Re-append the missing components in the correct order.
        for part in missing_parts.into_iter().rev() {
            result.push(part);
        }
        result
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

/// Refresh GitLab OAuth tokens if needed before git write operations.
/// Silently succeeds when no refresh is needed or on failure (the git
/// command will use whatever token is in the keychain).
pub async fn refresh_forge_token(state: &State<'_, AppState>) {
    let path = match repo_path(state) {
        Ok(p) => p,
        Err(_) => return,
    };
    let pid = get_profile_id(state);
    crate::oauth::try_refresh_gitlab_token(&path, pid.as_deref())
        .await
        .ok();
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
