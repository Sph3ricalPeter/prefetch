use crate::error::AppError;
use crate::git::conflict;
use crate::git::exec::{capture, capture_bytes, git_cmd, run_git, run_git_with_progress};
use crate::git::forge;
use crate::git::graph::assign_lanes;
use crate::git::parse;
use crate::git::types::{
    self as types, BranchInfo, CommitInfo, ConflictState, DiffHunk, DiffLine, FileDiff, FileStatus,
    GraphData, RebaseProgress, StashInfo, TagInfo, UndoAction,
};
use git2::{BranchType, Repository, Sort};
use std::collections::HashMap;
use std::path::Path;
use tracing::warn;

const MAX_DIFF_LINES: usize = 50_000;

fn truncate_diff(mut diff: FileDiff) -> FileDiff {
    let total: usize = diff.hunks.iter().map(|h| h.lines.len()).sum();
    if total <= MAX_DIFF_LINES {
        return diff;
    }
    diff.is_truncated = true;
    diff.total_lines = total as u32;
    let mut remaining = MAX_DIFF_LINES;
    for hunk in &mut diff.hunks {
        if remaining == 0 {
            hunk.lines.clear();
        } else if hunk.lines.len() > remaining {
            hunk.lines.truncate(remaining);
            remaining = 0;
        } else {
            remaining -= hunk.lines.len();
        }
    }
    diff.hunks.retain(|h| !h.lines.is_empty());
    diff
}

/// Get the repository display name from its path.
pub fn repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

/// Resolve the git user identity (name + email) and determine its source.
///
/// Checks local → global → system config in priority order, matching
/// how git itself resolves `user.name` and `user.email`.
pub fn get_git_identity(path: &str) -> super::types::GitIdentity {
    // Try each scope in priority order
    let scopes = &["--local", "--global", "--system"];
    let scope_names = &["local", "global", "system"];

    let mut resolved_name: Option<(String, &str)> = None;
    let mut resolved_email: Option<(String, &str)> = None;

    for (scope_flag, scope_name) in scopes.iter().zip(scope_names.iter()) {
        if resolved_name.is_none() {
            if let Ok(val) = run_git(path, &["config", scope_flag, "user.name"], &[]) {
                let val = val.trim().to_string();
                if !val.is_empty() {
                    resolved_name = Some((val, scope_name));
                }
            }
        }
        if resolved_email.is_none() {
            if let Ok(val) = run_git(path, &["config", scope_flag, "user.email"], &[]) {
                let val = val.trim().to_string();
                if !val.is_empty() {
                    resolved_email = Some((val, scope_name));
                }
            }
        }
    }

    // The "source" is whichever scope provided the name (or email if no name)
    let source = resolved_name
        .as_ref()
        .or(resolved_email.as_ref())
        .map(|(_, s)| s.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    super::types::GitIdentity {
        name: resolved_name.map(|(v, _)| v).unwrap_or_default(),
        email: resolved_email.map(|(v, _)| v).unwrap_or_default(),
        source,
    }
}

/// Walk commits from HEAD, assign lanes, and return the full graph data.
///
/// # Thread safety
/// Opens a fresh `git2::Repository` per call (cheap, ~microseconds).
/// `git2::Repository` is NOT Send/Sync, so we cannot cache it across
/// async boundaries. Each function that needs repo access opens its own
/// instance inside a `spawn_blocking` closure and drops it before returning.
pub fn walk_commits(path: &str, limit: usize) -> Result<GraphData, AppError> {
    let mut repo = Repository::open(path)?;

    // Collect stash commit OIDs up front. A stash badge is anchored in the UI to
    // its base commit (the commit the stash was created on top of). If that base
    // commit is not reachable from any branch tip — e.g. the stash was made on a
    // since-deleted or rebased-away branch, or mid cherry-pick/rebase — it would
    // never enter the revwalk below and the stash would silently vanish from the
    // graph. We push each stash's base commit onto the revwalk so the anchor row
    // always exists. `stash_foreach` needs `&mut repo`, so gather OIDs before the
    // revwalk borrows `repo` immutably.
    let mut stash_oids: Vec<git2::Oid> = Vec::new();
    let _ = repo.stash_foreach(|_index, _message, oid| {
        stash_oids.push(*oid);
        true
    });

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

    // Push each stash's base commit (first parent of the stash commit) so stashes
    // anchored to otherwise-unreachable commits still render. Pushing the stash
    // commit itself would add a spurious row, so resolve to parent 0 — which is
    // the same commit `list_stashes` reports as `parent_commit_id`.
    for stash_oid in &stash_oids {
        if let Ok(stash_commit) = repo.find_commit(*stash_oid) {
            if let Some(parent) = stash_commit.parent_ids().next() {
                let _ = revwalk.push(parent);
            }
        }
    }

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
        let co_authors = parse::co_authors(&full_message);

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
/// Batch-compute ahead/behind counts for all local branches in a single subprocess.
///
/// Uses `git for-each-ref --format='%(refname:short)\t%(upstream:track)'` which outputs
/// lines like `main\t[ahead 3, behind 1]` or `feature\t` (no upstream).
struct BranchTracking {
    ahead: u32,
    behind: u32,
    upstream: Option<String>,
}

fn get_all_tracking(path: &str) -> HashMap<String, BranchTracking> {
    let mut map = HashMap::new();
    let text = match capture(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)",
            "refs/heads/",
        ],
        &[],
    ) {
        Ok(text) => text,
        Err(_) => return map,
    };
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let branch_name = parts[0];
        let upstream_short = parts[1]; // e.g. "origin/main" or ""
        let track = if parts.len() == 3 { parts[2] } else { "" };

        let upstream = if upstream_short.is_empty() {
            None
        } else {
            Some(upstream_short.to_string())
        };

        let mut ahead = 0u32;
        let mut behind = 0u32;

        if let Some(pos) = track.find("ahead ") {
            let rest = &track[pos + 6..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            ahead = rest[..end].parse().unwrap_or(0);
        }
        if let Some(pos) = track.find("behind ") {
            let rest = &track[pos + 7..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            behind = rest[..end].parse().unwrap_or(0);
        }

        map.insert(
            branch_name.to_string(),
            BranchTracking {
                ahead,
                behind,
                upstream,
            },
        );
    }

    map
}

pub fn list_branches(path: &str) -> Result<Vec<BranchInfo>, AppError> {
    let repo = Repository::open(path)?;

    // Get current HEAD ref for is_head detection and fast-forward checks
    let head_ref = repo.head().ok();
    let head_name = head_ref
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));
    let head_oid = head_ref
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id());

    // Batch-fetch ahead/behind + upstream for all local branches (single subprocess)
    let tracking = get_all_tracking(path);

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

            let branch_commit = branch.get().peel_to_commit().ok();
            let commit_id = branch_commit
                .as_ref()
                .map(|c| c.id().to_string())
                .unwrap_or_default();

            let short_commit_id = commit_id.get(..7).unwrap_or(&commit_id).to_string();

            let is_head = !is_remote && head_name.as_deref() == Some(&name);

            // Look up ahead/behind + upstream for local branches
            let (ahead, behind, upstream_name) = if !is_remote {
                match tracking.get(&name) {
                    Some(t) => (Some(t.ahead), Some(t.behind), t.upstream.clone()),
                    None => (Some(0), Some(0), None),
                }
            } else {
                (None, None, None)
            };

            // A rebase onto this branch would be a fast-forward if HEAD is
            // an ancestor of this branch's tip (i.e. the branch is strictly
            // ahead of HEAD with no divergence).
            let can_fast_forward = if !is_remote && !is_head {
                match (head_oid, branch_commit.as_ref()) {
                    (Some(head), Some(bc)) => {
                        repo.graph_descendant_of(bc.id(), head).unwrap_or(false)
                    }
                    _ => false,
                }
            } else {
                false
            };

            branches.push(BranchInfo {
                name,
                is_remote,
                is_head,
                commit_id,
                short_commit_id,
                ahead,
                behind,
                can_fast_forward,
                upstream_name,
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

/// List refs (branches + tags) with the unix timestamp of their tip commit, MRU first.
///
/// Used by the UI to (a) stack badges in most-recently-updated order when several
/// refs point at the same commit and (b) sort the canvas edge draw order so the
/// most recent branch's lines paint on top.
///
/// Uses `git for-each-ref --sort=-committerdate` over `refs/heads`, `refs/remotes`,
/// and `refs/tags`. `committerdate` resolves to the underlying commit's date even
/// for lightweight tags, which matches the "tip last touched" semantics we want.
/// Refnames cannot contain spaces in git, so a single space is a safe delimiter
/// after the leading unix timestamp.
pub fn get_ref_mru(path: &str) -> Result<Vec<(String, i64)>, AppError> {
    let out = run_git(
        path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(committerdate:unix) %(refname:short)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
        &[],
    )?;

    let mut result = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, ' ');
        let ts_str = match parts.next() {
            Some(s) => s,
            None => continue,
        };
        let name = match parts.next() {
            Some(s) => s.trim().to_string(),
            None => continue,
        };
        if name.is_empty() {
            continue;
        }
        let ts: i64 = ts_str.parse().unwrap_or(0);
        result.push((name, ts));
    }
    Ok(result)
}

/// Checkout a branch using git CLI subprocess.
pub fn checkout_branch(path: &str, name: &str) -> Result<(), AppError> {
    run_git(path, &["checkout", name], &[])?;
    Ok(())
}

