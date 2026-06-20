//! GitHub provider implementation.

use crate::error::AppError;
use crate::git::forge::ForgeProvider;
use crate::git::forge::TokenType;
use crate::git::types::{CiJob, ForgeConfig, ForgeRepo, Pipeline, PipelineStatus, PrInfo};

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

    // ── CI (GitHub Actions) ──────────────────────────────────────────────────

    fn list_pipelines(
        &self,
        config: &ForgeConfig,
        branch: Option<&str>,
        token: &str,
        per_page: u32,
    ) -> Result<Vec<Pipeline>, AppError> {
        let branch_param = branch
            .map(|b| format!("&branch={}", urlencoding::encode(b)))
            .unwrap_or_default();
        let url = format!(
            "https://api.{}/repos/{}/{}/actions/runs?per_page={}{}",
            config.host, config.owner, config.repo, per_page, branch_param,
        );

        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(|e| AppError::Other(format!("GitHub Actions API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!(
                "GitHub Actions API {status}: {body}"
            )));
        }

        let json: serde_json::Value = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse Actions response: {e}")))?;

        let runs = json["workflow_runs"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        Ok(runs
            .iter()
            .filter_map(|r| {
                Some(Pipeline {
                    id: r["id"].as_u64()?,
                    name: r["name"].as_str().map(|s| s.to_string()),
                    source: r["event"].as_str().map(|s| s.to_string()),
                    schedule_name: None,
                    status: gh_run_status(
                        r["status"].as_str().unwrap_or(""),
                        r["conclusion"].as_str(),
                    ),
                    branch: r["head_branch"].as_str().unwrap_or("").to_string(),
                    commit_sha: r["head_sha"].as_str().unwrap_or("").to_string(),
                    created_at: r["created_at"].as_str().unwrap_or("").to_string(),
                    updated_at: r["updated_at"].as_str().map(|s| s.to_string()),
                    duration_secs: compute_duration(
                        r["run_started_at"].as_str(),
                        r["updated_at"].as_str(),
                    ),
                    url: r["html_url"].as_str().unwrap_or("").to_string(),
                })
            })
            .collect())
    }

    fn list_pipeline_jobs(
        &self,
        config: &ForgeConfig,
        pipeline_id: u64,
        token: &str,
    ) -> Result<Vec<CiJob>, AppError> {
        let url = format!(
            "https://api.{}/repos/{}/{}/actions/runs/{}/jobs?per_page=100",
            config.host, config.owner, config.repo, pipeline_id,
        );

        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(|e| AppError::Other(format!("GitHub Actions API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!(
                "GitHub Actions API {status}: {body}"
            )));
        }

        let json: serde_json::Value = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse jobs response: {e}")))?;

        let jobs = json["jobs"].as_array().cloned().unwrap_or_default();

        Ok(jobs
            .iter()
            .filter_map(|j| {
                Some(CiJob {
                    id: j["id"].as_u64()?,
                    name: j["name"].as_str().unwrap_or("").to_string(),
                    status: gh_run_status(
                        j["status"].as_str().unwrap_or(""),
                        j["conclusion"].as_str(),
                    ),
                    started_at: j["started_at"].as_str().map(|s| s.to_string()),
                    completed_at: j["completed_at"].as_str().map(|s| s.to_string()),
                    duration_secs: compute_duration(
                        j["started_at"].as_str(),
                        j["completed_at"].as_str(),
                    ),
                })
            })
            .collect())
    }

    fn get_job_log(
        &self,
        config: &ForgeConfig,
        job_id: u64,
        token: &str,
    ) -> Result<String, AppError> {
        let url = format!(
            "https://api.{}/repos/{}/{}/actions/jobs/{}/logs",
            config.host, config.owner, config.repo, job_id,
        );

        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|e| AppError::Other(format!("HTTP client error: {e}")))?;

        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(|e| AppError::Other(format!("GitHub Actions API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!(
                "GitHub Actions API {status}: {body}"
            )));
        }

        resp.text()
            .map_err(|e| AppError::Other(format!("Failed to read log body: {e}")))
    }
}

fn gh_run_status(status: &str, conclusion: Option<&str>) -> PipelineStatus {
    match status {
        "queued" | "pending" | "waiting" => PipelineStatus::Queued,
        "in_progress" => PipelineStatus::InProgress,
        "completed" => match conclusion {
            Some("success") => PipelineStatus::Success,
            Some("failure" | "timed_out") => PipelineStatus::Failure,
            Some("cancelled" | "skipped") => PipelineStatus::Cancelled,
            _ => PipelineStatus::Unknown,
        },
        _ => PipelineStatus::Unknown,
    }
}

fn compute_duration(start: Option<&str>, end: Option<&str>) -> Option<u64> {
    let s = chrono::DateTime::parse_from_rfc3339(start?).ok()?;
    let e = chrono::DateTime::parse_from_rfc3339(end?).ok()?;
    let dur = (e - s).num_seconds();
    if dur >= 0 {
        Some(dur as u64)
    } else {
        None
    }
}
