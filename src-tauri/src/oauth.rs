//! OAuth authorization code flow with PKCE for GitHub and GitLab.
//!
//! Flow:
//! 1. Generate PKCE verifier + challenge, state token, pick ephemeral port
//! 2. Open system browser to authorization URL
//! 3. Spin up one-shot localhost HTTP server to receive the callback
//! 4. Exchange auth code for access token
//! 5. Store token via existing keychain infrastructure

use crate::error::AppError;
use crate::git::forge;
use serde::Serialize;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tracing::{info, warn};

// ── PKCE helpers ─────────────────────────────────────────────────────────────

/// Generate a random 43-character URL-safe string for PKCE code_verifier.
fn generate_verifier() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut bytes = [0u8; 32];
    // Use multiple random hashers for entropy (no external RNG crate needed)
    for chunk in bytes.chunks_mut(8) {
        let s = RandomState::new();
        let mut h = s.build_hasher();
        h.write_u64(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64,
        );
        let val = h.finish();
        for (i, b) in chunk.iter_mut().enumerate() {
            *b = ((val >> (i * 8)) & 0xFF) as u8;
        }
    }
    base64_url_encode(&bytes)
}

/// Generate a random state parameter to prevent CSRF.
fn generate_state() -> String {
    generate_verifier() // Same format works fine
}

/// SHA-256 hash for PKCE code_challenge (S256 method).
fn sha256(input: &[u8]) -> [u8; 32] {
    // Minimal SHA-256 implementation to avoid adding a crypto dependency.
    // We only need it for the PKCE challenge (one short hash per OAuth flow).
    sha256_impl(input)
}

fn base64_url_encode(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut result = String::with_capacity((bytes.len() * 4).div_ceil(3));
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        }
    }
    result
}

/// Compute PKCE code_challenge = BASE64URL(SHA256(code_verifier))
fn pkce_challenge(verifier: &str) -> String {
    let hash = sha256(verifier.as_bytes());
    base64_url_encode(&hash)
}

// ── Minimal SHA-256 ──────────────────────────────────────────────────────────

fn sha256_impl(message: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    // Pre-processing: pad message
    let ml = message.len();
    let mut padded = message.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    let bit_len = (ml as u64) * 8;
    padded.extend_from_slice(&bit_len.to_be_bytes());

    // Process each 512-bit block
    for block in padded.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                block[i * 4],
                block[i * 4 + 1],
                block[i * 4 + 2],
                block[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut result = [0u8; 32];
    for (i, &val) in h.iter().enumerate() {
        result[i * 4..i * 4 + 4].copy_from_slice(&val.to_be_bytes());
    }
    result
}

// ── OAuth flow types ────────────────────────────────────────────────────────

/// Which forge we're authenticating with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OAuthProvider {
    GitHub,
    GitLab,
}

/// Configuration for an OAuth app (client_id, client_secret, scopes, endpoints).
struct OAuthConfig {
    authorize_url: String,
    token_url: String,
    client_id: String,
    client_secret: Option<String>,
    scopes: String,
}

impl OAuthConfig {
    fn github() -> Self {
        Self {
            authorize_url: "https://github.com/login/oauth/authorize".to_string(),
            token_url: "https://github.com/login/oauth/access_token".to_string(),
            client_id: env!("GH_OAUTH_CLIENT_ID").to_string(),
            client_secret: Some(env!("GH_OAUTH_CLIENT_SECRET").to_string()),
            scopes: "repo".to_string(),
        }
    }

    fn gitlab() -> Self {
        Self {
            authorize_url: "https://gitlab.com/oauth/authorize".to_string(),
            token_url: "https://gitlab.com/oauth/token".to_string(),
            client_id: env!("GITLAB_OAUTH_CLIENT_ID").to_string(),
            client_secret: Some(env!("GITLAB_OAUTH_CLIENT_SECRET").to_string()),
            scopes: "read_user read_api write_repository".to_string(),
        }
    }
}

