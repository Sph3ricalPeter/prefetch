//! GitLab provider implementation.

use crate::error::AppError;
use crate::git::forge::ForgeProvider;
use crate::git::forge::TokenType;
use crate::git::types::{ForgeConfig, ForgeRepo, PrInfo};

pub struct GitLabProvider;

fn gitlab_auth_header(token: &str) -> (&'static str, String) {
    if token.starts_with("glpat-") {
        ("PRIVATE-TOKEN", token.to_string())
    } else {
        ("Authorization", format!("Bearer {token}"))
    }
}

impl ForgeProvider for GitLabProvider {
    fn http_auth_username(&self, _host: &str, _token: &str) -> String {
        "oauth2".to_string()
    }

    fn detect_token_type(&self, token: &str) -> TokenType {
        if token.starts_with("glpat-") {
            TokenType::Pat
        } else {
            TokenType::OAuth
        }
    }

    fn get_user_info(&self, host: &str, token: &str) -> Option<(String, String)> {
        let url = format!("https://{host}/api/v4/user");
        let (auth_header, auth_value) = gitlab_auth_header(token);

        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header(auth_header, &auth_value)
            .send()
            .ok()?;

        if !resp.status().is_success() {
            return None;
        }

        let json: serde_json::Value = resp.json().ok()?;
        let username = json["username"].as_str()?.to_string();
        let avatar_url = json["avatar_url"].as_str().unwrap_or("").to_string();
        Some((username, avatar_url))
    }

    fn search_avatar(
        &self,
        host: &str,
        token: &Option<String>,
        email: &str,
    ) -> Option<String> {
        let url = format!(
            "https://{}/api/v4/avatar?email={}&size=128",
            host,
            urlencoding::encode(email)
        );
        tracing::debug!(url = %url, has_token = token.is_some(), "gitlab avatar API request");
        let client = reqwest::blocking::Client::new();
        let mut req = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT);
        if let Some(t) = token {
            let (h, v) = gitlab_auth_header(t);
            req = req.header(h, v);
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

    fn get_pr_for_branch(
        &self,
        config: &ForgeConfig,
        branch: &str,
        token: &Option<String>,
    ) -> Option<PrInfo> {
        let project_path =
            urlencoding::encode(&format!("{}/{}", config.owner, config.repo)).into_owned();

        let url = format!(
            "https://{}/api/v4/projects/{}/merge_requests?source_branch={}&state=opened&per_page=1",
            config.host, project_path, branch
        );

        let client = reqwest::blocking::Client::new();
        let mut req = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT);

        if let Some(t) = token {
            let (h, v) = gitlab_auth_header(t);
            req = req.header(h, v);
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

    fn list_repos(&self, host: &str, token: &str) -> Result<Vec<ForgeRepo>, AppError> {
        let client = reqwest::blocking::Client::new();
        let mut all_repos = Vec::new();
        let mut page = 1u32;
        let (auth_header, auth_value) = gitlab_auth_header(token);

        loop {
            let url = format!(
                "https://{}/api/v4/projects?membership=true&order_by=last_activity_at&per_page=100&page={}",
                host, page
            );
            let req = client
                .get(&url)
                .header("User-Agent", super::USER_AGENT)
                .header(auth_header, &auth_value);

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
}
