//! OS keychain token storage — save, load, delete for forge PATs and OAuth tokens.

use crate::error::AppError;

pub(crate) const KEYCHAIN_SERVICE: &str = "prefetch";

/// Build a keyring username scoped to an optional profile.
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

/// Strict token lookup — only checks the profile-scoped key, no legacy fallback.
/// Use this for status checks where you need to know if THIS profile has a token.
pub fn has_token_for_profile(profile_id: Option<&str>, host: &str) -> bool {
    let user = keyring_user(profile_id, host);
    let entry = match keyring::Entry::new(KEYCHAIN_SERVICE, &user) {
        Ok(e) => e,
        Err(_) => return false,
    };
    entry.get_password().is_ok()
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
            Err(e) => {
                return Err(AppError::Other(format!(
                    "Failed to delete legacy token: {e}"
                )))
            }
        }
    }

    delete_refresh_token_for_profile(profile_id, host).ok();
    Ok(())
}

// ── Refresh token storage ───────────────────────────────────────────────────

const REFRESH_SERVICE: &str = "prefetch-refresh";

pub fn save_refresh_token_for_profile(
    profile_id: Option<&str>,
    host: &str,
    token: &str,
) -> Result<(), AppError> {
    let user = keyring_user(profile_id, host);
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
        let user = keyring_user(Some(pid), host);
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

pub fn delete_refresh_token_for_profile(
    profile_id: Option<&str>,
    host: &str,
) -> Result<(), AppError> {
    let user = keyring_user(profile_id, host);
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

// ── Bitbucket username storage ───────────────────────────────────────────────

pub fn load_bb_username(profile_id: Option<&str>, host: &str) -> Result<Option<String>, AppError> {
    let key = match profile_id {
        Some(pid) => format!("{pid}/{host}/username"),
        None => format!("{host}/username"),
    };
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key)
        .map_err(|e| AppError::Other(format!("Keyring error: {e}")))?;
    match entry.get_password() {
        Ok(u) => Ok(Some(u)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(format!("Failed to load BB username: {e}"))),
    }
}