/// Force-checkout a branch, discarding all local changes.
pub fn force_checkout_branch(path: &str, name: &str) -> Result<(), AppError> {
    run_git(path, &["checkout", "--force", name], &[])?;
    Ok(())
}

/// Checkout a branch and reset it to match a remote ref.
/// Used for "Reset Local to Remote" when checking out a remote branch.
pub fn reset_branch_to_remote(path: &str, branch: &str, remote_ref: &str) -> Result<(), AppError> {
    run_git(path, &["checkout", branch], &[])?;
    run_git(path, &["reset", "--hard", remote_ref], &[])?;
    Ok(())
}

/// Create a new branch and check it out.
pub fn create_branch(path: &str, name: &str) -> Result<(), AppError> {
    run_git(path, &["checkout", "-b", name], &[])?;
    Ok(())
}

/// Clone a remote repository with progress streaming.
///
/// If the URL is HTTPS and a token is available for the host, credentials
/// are injected into the URL to avoid credential-helper prompts.
pub fn clone_repo<F: Fn(&str)>(
    url: &str,
    target_path: &str,
    on_progress: F,
    extra_env: &[(String, String)],
    token: Option<&str>,
) -> Result<String, AppError> {
    let mut args: Vec<String> = Vec::new();
    let mut env = extra_env.to_vec();

    let effective_url = if url.starts_with("https://") {
        if let Some(tok) = token {
            // Strip any existing user@ from the URL before injecting credentials
            // e.g. "https://user@bitbucket.org/..." → "https://bitbucket.org/..."
            let stripped = url.strip_prefix("https://").unwrap_or(url);
            let bare_url = if let Some(at_pos) = stripped.find('@') {
                let after_at = &stripped[at_pos + 1..];
                format!("https://{after_at}")
            } else {
                url.to_string()
            };
            let host = bare_url
                .strip_prefix("https://")
                .and_then(|s| s.split('/').next())
                .unwrap_or("");
            let username = forge::http_auth_username(host, tok);
            let authed_url = format!(
                "https://{username}:{tok}@{}",
                bare_url.strip_prefix("https://").unwrap_or(&bare_url)
            );
            args.extend(["-c", "credential.helper="].iter().map(|s| s.to_string()));
            env.push(("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()));
            env.push(("GCM_INTERACTIVE".to_string(), "never".to_string()));
            authed_url
        } else {
            url.to_string()
        }
    } else {
        url.to_string()
    };

    args.extend(["clone", "--progress"].iter().map(|s| s.to_string()));
    args.push(effective_url);
    args.push(target_path.to_string());

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let result = run_git_with_progress(".", &args_refs, &on_progress, &env);

    // Reset origin to the original URL so credentials aren't stored in .git/config.
    // git clone persists the full URL (including embedded user:token@) in .git/config.
    if result.is_ok() && token.is_some() {
        let _ = run_git(target_path, &["remote", "set-url", "origin", url], &[]);
    }

    result
}

/// Fetch all remotes with progress streaming.
///
/// When a forge token is stored for an HTTPS remote, credentials are
/// injected automatically so the user doesn't need a separate credential
/// helper. Profile env vars are applied for SSH key injection.
pub fn fetch_all<F: Fn(&str)>(
    path: &str,
    on_progress: F,
    extra_env: &[(String, String)],
    profile_id: Option<&str>,
) -> Result<String, AppError> {
    if let Some(authed) = forge::authenticated_remote_url(path, profile_id) {
        let args = authed.build_args(&[
            "fetch",
            &authed.url,
            "+refs/heads/*:refs/remotes/origin/*",
            "+refs/tags/*:refs/tags/*",
            "--prune",
            "--progress",
        ]);
        let env = authed.merge_env(extra_env);
        let r = run_git_with_progress(path, &args, &on_progress, &env);
        if r.is_ok() {
            return r;
        }
        if is_credential_error(r.as_ref().unwrap_err()) {
            warn!("fetch with embedded token failed (credential/access error); retrying via system credential helper");
            return run_git_with_progress(
                path,
                &[
                    "fetch",
                    "--all",
                    "--prune",
                    "--tags",
                    "--force",
                    "--progress",
                ],
                &on_progress,
                extra_env,
            );
        }
        r
    } else {
        run_git_with_progress(
            path,
            &[
                "fetch",
                "--all",
                "--prune",
                "--tags",
                "--force",
                "--progress",
            ],
            &on_progress,
            extra_env,
        )
    }
}

/// Check whether a push/fetch failure is a credential or access error where
/// retrying without the embedded token (letting the system credential helper
/// handle auth) might succeed.  GitHub returns "Repository not found" for
/// permission errors on org repos when the PAT lacks org scope.
fn is_credential_error(err: &AppError) -> bool {
    let msg = match err {
        AppError::Git(msg) | AppError::Other(msg) => msg.to_lowercase(),
        _ => return false,
    };
    msg.contains("repository not found")
        || msg.contains("authentication failed")
        || msg.contains("could not read username")
        || msg.contains("permission denied")
        || msg.contains("invalid credentials")
        || msg.contains("could not resolve host")
}

/// Force push to remote (used after reset when local diverges from remote).
///
/// Includes a `-u` fallback for branches that have never been pushed,
/// mirroring the regular `push()` behaviour.
pub fn force_push<F: Fn(&str)>(
    path: &str,
    on_progress: F,
    extra_env: &[(String, String)],
    profile_id: Option<&str>,
) -> Result<String, AppError> {
    let authed = forge::authenticated_remote_url(path, profile_id);

    // Try normal force-push first
    let result = if let Some(ref a) = authed {
        // When pushing to a URL (not a named remote), bare --force-with-lease
        // can't find the remote-tracking ref automatically, causing "stale info"
        // errors. We resolve the expected SHA from the tracking ref and pass it
        // explicitly so the lease check works regardless of the remote spec.
        let lease_flag = explicit_lease_flag(path);
        let args = a.build_args(&["push", &a.url, &lease_flag, "--progress"]);
        let env = a.merge_env(extra_env);
        run_git_with_progress(path, &args, &on_progress, &env)
    } else {
        run_git_with_progress(
            path,
            &["push", "--force-with-lease", "--progress"],
            &on_progress,
            extra_env,
        )
    };

    if let Ok(ref output) = result {
        if authed.is_some() {
            fixup_remote_tracking_for_head(path);
        }
        return Ok(output.clone());
    }

    // Token doesn't have access (e.g. org repo) — retry via system credential helper
    if authed.is_some() && is_credential_error(result.as_ref().unwrap_err()) {
        warn!("force push with embedded token failed (credential/access error); retrying via system credential helper");
        let retry = run_git_with_progress(
            path,
            &["push", "--force-with-lease", "--progress"],
            &on_progress,
            extra_env,
        );
        if retry.is_ok() {
            return retry;
        }
        let repo = Repository::open(path)?;
        let head = repo.head()?;
        let branch_name = head.shorthand().unwrap_or("HEAD");
        return run_git_with_progress(
            path,
            &[
                "push",
                "-u",
                "origin",
                branch_name,
                "--force-with-lease",
                "--progress",
            ],
            &on_progress,
            extra_env,
        );
    }

    // Fallback: try with -u for branches that have no upstream yet
    let repo = Repository::open(path)?;
    let head = repo.head()?;
    let branch_name = head.shorthand().unwrap_or("HEAD");
    if let Some(ref a) = authed {
        let lease_flag = explicit_lease_flag(path);
        let args = a.build_args(&["push", "-u", &a.url, branch_name, &lease_flag, "--progress"]);
        let env = a.merge_env(extra_env);
        let r = run_git_with_progress(path, &args, &on_progress, &env);
        if r.is_ok() {
            fixup_remote_tracking_for_head(path);
        }
        r
    } else {
        run_git_with_progress(
            path,
            &[
                "push",
                "-u",
                "origin",
                branch_name,
                "--force-with-lease",
                "--progress",
            ],
            &on_progress,
            extra_env,
        )
    }
}

/// Build an explicit `--force-with-lease=<branch>:<sha>` flag.
///
/// When pushing to a raw URL instead of a named remote, git cannot
/// automatically look up the remote-tracking ref for the lease check.
/// We resolve `refs/remotes/origin/<branch>` ourselves and embed the
/// expected SHA so the server-side check works correctly.
///
/// Falls back to `--force` if no tracking ref exists (e.g. branch was
/// never pushed before).
fn explicit_lease_flag(path: &str) -> String {
    let repo = match Repository::open(path) {
        Ok(r) => r,
        Err(_) => return "--force".to_string(),
    };
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return "--force".to_string(),
    };
    let branch_name = match head.shorthand() {
        Some(n) => n,
        None => return "--force".to_string(),
    };

    let tracking_ref = format!("refs/remotes/origin/{branch_name}");
    match run_git(path, &["rev-parse", &tracking_ref], &[]) {
        Ok(sha) => format!("--force-with-lease={branch_name}:{}", sha.trim()),
        // No tracking ref → branch was never pushed; plain --force is fine.
        Err(_) => "--force".to_string(),
    }
}

/// Pull from the current branch's upstream with progress streaming.
pub fn pull<F: Fn(&str)>(
    path: &str,
    on_progress: F,
    extra_env: &[(String, String)],
    profile_id: Option<&str>,
) -> Result<String, AppError> {
    if let Some(authed) = forge::authenticated_remote_url(path, profile_id) {
        let args = authed.build_args(&["pull", &authed.url, "--progress"]);
        let env = authed.merge_env(extra_env);
        let r = run_git_with_progress(path, &args, &on_progress, &env);
        if r.is_ok() {
            return r;
        }
        if is_credential_error(r.as_ref().unwrap_err()) {
            warn!("pull with embedded token failed (credential/access error); retrying via system credential helper");
            return run_git_with_progress(path, &["pull", "--progress"], &on_progress, extra_env);
        }
        r
    } else {
        run_git_with_progress(path, &["pull", "--progress"], &on_progress, extra_env)
    }
}

/// Push to the current branch's upstream with progress streaming, setting upstream if needed.
pub fn push<F: Fn(&str)>(
    path: &str,
    on_progress: F,
    extra_env: &[(String, String)],
    profile_id: Option<&str>,
) -> Result<String, AppError> {
    let authed = forge::authenticated_remote_url(path, profile_id);

    // Try normal push first
    let result = if let Some(ref a) = authed {
        let args = a.build_args(&["push", &a.url, "--progress"]);
        let env = a.merge_env(extra_env);
        run_git_with_progress(path, &args, &on_progress, &env)
    } else {
        run_git_with_progress(path, &["push", "--progress"], &on_progress, extra_env)
    };

    if let Ok(ref output) = result {
        if authed.is_some() {
            fixup_remote_tracking_for_head(path);
        }
        return Ok(output.clone());
    }

    // Token doesn't have access (e.g. org repo) — retry via system credential helper
    if authed.is_some() && is_credential_error(result.as_ref().unwrap_err()) {
        warn!("push with embedded token failed (credential/access error); retrying via system credential helper");
        let retry = run_git_with_progress(path, &["push", "--progress"], &on_progress, extra_env);
        if retry.is_ok() {
            return retry;
        }
        let repo = Repository::open(path)?;
        let head = repo.head()?;
        let branch_name = head.shorthand().unwrap_or("HEAD");
        return run_git_with_progress(
            path,
            &["push", "-u", "origin", branch_name, "--progress"],
            &on_progress,
            extra_env,
        );
    }

    // If it failed, try with --set-upstream for new branches
    let repo = Repository::open(path)?;
    let head = repo.head()?;
    let branch_name = head.shorthand().unwrap_or("HEAD");
    if let Some(ref a) = authed {
        let args = a.build_args(&["push", "-u", &a.url, branch_name, "--progress"]);
        let env = a.merge_env(extra_env);
        let r = run_git_with_progress(path, &args, &on_progress, &env);
        if r.is_ok() {
            fixup_remote_tracking_for_head(path);
        }
        r
    } else {
        run_git_with_progress(
            path,
            &["push", "-u", "origin", branch_name, "--progress"],
            &on_progress,
            extra_env,
        )
    }
}

// ── Post-push tracking fixup ─────────────────────────────────────────────────

/// Convenience wrapper: resolve the current HEAD branch name and run
/// [`fixup_remote_tracking`]. Silently swallows errors — the push itself
/// already succeeded, so a fixup failure should not surface to the user.
fn fixup_remote_tracking_for_head(path: &str) {
    let Ok(repo) = Repository::open(path) else {
        return;
    };
    let Ok(head) = repo.head() else { return };
    let Some(branch_name) = head.shorthand() else {
        return;
    };
    if let Err(e) = fixup_remote_tracking(path, branch_name) {
        warn!("post-push tracking fixup failed: {e}");
    }
}

/// After pushing via URL (not a named remote), git sets
/// `branch.<name>.remote` to the full URL instead of `"origin"` and does NOT
/// create the remote tracking ref (`refs/remotes/origin/<branch>`).
///
/// This function repairs both:
/// 1. Overwrites `branch.<name>.remote` → `"origin"`
///    (also removes the embedded PAT that would otherwise leak into `.git/config`)
/// 2. Ensures `branch.<name>.merge` → `refs/heads/<branch>`
/// 3. Creates/updates `refs/remotes/origin/<branch>` to match the local branch
///    tip so that `git2` `BranchType::Remote` iteration and `for-each-ref` both
///    see it.
///
/// This is a no-op when the upstream already points to `"origin"`.
fn fixup_remote_tracking(path: &str, branch_name: &str) -> Result<(), AppError> {
    // Step 1 — Check what branch.<name>.remote is currently set to.
    let current_remote = run_git(
        path,
        &["config", "--local", &format!("branch.{branch_name}.remote")],
        &[],
    );

    match current_remote {
        Ok(remote) => {
            let remote = remote.trim();
            if remote == "origin" {
                // Already correct — only need to ensure the tracking ref exists.
                ensure_tracking_ref(path, branch_name)?;
                return Ok(());
            }
            // remote is a URL (likely with embedded credentials) — fix it.
        }
        Err(_) => {
            // No upstream configured — nothing to fix.
            return Ok(());
        }
    }

    // Step 2 — Overwrite branch.<branch>.remote to "origin".
    run_git(
        path,
        &[
            "config",
            "--local",
            &format!("branch.{branch_name}.remote"),
            "origin",
        ],
        &[],
    )?;

    // Step 3 — Ensure branch.<branch>.merge is set correctly.
    let merge_ref = format!("refs/heads/{branch_name}");
    run_git(
        path,
        &[
            "config",
            "--local",
            &format!("branch.{branch_name}.merge"),
            &merge_ref,
        ],
        &[],
    )?;

    // Step 4 — Create/update the remote tracking ref.
    ensure_tracking_ref(path, branch_name)?;

    Ok(())
}

/// Point `refs/remotes/origin/<branch>` at the same commit as the local branch
/// tip. This is a purely local `update-ref` — no network access.
fn ensure_tracking_ref(path: &str, branch_name: &str) -> Result<(), AppError> {
    let sha = run_git(path, &["rev-parse", "HEAD"], &[])?;
    let sha = sha.trim();
    run_git(
        path,
        &[
            "update-ref",
            &format!("refs/remotes/origin/{branch_name}"),
            sha,
        ],
        &[],
    )?;
    Ok(())
}

// ── Hook failure detection ────────────────────────────────────────────────────

/// Capture `git diff --numstat` output and parse it into a path -> (adds, dels) map.
fn parse_numstat(path: &str, args: &[&str]) -> HashMap<String, (u32, u32)> {
    parse::numstat(&capture(path, args, &[]).unwrap_or_default())
}

/// Get the working tree status (staged + unstaged + untracked files).
///
/// Uses `git status --porcelain=v1` CLI instead of git2-rs to avoid
/// false positives from CRLF/autocrlf handling on Windows.
pub fn get_status(path: &str) -> Result<Vec<FileStatus>, AppError> {
    let stdout_raw = capture_bytes(path, &["status", "--porcelain=v1", "-uall"], &[])
        .map_err(|e| AppError::Other(format!("git status failed: {e}")))?;
    if stdout_raw.len() > 512_000 {
        tracing::warn!(
            "git status -uall output is {}KB, falling back to -unormal",
            stdout_raw.len() / 1024
        );
        return get_status_fallback(path);
    }

    let text = String::from_utf8_lossy(&stdout_raw);
    tracing::debug!(
        "git status: {} bytes, {} lines",
        stdout_raw.len(),
        text.lines().count()
    );

    // Fast path: no changes at all → skip the 2 expensive `git diff --numstat`
    // subprocess spawns (~100ms saved on Windows). The poller hits this path
    // most of the time when the user isn't actively editing files.
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    // Get line stats for staged and unstaged changes
    let staged_stats = parse_numstat(path, &["diff", "--cached", "--numstat"]);
    let unstaged_stats = parse_numstat(path, &["diff", "--numstat"]);

    Ok(parse::porcelain_status(
        &text,
        &staged_stats,
        &unstaged_stats,
    ))
}

/// Fallback when `-uall` output exceeds the size threshold.
/// Uses `-unormal` which collapses untracked directories into a single entry.
fn get_status_fallback(path: &str) -> Result<Vec<FileStatus>, AppError> {
    let text = capture(path, &["status", "--porcelain=v1", "-unormal"], &[])
        .map_err(|e| AppError::Other(format!("git status -unormal failed: {e}")))?;
    let staged_stats = parse_numstat(path, &["diff", "--cached", "--numstat"]);
    let unstaged_stats = parse_numstat(path, &["diff", "--numstat"]);
    Ok(parse::porcelain_status(
        &text,
        &staged_stats,
        &unstaged_stats,
    ))
}

/// Get the diff for a specific file using git CLI (avoids git2-rs borrow issues).
pub fn get_file_diff(repo_path: &str, file_path: &str, staged: bool) -> Result<FileDiff, AppError> {
    let args = if staged {
        vec!["diff", "--cached", "--", file_path]
    } else {
        vec!["diff", "--", file_path]
    };

    let diff_text = capture(repo_path, &args, &[])
        .map_err(|e| AppError::Other(format!("Failed to run git diff: {e}")))?;

    // Untracked files won't show in git diff — read file content as all-added.
    // But only apply this fallback for genuinely untracked files; tracked files
    // can also produce empty diff output (e.g. working tree matches index).
    if diff_text.trim().is_empty() && !staged {
        let is_tracked = git_cmd()
            .args(["ls-files", "--error-unmatch", "--", file_path])
            .current_dir(repo_path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if is_tracked {
            // File is in the index but has no unstaged changes — return empty diff
            return Ok(FileDiff {
                path: file_path.to_string(),
                hunks: vec![],
                is_binary: false,
                is_truncated: false,
                total_lines: 0,
            });
        }

        let abs_path = Path::new(repo_path).join(file_path);
        if abs_path.exists() {
            if let Ok(meta) = std::fs::metadata(&abs_path) {
                let size = meta.len();
                // Skip reading files > 1 MB — return truncated stub
                if size > 1_000_000 {
                    let estimated_lines = (size / 40) as u32; // rough estimate
                    return Ok(FileDiff {
                        path: file_path.to_string(),
                        hunks: vec![],
                        is_binary: false,
                        is_truncated: true,
                        total_lines: estimated_lines,
                    });
                }
            }
            match std::fs::read_to_string(&abs_path) {
                Ok(content) => {
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
                        return Ok(truncate_diff(FileDiff {
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
                            is_truncated: false,
                            total_lines: 0,
                        }));
                    }
                }
                Err(_) => {
                    return Ok(FileDiff {
                        path: file_path.to_string(),
                        hunks: vec![],
                        is_binary: true,
                        is_truncated: false,
                        total_lines: 0,
                    });
                }
            }
        }
    }

    if parse::has_binary_marker(&diff_text) {
        return Ok(FileDiff {
            path: file_path.to_string(),
            hunks: vec![],
            is_binary: true,
            is_truncated: false,
            total_lines: 0,
        });
    }

    Ok(truncate_diff(FileDiff {
        path: file_path.to_string(),
        hunks: parse::unified_diff(&diff_text),
        is_binary: false,
        is_truncated: false,
        total_lines: 0,
    }))
}

/// Discard changes in specific files (revert to HEAD state).
/// Handles tracked modified/deleted files via `git checkout`, and
/// untracked files via `git clean`.
/// Resolve a conflict by accepting our version of the file.
///
/// During rebase, git's ours/theirs are inverted from the user's perspective,
/// so we swap the checkout flag to match the UI's "ours" = user's branch.
pub fn resolve_ours(path: &str, file_path: &str) -> Result<(), AppError> {
    let flag = if conflict::is_rebase_in_progress(path) {
        "--theirs" // git's theirs = user's ours during rebase
    } else {
        "--ours"
    };
    run_git(path, &["checkout", flag, "--", file_path], &[])?;
    run_git(path, &["add", file_path], &[])?;
    Ok(())
}

/// Resolve a conflict by accepting their version of the file.
///
/// During rebase, git's ours/theirs are inverted from the user's perspective,
/// so we swap the checkout flag to match the UI's "theirs" = target branch.
pub fn resolve_theirs(path: &str, file_path: &str) -> Result<(), AppError> {
    let flag = if conflict::is_rebase_in_progress(path) {
        "--ours" // git's ours = user's theirs during rebase
    } else {
        "--theirs"
    };
    run_git(path, &["checkout", flag, "--", file_path], &[])?;
    run_git(path, &["add", file_path], &[])?;
    Ok(())
}

pub fn discard_files(path: &str, files: &[String]) -> Result<(), AppError> {
    // Unstage any staged changes first
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    let mut reset_args = vec!["reset", "HEAD", "--"];
    reset_args.extend(file_refs.clone());
    let _ = run_git(path, &reset_args, &[]);

    // Restore tracked files to HEAD state. Do this one file at a time: a single
    // `git checkout -- <a> <b>` aborts the WHOLE batch with a pathspec error if
    // any path is untracked (e.g. a mixed selection of modified + untracked
    // files), leaving the tracked modifications un-reverted. Per-file keeps an
    // untracked path from blocking the others.
    for file in &file_refs {
        let _ = run_git(path, &["checkout", "--", file], &[]);
    }

    // Clean untracked files (only affects untracked paths; tracked ones are ignored)
    let mut clean_args = vec!["clean", "-f", "--"];
    clean_args.extend(file_refs);
    let _ = run_git(path, &clean_args, &[]);

    Ok(())
}

/// Discard ALL changes — revert entire working tree to HEAD.
pub fn discard_all(path: &str) -> Result<(), AppError> {
    // Unstage everything
    let _ = run_git(path, &["reset", "HEAD"], &[]);
    // Revert all tracked files
    run_git(path, &["checkout", "--", "."], &[])?;
    // Remove all untracked files
    run_git(path, &["clean", "-fd"], &[])?;
    Ok(())
}

/// Stage files using git CLI.
pub fn stage_files(path: &str, files: &[String]) -> Result<(), AppError> {
    let mut args = vec!["add", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    run_git(path, &args, &[])?;
    Ok(())
}

/// Unstage files using git CLI.
pub fn unstage_files(path: &str, files: &[String]) -> Result<(), AppError> {
    let mut args = vec!["reset", "HEAD", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    run_git(path, &args, &[])?;
    Ok(())
}

/// Stage a partial patch (hunk/line staging) using `git apply --cached`.
pub fn stage_patch(repo_path: &str, patch_text: &str) -> Result<(), AppError> {
    apply_patch_impl(repo_path, patch_text, false)
}

/// Unstage a partial patch using `git apply --cached --reverse`.
pub fn unstage_patch(repo_path: &str, patch_text: &str) -> Result<(), AppError> {
    apply_patch_impl(repo_path, patch_text, true)
}

fn apply_patch_impl(repo_path: &str, patch_text: &str, reverse: bool) -> Result<(), AppError> {
    use std::io::Write;
    use std::process::Stdio;

    let mut args = vec!["apply", "--cached", "--unidiff-zero"];
    if reverse {
        args.push("--reverse");
    }
    args.push("-");

    let mut child = git_cmd()
        .args(&args)
        .current_dir(repo_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to spawn git apply: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(patch_text.as_bytes())
            .map_err(|e| AppError::Other(format!("Failed to write patch to stdin: {e}")))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::Other(format!("Failed to wait for git apply: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Git(format!("git apply failed: {stderr}")));
    }

    Ok(())
}

/// Get the base, ours, and theirs versions of a conflicted file, with commit
/// hashes and branch names for display. Reconstruction (including the rebase
/// ours/theirs swap) lives in [`crate::git::conflict`].
pub fn get_conflict_contents(
    repo_path: &str,
    file_path: &str,
) -> Result<types::ConflictContents, AppError> {
    Ok(conflict::assemble(conflict::gather(repo_path, file_path)))
}

/// Resolve a conflict by writing custom content and staging the file.
pub fn resolve_conflict_with_content(
    repo_path: &str,
    file_path: &str,
    content: &str,
) -> Result<(), AppError> {
    let abs_path = std::path::Path::new(repo_path).join(file_path);
    std::fs::write(&abs_path, content)
        .map_err(|e| AppError::Other(format!("Failed to write resolved file: {e}")))?;
    run_git(repo_path, &["add", "--", file_path], &[])?;
    Ok(())
}

/// Create a commit using git CLI.
pub fn create_commit(
    path: &str,
    message: &str,
    amend: bool,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    if amend {
        run_git(path, &["commit", "--amend", "-m", message], extra_env)
    } else {
        run_git(path, &["commit", "-m", message], extra_env)
    }
}

/// Reword the HEAD commit's message without touching the index.
///
/// Creates a new commit object via `git commit-tree` with HEAD's tree and
/// parents but a new message, then moves HEAD via `update-ref`. Unlike
/// `git commit --amend -m ...`, staged changes are NOT folded in.
pub fn reword_head_commit(
    path: &str,
    message: &str,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    let tree = run_git(path, &["rev-parse", "HEAD^{tree}"], &[])?;
    let tree = tree.trim().to_string();

    let parents_raw = run_git(path, &["rev-list", "--parents", "-n", "1", "HEAD"], &[])?;
    let parents: Vec<String> = parents_raw
        .split_whitespace()
        .skip(1)
        .map(|s| s.to_string())
        .collect();

    let mut args: Vec<String> = vec!["commit-tree".into(), tree];
    for p in &parents {
        args.push("-p".into());
        args.push(p.clone());
    }
    args.push("-m".into());
    args.push(message.into());
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let new_sha = capture(path, &arg_refs, extra_env)
        .map_err(|e| AppError::Git(format!("commit-tree failed: {e}")))?;
    let new_sha = new_sha.trim().to_string();
    if new_sha.is_empty() {
        return Err(AppError::Git("commit-tree returned empty SHA".into()));
    }

    run_git(path, &["update-ref", "HEAD", &new_sha], &[])?;

    Ok(new_sha)
}

/// Get the list of files changed in a specific commit.
pub fn get_commit_files(repo_path: &str, commit_id: &str) -> Result<Vec<FileStatus>, AppError> {
    // Run both git commands concurrently — each spawns a subprocess, so
    // overlapping them cuts wall time roughly in half on large commits.
    let path2 = repo_path.to_owned();
    let id2 = commit_id.to_owned();
    let numstat_handle = std::thread::spawn(move || {
        parse_numstat(
            &path2,
            &["diff-tree", "--no-commit-id", "-r", "--numstat", &id2],
        )
    });

    let text = capture(
        repo_path,
        &[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--name-status",
            commit_id,
        ],
        &[],
    )
    .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    let numstat = numstat_handle.join().unwrap_or_default();

    Ok(parse::name_status(&text, &numstat))
}

/// Get the diff for a specific file in a historical commit.
pub fn get_commit_file_diff(
    repo_path: &str,
    commit_id: &str,
    file_path: &str,
) -> Result<FileDiff, AppError> {
    // Root commits have no `commit^`, so git exits non-zero here — fall back to
    // an empty diff rather than erroring (matches the previous behaviour).
    let diff_text = capture(
        repo_path,
        &["diff", &format!("{commit_id}^"), commit_id, "--", file_path],
        &[],
    )
    .unwrap_or_default();

    if parse::has_binary_marker(&diff_text) {
        return Ok(FileDiff {
            path: file_path.to_string(),
            hunks: vec![],
            is_binary: true,
            is_truncated: false,
            total_lines: 0,
        });
    }

    Ok(truncate_diff(FileDiff {
        path: file_path.to_string(),
        hunks: parse::unified_diff(&diff_text),
        is_binary: false,
        is_truncated: false,
        total_lines: 0,
    }))
}

/// List all stashes with commit and parent IDs.
pub fn list_stashes(path: &str) -> Result<Vec<StashInfo>, AppError> {
    // Use --format to get: <stash_hash>\t<parent_hash>\t<refname>\t<message>
    let text = capture(
        path,
        &["stash", "list", "--format=%H%x09%P%x09%gd%x09%gs"],
        &[],
    )
    .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;
    let mut stashes = Vec::new();

    for (idx, line) in text.lines().enumerate() {
        let parts: Vec<&str> = line.splitn(4, '\t').collect();
        if parts.len() >= 4 {
            let commit_id = parts[0].to_string();
            // Parent field may contain multiple parents separated by spaces; take the first
            let parent_commit_id = parts[1].split_whitespace().next().unwrap_or("").to_string();
            let message = parts[3].to_string();
            stashes.push(StashInfo {
                index: idx,
                message,
                commit_id,
                parent_commit_id,
            });
        }
    }

    Ok(stashes)
}

/// Pre-flight check: verify every dirty file is readable/writable before stashing.
/// Returns `Ok(())` if all files are accessible, or an error naming the locked files.
fn preflight_check_files(path: &str) -> Result<(), AppError> {
    // If status can't be determined, skip the check rather than block the stash.
    let text = match capture(path, &["status", "--porcelain=v1", "-uall"], &[]) {
        Ok(text) => text,
        Err(_) => return Ok(()),
    };
    let mut locked = Vec::new();
    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let file = line[3..].trim();
        // Skip deleted files and renames (only the destination part matters)
        let file = if let Some((_old, new)) = file.split_once(" -> ") {
            new
        } else {
            file
        };
        let full = std::path::Path::new(path).join(file);
        if !full.exists() {
            continue; // deleted file, nothing to check
        }
        if full.is_dir() {
            continue;
        }
        // Try opening for read+write — this catches OS locks and permission issues
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&full)
        {
            Ok(_) => {}
            Err(_) => {
                // For untracked files, read-only is acceptable (git stash just deletes them)
                if std::fs::File::open(&full).is_err() {
                    locked.push(file.to_string());
                }
            }
        }
    }

    if locked.is_empty() {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "Cannot stash: {} locked or inaccessible by another process:\n{}",
            if locked.len() == 1 {
                "file is"
            } else {
                "files are"
            },
            locked.join("\n")
        )))
    }
}

