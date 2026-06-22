//! Credential injection — authenticated HTTPS remote URLs for git CLI operations.

use crate::git::exec::run_git;
use crate::git::forge::{detect_forge, keychain, provider};

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
    let token = keychain::load_token_for_profile(profile_id, &config.host).ok()??;

    let p = provider(&config.kind);
    let username = p.http_auth_username(&config.host, &token);

    // Strip existing user@ (e.g. Bitbucket URLs: https://user@bitbucket.org/...)
    // before injecting our credentials.
    let bare = url.strip_prefix("https://").unwrap_or(url);
    let bare = if let Some(at_pos) = bare.find('@') {
        &bare[at_pos + 1..]
    } else {
        bare
    };
    let authed = format!("https://{username}:{token}@{bare}");

    Some(AuthenticatedRemote {
        url: authed,
        extra_args: vec!["-c".to_string(), "credential.helper=".to_string()],
        extra_env: vec![
            ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
            ("GCM_INTERACTIVE".to_string(), "never".to_string()),
        ],
    })
}
