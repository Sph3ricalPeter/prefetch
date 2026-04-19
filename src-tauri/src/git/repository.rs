use crate::error::AppError;
use crate::git::graph::assign_lanes;
use crate::git::types::{
    BranchInfo, CommitInfo, DiffHunk, DiffLine, FileDiff, FileStatus, GraphData,
};
use git2::{BranchType, Repository, Sort, Status};
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

/// Get the working tree status (staged + unstaged + untracked files).
pub fn get_status(path: &str) -> Result<Vec<FileStatus>, AppError> {
    let repo = Repository::open(path)?;
    let statuses = repo.statuses(None)?;
    let mut result: Vec<FileStatus> = Vec::new();

    for entry in statuses.iter() {
        let file_path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        // Staged changes (index vs HEAD)
        if s.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED,
        ) {
            result.push(FileStatus {
                path: file_path.clone(),
                status_type: status_type_from_index(s),
                is_staged: true,
            });
        }

        // Unstaged changes (workdir vs index) or untracked
        if s.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_NEW,
        ) {
            result.push(FileStatus {
                path: file_path,
                status_type: if s.contains(Status::WT_NEW) {
                    "untracked".to_string()
                } else {
                    status_type_from_workdir(s)
                },
                is_staged: false,
            });
        }
    }

    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

fn status_type_from_index(s: Status) -> String {
    if s.contains(Status::INDEX_NEW) {
        "added"
    } else if s.contains(Status::INDEX_MODIFIED) {
        "modified"
    } else if s.contains(Status::INDEX_DELETED) {
        "deleted"
    } else if s.contains(Status::INDEX_RENAMED) {
        "renamed"
    } else {
        "modified"
    }
    .to_string()
}

fn status_type_from_workdir(s: Status) -> String {
    if s.contains(Status::WT_MODIFIED) {
        "modified"
    } else if s.contains(Status::WT_DELETED) {
        "deleted"
    } else if s.contains(Status::WT_RENAMED) {
        "renamed"
    } else if s.contains(Status::WT_NEW) {
        "untracked"
    } else {
        "modified"
    }
    .to_string()
}

/// Get the diff for a specific file using git CLI (avoids git2-rs borrow issues).
pub fn get_file_diff(repo_path: &str, file_path: &str, staged: bool) -> Result<FileDiff, AppError> {
    let args = if staged {
        vec!["diff", "--cached", "--", file_path]
    } else {
        vec!["diff", "--", file_path]
    };

    let output = Command::new("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git diff: {e}")))?;

    let diff_text = String::from_utf8_lossy(&output.stdout);

    // Untracked files won't show in git diff — read file content as all-added
    if diff_text.trim().is_empty() && !staged {
        let abs_path = Path::new(repo_path).join(file_path);
        if abs_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&abs_path) {
                let lines: Vec<DiffLine> = content
                    .lines()
                    .enumerate()
                    .map(|(i, l)| DiffLine {
                        origin: '+',
                        content: l.to_string(),
                        old_lineno: None,
                        new_lineno: Some(i as u32 + 1),
                    })
                    .collect();
                if !lines.is_empty() {
                    return Ok(FileDiff {
                        path: file_path.to_string(),
                        hunks: vec![DiffHunk {
                            header: format!("@@ -0,0 +1,{} @@", lines.len()),
                            old_start: 0,
                            old_lines: 0,
                            new_start: 1,
                            new_lines: lines.len() as u32,
                            lines,
                        }],
                        is_binary: false,
                    });
                }
            }
        }
    }

    if diff_text.contains("Binary files") {
        return Ok(FileDiff {
            path: file_path.to_string(),
            hunks: vec![],
            is_binary: true,
        });
    }

    Ok(FileDiff {
        path: file_path.to_string(),
        hunks: parse_unified_diff(&diff_text),
        is_binary: false,
    })
}

fn parse_unified_diff(diff_text: &str) -> Vec<DiffHunk> {
    let mut hunks: Vec<DiffHunk> = Vec::new();

    for line in diff_text.lines() {
        if line.starts_with("@@") {
            let (old_start, old_lines, new_start, new_lines) = parse_hunk_header(line);
            hunks.push(DiffHunk {
                header: line.to_string(),
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
        } else if let Some(hunk) = hunks.last_mut() {
            let origin = if line.starts_with('+') {
                '+'
            } else if line.starts_with('-') {
                '-'
            } else {
                ' '
            };

            let content =
                if !line.is_empty() && (origin == '+' || origin == '-' || line.starts_with(' ')) {
                    line[1..].to_string()
                } else {
                    line.to_string()
                };

            hunk.lines.push(DiffLine {
                origin,
                content,
                old_lineno: None,
                new_lineno: None,
            });
        }
    }

    hunks
}

fn parse_hunk_header(line: &str) -> (u32, u32, u32, u32) {
    let parts: Vec<&str> = line.split_whitespace().collect();
    let (mut old_start, mut old_lines, mut new_start, mut new_lines) = (0u32, 1u32, 0u32, 1u32);

    if parts.len() >= 3 {
        if let Some(old) = parts[1].strip_prefix('-') {
            let nums: Vec<&str> = old.split(',').collect();
            old_start = nums[0].parse().unwrap_or(0);
            old_lines = nums.get(1).and_then(|n| n.parse().ok()).unwrap_or(1);
        }
        if let Some(new) = parts[2].strip_prefix('+') {
            let nums: Vec<&str> = new.split(',').collect();
            new_start = nums[0].parse().unwrap_or(0);
            new_lines = nums.get(1).and_then(|n| n.parse().ok()).unwrap_or(1);
        }
    }

    (old_start, old_lines, new_start, new_lines)
}

/// Stage files using git CLI.
pub fn stage_files(path: &str, files: &[String]) -> Result<(), AppError> {
    let mut args = vec!["add", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    run_git(path, &args)?;
    Ok(())
}

/// Unstage files using git CLI.
pub fn unstage_files(path: &str, files: &[String]) -> Result<(), AppError> {
    let mut args = vec!["reset", "HEAD", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    run_git(path, &args)?;
    Ok(())
}

/// Create a commit using git CLI.
pub fn create_commit(path: &str, message: &str, amend: bool) -> Result<String, AppError> {
    if amend {
        run_git(path, &["commit", "--amend", "-m", message])
    } else {
        run_git(path, &["commit", "-m", message])
    }
}