/// Create a backup commit of all changes (tracked + untracked) via `git stash create`.
/// Returns the commit hash, or None if there's nothing to back up.
///
/// `git stash create` only captures tracked files, so we temporarily stage
/// everything (`git add -A`) and restore the original index afterwards via
/// `git write-tree` / `git read-tree` to preserve the user's staging state.
/// If `git add -A` itself fails (e.g. permission error), we still attempt
/// the create so at least previously-tracked changes are captured.
fn create_stash_backup(path: &str, extra_env: &[(String, String)]) -> Option<String> {
    // Snapshot the current index so we can restore it exactly after the backup.
    let saved_tree = run_git(path, &["write-tree"], extra_env)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Stage everything so untracked files are included in the snapshot.
    let _ = run_git(path, &["add", "-A"], extra_env);

    let hash = run_git(path, &["stash", "create"], extra_env)
        .ok()
        .and_then(|s| {
            let h = s.trim().to_string();
            if h.is_empty() || h == "Done" {
                None
            } else {
                Some(h)
            }
        });

    // Restore the original index state. `read-tree` replaces the index with the
    // saved tree without touching the working tree, preserving staged/unstaged split.
    if let Some(ref tree) = saved_tree {
        let _ = run_git(path, &["read-tree", tree], extra_env);
    } else {
        let _ = run_git(path, &["reset"], extra_env);
    }

    hash
}

