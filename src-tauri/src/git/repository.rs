use crate::error::AppError;
use crate::git::graph::assign_lanes;
use crate::git::types::{
    BranchInfo, CoAuthor, CommitInfo, DiffHunk, DiffLine, FileDiff, FileStatus, GraphData,
    StashInfo, TagInfo,
};
use git2::{BranchType, Repository, Sort, Status};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

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
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    // Push all branch tips so commits from all branches are visible,
    // not just those reachable from HEAD
    for (branch, _) in repo.branches(Some(BranchType::Local))?.flatten() {
        if let Some(oid) = branch.get().target() {
            let _ = revwalk.push(oid);
        }
    }
    for (branch, _) in repo.branches(Some(BranchType::Remote))?.flatten() {
        if let Some(oid) = branch.get().target() {
            let _ = revwalk.push(oid);
        }
    }
    // Fallback: also push HEAD in case it's detached
    let _ = revwalk.push_head();

    let mut commits: Vec<CommitInfo> = Vec::new();

    for (i, oid_result) in revwalk.enumerate() {
        if i >= limit {
            break;
        }

        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;

        let author = commit.author();
        let message = commit.summary().unwrap_or("").to_string();
        let full_message = commit.message().unwrap_or("").to_string();
        let body = full_message
            .strip_prefix(commit.summary().unwrap_or(""))
            .unwrap_or("")
            .trim()
            .to_string();
        let co_authors = parse_co_authors(&full_message);

        let parent_ids: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();

        let id = oid.to_string();
        let short_id = id[..7.min(id.len())].to_string();

        commits.push(CommitInfo {
            id,
            short_id,
            message,
            body,
            author_name: author.name().unwrap_or("Unknown").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parent_ids,
            co_authors,
            lane: 0, // will be assigned by graph algorithm
        });
    }

    let (edges, total_lanes) = assign_lanes(&mut commits);

    // Resolve the commit that HEAD points to (works for both branch and detached HEAD)
    let head_commit_id = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string());

    Ok(GraphData {
        commits,
        edges,
        total_lanes,
        head_commit_id,
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

/// Create a new branch and check it out.
pub fn create_branch(path: &str, name: &str) -> Result<(), AppError> {
    run_git(path, &["checkout", "-b", name])?;
    Ok(())
}

/// Fetch all remotes with progress streaming.
pub fn fetch_all<F: Fn(&str)>(path: &str, on_progress: F) -> Result<String, AppError> {
    run_git_with_progress(
        path,
        &["fetch", "--all", "--prune", "--progress"],
        &on_progress,
    )
}

/// Pull from the current branch's upstream with progress streaming.
pub fn pull<F: Fn(&str)>(path: &str, on_progress: F) -> Result<String, AppError> {
    run_git_with_progress(path, &["pull", "--progress"], &on_progress)
}

/// Push to the current branch's upstream with progress streaming, setting upstream if needed.
pub fn push<F: Fn(&str)>(path: &str, on_progress: F) -> Result<String, AppError> {
    // Try normal push first
    let result = run_git_with_progress(path, &["push", "--progress"], &on_progress);
    if result.is_ok() {
        return result;
    }

    // If it failed, try with --set-upstream for new branches
    let repo = Repository::open(path)?;
    let head = repo.head()?;
    let branch_name = head.shorthand().unwrap_or("HEAD");
    run_git_with_progress(
        path,
        &["push", "-u", "origin", branch_name, "--progress"],
        &on_progress,
    )
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

/// Run a git CLI command with real-time progress streaming.
///
/// Git writes progress to stderr using `\r` for in-place updates.
/// This function reads stderr in chunks, splits on `\r`/`\n`, and calls
/// `on_progress` with each line. The `--progress` flag must be included
/// in `args` to force progress output on piped stderr.
fn run_git_with_progress<F: Fn(&str)>(
    path: &str,
    args: &[&str],
    on_progress: &F,
) -> Result<String, AppError> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    // Read stderr in chunks, splitting on \r or \n for progress lines.
    // Git uses \r for in-place progress updates (e.g. "Receiving objects: 45%")
    let mut stderr = child.stderr.take().expect("stderr was piped");
    let mut buf = [0u8; 4096];
    let mut all_stderr = String::new();
    let mut partial_line = String::new();

    loop {
        match stderr.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]);
                for ch in chunk.chars() {
                    if ch == '\r' || ch == '\n' {
                        if !partial_line.is_empty() {
                            let trimmed = partial_line.trim().to_string();
                            if !trimmed.is_empty() {
                                on_progress(&trimmed);
                            }
                            all_stderr.push_str(&partial_line);
                            all_stderr.push('\n');
                            partial_line.clear();
                        }
                    } else {
                        partial_line.push(ch);
                    }
                }
            }
            Err(_) => break,
        }
    }
    // Flush remaining partial line
    if !partial_line.is_empty() {
        let trimmed = partial_line.trim().to_string();
        if !trimmed.is_empty() {
            on_progress(&trimmed);
        }
        all_stderr.push_str(&partial_line);
    }

    // Read stdout
    let mut stdout_text = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        stdout.read_to_string(&mut stdout_text).ok();
    }

    let status = child
        .wait()
        .map_err(|e| AppError::Other(format!("Failed to wait for git: {e}")))?;

    if !status.success() {
        return Err(AppError::Git(all_stderr.trim().to_string()));
    }

    let result = stdout_text.trim().to_string();
    Ok(if result.is_empty() {
        "Done".to_string()
    } else {
        result
    })
}

