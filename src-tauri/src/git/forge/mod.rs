//! Forge integration — remote detection, OS keychain token storage,
//! and pull-request / merge-request lookup via REST APIs.
//!
//! Supports GitHub, GitLab (including self-hosted), and Bitbucket Cloud.

pub mod bitbucket;
pub mod credential;
pub mod github;
pub mod gitlab;
pub mod keychain;

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::AppError;
use crate::git::exec::run_git;
use crate::git::types::{CiJob, ForgeConfig, ForgeKind, ForgeRepo, Pipeline, PrInfo};

pub(crate) const USER_AGENT: &str = "prefetch-git-client/0.1";

// Re-export keychain + credential for callers that use `forge::` paths
pub use credential::authenticated_remote_url;
pub use keychain::{
    delete_token_for_profile, load_refresh_token_for_profile, load_token_for_profile,
    save_refresh_token_for_profile, save_token_for_profile,
};

// ── Provider trait ──────────────────────────────────────────────────────────

/// Token type — OAuth or Personal Access Token / API Token.
#[derive(Debug, Clone, serde::Serialize)]
pub enum TokenType {
    #[serde(rename = "oauth")]
    OAuth,
    #[serde(rename = "pat")]
    Pat,
}

/// Information about a stored forge token.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TokenInfo {
    pub token_type: TokenType,
    pub username: String,
    pub avatar_url: String,
}

/// Operations that vary per git hosting provider.
pub trait ForgeProvider: Send + Sync {
    /// The HTTP username for injecting credentials into HTTPS remote URLs.
    /// May depend on host and token (Bitbucket API tokens need the actual username).
    fn http_auth_username(&self, host: &str, token: &str) -> String;

    /// Classify a token as OAuth or PAT based on its prefix/format.
    fn detect_token_type(&self, token: &str) -> TokenType;

    /// Fetch authenticated user info (username, avatar_url) from the provider API.
    fn get_user_info(&self, host: &str, token: &str) -> Option<(String, String)>;

    /// Search for a user's avatar by email address.
    fn search_avatar(&self, host: &str, token: &Option<String>, email: &str) -> Option<String>;

    /// Look up the open PR/MR for a branch.
    fn get_pr_for_branch(
        &self,
        config: &ForgeConfig,
        branch: &str,
        token: &Option<String>,
    ) -> Option<PrInfo>;

    /// List repositories the authenticated user has access to.
    fn list_repos(&self, host: &str, token: &str) -> Result<Vec<ForgeRepo>, AppError>;

    // ── CI / Pipeline methods ────────────────────────────────────────────────

    /// List recent pipelines/workflow runs for a branch.
    fn list_pipelines(
        &self,
        config: &ForgeConfig,
        branch: Option<&str>,
        token: &str,
        per_page: u32,
    ) -> Result<Vec<Pipeline>, AppError>;

    /// List jobs within a pipeline/workflow run.
    fn list_pipeline_jobs(
        &self,
        config: &ForgeConfig,
        pipeline_id: u64,
        token: &str,
    ) -> Result<Vec<CiJob>, AppError>;

    /// Download the log for a single job (raw text, may contain ANSI escapes).
    fn get_job_log(
        &self,
        config: &ForgeConfig,
        job_id: u64,
        token: &str,
    ) -> Result<String, AppError>;
}

/// Get the provider implementation for a ForgeKind.
pub fn provider(kind: &ForgeKind) -> &'static dyn ForgeProvider {
    match kind {
        ForgeKind::GitHub => &github::GitHubProvider,
        ForgeKind::GitLab => &gitlab::GitLabProvider,
        ForgeKind::Bitbucket => &bitbucket::BitbucketProvider,
    }
}

// ── Remote detection ────────────────────────────────────────────────────────

static HOST_KIND_CACHE: std::sync::LazyLock<Mutex<HashMap<String, ForgeKind>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Detect the forge (GitHub / GitLab / Bitbucket) from the repo's `origin` remote URL.
pub fn detect_forge(path: &str) -> Result<Option<ForgeConfig>, AppError> {
    let output = run_git(path, &["remote", "get-url", "origin"], &[]);
    let url = match output {
        Ok(u) => u.trim().to_string(),
        Err(_) => return Ok(None),
    };

    parse_remote_url(&url)
}

