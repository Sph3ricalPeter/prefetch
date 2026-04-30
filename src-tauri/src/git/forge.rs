//! GitHub / GitLab integration — remote detection, OS keychain token storage,
//! and pull-request / merge-request lookup via REST APIs.

use crate::error::AppError;
use crate::git::repository::run_git;
use crate::git::types::{ForgeConfig, ForgeKind, PrInfo};

// ── Remote detection ─────────────────────────────────────────────────────────

/// Detect the forge (GitHub / GitLab) from the repo's `origin` remote URL.
///
/// Handles SSH (`git@github.com:owner/repo.git`) and HTTPS
/// (`https://github.com/owner/repo.git`) formats.
///
/// Returns `None` if there is no `origin` remote or the URL is unrecognised.
pub fn detect_forge(path: &str) -> Result<Option<ForgeConfig>, AppError> {
    let output = run_git(path, &["remote", "get-url", "origin"], &[]);
    let url = match output {
        Ok(u) => u.trim().to_string(),
        Err(_) => return Ok(None), // no origin remote
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
    //        https://gitlab.com/owner/repo.git
    if url.starts_with("https://") || url.starts_with("http://") {
        let without_scheme = url
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        if let Some(slash) = without_scheme.find('/') {
            let host = without_scheme[..slash].to_string();
            let path_part = without_scheme[slash + 1..]
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

/// Split a path like "owner/repo" or "owner/group/repo" into (owner, repo).
/// For GitLab subgroups the last component is the repo name.
fn split_owner_repo(path: &str) -> Result<(String, String), AppError> {
    let parts: Vec<&str> = path.splitn(2, '/').collect();
    if parts.len() < 2 || parts[1].is_empty() {
        return Err(AppError::Other(format!(
            "Cannot parse owner/repo from: {path}"
        )));
    }
    let owner = parts[0].to_string();
    // For subgroups (a/b/c) the last segment is the repo
    let repo = parts[1]
        .split('/')
        .next_back()
        .unwrap_or(parts[1])
        .to_string();
    Ok((owner, repo))
}

fn classify_host(host: &str) -> ForgeKind {
    if host.contains("gitlab") {
        ForgeKind::GitLab
    } else {
        // Default to GitHub for github.com and any other host
        ForgeKind::GitHub
    }
}

// ── OS keychain token storage ─────────────────────────────────────────────────

const KEYCHAIN_SERVICE: &str = "prefetch";

/// Build the keyring username for a host, optionally scoped to a profile.
///
/// - No profile: `"github.com"` (legacy key)
/// - With profile: `"<profile_id>/github.com"`
fn keyring_user(profile_id: Option<&str>, host: &str) -> String {
    match profile_id {
        Some(id) => format!("{id}/{host}"),
        None => host.to_string(),
    }
}

/// Store a forge PAT in the OS keychain.
pub fn save_token_for_profile(
    profile_id: Option<&str>,
    host: &str,
    token: &str,
) -> Result<(), AppError> {
    let user = keyring_user(profile_id, host);
    keyring::Entry::new(KEYCHAIN_SERVICE, &user)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?
        .set_password(token)
        .map_err(|e| AppError::Other(format!("Failed to save token: {e}")))
}

/// Retrieve a forge PAT from the OS keychain, trying profile-scoped key first.
///
/// Fallback order:
/// 1. If `profile_id` is `Some`, try `<profile_id>/<host>` first.
/// 2. Fall back to `<host>` (legacy / shared key).
/// 3. If `profile_id` is `None`, use `<host>` directly.
pub fn load_token_for_profile(
    profile_id: Option<&str>,
    host: &str,
) -> Result<Option<String>, AppError> {
    if let Some(pid) = profile_id {
        // Try profile-scoped key first
        let user = keyring_user(Some(pid), host);
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &user)
            .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
        match entry.get_password() {
            Ok(token) => return Ok(Some(token)),
            Err(keyring::Error::NoEntry) => {
                // Fall through to legacy key
            }
            Err(e) => return Err(AppError::Other(format!("Failed to load token: {e}"))),
        }
    }

    // Legacy / no-profile key
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, host)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(format!("Failed to load token: {e}"))),
    }
}

/// Delete a forge PAT from the OS keychain (profile-scoped or legacy).
pub fn delete_token_for_profile(profile_id: Option<&str>, host: &str) -> Result<(), AppError> {
    let user = keyring_user(profile_id, host);
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &user)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone — not an error
        Err(e) => Err(AppError::Other(format!("Failed to delete token: {e}"))),
    }?;
    // Also remove any associated refresh token
    delete_refresh_token_for_profile(profile_id, host).ok();
    Ok(())
}

// ── Refresh token storage ───────────────────────────────────────────────────

const REFRESH_SERVICE: &str = "prefetch-refresh";