/// Parse `git diff --numstat` output into a map of path -> (additions, deletions).
fn parse_numstat(path: &str, args: &[&str]) -> HashMap<String, (u32, u32)> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .ok();

    let mut stats: HashMap<String, (u32, u32)> = HashMap::new();
    if let Some(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                let add = parts[0].parse::<u32>().ok();
                let del = parts[1].parse::<u32>().ok();
                if let (Some(a), Some(d)) = (add, del) {
                    stats.insert(parts[2].to_string(), (a, d));
                }
            }
        }
    }
    stats
}

/// Get the working tree status (staged + unstaged + untracked files).
pub fn get_status(path: &str) -> Result<Vec<FileStatus>, AppError> {
    let repo = Repository::open(path)?;
    let statuses = repo.statuses(None)?;

    // Get line stats for staged and unstaged changes
    let staged_stats = parse_numstat(path, &["diff", "--cached", "--numstat"]);
    let unstaged_stats = parse_numstat(path, &["diff", "--numstat"]);

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
            let (additions, deletions) = staged_stats
                .get(&file_path)
                .map(|&(a, d)| (Some(a), Some(d)))
                .unwrap_or((None, None));
            result.push(FileStatus {
                path: file_path.clone(),
                status_type: status_type_from_index(s),
                is_staged: true,
                additions,
                deletions,
            });
        }

        // Unstaged changes (workdir vs index) or untracked
        if s.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_NEW,
        ) {
            let (additions, deletions) = unstaged_stats
                .get(&file_path)
                .map(|&(a, d)| (Some(a), Some(d)))
                .unwrap_or((None, None));
            result.push(FileStatus {
                path: file_path,
                status_type: if s.contains(Status::WT_NEW) {
                    "untracked".to_string()
                } else {
                    status_type_from_workdir(s)
                },
                is_staged: false,
                additions,
                deletions,
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

/// Get the list of files changed in a specific commit.
pub fn get_commit_files(repo_path: &str, commit_id: &str) -> Result<Vec<FileStatus>, AppError> {
    // Get name-status for file status types
    let output = Command::new("git")
        .args([
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--name-status",
            commit_id,
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    // Get numstat for line counts
    let numstat = parse_numstat(
        repo_path,
        &["diff-tree", "--no-commit-id", "-r", "--numstat", commit_id],
    );

    let text = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() == 2 {
            let file_path = parts[1].to_string();
            let status_type = match parts[0] {
                "A" => "added",
                "M" => "modified",
                "D" => "deleted",
                "R" => "renamed",
                _ => "modified",
            }
            .to_string();
            let (additions, deletions) = numstat
                .get(&file_path)
                .map(|&(a, d)| (Some(a), Some(d)))
                .unwrap_or((None, None));
            files.push(FileStatus {
                path: file_path,
                status_type,
                is_staged: true,
                additions,
                deletions,
            });
        }
    }

    Ok(files)
}

/// Parse "Co-Authored-By: Name <email>" trailers from a commit message.
fn parse_co_authors(message: &str) -> Vec<CoAuthor> {
    message
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let rest = trimmed
                .strip_prefix("Co-Authored-By:")
                .or_else(|| trimmed.strip_prefix("Co-authored-by:"))?;
            let rest = rest.trim();
            if let Some(email_start) = rest.find('<') {
                let name = rest[..email_start].trim().to_string();
                let email = rest[email_start + 1..]
                    .trim_end_matches('>')
                    .trim()
                    .to_string();
                Some(CoAuthor { name, email })
            } else {
                Some(CoAuthor {
                    name: rest.to_string(),
                    email: String::new(),
                })
            }
        })
        .collect()
}

/// Get the diff for a specific file in a historical commit.
pub fn get_commit_file_diff(
    repo_path: &str,
    commit_id: &str,
    file_path: &str,
) -> Result<FileDiff, AppError> {
    let output = Command::new("git")
        .args(["diff", &format!("{commit_id}^"), commit_id, "--", file_path])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git diff: {e}")))?;

    let diff_text = String::from_utf8_lossy(&output.stdout);

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

/// List all stashes.
pub fn list_stashes(path: &str) -> Result<Vec<StashInfo>, AppError> {
    let output = Command::new("git")
        .args(["stash", "list"])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    let text = String::from_utf8_lossy(&output.stdout);
    let mut stashes = Vec::new();

    for line in text.lines() {
        // Parse "stash@{0}: WIP on main: abc1234 message"
        if let (Some(idx_start), Some(idx_end)) = (line.find('{'), line.find('}')) {
            let index: usize = line[idx_start + 1..idx_end].parse().unwrap_or(0);
            let message = line[idx_end + 2..].trim().to_string();
            stashes.push(StashInfo { index, message });
        }
    }

    Ok(stashes)
}

/// Stash current changes (including untracked files).
pub fn stash_push(path: &str, message: Option<&str>) -> Result<String, AppError> {
    let mut args = vec!["stash", "push", "-u"];
    if let Some(msg) = message {
        args.push("-m");
        args.push(msg);
    }
    run_git(path, &args)
}

/// Pop a stash entry (apply and remove from stash list).
pub fn stash_pop(path: &str, index: usize) -> Result<String, AppError> {
    let stash_ref = format!("stash@{{{index}}}");
    run_git(path, &["stash", "pop", &stash_ref])
}

/// Drop a stash entry without applying.
pub fn stash_drop(path: &str, index: usize) -> Result<String, AppError> {
    let stash_ref = format!("stash@{{{index}}}");
    run_git(path, &["stash", "drop", &stash_ref])
}

/// Get the list of files changed in a stash entry.
pub fn get_stash_files(path: &str, index: usize) -> Result<Vec<FileStatus>, AppError> {
    let stash_ref = format!("stash@{{{index}}}");

    let output = Command::new("git")
        .args(["stash", "show", "--name-status", &stash_ref])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    let numstat = parse_numstat(path, &["stash", "show", "--numstat", &stash_ref]);

    let text = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() == 2 {
            let file_path = parts[1].to_string();
            let status_type = match parts[0] {
                "A" => "added",
                "M" => "modified",
                "D" => "deleted",
                "R" => "renamed",
                _ => "modified",
            }
            .to_string();
            let (additions, deletions) = numstat
                .get(&file_path)
                .map(|&(a, d)| (Some(a), Some(d)))
                .unwrap_or((None, None));
            files.push(FileStatus {
                path: file_path,
                status_type,
                is_staged: true,
                additions,
                deletions,
            });
        }
    }

    Ok(files)
}

/// List all tags with their commit SHAs and messages.
pub fn list_tags(path: &str) -> Result<Vec<TagInfo>, AppError> {
    let output = Command::new("git")
        .args([
            "tag",
            "-l",
            "--sort=-creatordate",
            // *objectname = dereferenced commit (annotated tags), objectname = tag/commit SHA
            "--format=%(refname:short)\t%(*objectname:short)\t%(objectname:short)\t%(contents:subject)",
        ])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    let text = String::from_utf8_lossy(&output.stdout);
    let mut tags = Vec::new();

    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(4, '\t').collect();
        if parts.is_empty() || parts[0].is_empty() {
            continue;
        }

        let name = parts[0].to_string();
        // For annotated tags: *objectname (deref) is the commit, objectname is the tag object
        // For lightweight tags: *objectname is empty, objectname is the commit
        let deref_sha = parts.get(1).unwrap_or(&"");
        let obj_sha = parts.get(2).unwrap_or(&"");
        let commit_id = if deref_sha.is_empty() {
            obj_sha.to_string()
        } else {
            deref_sha.to_string()
        };
        let message = parts
            .get(3)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        tags.push(TagInfo {
            name,
            commit_id,
            message,
        });
    }

    Ok(tags)
}

/// Create a tag (annotated if message provided, lightweight otherwise).
pub fn create_tag(
    path: &str,
    name: &str,
    commit: Option<&str>,
    message: Option<&str>,
) -> Result<String, AppError> {
    let mut args = vec!["tag"];
    if let Some(msg) = message {
        args.push("-a");
        args.push(name);
        args.push("-m");
        args.push(msg);
    } else {
        args.push(name);
    }
    if let Some(c) = commit {
        args.push(c);
    }
    run_git(path, &args)
}

/// Delete a local tag.
pub fn delete_tag(path: &str, name: &str) -> Result<String, AppError> {
    run_git(path, &["tag", "-d", name])
}

/// Push a tag to the remote.
pub fn push_tag(path: &str, name: &str) -> Result<String, AppError> {
    run_git(path, &["push", "origin", name])
}

/// Get the diff for a specific file in a stash entry.
pub fn get_stash_file_diff(
    repo_path: &str,
    index: usize,
    file_path: &str,
) -> Result<FileDiff, AppError> {
    let stash_ref = format!("stash@{{{index}}}");
    let output = Command::new("git")
        .args([
            "diff",
            &format!("{stash_ref}^"),
            &stash_ref,
            "--",
            file_path,
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git diff: {e}")))?;

    let diff_text = String::from_utf8_lossy(&output.stdout);

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