/// Result returned to the frontend after a successful OAuth flow.
#[derive(Debug, Clone, Serialize)]
pub struct OAuthResult {
    pub host: String,
    pub success: bool,
}

// ── Active flow cancellation ────────────────────────────────────────────────

/// Global handle to cancel an in-progress OAuth flow.
static CANCEL_TOKEN: std::sync::OnceLock<Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>> =
    std::sync::OnceLock::new();

fn cancel_store() -> &'static Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>> {
    CANCEL_TOKEN.get_or_init(|| Arc::new(Mutex::new(None)))
}

/// Cancel any in-progress OAuth flow.
pub async fn cancel_flow() {
    let mut guard = cancel_store().lock().await;
    if let Some(tx) = guard.take() {
        let _ = tx.send(());
        info!("OAuth flow cancelled by user");
    }
}

// ── Main OAuth flow ─────────────────────────────────────────────────────────

/// Start the OAuth authorization code flow with PKCE.
///
/// 1. Binds an ephemeral localhost port for the callback
/// 2. Opens the authorization URL in the system browser
/// 3. Waits for the callback with the auth code
/// 4. Exchanges the code for an access token
/// 5. Stores the token in the OS keychain
pub async fn start_flow(
    provider: OAuthProvider,
    profile_id: Option<String>,
) -> Result<OAuthResult, AppError> {
    let config = match provider {
        OAuthProvider::GitHub => OAuthConfig::github(),
        OAuthProvider::GitLab => OAuthConfig::gitlab(),
    };

    if config.client_id.is_empty() {
        return Err(AppError::Other(format!(
            "OAuth not yet configured for {provider:?} — use a Personal Access Token instead"
        )));
    }

    let host = match provider {
        OAuthProvider::GitHub => "github.com",
        OAuthProvider::GitLab => "gitlab.com",
    };

    // Bind to an ephemeral port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Other(format!("Failed to bind callback server: {e}")))?;

    let port = listener
        .local_addr()
        .map_err(|e| AppError::Other(format!("Failed to get local address: {e}")))?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    info!(port, "OAuth callback server listening");

    // Generate PKCE + state
    let verifier = generate_verifier();
    let challenge = pkce_challenge(&verifier);
    let state = generate_state();

    // Build authorization URL
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        config.authorize_url,
        urlencoding::encode(&config.client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&config.scopes),
        urlencoding::encode(&state),
        urlencoding::encode(&challenge),
    );

    // Open browser
    open::that(&auth_url).map_err(|e| AppError::Other(format!("Failed to open browser: {e}")))?;

    // Set up cancellation
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut guard = cancel_store().lock().await;
        *guard = Some(cancel_tx);
    }

    // Wait for callback or cancellation (with 5-minute timeout)
    let callback_result = tokio::select! {
        result = wait_for_callback(&listener, &state) => result,
        _ = cancel_rx => Err(AppError::Other("OAuth flow cancelled".to_string())),
        _ = tokio::time::sleep(std::time::Duration::from_secs(300)) => {
            Err(AppError::Other("OAuth flow timed out (5 minutes)".to_string()))
        }
    };

    // Clear cancel token
    {
        let mut guard = cancel_store().lock().await;
        *guard = None;
    }

    let auth_code = callback_result?;

    // Exchange code for token
    let token = exchange_code(&config, &auth_code, &redirect_uri, &verifier).await?;

    // Store tokens via existing keychain infrastructure
    forge::save_token_for_profile(profile_id.as_deref(), host, &token.access_token)?;
    if let Some(ref rt) = token.refresh_token {
        forge::save_refresh_token_for_profile(profile_id.as_deref(), host, rt)?;
    }

    info!(host, "OAuth token stored successfully");

    Ok(OAuthResult {
        host: host.to_string(),
        success: true,
    })
}

// ── Callback server ─────────────────────────────────────────────────────────

