use crate::error::AppError;
use crate::git::graph::assign_lanes;
use crate::git::types::{BranchInfo, CommitInfo, GraphData};
use git2::{BranchType, Repository, Sort};
use std::path::Path;
use std::process::Command;

/// Get the repository display name from its path.
pub fn repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

/// Walk commits from HEAD, assign lanes, and return the full graph data.
///
/// Opens a fresh git2::Repository per call (cheap, ~microseconds)
/// to avoid Send/Sync issues with git2::Repository.
pub fn walk_commits(path: &str, limit: usize) -> Result<GraphData, AppError> {
    let repo = Repository::open(path)?;

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    let mut commits: Vec<CommitInfo> = Vec::new();

    for (i, oid_result) in revwalk.enumerate() {
        if i >= limit {
            break;
        }

        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;

        let author = commit.author();
        let message = commit.summary().unwrap_or("").to_string();

        let parent_ids: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();

        let id = oid.to_string();
        let short_id = id[..7.min(id.len())].to_string();

        commits.push(CommitInfo {
            id,
            short_id,
            message,
            author_name: author.name().unwrap_or("Unknown").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parent_ids,
            lane: 0, // will be assigned by graph algorithm
        });
    }

    let (edges, total_lanes) = assign_lanes(&mut commits);

    Ok(GraphData {
        commits,
        edges,
        total_lanes,
    })
}

/// List all branches (local and remote).
pub fn list_branches(path: &str) -> Result<Vec<BranchInfo>, AppError> {
    let repo = Repository::open(path)?;

    // Get current HEAD branch name for is_head detection
    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let mut branches = Vec::new();

    for branch_type in &[BranchType::Local, BranchType::Remote] {
        let is_remote = *branch_type == BranchType::Remote;

        for result in repo.branches(Some(*branch_type))? {
            let (branch, _) = result?;

            let name = match branch.name() {
                Ok(Some(n)) => n.to_string(),
                _ => continue,
            };

            // Skip HEAD -> origin/main style refs
            if name.contains("HEAD") {
                continue;
            }

            let commit_id = branch
                .get()
                .peel_to_commit()
                .map(|c| c.id().to_string())
                .unwrap_or_default();

            let short_commit_id = commit_id.get(..7).unwrap_or(&commit_id).to_string();

            let is_head = !is_remote && head_name.as_deref() == Some(&name);

            branches.push(BranchInfo {
                name,
                is_remote,
                is_head,
                commit_id,
                short_commit_id,
            });
        }
    }

    // Sort: HEAD branch first, then local alphabetically, then remote alphabetically
    branches.sort_by(|a, b| {
        b.is_head
            .cmp(&a.is_head)
            .then(a.is_remote.cmp(&b.is_remote))
            .then(a.name.cmp(&b.name))
    });

    Ok(branches)
}

/// Checkout a branch using git CLI subprocess.
pub fn checkout_branch(path: &str, name: &str) -> Result<(), AppError> {
    run_git(path, &["checkout", name])?;
    Ok(())
}

/// Fetch all remotes.
pub fn fetch_all(path: &str) -> Result<String, AppError> {
    run_git(path, &["fetch", "--all", "--prune"])
}

/// Pull from the current branch's upstream.
pub fn pull(path: &str) -> Result<String, AppError> {
    run_git(path, &["pull"])
}

/// Push to the current branch's upstream, setting it if needed.
pub fn push(path: &str) -> Result<String, AppError> {
    // Try normal push first
    let result = run_git(path, &["push"]);
    if result.is_ok() {
        return result;
    }

    // If it failed, try with --set-upstream for new branches
    let repo = Repository::open(path)?;
    let head = repo.head()?;
    let branch_name = head.shorthand().unwrap_or("HEAD");
    run_git(path, &["push", "-u", "origin", branch_name])
}

/// Run a git CLI command in the given repo directory.
/// Returns combined stdout+stderr on success, or AppError on failure.
fn run_git(path: &str, args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(stderr.trim().to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout.trim(), stderr.trim());
    Ok(if combined.is_empty() {
        "Done".to_string()
    } else {
        combined
    })
}
