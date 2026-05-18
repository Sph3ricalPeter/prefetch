//! GitHub / GitLab integration — remote detection, OS keychain token storage,
//! and pull-request / merge-request lookup via REST APIs.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::AppError;
use crate::git::repository::run_git;
use crate::git::types::{ForgeConfig, ForgeKind, ForgeRepo, PrInfo};

static HOST_KIND_CACHE: std::sync::LazyLock<Mutex<HashMap<String, ForgeKind>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

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
    let lower = host.to_lowercase();
    if lower.contains("github") {
        return ForgeKind::GitHub;
    }
    if lower.contains("gitlab") {
        return ForgeKind::GitLab;
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

/// Probe `GET https://{host}/api/v4/version` to detect GitLab instances.
/// Self-hosted GitLab always exposes this endpoint (even unauthenticated).
fn probe_gitlab_api(host: &str) -> Option<ForgeKind> {
    let url = format!("https://{host}/api/v4/version");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    let resp = client
        .get(&url)
        .header("User-Agent", "prefetch-git-client/0.1")
        .send()
        .ok()?;
    // GitLab returns 200 (public) or 401 (auth required) — both confirm it's GitLab.
    // A non-GitLab host would 404 or connection-refuse.
    let status = resp.status().as_u16();
    if status == 200 || status == 401 {
        Some(ForgeKind::GitLab)
    } else {
        None
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

/// Delete a forge PAT from the OS keychain (profile-scoped AND legacy).
///
/// Mirrors `load_token_for_profile`'s fallback: deletes both the profile-scoped
/// key and the legacy key so the token can't reappear via the fallback path.
pub fn delete_token_for_profile(profile_id: Option<&str>, host: &str) -> Result<(), AppError> {
    let user = keyring_user(profile_id, host);
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &user)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!("Failed to delete token: {e}"))),
    }?;

    // Also delete the legacy (unscoped) key if we were using a profile-scoped one,
    // so the token doesn't reappear via load_token_for_profile's fallback.
    if profile_id.is_some() {
        let legacy_entry = keyring::Entry::new(KEYCHAIN_SERVICE, host)
            .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
        match legacy_entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(AppError::Other(format!("Failed to delete legacy token: {e}"))),
        }
    }

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
            Err(e) => {
                return Err(AppError::Other(format!(
                    "Failed to load refresh token: {e}"
                )))
            }
        }
    }
    let entry = keyring::Entry::new(REFRESH_SERVICE, host)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(format!(
            "Failed to load refresh token: {e}"
        ))),
    }
}

fn delete_refresh_token_for_profile(profile_id: Option<&str>, host: &str) -> Result<(), AppError> {
    let user = refresh_keyring_user(profile_id, host);
    let entry = keyring::Entry::new(REFRESH_SERVICE, &user)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!(
            "Failed to delete refresh token: {e}"
        ))),
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
    let kind = classify_host(host);
    match kind {
        ForgeKind::GitHub => {
            if token.starts_with("ghp_") || token.starts_with("github_pat_") {
                TokenType::Pat
            } else {
                TokenType::OAuth
            }
        }
        ForgeKind::GitLab => {
            if token.starts_with("glpat-") {
                TokenType::Pat
            } else {
                TokenType::OAuth
            }
        }
    }
}