/// Wait for a single HTTP request on the callback server and extract the auth code.
async fn wait_for_callback(
    listener: &tokio::net::TcpListener,
    expected_state: &str,
) -> Result<String, AppError> {
    let (mut stream, _addr) = listener
        .accept()
        .await
        .map_err(|e| AppError::Other(format!("Failed to accept callback connection: {e}")))?;

    let mut buf = vec![0u8; 4096];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| AppError::Other(format!("Failed to read callback request: {e}")))?;

    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse the GET request to extract query parameters
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| AppError::Other("Invalid HTTP request on callback".to_string()))?;

    // Check for error in query params
    if let Some(error) = extract_query_param(path, "error") {
        let desc = extract_query_param(path, "error_description").unwrap_or_else(|| error.clone());
        send_error_response(&mut stream, &desc).await;
        return Err(AppError::Other(format!("OAuth error: {desc}")));
    }

    // Extract code and state
    let code = extract_query_param(path, "code")
        .ok_or_else(|| AppError::Other("No authorization code in callback".to_string()))?;
    let returned_state = extract_query_param(path, "state")
        .ok_or_else(|| AppError::Other("No state parameter in callback".to_string()))?;

    // Verify state to prevent CSRF
    if returned_state != expected_state {
        send_error_response(&mut stream, "State mismatch — possible CSRF attack").await;
        return Err(AppError::Other(
            "OAuth state mismatch — possible CSRF attack".to_string(),
        ));
    }

    // Send success response to browser
    send_success_response(&mut stream).await;

    Ok(code)
}

fn extract_query_param(path: &str, key: &str) -> Option<String> {
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == key {
                return Some(urlencoding::decode(v).unwrap_or_default().into_owned());
            }
        }
    }
    None
}