/// Store a backup stash commit so it shows up in `git stash list`.
fn store_stash_backup(
    path: &str,
    extra_env: &[(String, String)],
    hash: Option<&str>,
    message: Option<&str>,
) {
    let Some(hash) = hash else { return };
    let msg = format!(
        "RECOVERED: {}",
        message.unwrap_or("stash failed, changes saved here")
    );
    let _ = run_git(path, &["stash", "store", "-m", &msg, hash], extra_env);
}

/// Stash current changes (including untracked files).
pub fn stash_push(
    path: &str,
    message: Option<&str>,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    // Fail fast if any file is locked — before git modifies the working tree.
    preflight_check_files(path)?;

    // Safety: snapshot all changes before `git stash push` touches the working tree.
    // `git stash create` writes a commit object without modifying the worktree or refs.
    // If the real stash fails mid-cleanup we store this commit so changes survive.
    let backup_hash = create_stash_backup(path, extra_env);

    let mut args = vec!["stash", "push", "-u"];
    if let Some(msg) = message {
        args.push("-m");
        args.push(msg);
    }

    match run_git(path, &args, extra_env) {
        Ok(result) => Ok(result),
        Err(e) => {
            store_stash_backup(path, extra_env, backup_hash.as_deref(), message);
            Err(e)
        }
    }
}

