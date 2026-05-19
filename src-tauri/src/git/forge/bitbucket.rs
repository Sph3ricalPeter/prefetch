//! Bitbucket Cloud provider implementation (bitbucket.org only, no Data Center).

use crate::error::AppError;
use crate::git::forge::keychain;
use crate::git::forge::ForgeProvider;
use crate::git::forge::TokenType;
use crate::git::types::{ForgeConfig, ForgeRepo, PrInfo};
use tracing::{debug, warn};

pub struct BitbucketProvider;

impl ForgeProvider for BitbucketProvider {
    fn http_auth_username(&self, host: &str, token: &str) -> String {
        let tt = self.detect_token_type(token);
        match tt {
            TokenType::OAuth => "x-token-auth".to_string(),
            TokenType::Pat => {
                // API tokens require the actual Bitbucket username.
                // Look it up from the cached keychain entry.
                keychain::load_bb_username(None, host)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "x-token-auth".to_string())
            }
        }
    }

    fn detect_token_type(&self, token: &str) -> TokenType {
        // Bitbucket API tokens have no standard prefix.
        // OAuth access tokens are JWT-like (contain dots, typically 100+ chars).
        if token.contains('.') && token.len() > 80 {
            TokenType::OAuth
        } else {
            TokenType::Pat
        }
    }

    fn get_user_info(&self, _host: &str, token: &str) -> Option<(String, String)> {
        // Bitbucket Cloud API is always at api.bitbucket.org (not api.{host})
        let url = "https://api.bitbucket.org/2.0/user";
        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(url)
            .header("User-Agent", super::USER_AGENT)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .ok()?;

        if !resp.status().is_success() {
            return None;
        }

        let json: serde_json::Value = resp.json().ok()?;
        let username = json["username"].as_str()?.to_string();
        let avatar_url = json["links"]["avatar"]["href"]
            .as_str()
            .unwrap_or("")
            .to_string();
        Some((username, avatar_url))
    }

    fn search_avatar(
        &self,
        _host: &str,
        _token: &Option<String>,
        _email: &str,
    ) -> Option<String> {
        // Bitbucket has no public email→avatar search API.
        // Could use Gravatar fallback in the future.
        None
    }

    fn get_pr_for_branch(
        &self,
        config: &ForgeConfig,
        branch: &str,
        token: &Option<String>,
    ) -> Option<PrInfo> {
        // Bitbucket default returns only OPEN PRs.
        // Query: source.branch.name="branch"
        let query = format!("source.branch.name=\"{}\"", branch);
        let url = format!(
            "https://api.bitbucket.org/2.0/repositories/{}/{}/pullrequests?q={}",
            config.owner,
            config.repo,
            urlencoding::encode(&query)
        );

        let client = reqwest::blocking::Client::new();
        let mut req = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT);

        if let Some(t) = token {
            req = req.header("Authorization", format!("Bearer {t}"));
        }

        let resp = req.send().ok()?;
        let json: serde_json::Value = resp.json().ok()?;
        let prs = json["values"].as_array()?;
        let pr = prs.first()?;

        Some(PrInfo {
            number: pr["id"].as_u64()?,
            title: pr["title"].as_str()?.to_string(),
            url: pr["links"]["html"]["href"].as_str()?.to_string(),
            // Bitbucket uses uppercase states (OPEN, MERGED, DECLINED) — normalize
            state: pr["state"]
                .as_str()
                .unwrap_or("OPEN")
                .to_lowercase(),
        })
    }

    fn list_repos(&self, _host: &str, token: &str) -> Result<Vec<ForgeRepo>, AppError> {
        let client = reqwest::blocking::Client::new();

        // First, list all workspaces the user is a member of
        let workspaces = list_workspaces(&client, token)?;

        let mut all_repos = Vec::new();
        for ws in &workspaces {
            let mut next_url: Option<String> = Some(format!(
                "https://api.bitbucket.org/2.0/repositories/{}?role=member&sort=-updated_on&pagelen=100",
                urlencoding::encode(ws)
            ));

            while let Some(url) = next_url.take() {
                let resp = client
                    .get(&url)
                    .header("User-Agent", super::USER_AGENT)
                    .header("Authorization", format!("Bearer {token}"))
                    .send()
                    .map_err(|e| AppError::Other(format!("Bitbucket API error: {e}")))?;

                if !resp.status().is_success() {
                    let status = resp.status();
                    let body = resp.text().unwrap_or_default();
                    return Err(AppError::Other(format!("Bitbucket API {status}: {body}")));
                }

                let json: serde_json::Value = resp
                    .json()
                    .map_err(|e| AppError::Other(format!("Bitbucket parse error: {e}")))?;

                if let Some(values) = json["values"].as_array() {
                    for repo in values {
                        let clone_links = repo["links"]["clone"].as_array();
                        let https_url = clone_links
                            .and_then(|links| {
                                links
                                    .iter()
                                    .find(|l| l["name"].as_str() == Some("https"))
                            })
                            .and_then(|l| l["href"].as_str())
                            .unwrap_or("")
                            .to_string();
                        let ssh_url = clone_links
                            .and_then(|links| {
                                links.iter().find(|l| l["name"].as_str() == Some("ssh"))
                            })
                            .and_then(|l| l["href"].as_str())
                            .map(|s| s.to_string());
                        all_repos.push(ForgeRepo {
                            name: repo["slug"].as_str().unwrap_or("").to_string(),
                            full_name: repo["full_name"].as_str().unwrap_or("").to_string(),
                            clone_url_https: https_url,
                            clone_url_ssh: ssh_url,
                            description: repo["description"]
                                .as_str()
                                .filter(|s| !s.is_empty())
                                .map(|s| s.to_string()),
                            is_private: repo["is_private"].as_bool().unwrap_or(false),
                            updated_at: repo["updated_on"].as_str().unwrap_or("").to_string(),
                        });
                    }
                }

                next_url = json["next"].as_str().map(|s| s.to_string());
            }
        }

        Ok(all_repos)
    }
}

/// List all workspace slugs the authenticated user belongs to.
fn list_workspaces(
    client: &reqwest::blocking::Client,
    token: &str,
) -> Result<Vec<String>, AppError> {
    let mut slugs = Vec::new();
    let mut next_url: Option<String> = Some(
        "https://api.bitbucket.org/2.0/user/workspaces?pagelen=100".to_string(),
    );

    while let Some(url) = next_url.take() {
        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(|e| AppError::Other(format!("Bitbucket workspaces error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!(
                "Bitbucket workspaces API {status}: {body}"
            )));
        }

        let json: serde_json::Value = resp
            .json()
            .map_err(|e| AppError::Other(format!("Bitbucket workspaces parse error: {e}")))?;

        debug!("Bitbucket workspaces response: {}", json);

        if let Some(values) = json["values"].as_array() {
            for ws in values {
                // /2.0/user/workspaces nests workspace data under "workspace"
                let slug = ws["workspace"]["slug"]
                    .as_str()
                    .or_else(|| ws["slug"].as_str());
                if let Some(slug) = slug {
                    debug!("Found Bitbucket workspace: {slug}");
                    slugs.push(slug.to_string());
                }
            }
        }

        next_url = json["next"].as_str().map(|s| s.to_string());
    }

    if slugs.is_empty() {
        warn!("No Bitbucket workspaces found for authenticated user");
    }

    Ok(slugs)
}