async fn send_success_response(stream: &mut tokio::net::TcpStream) {
    let body = r#"<!DOCTYPE html>
<html><head><title>Prefetch</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  display: flex; align-items: center; justify-content: center; height: 100vh;
  margin: 0; background: #0a0a0b; color: #e4e4e7; }
.card { text-align: center; padding: 2rem; }
h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
p { color: #a1a1aa; }
</style></head>
<body><div class="card">
<h1>&#10003; Authorization successful</h1>
<p>You can close this tab and return to Prefetch.</p>
</div></body></html>"#;

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

async fn send_error_response(stream: &mut tokio::net::TcpStream, error: &str) {
    let body = format!(
        r#"<!DOCTYPE html>
<html><head><title>Prefetch</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  display: flex; align-items: center; justify-content: center; height: 100vh;
  margin: 0; background: #0a0a0b; color: #e4e4e7; }}
.card {{ text-align: center; padding: 2rem; }}
h1 {{ font-size: 1.5rem; margin-bottom: 0.5rem; color: #ef4444; }}
p {{ color: #a1a1aa; }}
</style></head>
<body><div class="card">
<h1>&#10007; Authorization failed</h1>
<p>{}</p>
<p>You can close this tab and try again in Prefetch.</p>
</div></body></html>"#,
        error
    );

    let response = format!(
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

// ── Token exchange ──────────────────────────────────────────────────────────

struct OAuthTokens {
    access_token: String,
    refresh_token: Option<String>,
}

/// Exchange the authorization code for an access token.
async fn exchange_code(
    config: &OAuthConfig,
    code: &str,
    redirect_uri: &str,
    verifier: &str,
) -> Result<OAuthTokens, AppError> {
    let client = reqwest::Client::new();

    let mut params = vec![
        ("client_id", config.client_id.as_str()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier),
    ];

    // GitHub OAuth Apps require client_secret for the token exchange
    let secret_ref;
    if let Some(ref secret) = config.client_secret {
        secret_ref = secret.clone();
        params.push(("client_secret", &secret_ref));
    }

    let resp = client
        .post(&config.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Token exchange request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        warn!(status = %status, body = %body, "Token exchange failed");
        return Err(AppError::Other(format!(
            "Token exchange failed (HTTP {status}): {body}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("Failed to parse token response: {e}")))?;

    let access_token = json["access_token"]
        .as_str()
        .ok_or_else(|| {
            let error = json["error"].as_str().unwrap_or("unknown");
            let desc = json["error_description"].as_str().unwrap_or("");
            AppError::Other(format!("No access_token in response: {error} {desc}"))
        })?
        .to_string();

    let refresh_token = json["refresh_token"].as_str().map(|s| s.to_string());

    Ok(OAuthTokens {
        access_token,
        refresh_token,
    })
}

// ── Token refresh ──────────────────────────────────────────────────────────

/// Refresh a GitLab OAuth access token using the stored refresh token.
/// Updates both access and refresh tokens in the keychain on success.
/// Does nothing for GitHub (tokens don't expire) or when no refresh token exists.
pub async fn try_refresh_gitlab_token(
    path: &str,
    profile_id: Option<&str>,
) -> Result<(), AppError> {
    let config = forge::detect_forge(path).ok().flatten();
    let config = match config {
        Some(c) if c.kind == crate::git::types::ForgeKind::GitLab => c,
        _ => return Ok(()),
    };

    let refresh_token = match forge::load_refresh_token_for_profile(profile_id, &config.host)? {
        Some(t) => t,
        None => return Ok(()),
    };

    let gitlab = OAuthConfig::gitlab();
    let client = reqwest::Client::new();

    let mut params = vec![
        ("client_id", gitlab.client_id.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
    ];
    let secret_ref;
    if let Some(ref secret) = gitlab.client_secret {
        secret_ref = secret.clone();
        params.push(("client_secret", &secret_ref));
    }

    let resp = client
        .post(&gitlab.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Token refresh request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        warn!(status = %status, body = %body, "GitLab token refresh failed");
        return Err(AppError::Other(format!(
            "Token refresh failed (HTTP {status}): {body}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("Failed to parse refresh response: {e}")))?;

    let new_access = json["access_token"]
        .as_str()
        .ok_or_else(|| AppError::Other("No access_token in refresh response".to_string()))?;

    forge::save_token_for_profile(profile_id, &config.host, new_access)?;

    if let Some(new_refresh) = json["refresh_token"].as_str() {
        forge::save_refresh_token_for_profile(profile_id, &config.host, new_refresh)?;
    }

    info!("GitLab access token refreshed successfully");
    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_empty() {
        let hash = sha256(b"");
        let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_sha256_hello() {
        let hash = sha256(b"hello");
        let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn test_pkce_challenge_format() {
        let verifier = "test_verifier_string_for_pkce_challenge";
        let challenge = pkce_challenge(verifier);
        // Challenge should be base64url-encoded (no +, /, or = chars)
        assert!(!challenge.contains('+'));
        assert!(!challenge.contains('/'));
        assert!(!challenge.contains('='));
        assert!(!challenge.is_empty());
    }

    #[test]
    fn test_base64_url_encode() {
        let input = b"\x00\x01\x02\x03";
        let encoded = base64_url_encode(input);
        assert!(!encoded.contains('+'));
        assert!(!encoded.contains('/'));
    }

    #[test]
    fn test_extract_query_param() {
        let path = "/callback?code=abc123&state=xyz789";
        assert_eq!(
            extract_query_param(path, "code"),
            Some("abc123".to_string())
        );
        assert_eq!(
            extract_query_param(path, "state"),
            Some("xyz789".to_string())
        );
        assert_eq!(extract_query_param(path, "missing"), None);
    }

    #[test]
    fn test_extract_query_param_encoded() {
        let path = "/callback?error_description=access%20denied&error=access_denied";
        assert_eq!(
            extract_query_param(path, "error_description"),
            Some("access denied".to_string())
        );
    }
}