/// Pop a stash entry (apply and remove from stash list).
pub fn stash_pop(path: &str, index: usize) -> Result<String, AppError> {
    let stash_ref = format!("stash@{{{index}}}");
    run_git(path, &["stash", "pop", &stash_ref], &[])
}

/// Apply a stash entry without removing it from the stash list.
pub fn stash_apply(path: &str, index: usize) -> Result<String, AppError> {
    let stash_ref = format!("stash@{{{index}}}");
    run_git(path, &["stash", "apply", &stash_ref], &[])
}

/// Drop a stash entry without applying.
pub fn stash_drop(path: &str, index: usize) -> Result<String, AppError> {
    let stash_ref = format!("stash@{{{index}}}");
    run_git(path, &["stash", "drop", &stash_ref], &[])
}

/// Get the list of files changed in a stash entry.
pub fn get_stash_files(path: &str, index: usize) -> Result<Vec<FileStatus>, AppError> {
    let stash_ref = format!("stash@{{{index}}}");

    // `-u` (--include-untracked) is essential: without it, `git stash show`
    // omits untracked files entirely. A stash made with `git stash push -u`
    // stores untracked files in a separate `^3` parent, so a stash whose
    // changes are all-new files would otherwise report zero files here and the
    // detail panel would show only the description. The flag is harmless on
    // stashes with no untracked component.
    let text = capture(
        path,
        &["stash", "show", "-u", "--name-status", &stash_ref],
        &[],
    )
    .unwrap_or_default();

    let numstat = parse_numstat(path, &["stash", "show", "-u", "--numstat", &stash_ref]);

    Ok(parse::name_status(&text, &numstat))
}

/// List all tags with their commit SHAs and messages.
pub fn list_tags(path: &str) -> Result<Vec<TagInfo>, AppError> {
    let text = capture(
        path,
        &[
            "tag",
            "-l",
            "--sort=-creatordate",
            // *objectname = dereferenced commit (annotated tags), objectname = tag/commit SHA
            "--format=%(refname:short)\t%(*objectname:short)\t%(objectname:short)\t%(contents:subject)",
        ],
        &[],
    )
    .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;
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
    extra_env: &[(String, String)],
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
    run_git(path, &args, extra_env)
}

/// Delete a local tag.
pub fn delete_tag(path: &str, name: &str) -> Result<String, AppError> {
    run_git(path, &["tag", "-d", name], &[])
}

/// Push a tag to the remote.
pub fn push_tag(
    path: &str,
    name: &str,
    extra_env: &[(String, String)],
    profile_id: Option<&str>,
) -> Result<String, AppError> {
    if let Some(authed) = forge::authenticated_remote_url(path, profile_id) {
        let args = authed.build_args(&["push", &authed.url, name]);
        let env = authed.merge_env(extra_env);
        run_git(path, &args, &env)
    } else {
        run_git(path, &["push", "origin", name], extra_env)
    }
}

/// Get the diff for a specific file in a stash entry.
pub fn get_stash_file_diff(
    repo_path: &str,
    index: usize,
    file_path: &str,
) -> Result<FileDiff, AppError> {
    let stash_ref = format!("stash@{{{index}}}");
    let mut diff_text = capture(
        repo_path,
        &[
            "diff",
            &format!("{stash_ref}^"),
            &stash_ref,
            "--",
            file_path,
        ],
        &[],
    )
    .unwrap_or_default();

    // Untracked files live in the stash's `^3` parent, not in the main stash
    // commit, so the diff above is empty for them. Fall back to diffing the base
    // against the untracked tree, which renders the file as a fresh addition.
    // `^3` only exists for stashes created with `-u`; if it's absent the diff
    // errors out and we keep the (empty) original result.
    if diff_text.is_empty() {
        if let Ok(untracked) = capture(
            repo_path,
            &[
                "diff",
                &format!("{stash_ref}^"),
                &format!("{stash_ref}^3"),
                "--",
                file_path,
            ],
            &[],
        ) {
            diff_text = untracked;
        }
    }

    if parse::has_binary_marker(&diff_text) {
        return Ok(FileDiff {
            path: file_path.to_string(),
            hunks: vec![],
            is_binary: true,
            is_truncated: false,
            total_lines: 0,
        });
    }

    Ok(truncate_diff(FileDiff {
        path: file_path.to_string(),
        hunks: parse::unified_diff(&diff_text),
        is_binary: false,
        is_truncated: false,
        total_lines: 0,
    }))
}

