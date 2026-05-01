use crate::background::BackgroundFetcher;
use crate::error::AppError;
use crate::git::profile::ActiveProfile;
use crate::AppState;
use tauri::State;

/// Set the active profile. Pass `None` to deactivate profiles (use git config).
///
/// Also restarts the background fetcher so it uses the new profile's credentials.
#[tauri::command]
pub fn set_active_profile(
    profile: Option<ActiveProfile>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    // Update the active profile
    {
        let mut lock = state
            .active_profile
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *lock = profile.clone();
    }

    // Restart the background fetcher with the new profile's credentials
    // (only if a repo is currently open)
    let repo_path = state.repo_path.lock().ok().and_then(|guard| guard.clone());

    if let Some(path) = repo_path {
        let mut fetcher_lock = state
            .fetcher
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *fetcher_lock = None; // Drop old fetcher
        *fetcher_lock = Some(BackgroundFetcher::start(
            path,
            app,
            profile,
            std::sync::Arc::clone(&state.fetch_interval_secs),
        ));
    }

    Ok(())
}

/// Get the currently active profile, if any.
#[tauri::command]
pub fn get_active_profile(state: State<'_, AppState>) -> Result<Option<ActiveProfile>, AppError> {
    let lock = state
        .active_profile
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(lock.clone())
}