/// Fetch user info for a stored token by calling the forge's user API.
/// Returns `None` if no token is stored or the API call fails.
pub fn get_token_info(profile_id: Option<&str>, host: &str) -> Option<TokenInfo> {
    let token = load_token_for_profile(profile_id, host).ok()??;
    let token_type = detect_token_type(host, &token);
    let kind = classify_host(host);

    let (url, auth_header, auth_value) = match kind {
        ForgeKind::GitHub => (
            format!("https://api.{host}/user"),
            "Authorization",
            format!("Bearer {token}"),
        ),
        ForgeKind::GitLab => match token_type {
            TokenType::Pat => (
                format!("https://{host}/api/v4/user"),
                "PRIVATE-TOKEN",
                token.clone(),
            ),
            TokenType::OAuth => (
                format!("https://{host}/api/v4/user"),
                "Authorization",
                format!("Bearer {token}"),
            ),
        },
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

    let username = match kind {
        ForgeKind::GitHub => json["login"].as_str()?.to_string(),
        ForgeKind::GitLab => json["username"].as_str()?.to_string(),
    };

    let avatar_url = json["avatar_url"].as_str().unwrap_or("").to_string();

    Some(TokenInfo {
        token_type,
        username,
        avatar_url,
    })
}

// ── User avatar search ──────────────────────────────────────────────────────

/// Search for a user's avatar URL by email using the forge's API.
/// Returns `None` if no user is found or the API call fails.
pub fn search_user_avatar(host: &str, token: &Option<String>, email: &str) -> Option<String> {
    let client = reqwest::blocking::Client::new();
    let kind = classify_host(host);

    match kind {
        ForgeKind::GitHub => {
            let url = format!(
                "https://api.{}/search/users?q={}+in:email&per_page=1",
                host,
                urlencoding::encode(email)
            );
            let mut req = client
                .get(&url)
                .header("User-Agent", "prefetch-git-client/0.1")
                .header("Accept", "application/vnd.github+json");
            if let Some(t) = token {
                req = req.header("Authorization", format!("Bearer {t}"));
            }
            let resp = req.send().ok()?;
            if !resp.status().is_success() {
                return None;
            }
            let json: serde_json::Value = resp.json().ok()?;
            let items = json["items"].as_array()?;
            let user = items.first()?;
            user["avatar_url"].as_str().map(|s| s.to_string())
        }
        ForgeKind::GitLab => {
            // Use the dedicated Avatar API — works without auth for public
            // accounts and returns a direct avatar URL for any email.
            let url = format!(
                "https://{}/api/v4/avatar?email={}&size=128",
                host,
                urlencoding::encode(email)
            );
            tracing::debug!(url = %url, has_token = token.is_some(), "gitlab avatar API request");
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
            let resp = match req.send() {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!(error = %e, "gitlab avatar API request failed");
                    return None;
                }
            };
            let status = resp.status();
            if !status.is_success() {
                tracing::debug!(status = %status, "gitlab avatar API non-success status");
                return None;
            }
            let json: serde_json::Value = match resp.json() {
                Ok(j) => j,
                Err(e) => {
                    tracing::warn!(error = %e, "gitlab avatar API JSON parse failed");
                    return None;
                }
            };
            tracing::debug!(response = %json, "gitlab avatar API response");
            let avatar = match json["avatar_url"].as_str() {
                Some(a) => a,
                None => {
                    tracing::debug!("gitlab avatar API: no avatar_url in response");
                    return None;
                }
            };
            Some(avatar.to_string())
        }
    }
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

// ── Repo listing ─────────────────────────────────────────────────────────────

/// List repositories the authenticated user has access to.
///
/// Dispatches to GitHub or GitLab based on the `host` string.
/// Requires a valid token — returns an error if none is provided.
pub fn list_user_repos(host: &str, token: &str) -> Result<Vec<ForgeRepo>, AppError> {
    let kind = classify_host(host);
    match kind {
        ForgeKind::GitHub => github_list_repos(host, token),
        ForgeKind::GitLab => gitlab_list_repos(host, token),
    }
}

fn github_list_repos(host: &str, token: &str) -> Result<Vec<ForgeRepo>, AppError> {
    let client = reqwest::blocking::Client::new();
    let mut all_repos = Vec::new();
    let mut page = 1u32;

    loop {
        let url = format!(
            "https://api.{}/user/repos?sort=updated&per_page=100&page={}&type=all",
            host, page
        );
        let resp = client
            .get(&url)
            .header("User-Agent", "prefetch-git-client/0.1")
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(|e| AppError::Other(format!("GitHub API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!("GitHub API {status}: {body}")));
        }

        let repos: Vec<serde_json::Value> = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse GitHub response: {e}")))?;

        if repos.is_empty() {
            break;
        }

        for repo in &repos {
            all_repos.push(ForgeRepo {
                name: repo["name"].as_str().unwrap_or("").to_string(),
                full_name: repo["full_name"].as_str().unwrap_or("").to_string(),
                clone_url_https: repo["clone_url"].as_str().unwrap_or("").to_string(),
                clone_url_ssh: repo["ssh_url"].as_str().map(|s| s.to_string()),
                description: repo["description"].as_str().map(|s| s.to_string()),
                is_private: repo["private"].as_bool().unwrap_or(false),
                updated_at: repo["updated_at"].as_str().unwrap_or("").to_string(),
            });
        }

        if repos.len() < 100 {
            break;
        }
        page += 1;
    }

    Ok(all_repos)
}

fn gitlab_list_repos(host: &str, token: &str) -> Result<Vec<ForgeRepo>, AppError> {
    let client = reqwest::blocking::Client::new();
    let mut all_repos = Vec::new();
    let mut page = 1u32;

    let is_pat = token.starts_with("glpat-");

    loop {
        let url = format!(
            "https://{}/api/v4/projects?membership=true&order_by=last_activity_at&per_page=100&page={}",
            host, page
        );
        let mut req = client
            .get(&url)
            .header("User-Agent", "prefetch-git-client/0.1");
        if is_pat {
            req = req.header("PRIVATE-TOKEN", token);
        } else {
            req = req.header("Authorization", format!("Bearer {token}"));
        }

        let resp = req
            .send()
            .map_err(|e| AppError::Other(format!("GitLab API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!("GitLab API {status}: {body}")));
        }

        let repos: Vec<serde_json::Value> = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse GitLab response: {e}")))?;

        if repos.is_empty() {
            break;
        }

        for repo in &repos {
            all_repos.push(ForgeRepo {
                name: repo["name"].as_str().unwrap_or("").to_string(),
                full_name: repo["path_with_namespace"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                clone_url_https: repo["http_url_to_repo"].as_str().unwrap_or("").to_string(),
                clone_url_ssh: repo["ssh_url_to_repo"].as_str().map(|s| s.to_string()),
                description: repo["description"].as_str().map(|s| s.to_string()),
                is_private: repo["visibility"].as_str() == Some("private"),
                updated_at: repo["last_activity_at"].as_str().unwrap_or("").to_string(),
            });
        }

        if repos.len() < 100 {
            break;
        }
        page += 1;
    }

    Ok(all_repos)
}