fn refresh_keyring_user(profile_id: Option<&str>, host: &str) -> String {
    match profile_id {
        Some(id) => format!("{id}/{host}"),
        None => host.to_string(),
    }
}

pub fn save_refresh_token_for_profile(
    profile_id: Option<&str>,
    host: &str,
    token: &str,
) -> Result<(), AppError> {
    let user = refresh_keyring_user(profile_id, host);
    keyring::Entry::new(REFRESH_SERVICE, &user)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?
        .set_password(token)
        .map_err(|e| AppError::Other(format!("Failed to save refresh token: {e}")))
}

pub fn load_refresh_token_for_profile(
    profile_id: Option<&str>,
    host: &str,
) -> Result<Option<String>, AppError> {
    if let Some(pid) = profile_id {
        let user = refresh_keyring_user(Some(pid), host);
        let entry = keyring::Entry::new(REFRESH_SERVICE, &user)
            .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
        match entry.get_password() {
            Ok(token) => return Ok(Some(token)),
            Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(AppError::Other(format!("Failed to load refresh token: {e}"))),
        }
    }
    let entry = keyring::Entry::new(REFRESH_SERVICE, host)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(format!("Failed to load refresh token: {e}"))),
    }
}

fn delete_refresh_token_for_profile(profile_id: Option<&str>, host: &str) -> Result<(), AppError> {
    let user = refresh_keyring_user(profile_id, host);
    let entry = keyring::Entry::new(REFRESH_SERVICE, &user)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!("Failed to delete refresh token: {e}"))),
    }
}

// ── Credential injection ─────────────────────────────────────────────────────

/// An authenticated remote URL paired with environment and CLI overrides
/// that suppress Git Credential Manager for this command.
///
/// When credentials are embedded in the URL, GCM must be disabled to prevent
/// it from caching `x-access-token` entries that conflict with the user's
/// normal GitHub credentials (which causes the "Select an account" popup).
pub struct AuthenticatedRemote {
    /// The HTTPS URL with embedded credentials,
    /// e.g. `https://x-access-token:TOKEN@github.com/owner/repo.git`.
    pub url: String,
    /// Extra `-c key=value` args to prepend **before** the git subcommand.
    /// Currently `["-c", "credential.helper="]` to disable all helpers.
    pub extra_args: Vec<String>,
    /// Extra environment variables that suppress interactive prompts.
    pub extra_env: Vec<(String, String)>,
}

impl AuthenticatedRemote {
    /// Build a complete args vector: credential-suppression flags first,
    /// then the caller-provided subcommand args.
    pub fn build_args<'a>(&'a self, subcommand_args: &[&'a str]) -> Vec<&'a str> {
        let mut args: Vec<&str> = self.extra_args.iter().map(|s| s.as_str()).collect();
        args.extend_from_slice(subcommand_args);
        args
    }

    /// Merge credential-suppression env vars with the caller's existing env.
    pub fn merge_env(&self, base_env: &[(String, String)]) -> Vec<(String, String)> {
        let mut env = base_env.to_vec();
        env.extend(self.extra_env.clone());
        env
    }
}

/// Build an authenticated HTTPS remote URL for git CLI operations.
///
/// For HTTPS remotes with a stored token, returns an [`AuthenticatedRemote`]
/// containing the URL with embedded credentials **and** the CLI / env
/// overrides needed to suppress Git Credential Manager.
///
/// `profile_id` scopes the token lookup — tries profile-specific key first,
/// then falls back to the legacy shared key.
///
/// Returns `None` for SSH remotes or when no token is stored — the caller
/// should fall back to the normal remote name so the user's SSH keys /
/// credential helper still work.
pub fn authenticated_remote_url(
    path: &str,
    profile_id: Option<&str>,
) -> Option<AuthenticatedRemote> {
    let url = run_git(path, &["remote", "get-url", "origin"], &[]).ok()?;
    let url = url.trim();

    // Only inject credentials for HTTPS remotes
    if !url.starts_with("https://") {
        return None;
    }

    let config = detect_forge(path).ok()??;
    let token = load_token_for_profile(profile_id, &config.host).ok()??;

    let username = match config.kind {
        ForgeKind::GitHub => "x-access-token",
        ForgeKind::GitLab => "oauth2",
    };

    // https://github.com/... → https://x-access-token:TOKEN@github.com/...
    let authed = url.replacen("https://", &format!("https://{username}:{token}@"), 1);

    Some(AuthenticatedRemote {
        url: authed,
        extra_args: vec!["-c".to_string(), "credential.helper=".to_string()],
        extra_env: vec![
            ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
            ("GCM_INTERACTIVE".to_string(), "never".to_string()),
        ],
    })
}

// ── Token info lookup ────────────────────────────────────────────────────────

/// Token type — OAuth or Personal Access Token.
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

/// Detect token type from its prefix.
fn detect_token_type(host: &str, token: &str) -> TokenType {
    match host {
        "github.com" => {
            if token.starts_with("ghp_") || token.starts_with("github_pat_") {
                TokenType::Pat
            } else {
                TokenType::OAuth
            }
        }
        "gitlab.com" => {
            if token.starts_with("glpat-") {
                TokenType::Pat
            } else {
                TokenType::OAuth
            }
        }
        _ => TokenType::Pat, // assume PAT for unknown hosts
    }
}

/// Fetch user info for a stored token by calling the forge's user API.
/// Returns `None` if no token is stored or the API call fails.
pub fn get_token_info(profile_id: Option<&str>, host: &str) -> Option<TokenInfo> {
    let token = load_token_for_profile(profile_id, host).ok()??;
    let token_type = detect_token_type(host, &token);

    let (url, auth_header, auth_value) = match host {
        "github.com" => (
            "https://api.github.com/user".to_string(),
            "Authorization",
            format!("Bearer {token}"),
        ),
        "gitlab.com" => match token_type {
            TokenType::Pat => (
                "https://gitlab.com/api/v4/user".to_string(),
                "PRIVATE-TOKEN",
                token.clone(),
            ),
            TokenType::OAuth => (
                "https://gitlab.com/api/v4/user".to_string(),
                "Authorization",
                format!("Bearer {token}"),
            ),
        },
        _ => return None,
    };

    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "prefetch-git-client/0.1")
        .header(auth_header, &auth_value)
        .send()
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let json: serde_json::Value = resp.json().ok()?;

