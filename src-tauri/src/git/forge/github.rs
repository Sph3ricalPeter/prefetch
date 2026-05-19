//! GitHub provider implementation.

use crate::error::AppError;
use crate::git::forge::ForgeProvider;
use crate::git::forge::TokenType;
use crate::git::types::{ForgeConfig, ForgeRepo, PrInfo};

pub struct GitHubProvider;

impl ForgeProvider for GitHubProvider {
    fn http_auth_username(&self, _host: &str, _token: &str) -> String {
        "x-access-token".to_string()
    }

    fn detect_token_type(&self, token: &str) -> TokenType {
        if token.starts_with("ghp_") || token.starts_with("github_pat_") {
            TokenType::Pat
        } else {
            TokenType::OAuth
        }
    }

    fn get_user_info(&self, host: &str, token: &str) -> Option<(String, String)> {
        let url = format!("https://api.{host}/user");
        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .ok()?;

        if !resp.status().is_success() {
            return None;
        }

        let json: serde_json::Value = resp.json().ok()?;
        let username = json["login"].as_str()?.to_string();
        let avatar_url = json["avatar_url"].as_str().unwrap_or("").to_string();
        Some((username, avatar_url))
    }

    fn search_avatar(&self, host: &str, token: &Option<String>, email: &str) -> Option<String> {
        let url = format!(
            "https://api.{}/search/users?q={}+in:email&per_page=1",
            host,
            urlencoding::encode(email)
        );
        let client = reqwest::blocking::Client::new();
        let mut req = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
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

    fn get_pr_for_branch(
        &self,
        config: &ForgeConfig,
        branch: &str,
        token: &Option<String>,
    ) -> Option<PrInfo> {
        let url = format!(
            "https://api.{}/repos/{}/{}/pulls?head={}:{}&state=open&per_page=1",
            config.host, config.owner, config.repo, config.owner, branch
        );

        let client = reqwest::blocking::Client::new();
        let mut req = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
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

    fn list_repos(&self, host: &str, token: &str) -> Result<Vec<ForgeRepo>, AppError> {
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
                .header("User-Agent", super::USER_AGENT)
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
}