fn parse_remote_url(url: &str) -> Result<Option<ForgeConfig>, AppError> {
    // SSH: git@github.com:owner/repo.git
    //      git@gitlab.com:owner/subgroup/repo.git
    if let Some(at_pos) = url.find('@') {
        if let Some(colon_pos) = url[at_pos..].find(':') {
            let host = url[at_pos + 1..at_pos + colon_pos].to_string();
            let path_part = url[at_pos + colon_pos + 1..]
                .trim_end_matches(".git")
                .to_string();
            let (owner, repo) = split_owner_repo(&path_part)?;
            let kind = classify_host(&host);
            return Ok(Some(ForgeConfig {
                kind,
                host,
                owner,
                repo,
            }));
        }
    }

    // HTTPS: https://github.com/owner/repo.git
    //        https://user@bitbucket.org/owner/repo.git
    //        https://user:token@host/owner/repo.git  (strip credentials)
    if url.starts_with("https://") || url.starts_with("http://") {
        let without_scheme = url
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        // Strip user:pass@ or user@ prefix before extracting the host
        let without_creds = if let Some(at_pos) = without_scheme.find('@') {
            let after_at = &without_scheme[at_pos + 1..];
            // Only strip if there's still a path component after the @
            if after_at.contains('/') {
                after_at
            } else {
                without_scheme
            }
        } else {
            without_scheme
        };
        if let Some(slash) = without_creds.find('/') {
            let host = without_creds[..slash].to_string();
            let path_part = without_creds[slash + 1..]
                .trim_end_matches(".git")
                .to_string();
            let (owner, repo) = split_owner_repo(&path_part)?;
            let kind = classify_host(&host);
            return Ok(Some(ForgeConfig {
                kind,
                host,
                owner,
                repo,
            }));
        }
    }

    Ok(None)
}

fn split_owner_repo(path: &str) -> Result<(String, String), AppError> {
    let parts: Vec<&str> = path.splitn(2, '/').collect();
    if parts.len() < 2 || parts[1].is_empty() {
        return Err(AppError::Other(format!(
            "Cannot parse owner/repo from: {path}"
        )));
    }
    let owner = parts[0].to_string();
    let repo = parts[1]
        .split('/')
        .next_back()
        .unwrap_or(parts[1])
        .to_string();
    Ok((owner, repo))
}

pub fn classify_host(host: &str) -> ForgeKind {
    let lower = host.to_lowercase();
    if lower.contains("github") {
        return ForgeKind::GitHub;
    }
    if lower.contains("gitlab") {
        return ForgeKind::GitLab;
    }
    if lower.contains("bitbucket") {
        return ForgeKind::Bitbucket;
    }

    if let Ok(cache) = HOST_KIND_CACHE.lock() {
        if let Some(kind) = cache.get(host) {
            return kind.clone();
        }
    }

    let kind = probe_gitlab_api(host).unwrap_or(ForgeKind::GitHub);

    if let Ok(mut cache) = HOST_KIND_CACHE.lock() {
        cache.insert(host.to_string(), kind.clone());
    }

    kind
}

fn probe_gitlab_api(host: &str) -> Option<ForgeKind> {
    let url = format!("https://{host}/api/v4/version");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    let resp = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .ok()?;
    let status = resp.status().as_u16();
    if status == 200 || status == 401 {
        Some(ForgeKind::GitLab)
    } else {
        None
    }
}

// ── Public API functions (dispatch through trait) ───────────────────────────

/// Get the HTTP auth username for credential injection into HTTPS URLs.
pub fn http_auth_username(host: &str, token: &str) -> String {
    let kind = classify_host(host);
    let p = provider(&kind);
    p.http_auth_username(host, token)
}

