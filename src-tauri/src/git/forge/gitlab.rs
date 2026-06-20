//! GitLab provider implementation.

use std::collections::HashMap;

use crate::error::AppError;
use crate::git::forge::ForgeProvider;
use crate::git::forge::TokenType;
use crate::git::types::{CiJob, ForgeConfig, ForgeRepo, Pipeline, PipelineStatus, PrInfo};

pub struct GitLabProvider;

fn gitlab_project_path(config: &ForgeConfig) -> String {
    urlencoding::encode(&format!("{}/{}", config.owner, config.repo)).into_owned()
}

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

    fn search_avatar(&self, host: &str, token: &Option<String>, email: &str) -> Option<String> {
        let url = format!(
            "https://{}/api/v4/avatar?email={}&size=128",
            host,
            urlencoding::encode(email)
        );
        tracing::debug!(url = %url, has_token = token.is_some(), "gitlab avatar API request");
        let client = reqwest::blocking::Client::new();
        let mut req = client.get(&url).header("User-Agent", super::USER_AGENT);
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
        let project_path = gitlab_project_path(config);

        let url = format!(
            "https://{}/api/v4/projects/{}/merge_requests?source_branch={}&state=opened&per_page=1",
            config.host, project_path, branch
        );

        let client = reqwest::blocking::Client::new();
        let mut req = client.get(&url).header("User-Agent", super::USER_AGENT);

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

    // ── CI (GitLab CI) ───────────────────────────────────────────────────────

    fn list_pipelines(
        &self,
        config: &ForgeConfig,
        branch: Option<&str>,
        token: &str,
        per_page: u32,
    ) -> Result<Vec<Pipeline>, AppError> {
        let project_path = gitlab_project_path(config);

        let ref_param = branch
            .map(|b| format!("&ref={}", urlencoding::encode(b)))
            .unwrap_or_default();
        let url = format!(
            "https://{}/api/v4/projects/{}/pipelines?per_page={}{}",
            config.host, project_path, per_page, ref_param,
        );

        let (auth_header, auth_value) = gitlab_auth_header(token);
        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header(auth_header, &auth_value)
            .send()
            .map_err(|e| AppError::Other(format!("GitLab CI API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!("GitLab CI API {status}: {body}")));
        }

        let pipelines: Vec<serde_json::Value> = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse pipelines response: {e}")))?;

        let mut result: Vec<Pipeline> = pipelines
            .iter()
            .filter_map(|p| {
                Some(Pipeline {
                    id: p["id"].as_u64()?,
                    name: None,
                    source: p["source"].as_str().map(|s| s.to_string()),
                    schedule_name: None,
                    status: gl_pipeline_status(p["status"].as_str().unwrap_or("")),
                    branch: p["ref"].as_str().unwrap_or("").to_string(),
                    commit_sha: p["sha"].as_str().unwrap_or("").to_string(),
                    created_at: p["created_at"].as_str().unwrap_or("").to_string(),
                    updated_at: p["updated_at"].as_str().map(|s| s.to_string()),
                    duration_secs: p["duration"]
                        .as_u64()
                        .or_else(|| p["duration"].as_f64().map(|f| f as u64)),
                    url: p["web_url"].as_str().unwrap_or("").to_string(),
                })
            })
            .collect();

        // GitLab's pipeline list exposes `source: "schedule"` but not which
        // schedule. The name lives on the Pipeline schedules API, which links
        // each schedule only to its most recent pipeline — so we can label the
        // latest run of each schedule, not historical ones. Best-effort: only
        // hit the endpoint when a scheduled pipeline is actually present.
        if result
            .iter()
            .any(|p| p.source.as_deref() == Some("schedule"))
        {
            let names = fetch_schedule_names(config, token);
            for p in &mut result {
                if let Some(name) = names.get(&p.id) {
                    p.schedule_name = Some(name.clone());
                }
            }
        }

        Ok(result)
    }

    fn list_pipeline_jobs(
        &self,
        config: &ForgeConfig,
        pipeline_id: u64,
        token: &str,
    ) -> Result<Vec<CiJob>, AppError> {
        let project_path = gitlab_project_path(config);

        let url = format!(
            "https://{}/api/v4/projects/{}/pipelines/{}/jobs?per_page=100",
            config.host, project_path, pipeline_id,
        );

        let (auth_header, auth_value) = gitlab_auth_header(token);
        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header(auth_header, &auth_value)
            .send()
            .map_err(|e| AppError::Other(format!("GitLab CI API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!("GitLab CI API {status}: {body}")));
        }

        let jobs: Vec<serde_json::Value> = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse jobs response: {e}")))?;

        // GitLab returns jobs newest-first; reverse to match pipeline execution order.
        let mut result: Vec<CiJob> = jobs
            .iter()
            .filter_map(|j| {
                let mut status = gl_pipeline_status(j["status"].as_str().unwrap_or(""));
                // GitLab: failed job with allow_failure → warning
                if status == PipelineStatus::Failure
                    && j["allow_failure"].as_bool().unwrap_or(false)
                {
                    status = PipelineStatus::Warning;
                }
                Some(CiJob {
                    id: j["id"].as_u64()?,
                    name: j["name"].as_str().unwrap_or("").to_string(),
                    status,
                    started_at: j["started_at"].as_str().map(|s| s.to_string()),
                    completed_at: j["finished_at"].as_str().map(|s| s.to_string()),
                    duration_secs: j["duration"]
                        .as_u64()
                        .or_else(|| j["duration"].as_f64().map(|f| f as u64)),
                })
            })
            .collect();
        result.reverse();
        Ok(result)
    }

    fn get_job_log(
        &self,
        config: &ForgeConfig,
        job_id: u64,
        token: &str,
    ) -> Result<String, AppError> {
        let project_path = gitlab_project_path(config);

        let url = format!(
            "https://{}/api/v4/projects/{}/jobs/{}/trace",
            config.host, project_path, job_id,
        );

        let (auth_header, auth_value) = gitlab_auth_header(token);
        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(&url)
            .header("User-Agent", super::USER_AGENT)
            .header(auth_header, &auth_value)
            .send()
            .map_err(|e| AppError::Other(format!("GitLab CI API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(AppError::Other(format!("GitLab CI API {status}: {body}")));
        }

        resp.text()
            .map_err(|e| AppError::Other(format!("Failed to read log body: {e}")))
    }
}

/// Best-effort map of `pipeline id → schedule description` for pipelines that
/// were triggered by a GitLab pipeline schedule. GitLab only links each
/// schedule to its most recent pipeline (`last_pipeline`), so only the latest
/// run of each schedule can be named. Any error is swallowed and logged —
/// schedule names are a nicety, not load-bearing.
fn fetch_schedule_names(config: &ForgeConfig, token: &str) -> HashMap<u64, String> {
    let mut map = HashMap::new();
    let project_path = gitlab_project_path(config);
    let url = format!(
        "https://{}/api/v4/projects/{}/pipeline_schedules?per_page=100",
        config.host, project_path,
    );

    let (auth_header, auth_value) = gitlab_auth_header(token);
    let client = reqwest::blocking::Client::new();
    let resp = match client
        .get(&url)
        .header("User-Agent", super::USER_AGENT)
        .header(auth_header, &auth_value)
        .send()
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            tracing::debug!(status = %r.status(), "gitlab pipeline_schedules non-success; skipping names");
            return map;
        }
        Err(e) => {
            tracing::warn!(error = %e, "gitlab pipeline_schedules request failed");
            return map;
        }
    };

    let schedules: Vec<serde_json::Value> = match resp.json() {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "failed to parse gitlab pipeline_schedules response");
            return map;
        }
    };

    for s in &schedules {
        if let (Some(id), Some(desc)) =
            (s["last_pipeline"]["id"].as_u64(), s["description"].as_str())
        {
            if !desc.is_empty() {
                map.insert(id, desc.to_string());
            }
        }
    }
    map
}

fn gl_pipeline_status(status: &str) -> PipelineStatus {
    match status {
        "pending" | "waiting_for_resource" | "preparing" | "scheduled" => PipelineStatus::Queued,
        "running" => PipelineStatus::InProgress,
        "success" => PipelineStatus::Success,
        "failed" => PipelineStatus::Failure,
        "canceled" | "skipped" => PipelineStatus::Cancelled,
        // GitLab returns this when the pipeline passed but some allowed-failure jobs failed.
        "manual" => PipelineStatus::Queued,
        _ => {
            // Catch "success with warnings" or similar compound statuses
            if status.contains("warning") {
                PipelineStatus::Warning
            } else {
                PipelineStatus::Unknown
            }
        }
    }
}