/// Read the full file content as lines for context expansion in diffs.
///
/// - `rev = None` → read from working directory (disk)
/// - `rev = Some("")` → read from the git index (staged version)
/// - `rev = Some("abc123")` → read from a specific commit/ref via `git show`
pub fn get_file_blob(
    repo_path: &str,
    file_path: &str,
    rev: Option<&str>,
) -> Result<Vec<String>, AppError> {
    match rev {
        None => {
            let abs = Path::new(repo_path).join(file_path);
            let content = std::fs::read_to_string(&abs)
                .map_err(|e| AppError::Other(format!("Failed to read file: {e}")))?;
            Ok(content.lines().map(String::from).collect())
        }
        Some(r) => {
            let spec = if r.is_empty() {
                format!(":{file_path}")
            } else {
                format!("{r}:{file_path}")
            };
            let content = capture(repo_path, &["show", &spec], &[])
                .map_err(|e| AppError::Other(format!("git show failed: {e}")))?;
            Ok(content.lines().map(String::from).collect())
        }
    }
}

/// Read a file as raw bytes and return base64-encoded content.
///
/// - `rev = None`       → read from working directory (disk)
/// - `rev = Some("")`   → read from the git index (staged version)
/// - `rev = Some("ab")` → read from a specific commit/ref via `git show`
///
/// Returns `None` when the file does not exist at the given revision.
pub fn get_binary_blob_base64(
    repo_path: &str,
    file_path: &str,
    rev: Option<&str>,
) -> Result<Option<String>, AppError> {
    use base64::Engine;

    let raw = match rev {
        None => {
            let abs = Path::new(repo_path).join(file_path);
            match std::fs::read(&abs) {
                Ok(bytes) => bytes,
                Err(_) => return Ok(None),
            }
        }
        Some(r) => {
            let spec = if r.is_empty() {
                format!(":{file_path}")
            } else {
                format!("{r}:{file_path}")
            };
            match capture_bytes(repo_path, &["show", &spec], &[]) {
                Ok(bytes) => bytes,
                Err(_) => return Ok(None),
            }
        }
    };

    Ok(Some(base64::engine::general_purpose::STANDARD.encode(&raw)))
}

/// Get the last undoable action from the reflog.
pub fn get_undo_action(path: &str) -> Result<UndoAction, AppError> {
    let text = capture(path, &["reflog", "--format=%H %gs", "-n", "1"], &[]).unwrap_or_default();
    let line = text.trim();

    if line.is_empty() {
        return Ok(UndoAction {
            description: "Nothing to undo".to_string(),
            can_undo: false,
        });
    }

    let action = line.split_once(' ').map(|(_, desc)| desc).unwrap_or(line);
    let (can_undo, description) = classify_reflog_action(action);

    Ok(UndoAction {
        description,
        can_undo,
    })
}

/// Classify a reflog action string and return (can_undo, human_description).
fn classify_reflog_action(action: &str) -> (bool, String) {
    let action_lower = action.to_lowercase();

    if action_lower.starts_with("checkout: moving from") {
        let desc = if let Some(rest) = action.strip_prefix("checkout: moving from ") {
            let parts: Vec<&str> = rest.split(" to ").collect();
            if parts.len() == 2 {
                format!("Undo checkout → back to {}", parts[0])
            } else {
                "Undo checkout".to_string()
            }
        } else {
            "Undo checkout".to_string()
        };
        (true, desc)
    } else if action_lower.starts_with("commit") && !action_lower.starts_with("commit (initial)") {
        let msg = action.split(": ").nth(1).unwrap_or("").trim();
        let desc = if msg.is_empty() {
            "Undo last commit".to_string()
        } else {
            format!("Undo commit: {msg}")
        };
        (true, desc)
    } else if action_lower.starts_with("merge")
        || action_lower.starts_with("rebase")
        || action_lower.starts_with("pull")
        || action_lower.starts_with("reset")
    {
        (true, format!("Undo {action}"))
    } else {
        (false, format!("Cannot undo: {action}"))
    }
}

/// Execute an undo by reading the reflog and performing the inverse operation.
pub fn undo_last(path: &str, extra_env: &[(String, String)]) -> Result<String, AppError> {
    let text = capture(path, &["reflog", "--format=%H %gs", "-n", "2"], &[]).unwrap_or_default();
    let lines: Vec<&str> = text.trim().lines().collect();

    if lines.is_empty() {
        return Err(AppError::Other(
            "Nothing to undo — reflog is empty".to_string(),
        ));
    }

    let current_line = lines[0];
    let action = current_line
        .split_once(' ')
        .map(|(_, desc)| desc)
        .unwrap_or("");
    let action_lower = action.to_lowercase();

    if action_lower.starts_with("checkout: moving from") {
        if let Some(rest) = action.strip_prefix("checkout: moving from ") {
            let parts: Vec<&str> = rest.split(" to ").collect();
            if !parts.is_empty() {
                return run_git(path, &["checkout", parts[0]], &[]);
            }
        }
        Err(AppError::Other(
            "Could not parse checkout reflog entry".to_string(),
        ))
    } else if action_lower.starts_with("commit") && !action_lower.starts_with("commit (initial)") {
        // Soft reset keeps changes staged
        run_git(path, &["reset", "--soft", "HEAD~1"], extra_env)
    } else if action_lower.starts_with("merge")
        || action_lower.starts_with("rebase")
        || action_lower.starts_with("pull")
    {
        if lines.len() >= 2 {
            let prev_sha = lines[1].split_once(' ').map(|(sha, _)| sha).unwrap_or("");
            if !prev_sha.is_empty() {
                return run_git(path, &["reset", "--hard", prev_sha], extra_env);
            }
        }
        Err(AppError::Other(
            "Could not determine previous state from reflog".to_string(),
        ))
    } else if action_lower.starts_with("reset") {
        if lines.len() >= 2 {
            let prev_sha = lines[1].split_once(' ').map(|(sha, _)| sha).unwrap_or("");
            if !prev_sha.is_empty() {
                return run_git(path, &["reset", "--hard", prev_sha], extra_env);
            }
        }
        Err(AppError::Other(
            "Could not determine previous state from reflog".to_string(),
        ))
    } else {
        Err(AppError::Other(format!("Cannot undo: {action}")))
    }
}

/// Reset the current branch to a specific commit.
/// `mode` should be "--soft" or "--hard".
pub fn reset_to_commit(path: &str, commit_id: &str, mode: &str) -> Result<String, AppError> {
    run_git(path, &["reset", mode, commit_id], &[])
}

/// Cherry-pick a commit onto the current branch.
pub fn cherry_pick(
    path: &str,
    commit_id: &str,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    run_git(path, &["cherry-pick", commit_id], extra_env)
}

/// Rebase the current branch onto a target branch (non-interactive).
pub fn rebase_onto(
    path: &str,
    target: &str,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    run_git(path, &["rebase", "--autostash", target], extra_env)
}

/// Merge a target branch (or commit) into the current branch.
pub fn merge_branch(
    path: &str,
    target: &str,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    run_git(path, &["merge", target], extra_env)
}

/// Read the default merge message from `.git/MERGE_MSG`.
///
/// Git writes this file when a merge stops for conflicts (or for a
/// non-fast-forward merge that needs a commit message).
pub fn get_merge_message(path: &str) -> Result<String, AppError> {
    let msg_path = Path::new(path).join(".git").join("MERGE_MSG");
    std::fs::read_to_string(&msg_path)
        .map(|s| s.trim().to_string())
        .map_err(|e| AppError::Other(format!("Failed to read MERGE_MSG: {e}")))
}

/// Revert a commit (creates a new commit that undoes the given commit).
pub fn revert_commit(
    path: &str,
    commit_id: &str,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    run_git(path, &["revert", commit_id], extra_env)
}

/// Checkout a specific commit in detached HEAD state.
pub fn checkout_detached(path: &str, commit_id: &str) -> Result<String, AppError> {
    run_git(path, &["checkout", "--detach", commit_id], &[])
}

/// Create a new branch at a specific commit (without checking it out).
pub fn create_branch_at(path: &str, name: &str, commit_id: &str) -> Result<(), AppError> {
    run_git(path, &["branch", name, commit_id], &[])?;
    Ok(())
}

/// Rename a local branch.
pub fn rename_branch(path: &str, old_name: &str, new_name: &str) -> Result<String, AppError> {
    run_git(path, &["branch", "-m", old_name, new_name], &[])
}