/// Fetch user info for a stored token by calling the forge's user API.
///
/// If the API call fails and a refresh token is available (GitLab/Bitbucket
/// OAuth), transparently refreshes the access token and retries once.
pub fn get_token_info(profile_id: Option<&str>, host: &str) -> Option<TokenInfo> {
    let mut token = load_token_for_profile(profile_id, host).ok()??;
    let kind = classify_host(host);
    let p = provider(&kind);
    let mut token_type = p.detect_token_type(&token);
    let refresh_token = load_refresh_token_for_profile(profile_id, host)
        .ok()
        .flatten();
    // If a refresh token exists, the token came from an OAuth flow regardless
    // of what the format heuristic says (Bitbucket tokens lack distinguishing prefixes).
    if matches!(token_type, TokenType::Pat) && refresh_token.is_some() {
        token_type = TokenType::OAuth;
    }

    let result = p.get_user_info(host, &token);
    let (username, avatar_url) = match result {
        Some(info) => info,
        None if refresh_token.is_some() => {
            if let Some(new_token) =
                try_refresh_blocking(profile_id, host, &kind, &refresh_token.unwrap())
            {
                token = new_token;
                token_type = TokenType::OAuth;
                p.get_user_info(host, &token)?
            } else {
                return None;
            }
        }
        None => return None,
    };

    Some(TokenInfo {
        token_type,
        username,
        avatar_url,
    })
}

fn try_refresh_blocking(
    profile_id: Option<&str>,
    host: &str,
    kind: &ForgeKind,
    refresh_token: &str,
) -> Option<String> {
    use crate::git::types::ForgeKind;

    let (token_url, client_id, client_secret) = match kind {
        ForgeKind::GitLab => (
            "https://gitlab.com/oauth/token",
            env!("GITLAB_OAUTH_CLIENT_ID"),
            Some(env!("GITLAB_OAUTH_CLIENT_SECRET")),
        ),
        ForgeKind::Bitbucket => (
            "https://bitbucket.org/site/oauth2/access_token",
            option_env!("BB_OAUTH_CLIENT_ID").unwrap_or(""),
            option_env!("BB_OAUTH_CLIENT_SECRET"),
        ),
        _ => return None,
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let mut params = vec![
        ("client_id", client_id),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ];
    if let Some(secret) = client_secret {
        params.push(("client_secret", secret));
    }

    let resp = client
        .post(token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .ok()?;

    if !resp.status().is_success() {
        tracing::warn!(
            status = %resp.status(),
            host = %host,
            "Blocking token refresh failed"
        );
        return None;
    }

    let json: serde_json::Value = resp.json().ok()?;
    let new_access = json["access_token"].as_str()?;

    save_token_for_profile(profile_id, host, new_access).ok()?;
    if let Some(new_refresh) = json["refresh_token"].as_str() {
        save_refresh_token_for_profile(profile_id, host, new_refresh).ok();
    }

    tracing::debug!(host = %host, "Token refreshed successfully (blocking)");
    Some(new_access.to_string())
}

/// Search for a user's avatar URL by email using the forge's API.
pub fn search_user_avatar(host: &str, token: &Option<String>, email: &str) -> Option<String> {
    let kind = classify_host(host);
    let p = provider(&kind);
    p.search_avatar(host, token, email)
}

/// Look up the open PR / MR for `branch` on the detected forge.
pub fn get_pr_for_branch(
    config: &ForgeConfig,
    branch: &str,
    token: &Option<String>,
) -> Option<PrInfo> {
    let p = provider(&config.kind);
    p.get_pr_for_branch(config, branch, token)
}

/// List repositories the authenticated user has access to.
pub fn list_user_repos(host: &str, token: &str) -> Result<Vec<ForgeRepo>, AppError> {
    let kind = classify_host(host);
    let p = provider(&kind);
    p.list_repos(host, token)
}

// ── CI / Pipeline public API ──────────────────────────────────────────────

pub fn list_pipelines(
    config: &ForgeConfig,
    branch: Option<&str>,
    token: &str,
    per_page: u32,
) -> Result<Vec<Pipeline>, AppError> {
    let p = provider(&config.kind);
    p.list_pipelines(config, branch, token, per_page)
}

pub fn list_pipeline_jobs(
    config: &ForgeConfig,
    pipeline_id: u64,
    token: &str,
) -> Result<Vec<CiJob>, AppError> {
    let p = provider(&config.kind);
    p.list_pipeline_jobs(config, pipeline_id, token)
}

pub fn get_job_log(config: &ForgeConfig, job_id: u64, token: &str) -> Result<String, AppError> {
    let p = provider(&config.kind);
    p.get_job_log(config, job_id, token)
}
