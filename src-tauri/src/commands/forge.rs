//! Tauri commands for GitHub / GitLab forge integration.

use crate::commands::helpers::{get_profile_id, offload, repo_path};
use crate::error::AppError;
use crate::git::{
    forge,
    types::{ForgeConfig, PrInfo},
};
use crate::oauth;
use crate::AppState;
use serde::Serialize;
use tauri::State;
use tracing::instrument;

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
    let profile_id = get_profile_id(&state);

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
///
/// If `profile_id` is provided, the token is stored under that profile.
/// Otherwise falls back to the active profile from state, or legacy (no profile) key.
#[tauri::command]
pub async fn save_forge_token(
    host: String,
    token: String,
    profile_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pid = profile_id.or_else(|| get_profile_id(&state));
    offload(move || forge::save_token_for_profile(pid.as_deref(), &host, &token)).await
}

/// Remove the PAT for the given host from the OS keychain.
///
/// If `profile_id` is provided, deletes the token for that profile.
/// Otherwise falls back to the active profile from state, or legacy (no profile) key.
#[tauri::command]
pub async fn delete_forge_token(
    host: String,
    profile_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pid = profile_id.or_else(|| get_profile_id(&state));
    offload(move || forge::delete_token_for_profile(pid.as_deref(), &host)).await
}

/// Check whether a token exists for a given profile + host.
///
/// Used by the settings UI to show token status per-profile without
/// needing a repo open (unlike `get_forge_status` which requires a repo).
#[tauri::command]
pub async fn check_profile_token(profile_id: String, host: String) -> Result<bool, AppError> {
    offload(move || {
        let token = forge::load_token_for_profile(Some(&profile_id), &host)?;
        Ok(token.is_some())
    })
    .await
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

    let profile_id = get_profile_id(&state);

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

// ── OAuth ────────────────────────────────────────────────────────────────────

/// Start an OAuth authorization code flow for the given forge.
///
/// Opens the system browser, waits for the callback, exchanges the code
/// for a token, and stores it in the OS keychain.
#[tauri::command]
pub async fn start_oauth_flow(
    provider: String,
    profile_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<oauth::OAuthResult, AppError> {
    let pid = profile_id.or_else(|| get_profile_id(&state));

    let provider = match provider.as_str() {
        "github" => oauth::OAuthProvider::GitHub,
        "gitlab" => oauth::OAuthProvider::GitLab,
        other => {
            return Err(AppError::Other(format!(
                "Unknown OAuth provider: {other}"
            )))
        }
    };

    oauth::start_flow(provider, pid).await
}

/// Cancel any in-progress OAuth flow.
#[tauri::command]
pub async fn cancel_oauth_flow() -> Result<(), AppError> {
    oauth::cancel_flow().await;
    Ok(())
}

// ── Open URL ──────────────────────────────────────────────────────────────────

/// Open a URL in the system default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    open::that(&url).map_err(|e| AppError::Other(format!("Failed to open URL: {e}")))?;
    Ok(())
}