    let username = match host {
        "github.com" => json["login"].as_str()?.to_string(),
        "gitlab.com" => json["username"].as_str()?.to_string(),
        _ => return None,
    };

    let avatar_url = json["avatar_url"].as_str().unwrap_or("").to_string();

    Some(TokenInfo {
        token_type,
        username,
        avatar_url,
    })
}

// ── PR / MR lookup ────────────────────────────────────────────────────────────

/// Look up the open PR / MR for `branch` on the detected forge.
///
/// Makes a synchronous HTTP request using `reqwest::blocking`.
/// Returns `None` if the branch has no open PR, or if the API call fails
/// (e.g. no token, network error) — failures are silenced so the UI
/// degrades gracefully.
pub fn get_pr_for_branch(
    config: &ForgeConfig,
    branch: &str,
    token: &Option<String>,
) -> Option<PrInfo> {
    match config.kind {
        ForgeKind::GitHub => github_get_pr(config, branch, token),
        ForgeKind::GitLab => gitlab_get_mr(config, branch, token),
    }
}

fn github_get_pr(config: &ForgeConfig, branch: &str, token: &Option<String>) -> Option<PrInfo> {
    let url = format!(
        "https://api.{}/repos/{}/{}/pulls?head={}:{}&state=open&per_page=1",
        config.host, config.owner, config.repo, config.owner, branch
    );

    let client = reqwest::blocking::Client::new();
    let mut req = client
        .get(&url)
        .header("User-Agent", "prefetch-git-client/0.1")
        .header("Accept", "application/vnd.github+json");

    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }

    let resp = req.send().ok()?;
    let prs: Vec<serde_json::Value> = resp.json().ok()?;
    let pr = prs.into_iter().next()?;

    Some(PrInfo {
        number: pr["number"].as_u64()?,
        title: pr["title"].as_str()?.to_string(),
        url: pr["html_url"].as_str()?.to_string(),
        state: pr["state"].as_str().unwrap_or("open").to_string(),
    })
}

fn gitlab_get_mr(config: &ForgeConfig, branch: &str, token: &Option<String>) -> Option<PrInfo> {
    // URL-encode owner/repo for the project ID path
    let project_path =
        urlencoding::encode(&format!("{}/{}", config.owner, config.repo)).into_owned();

    let url = format!(
        "https://{}/api/v4/projects/{}/merge_requests?source_branch={}&state=opened&per_page=1",
        config.host, project_path, branch
    );

    let client = reqwest::blocking::Client::new();
    let mut req = client
        .get(&url)
        .header("User-Agent", "prefetch-git-client/0.1");

    if let Some(t) = token {
        if t.starts_with("glpat-") {
            req = req.header("PRIVATE-TOKEN", t.as_str());
        } else {
            req = req.header("Authorization", format!("Bearer {t}"));
        }
    }

    let resp = req.send().ok()?;
    let mrs: Vec<serde_json::Value> = resp.json().ok()?;
    let mr = mrs.into_iter().next()?;

    Some(PrInfo {
        number: mr["iid"].as_u64()?,
        title: mr["title"].as_str()?.to_string(),
        url: mr["web_url"].as_str()?.to_string(),
        state: mr["state"].as_str().unwrap_or("opened").to_string(),
    })
}