/// Rename a branch both locally and on the remote.
///
/// 1. Rename the local branch (`git branch -m`)
/// 2. Push the new name to origin (`git push origin <new> -u`)
/// 3. Delete the old remote branch (`git push origin --delete <old>`)
/// 4. Clean up stale tracking refs
pub fn rename_branch_on_remote<F: Fn(&str)>(
    path: &str,
    old_name: &str,
    new_name: &str,
    on_progress: F,
    extra_env: &[(String, String)],
    profile_id: Option<&str>,
) -> Result<String, AppError> {
    run_git(path, &["branch", "-m", old_name, new_name], &[])?;

    let authed = forge::authenticated_remote_url(path, profile_id);

    // Push the new branch name and set upstream
    let push_result = if let Some(ref a) = authed {
        let args = a.build_args(&["push", "-u", &a.url, new_name, "--progress"]);
        let env = a.merge_env(extra_env);
        run_git_with_progress(path, &args, &on_progress, &env)
    } else {
        run_git_with_progress(
            path,
            &["push", "-u", "origin", new_name, "--progress"],
            &on_progress,
            extra_env,
        )
    };

    if let Err(e) = push_result {
        // Roll back the local rename so the user isn't left in a broken state
        let _ = run_git(path, &["branch", "-m", new_name, old_name], &[]);
        return Err(e);
    }

    // Fix tracking config after URL-based push
    if authed.is_some() {
        let _ = fixup_remote_tracking(path, new_name);
    }

    // Delete the old remote branch
    let delete_result = if let Some(ref a) = authed {
        let args = a.build_args(&["push", &a.url, "--delete", old_name]);
        let env = a.merge_env(extra_env);
        run_git(path, &args, &env)
    } else {
        run_git(path, &["push", "origin", "--delete", old_name], extra_env)
    };

    if let Err(e) = &delete_result {
        warn!("Failed to delete old remote branch {old_name}: {e}");
    }

    // Clean up stale remote tracking ref
    let _ = run_git(
        path,
        &[
            "update-ref",
            "-d",
            &format!("refs/remotes/origin/{old_name}"),
        ],
        &[],
    );

    Ok(format!(
        "Renamed '{old_name}' → '{new_name}' (local + remote)"
    ))
}

/// Delete a branch from a remote.
pub fn delete_remote_branch(
    path: &str,
    remote: &str,
    branch: &str,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    run_git(path, &["push", remote, "--delete", branch], extra_env)
}

/// Set the upstream tracking branch for the current branch.
pub fn set_upstream(path: &str, remote_branch: &str) -> Result<String, AppError> {
    run_git(path, &["branch", "--set-upstream-to", remote_branch], &[])
}

/// Stash specific files (instead of the entire working tree).
pub fn stash_push_files(
    path: &str,
    files: &[String],
    message: Option<&str>,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    // Pre-flight: check only the selected files are accessible.
    let mut locked = Vec::new();
    for file in files {
        let full = std::path::Path::new(path).join(file);
        if !full.exists() || full.is_dir() {
            continue;
        }
        if std::fs::File::open(&full).is_err() {
            locked.push(file.clone());
        }
    }
    if !locked.is_empty() {
        return Err(AppError::Other(format!(
            "Cannot stash: {} locked or inaccessible by another process:\n{}",
            if locked.len() == 1 {
                "file is"
            } else {
                "files are"
            },
            locked.join("\n")
        )));
    }

    let backup_hash = create_stash_backup(path, extra_env);

    // `-u` so untracked paths in the selection are stashable — without it git
    // rejects the WHOLE batch with a pathspec error on the first untracked file.
    let mut args = vec!["stash", "push", "-u"];
    if let Some(msg) = message {
        args.push("-m");
        args.push(msg);
    }
    args.push("--");
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);

    match run_git(path, &args, extra_env) {
        Ok(result) => Ok(result),
        Err(e) => {
            store_stash_backup(path, extra_env, backup_hash.as_deref(), message);
            Err(e)
        }
    }
}

/// Open a file or folder in the OS file manager / explorer.
pub fn show_in_folder(file_path: &str) -> Result<(), AppError> {
    let path = std::path::Path::new(file_path);
    let folder = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    open::that(folder).map_err(|e| AppError::Other(format!("Failed to open folder: {e}")))?;
    Ok(())
}

/// Open a file in the system default editor / application.
pub fn open_in_default_editor(file_path: &str) -> Result<(), AppError> {
    open::that(file_path).map_err(|e| AppError::Other(format!("Failed to open file: {e}")))?;
    Ok(())
}

/// Delete a file from the filesystem.
pub fn delete_file(file_path: &str) -> Result<(), AppError> {
    std::fs::remove_file(file_path)
        .map_err(|e| AppError::Other(format!("Failed to delete file: {e}")))?;
    Ok(())
}

/// Delete a local branch.
///
/// `force` uses `-D` (delete even if unmerged), otherwise `-d`.
pub fn delete_branch(path: &str, name: &str, force: bool) -> Result<String, AppError> {
    let flag = if force { "-D" } else { "-d" };
    run_git(path, &["branch", flag, name], &[])
}

