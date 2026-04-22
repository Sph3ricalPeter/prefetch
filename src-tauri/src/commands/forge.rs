//! Tauri commands for GitHub / GitLab forge integration.

use crate::error::AppError;
use crate::git::{
    forge,
    types::{ForgeConfig, PrInfo},
};
use crate::AppState;
use serde::Serialize;
use tauri::State;
use tracing::instrument;

/// Helper to get the open repository path from state.
fn repo_path(state: &State<'_, AppState>) -> Result<String, AppError> {
    let lock = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    lock.clone()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))
}

/// Run a blocking closure on the tokio thread pool.
async fn offload<F, T>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("Task join error: {e}")))?
}

// ── Forge status ──────────────────────────────────────────────────────────────

/// The forge status returned to the frontend — config + whether a token exists.
#[derive(Debug, Clone, Serialize)]
pub struct ForgeStatus {
    pub kind: Option<String>, // "github" | "gitlab" | null
    pub host: Option<String>,
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub has_token: bool,
}

/// Detect the forge from the open repo's remote URL and check for a stored PAT.
/// Uses the active profile for token lookup when available.
#[instrument(skip(state))]
#[tauri::command]
pub async fn get_forge_status(state: State<'_, AppState>) -> Result<ForgeStatus, AppError> {
    let path = repo_path(&state)?;
    let profile_id = state
        .active_profile
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|p| p.profile_id.clone()));

    offload(move || {
        let config = forge::detect_forge(&path)?;
        match config {
            None => Ok(ForgeStatus {
                kind: None,
                host: None,
                owner: None,
                repo: None,
                has_token: false,
            }),
            Some(cfg) => {
                let token =
                    forge::load_token_for_profile(profile_id.as_deref(), &cfg.host).unwrap_or(None);
                Ok(ForgeStatus {
                    kind: Some(format!("{:?}", cfg.kind).to_lowercase()),
                    host: Some(cfg.host),
                    owner: Some(cfg.owner),
                    repo: Some(cfg.repo),
                    has_token: token.is_some(),
                })
            }
        }
    })
    .await
}

// ── Token management ──────────────────────────────────────────────────────────

/// Store a PAT for the given host in the OS keychain.
#[tauri::command]
pub async fn save_forge_token(
    host: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let profile_id = state
        .active_profile
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|p| p.profile_id.clone()));
    offload(move || forge::save_token_for_profile(profile_id.as_deref(), &host, &token)).await
}

/// Remove the PAT for the given host from the OS keychain.
#[tauri::command]
pub async fn delete_forge_token(host: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let profile_id = state
        .active_profile
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|p| p.profile_id.clone()));
    offload(move || forge::delete_token_for_profile(profile_id.as_deref(), &host)).await
}

// ── PR / MR lookup ────────────────────────────────────────────────────────────

/// Return the open PR/MR for the given branch, or null if none exists.
#[tauri::command]
pub async fn get_pr_for_branch(
    branch: String,
    state: State<'_, AppState>,
) -> Result<Option<PrInfo>, AppError> {
    let path = repo_path(&state)?;

    // Check cache
    {
        let cache = state
            .pr_cache
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        if let Some(cached) = cache.get(&branch) {
            return Ok(cached.clone());
        }
    }

    let profile_id = state
        .active_profile
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|p| p.profile_id.clone()));

    let branch_clone = branch.clone();
    let pr = offload(move || {
        let config: Option<ForgeConfig> = forge::detect_forge(&path)?;
        let pr = match config {
            None => None,
            Some(ref cfg) => {
                let token =
                    forge::load_token_for_profile(profile_id.as_deref(), &cfg.host).unwrap_or(None);
                forge::get_pr_for_branch(cfg, &branch_clone, &token)
            }
        };
        Ok(pr)
    })
    .await?;

    // Store result (including None) so we don't hammer the API
    {
        let mut cache = state
            .pr_cache
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        cache.insert(branch, pr.clone());
    }

    Ok(pr)
}

/// Clear the PR cache (call after fetch / pull so stale badges are refreshed).
#[tauri::command]
pub fn clear_pr_cache(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut cache = state
        .pr_cache
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    cache.clear();
    Ok(())
}

// ── Open URL ──────────────────────────────────────────────────────────────────

/// Open a URL in the system default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    open::that(&url).map_err(|e| AppError::Other(format!("Failed to open URL: {e}")))?;
    Ok(())
}