/// Get progress info for an in-progress rebase.
///
/// Reads step/total from `.git/rebase-merge/` (or `rebase-apply/`)
/// and the current commit message from the `message` file.
pub fn get_rebase_progress(path: &str) -> Result<RebaseProgress, AppError> {
    let git_dir = Path::new(path).join(".git");
    let rebase_dir = if git_dir.join("rebase-merge").exists() {
        git_dir.join("rebase-merge")
    } else if git_dir.join("rebase-apply").exists() {
        git_dir.join("rebase-apply")
    } else {
        return Err(AppError::Other("No rebase in progress".to_string()));
    };

    let step = std::fs::read_to_string(rebase_dir.join("msgnum"))
        .unwrap_or_default()
        .trim()
        .parse::<u32>()
        .unwrap_or(0);
    let total = std::fs::read_to_string(rebase_dir.join("end"))
        .unwrap_or_default()
        .trim()
        .parse::<u32>()
        .unwrap_or(0);
    let message = std::fs::read_to_string(rebase_dir.join("message"))
        .unwrap_or_default()
        .trim()
        .to_string();

    // Try stopped-sha first (set when rebase pauses on conflict), then REBASE_HEAD
    let commit_id = std::fs::read_to_string(rebase_dir.join("stopped-sha"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .and_then(|full| {
            run_git(path, &["rev-parse", "--short", &full], &[])
                .ok()
                .map(|s| s.trim().to_string())
        })
        .or_else(|| {
            run_git(path, &["rev-parse", "--short", "REBASE_HEAD"], &[])
                .ok()
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_default();

    Ok(RebaseProgress {
        step,
        total,
        message,
        commit_id,
    })
}

/// Detect if a merge, rebase, or cherry-pick is in progress.
pub fn get_conflict_state(path: &str) -> Result<ConflictState, AppError> {
    let git_dir = Path::new(path).join(".git");

    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return Ok(ConflictState {
            in_progress: true,
            operation: "rebase".to_string(),
        });
    }

    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Ok(ConflictState {
            in_progress: true,
            operation: "cherry-pick".to_string(),
        });
    }

    if git_dir.join("MERGE_HEAD").exists() {
        return Ok(ConflictState {
            in_progress: true,
            operation: "merge".to_string(),
        });
    }

    Ok(ConflictState {
        in_progress: false,
        operation: String::new(),
    })
}

/// Abort the current in-progress operation (rebase, cherry-pick, or merge).
pub fn abort_operation(path: &str) -> Result<String, AppError> {
    let state = get_conflict_state(path)?;
    match state.operation.as_str() {
        "rebase" => run_git(path, &["rebase", "--abort"], &[]),
        "cherry-pick" => run_git(path, &["cherry-pick", "--abort"], &[]),
        "merge" => run_git(path, &["merge", "--abort"], &[]),
        _ => Err(AppError::Other("No operation in progress".to_string())),
    }
}

/// Continue the current in-progress operation after conflict resolution.
///
/// When `message` is provided, writes it to the appropriate message file
/// and suppresses git's editor so the user never gets bounced out to
/// VS Code (or whatever their `core.editor` is).
pub fn continue_operation(
    path: &str,
    message: Option<String>,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    let state = get_conflict_state(path)?;

    let mut env: Vec<(String, String)> = extra_env.to_vec();

    if let Some(ref msg) = message {
        // Write the commit message to the appropriate file so git uses it
        let git_dir = Path::new(path).join(".git");
        match state.operation.as_str() {
            "rebase" => {
                let rebase_dir = if git_dir.join("rebase-merge").exists() {
                    git_dir.join("rebase-merge")
                } else {
                    git_dir.join("rebase-apply")
                };
                std::fs::write(rebase_dir.join("message"), msg)
                    .map_err(|e| AppError::Other(format!("Failed to write rebase message: {e}")))?;
            }
            "cherry-pick" | "merge" => {
                std::fs::write(git_dir.join("MERGE_MSG"), msg)
                    .map_err(|e| AppError::Other(format!("Failed to write merge message: {e}")))?;
            }
            _ => {}
        }
    }

    // Always suppress the editor when continuing from the UI.
    // `cat` is available on all platforms (MSYS2 on Windows, coreutils on
    // Unix). It reads the file to stdout and exits 0, leaving the commit
    // message file untouched — exactly what we need.
    env.push(("GIT_EDITOR".to_string(), "cat".to_string()));

    match state.operation.as_str() {
        "rebase" => run_git(path, &["rebase", "--continue"], &env),
        "cherry-pick" => run_git(path, &["cherry-pick", "--continue"], &env),
        "merge" => run_git(path, &["merge", "--continue"], &env),
        _ => Err(AppError::Other("No operation in progress".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init_temp_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("create temp dir");
        let p = dir.path().to_str().unwrap();
        git_cmd()
            .args(["init"])
            .current_dir(p)
            .output()
            .expect("git init");
        git_cmd()
            .args(["config", "user.email", "test@test.com"])
            .current_dir(p)
            .output()
            .expect("config email");
        git_cmd()
            .args(["config", "user.name", "Test"])
            .current_dir(p)
            .output()
            .expect("config name");
        // Create an initial commit so HEAD exists
        std::fs::write(dir.path().join(".gitkeep"), "").unwrap();
        git_cmd()
            .args(["add", ".gitkeep"])
            .current_dir(p)
            .output()
            .expect("add");
        git_cmd()
            .args(["commit", "-m", "init"])
            .current_dir(p)
            .output()
            .expect("commit");
        dir
    }

    #[test]
    fn conflict_contents_flags_binary_image_and_skips_text() {
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        // PNG-like blobs with NUL bytes → git's binary heuristic trips.
        let ours_png: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x00, 0x01, 0x02, 0x03];
        let theirs_png: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x00, 0xAA, 0xBB, 0xCC];

        let main = run_git(p, &["rev-parse", "--abbrev-ref", "HEAD"], &[])
            .unwrap()
            .trim()
            .to_string();

        // Branch A adds img.png
        run_git(p, &["checkout", "-b", "branch-a"], &[]).unwrap();
        std::fs::write(dir.path().join("img.png"), ours_png).unwrap();
        run_git(p, &["add", "img.png"], &[]).unwrap();
        run_git(p, &["commit", "-m", "a adds img"], &[]).unwrap();

        // Branch B adds a conflicting img.png
        run_git(p, &["checkout", &main], &[]).unwrap();
        run_git(p, &["checkout", "-b", "branch-b"], &[]).unwrap();
        std::fs::write(dir.path().join("img.png"), theirs_png).unwrap();
        run_git(p, &["add", "img.png"], &[]).unwrap();
        run_git(p, &["commit", "-m", "b adds img"], &[]).unwrap();

        // Merge A into B → add/add conflict on the binary file.
        run_git(p, &["checkout", "branch-a"], &[]).unwrap();
        let _ = run_git(p, &["merge", "branch-b"], &[]); // expected to fail (conflict)

        let contents = get_conflict_contents(p, "img.png").unwrap();
        assert!(contents.is_binary, "binary file should be flagged");
        assert!(
            contents.ours.is_empty(),
            "binary text content must be empty"
        );
        assert!(
            contents.theirs.is_empty(),
            "binary text content must be empty"
        );
        assert!(contents.base.is_none());
        assert!(contents.ours_image.is_some(), "image preview should be set");
        assert!(
            contents.theirs_image.is_some(),
            "image preview should be set"
        );
        // The two sides differ, so their previews must differ too.
        assert_ne!(contents.ours_image, contents.theirs_image);
    }

    #[test]
    fn conflict_contents_keeps_text_for_text_files() {
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        let main = run_git(p, &["rev-parse", "--abbrev-ref", "HEAD"], &[])
            .unwrap()
            .trim()
            .to_string();

        run_git(p, &["checkout", "-b", "branch-a"], &[]).unwrap();
        std::fs::write(dir.path().join("note.txt"), "alpha\n").unwrap();
        run_git(p, &["add", "note.txt"], &[]).unwrap();
        run_git(p, &["commit", "-m", "a"], &[]).unwrap();

        run_git(p, &["checkout", &main], &[]).unwrap();
        run_git(p, &["checkout", "-b", "branch-b"], &[]).unwrap();
        std::fs::write(dir.path().join("note.txt"), "beta\n").unwrap();
        run_git(p, &["add", "note.txt"], &[]).unwrap();
        run_git(p, &["commit", "-m", "b"], &[]).unwrap();

        run_git(p, &["checkout", "branch-a"], &[]).unwrap();
        let _ = run_git(p, &["merge", "branch-b"], &[]);

        let contents = get_conflict_contents(p, "note.txt").unwrap();
        assert!(!contents.is_binary);
        assert_eq!(contents.ours.trim(), "alpha");
        assert_eq!(contents.theirs.trim(), "beta");
        assert!(contents.ours_image.is_none());
        assert!(contents.theirs_image.is_none());
    }

    #[test]
    fn status_shows_untracked_file() {
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        std::fs::write(dir.path().join("new.txt"), "hello").unwrap();

        let status = get_status(p).unwrap();
        let untracked: Vec<_> = status
            .iter()
            .filter(|f| f.status_type == "untracked")
            .collect();
        assert_eq!(untracked.len(), 1);
        assert_eq!(untracked[0].path, "new.txt");
        assert!(!untracked[0].is_staged);
    }

    #[test]
    fn status_shows_staged_and_modified() {
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        // Create and stage a file
        std::fs::write(dir.path().join("a.txt"), "v1").unwrap();
        git_cmd()
            .args(["add", "a.txt"])
            .current_dir(p)
            .output()
            .unwrap();

        let status = get_status(p).unwrap();
        let staged: Vec<_> = status
            .iter()
            .filter(|f| f.is_staged && f.path == "a.txt")
            .collect();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status_type, "added");

        // Modify after staging → should appear as both staged (added) and unstaged (modified)
        std::fs::write(dir.path().join("a.txt"), "v2").unwrap();
        let status = get_status(p).unwrap();
        let entries: Vec<_> = status.iter().filter(|f| f.path == "a.txt").collect();
        assert_eq!(entries.len(), 2);
        assert!(entries
            .iter()
            .any(|f| f.is_staged && f.status_type == "added"));
        assert!(entries
            .iter()
            .any(|f| !f.is_staged && f.status_type == "modified"));
    }

    #[test]
    fn staged_rename_reports_both_paths_and_unstages_cleanly() {
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        std::fs::write(dir.path().join("orig.txt"), "same content\nlines\n").unwrap();
        run_git(p, &["add", "orig.txt"], &[]).unwrap();
        run_git(p, &["commit", "-m", "add orig"], &[]).unwrap();
        run_git(p, &["mv", "orig.txt", "renamed.txt"], &[]).unwrap();

        let status = get_status(p).unwrap();
        let renamed = status
            .iter()
            .find(|f| f.status_type == "renamed")
            .expect("staged rename row");
        assert_eq!(renamed.path, "renamed.txt");
        assert_eq!(renamed.old_path.as_deref(), Some("orig.txt"));
        assert!(renamed.is_staged);

        // Unstaging resets both index entries — the rename halves.
        unstage_files(p, &["renamed.txt".into(), "orig.txt".into()]).unwrap();
        let status = get_status(p).unwrap();
        assert!(status.iter().all(|f| !f.is_staged));
        assert!(status.iter().any(|f| f.path == "renamed.txt"));
    }

    #[test]
    fn status_shows_deleted_file() {
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        std::fs::write(dir.path().join("del.txt"), "bye").unwrap();
        git_cmd()
            .args(["add", "del.txt"])
            .current_dir(p)
            .output()
            .unwrap();
        git_cmd()
            .args(["commit", "-m", "add del.txt"])
            .current_dir(p)
            .output()
            .unwrap();

        std::fs::remove_file(dir.path().join("del.txt")).unwrap();

        let status = get_status(p).unwrap();
        let deleted: Vec<_> = status
            .iter()
            .filter(|f| f.path == "del.txt" && f.status_type == "deleted")
            .collect();
        assert_eq!(deleted.len(), 1);
        assert!(!deleted[0].is_staged);
    }

    #[test]
    fn status_shows_nested_untracked_files() {
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        std::fs::create_dir_all(dir.path().join("sub/deep")).unwrap();
        std::fs::write(dir.path().join("sub/a.txt"), "a").unwrap();
        std::fs::write(dir.path().join("sub/deep/b.txt"), "b").unwrap();

        let status = get_status(p).unwrap();
        let untracked: Vec<_> = status
            .iter()
            .filter(|f| f.status_type == "untracked")
            .collect();
        // -uall expands directories, so we get individual files
        assert_eq!(untracked.len(), 2);
        assert!(untracked.iter().any(|f| f.path == "sub/a.txt"));
        assert!(untracked.iter().any(|f| f.path == "sub/deep/b.txt"));
    }

    #[test]
    fn status_empty_repo_returns_empty() {
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        let status = get_status(p).unwrap();
        assert!(status.is_empty());
    }

    #[test]
    fn discard_files_handles_mixed_tracked_and_untracked() {
        // Regression: a single `git checkout -- <a> <b>` aborts the whole batch
        // with a pathspec error when any path is untracked, leaving tracked
        // modifications un-reverted. discard_files must revert the tracked file
        // AND remove the untracked one even when both are passed together.
        let dir = init_temp_repo();
        let p = dir.path().to_str().unwrap();

        // Commit a tracked file
        std::fs::write(dir.path().join("tracked.txt"), "v1").unwrap();
        git_cmd()
            .args(["add", "tracked.txt"])
            .current_dir(p)
            .output()
            .unwrap();
        git_cmd()
            .args(["commit", "-m", "add tracked"])
            .current_dir(p)
            .output()
            .unwrap();

        // Modify the tracked file and add an untracked one
        std::fs::write(dir.path().join("tracked.txt"), "modified").unwrap();
        std::fs::write(dir.path().join("untracked.txt"), "new").unwrap();

        discard_files(p, &["tracked.txt".to_string(), "untracked.txt".to_string()]).unwrap();

        // Tracked file reverted to its committed content
        let contents = std::fs::read_to_string(dir.path().join("tracked.txt")).unwrap();
        assert_eq!(contents, "v1");
        // Untracked file removed
        assert!(!dir.path().join("untracked.txt").exists());
        // Working tree is clean
        assert!(get_status(p).unwrap().is_empty());
    }
}
