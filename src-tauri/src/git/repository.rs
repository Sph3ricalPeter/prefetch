use crate::error::AppError;
use crate::git::forge;
use crate::git::graph::assign_lanes;
use crate::git::profile::ActiveProfile;
use crate::git::types::{
    self as types, BranchInfo, CoAuthor, CommitInfo, ConflictState, DiffHunk, DiffLine, FileDiff,
    FileStatus, GraphData, RebaseProgress, StashInfo, TagInfo, UndoAction,
};
use git2::{BranchType, Repository, Sort};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use tracing::warn;

/// Unquote a git-quoted path.
///
/// Git wraps filenames in double quotes and uses C-style escaping when they
/// contain special characters (spaces, `&`, non-ASCII, etc.).
/// For example: `"Assets/Fonts & Materials/file.asset"`
///
/// This function strips the surrounding quotes and resolves escape sequences
/// (`\\`, `\"`, `\n`, `\t`, `\NNN` octal bytes, etc.).  If the path is not
/// quoted it is returned unchanged.
fn unquote_git_path(raw: &str) -> String {
    // Git-quoted paths always start AND end with "
    if !(raw.starts_with('"') && raw.ends_with('"') && raw.len() >= 2) {
        return raw.to_string();
    }
    let inner = &raw[1..raw.len() - 1];
    let mut result = Vec::with_capacity(inner.len());
    let bytes = inner.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 1;
            match bytes[i] {
                b'\\' => result.push(b'\\'),
                b'"' => result.push(b'"'),
                b'n' => result.push(b'\n'),
                b't' => result.push(b'\t'),
                b'r' => result.push(b'\r'),
                b'a' => result.push(0x07),
                b'b' => result.push(0x08),
                b'f' => result.push(0x0C),
                b'v' => result.push(0x0B),
                // Octal: \NNN (1-3 digits)
                b'0'..=b'7' => {
                    let mut val: u8 = bytes[i] - b'0';
                    for _ in 0..2 {
                        if i + 1 < bytes.len() && bytes[i + 1] >= b'0' && bytes[i + 1] <= b'7' {
                            i += 1;
                            val = val * 8 + (bytes[i] - b'0');
                        } else {
                            break;
                        }
                    }
                    result.push(val);
                }
                other => {
                    // Unknown escape – keep as-is
                    result.push(b'\\');
                    result.push(other);
                }
            }
        } else {
            result.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&result).to_string()
}

/// Configure a Command to hide the console window on Windows.
/// Without this, every `git` subprocess opens a visible terminal flash.
#[cfg(target_os = "windows")]
fn hide_console_window(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000) // CREATE_NO_WINDOW
}

#[cfg(not(target_os = "windows"))]
fn hide_console_window(cmd: &mut Command) -> &mut Command {
    cmd
}

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

/// Create a `git` command with console window hidden on Windows.
pub(crate) fn git_cmd() -> Command {
    let mut cmd = Command::new("git");
    hide_console_window(&mut cmd);
    cmd
}

/// Build environment variable overrides for git commands from the active profile.
///
/// When a profile is active, these env vars override whatever the user's git
/// config says for identity and SSH key. Returns an empty Vec when no profile.
pub fn profile_env(profile: &Option<ActiveProfile>) -> Vec<(String, String)> {
    let Some(p) = profile else {
        return vec![];
    };
    let mut env = vec![
        ("GIT_AUTHOR_NAME".into(), p.user_name.clone()),
        ("GIT_AUTHOR_EMAIL".into(), p.user_email.clone()),
        ("GIT_COMMITTER_NAME".into(), p.user_name.clone()),
        ("GIT_COMMITTER_EMAIL".into(), p.user_email.clone()),
    ];
    if let Some(ref ssh_path) = p.ssh_key_path {
        env.push((
            "GIT_SSH_COMMAND".into(),
            format!("ssh -i \"{ssh_path}\" -o IdentitiesOnly=yes"),
        ));
    }
    env
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
/// Batch-compute ahead/behind counts for all local branches in a single subprocess.
///
/// Uses `git for-each-ref --format='%(refname:short)\t%(upstream:track)'` which outputs
/// lines like `main\t[ahead 3, behind 1]` or `feature\t` (no upstream).
fn get_all_divergence(path: &str) -> HashMap<String, (u32, u32)> {
    let output = git_cmd()
        .args([
            "for-each-ref",
            "--format=%(refname:short)\t%(upstream:track)",
            "refs/heads/",
        ])
        .current_dir(path)
        .output();

    let mut map = HashMap::new();
    let out = match output {
        Ok(o) if o.status.success() => o,
        _ => return map,
    };

    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() != 2 {
            continue;
        }
        let branch_name = parts[0];
        let track = parts[1]; // e.g. "[ahead 3, behind 1]" or "[ahead 2]" or ""

        if track.is_empty() {
            continue;
        }

        let mut ahead = 0u32;
        let mut behind = 0u32;

        // Parse "ahead N"
        if let Some(pos) = track.find("ahead ") {
            let rest = &track[pos + 6..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            ahead = rest[..end].parse().unwrap_or(0);
        }
        // Parse "behind N"
        if let Some(pos) = track.find("behind ") {
            let rest = &track[pos + 7..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            behind = rest[..end].parse().unwrap_or(0);
        }

        if ahead > 0 || behind > 0 {
            map.insert(branch_name.to_string(), (ahead, behind));
        }
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

    // Batch-fetch ahead/behind for all local branches (single subprocess)
    let divergence = get_all_divergence(path);

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

            // Look up ahead/behind for local branches
            let (ahead, behind) = if !is_remote {
                divergence
                    .get(&name)
                    .map(|&(a, b)| (Some(a), Some(b)))
                    .unwrap_or((Some(0), Some(0)))
            } else {
                (None, None)
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
        run_git_with_progress(path, &args, &on_progress, &env)
    } else {
        run_git_with_progress(
            path,
            &["fetch", "--all", "--prune", "--progress"],
            &on_progress,
            extra_env,
        )
    }
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
        run_git_with_progress(path, &args, &on_progress, &env)
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
        // Defensively fixup tracking after any successful URL-based push
        // (handles edge cases like a previously deleted tracking ref).
        if authed.is_some() {
            fixup_remote_tracking_for_head(path);
        }
        return Ok(output.clone());
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

/// Known git-internal error strings that should NOT be classified as hook failures,
/// even when the candidate hook file exists.
const GIT_INTERNAL_ERRORS: &[&str] = &[
    "nothing to commit",
    "nothing added to commit",
    "empty commit message",
    "no changes added to commit",
    "pathspec",
    "did not match any file",
    "unable to access",
    "could not resolve host",
    "Authentication failed",
    "Permission denied",
    "rejected",
    "non-fast-forward",
    "failed to push",
];

/// Map a git subcommand to the hook names that can fire during that command.
fn candidate_hooks(subcommand: &str) -> &'static [&'static str] {
    match subcommand {
        "commit" => &["pre-commit", "prepare-commit-msg", "commit-msg"],
        "push" => &["pre-push"],
        "merge" => &["pre-merge-commit"],
        "rebase" => &["pre-rebase"],
        "checkout" | "switch" => &["post-checkout"],
        _ => &[],
    }
}

/// Resolve the hooks directory for the given repository.
///
/// Checks `core.hooksPath` first (used by husky, lefthook, pre-commit framework).
/// Falls back to `.git/hooks/`.
fn hooks_dir(path: &str) -> std::path::PathBuf {
    // Try to read core.hooksPath
    if let Ok(output) = git_cmd()
        .args(["config", "core.hooksPath"])
        .current_dir(path)
        .output()
    {
        if output.status.success() {
            let custom = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !custom.is_empty() {
                let p = std::path::Path::new(&custom);
                if p.is_absolute() {
                    return p.to_path_buf();
                } else {
                    return std::path::Path::new(path).join(&custom);
                }
            }
        }
    }
    std::path::Path::new(path).join(".git").join("hooks")
}

/// Detect whether a git command failure was caused by a hook.
///
/// Returns `Some(hook_name)` if a candidate hook file exists for the given
/// subcommand AND the stderr doesn't contain known git-internal error strings.
/// Returns `None` otherwise (the error should be treated as a generic git error).
fn detect_hook_failure(path: &str, args: &[&str], stderr: &str) -> Option<String> {
    let subcommand = args.first().copied().unwrap_or("");
    let candidates = candidate_hooks(subcommand);
    if candidates.is_empty() {
        return None;
    }

    // If stderr matches a known git-internal error, it's not a hook failure
    let lower = stderr.to_lowercase();
    for pattern in GIT_INTERNAL_ERRORS {
        if lower.contains(&pattern.to_lowercase()) {
            return None;
        }
    }

    // Check if any candidate hook file exists
    let hooks = hooks_dir(path);
    for hook_name in candidates {
        let hook_path = hooks.join(hook_name);
        if hook_path.exists() {
            return Some(hook_name.to_string());
        }
    }

    None
}

/// Run a git CLI command in the given repo directory.
/// Returns combined stdout+stderr on success, or AppError on failure.
///
/// `extra_env` allows injecting environment variables (e.g. profile identity
/// overrides). Pass `&[]` for read-only operations that don't need them.
pub(crate) fn run_git(
    path: &str,
    args: &[&str],
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    const MAX_RETRIES: u32 = 3;
    const RETRY_DELAY_MS: u64 = 200;

    for attempt in 0..MAX_RETRIES {
        let mut cmd = git_cmd();
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
        let output = cmd
            .args(args)
            .current_dir(path)
            .output()
            .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}{}", stdout.trim(), stderr.trim());
            return Ok(if combined.is_empty() {
                "Done".to_string()
            } else {
                combined
            });
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        // Retry on index.lock contention (another git process is running)
        if attempt + 1 < MAX_RETRIES && stderr.contains("index.lock") {
            std::thread::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS));
            continue;
        }

        if let Some(hook_name) = detect_hook_failure(path, args, &stderr) {
            return Err(AppError::HookFailed {
                hook_name,
                output: stderr,
            });
        }
        return Err(AppError::Git(stderr));
    }

    unreachable!()
}

/// Run a git CLI command with real-time progress streaming.
///
/// Git writes progress to stderr using `\r` for in-place updates.
/// This function reads stderr in chunks, splits on `\r`/`\n`, and calls
/// `on_progress` with each line. The `--progress` flag must be included
/// in `args` to force progress output on piped stderr.
///
/// `extra_env` allows injecting environment variables (e.g. profile identity
/// overrides). Pass `&[]` for operations that don't need them.
pub(crate) fn run_git_with_progress<F: Fn(&str)>(
    path: &str,
    args: &[&str],
    on_progress: &F,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    let mut cmd = git_cmd();
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let mut child = cmd
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
        let stderr_str = all_stderr.trim().to_string();
        if let Some(hook_name) = detect_hook_failure(path, args, &stderr_str) {
            return Err(AppError::HookFailed {
                hook_name,
                output: stderr_str,
            });
        }
        return Err(AppError::Git(stderr_str));
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
    let output = git_cmd().args(args).current_dir(path).output().ok();

    let mut stats: HashMap<String, (u32, u32)> = HashMap::new();
    if let Some(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                let add = parts[0].parse::<u32>().ok();
                let del = parts[1].parse::<u32>().ok();
                if let (Some(a), Some(d)) = (add, del) {
                    stats.insert(unquote_git_path(parts[2]), (a, d));
                }
            }
        }
    }
    stats
}

/// Get the working tree status (staged + unstaged + untracked files).
///
/// Uses `git status --porcelain=v1` CLI instead of git2-rs to avoid
/// false positives from CRLF/autocrlf handling on Windows.
pub fn get_status(path: &str) -> Result<Vec<FileStatus>, AppError> {
    let output = git_cmd()
        .args(["status", "--porcelain=v1", "-unormal"])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git status: {e}")))?;

    let text = String::from_utf8_lossy(&output.stdout);

    // Fast path: no changes at all → skip the 2 expensive `git diff --numstat`
    // subprocess spawns (~100ms saved on Windows). The poller hits this path
    // most of the time when the user isn't actively editing files.
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    // Get line stats for staged and unstaged changes
    let staged_stats = parse_numstat(path, &["diff", "--cached", "--numstat"]);
    let unstaged_stats = parse_numstat(path, &["diff", "--numstat"]);

    let mut result: Vec<FileStatus> = Vec::new();

    // Porcelain v1 format: "XY filename" where X=index status, Y=worktree status
    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_status = line.as_bytes()[0] as char;
        let wt_status = line.as_bytes()[1] as char;
        let file_path = unquote_git_path(&line[3..]);

        // Check for merge conflicts (both columns have U, or specific conflict combos)
        let is_conflict = matches!(
            (index_status, wt_status),
            ('U', 'U')
                | ('A', 'A')
                | ('D', 'D')
                | ('A', 'U')
                | ('U', 'A')
                | ('D', 'U')
                | ('U', 'D')
        );

        if is_conflict {
            let conflict_type = match (index_status, wt_status) {
                ('U', 'U') => "both_modified",
                ('A', 'A') => "both_added",
                ('D', 'D') => "both_deleted",
                ('A', 'U') => "added_by_us",
                ('U', 'A') => "added_by_them",
                ('D', 'U') => "deleted_by_us",
                ('U', 'D') => "deleted_by_them",
                _ => "conflicted",
            };
            result.push(FileStatus {
                path: file_path,
                status_type: "conflicted".to_string(),
                is_staged: false,
                additions: None,
                deletions: None,
                is_conflicted: true,
                conflict_type: Some(conflict_type.to_string()),
            });
            continue;
        }

        // Staged changes (index column)
        if index_status != ' ' && index_status != '?' {
            let (additions, deletions) = staged_stats
                .get(&file_path)
                .map(|&(a, d)| (Some(a), Some(d)))
                .unwrap_or((None, None));
            result.push(FileStatus {
                path: file_path.clone(),
                status_type: porcelain_to_status_type(index_status),
                is_staged: true,
                additions,
                deletions,
                is_conflicted: false,
                conflict_type: None,
            });
        }

        // Unstaged / untracked changes (worktree column)
        if wt_status != ' ' {
            let (additions, deletions) = unstaged_stats
                .get(&file_path)
                .map(|&(a, d)| (Some(a), Some(d)))
                .unwrap_or((None, None));
            result.push(FileStatus {
                path: file_path,
                status_type: if index_status == '?' {
                    "untracked".to_string()
                } else {
                    porcelain_to_status_type(wt_status)
                },
                is_staged: false,
                additions,
                deletions,
                is_conflicted: false,
                conflict_type: None,
            });
        }
    }

    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

fn porcelain_to_status_type(ch: char) -> String {
    match ch {
        'A' => "added",
        'M' => "modified",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "modified", // copied
        '?' => "untracked",
        _ => "modified",
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

    let output = git_cmd()
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git diff: {e}")))?;

    let diff_text = String::from_utf8_lossy(&output.stdout);

    // Untracked files won't show in git diff — read file content as all-added
    if diff_text.trim().is_empty() && !staged {
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
        }
    }

    if diff_text.contains("Binary files") {
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
        hunks: parse_unified_diff(&diff_text),
        is_binary: false,
        is_truncated: false,
        total_lines: 0,
    }))
}

fn parse_unified_diff(diff_text: &str) -> Vec<DiffHunk> {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut old_counter: u32 = 0;
    let mut new_counter: u32 = 0;

    for line in diff_text.lines() {
        if line.starts_with("@@") {
            let (old_start, old_lines, new_start, new_lines) = parse_hunk_header(line);
            old_counter = old_start;
            new_counter = new_start;
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

            let (old_lineno, new_lineno) = match origin {
                '+' => {
                    let n = new_counter;
                    new_counter += 1;
                    (None, Some(n))
                }
                '-' => {
                    let o = old_counter;
                    old_counter += 1;
                    (Some(o), None)
                }
                _ => {
                    let o = old_counter;
                    let n = new_counter;
                    old_counter += 1;
                    new_counter += 1;
                    (Some(o), Some(n))
                }
            };

            hunk.lines.push(DiffLine {
                origin,
                content,
                old_lineno,
                new_lineno,
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

/// Discard changes in specific files (revert to HEAD state).
/// Handles tracked modified/deleted files via `git checkout`, and
/// untracked files via `git clean`.
/// Resolve a conflict by accepting our version of the file.
///
/// During rebase, git's ours/theirs are inverted from the user's perspective,
/// so we swap the checkout flag to match the UI's "ours" = user's branch.
pub fn resolve_ours(path: &str, file_path: &str) -> Result<(), AppError> {
    let flag = if is_rebase_in_progress(path) {
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
    let flag = if is_rebase_in_progress(path) {
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

    // Restore tracked files to HEAD state
    let mut restore_args = vec!["checkout", "--"];
    restore_args.extend(file_refs.clone());
    let _ = run_git(path, &restore_args, &[]);

    // Clean untracked files
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

/// Get the base, ours, and theirs versions of a conflicted file,
/// along with commit hashes and branch names for display.
///
/// During **rebase**, git's ours/theirs semantics are inverted from the user's
/// perspective (git's "ours" = target branch, git's "theirs" = rebased branch).
/// We swap them here so the frontend always sees:
///   - "ours"   = the user's working branch
///   - "theirs" = the incoming / target branch
pub fn get_conflict_contents(
    repo_path: &str,
    file_path: &str,
) -> Result<types::ConflictContents, AppError> {
    // :1: = base (common ancestor), :2: = git's ours, :3: = git's theirs
    let base = git_show_stage(repo_path, 1, file_path).ok();
    let git_ours = git_show_stage(repo_path, 2, file_path).unwrap_or_default();
    let git_theirs = git_show_stage(repo_path, 3, file_path).unwrap_or_default();

    if is_rebase_in_progress(repo_path) {
        // During rebase of A onto B:
        //   git stage 2 ("ours")   = HEAD   = target branch B
        //   git stage 3 ("theirs") = REBASE_HEAD = user's branch A
        // Swap so the UI shows A as "ours" and B as "theirs".

        // Ours = user's branch (the branch being rebased)
        let ours_commit_id = run_git(repo_path, &["rev-parse", "--short", "REBASE_HEAD"], &[])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let ours_branch = read_rebase_head_name(repo_path).unwrap_or_else(|| {
            // Fallback: try name-rev on REBASE_HEAD
            run_git(
                repo_path,
                &["name-rev", "--name-only", "--no-undefined", "REBASE_HEAD"],
                &[],
            )
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && !s.contains(' ') && !s.contains("Could not"))
            .map(|s| s.strip_prefix("remotes/origin/").unwrap_or(&s).to_string())
            .unwrap_or_else(|| ours_commit_id.clone())
        });

        // Theirs = target branch (the branch we're rebasing onto)
        let theirs_commit_id = run_git(repo_path, &["rev-parse", "--short", "HEAD"], &[])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let theirs_branch =
            read_rebase_onto_name(repo_path).unwrap_or_else(|| theirs_commit_id.clone());

        let rebase_commit_message = run_git(
            repo_path,
            &["log", "-1", "--format=%s", "REBASE_HEAD"],
            &[],
        )
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

        Ok(types::ConflictContents {
            base,
            ours: git_theirs, // swap: user's branch content (git stage 3)
            theirs: git_ours, // swap: target branch content (git stage 2)
            ours_commit_id,
            theirs_commit_id,
            ours_branch,
            theirs_branch,
            rebase_commit_message,
        })
    } else {
        // Merge and cherry-pick: git's ours/theirs matches user expectations.

        // Ours = HEAD (current branch)
        let ours_commit_id = run_git(repo_path, &["rev-parse", "--short", "HEAD"], &[])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let ours_branch = run_git(repo_path, &["symbolic-ref", "--short", "HEAD"], &[])
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| ours_commit_id.clone());

        // Theirs = MERGE_HEAD or CHERRY_PICK_HEAD
        let theirs_ref = if Path::new(repo_path).join(".git/MERGE_HEAD").exists() {
            "MERGE_HEAD"
        } else if Path::new(repo_path).join(".git/CHERRY_PICK_HEAD").exists() {
            "CHERRY_PICK_HEAD"
        } else {
            "HEAD" // shouldn't reach here given rebase check above
        };
        let theirs_commit_id = run_git(repo_path, &["rev-parse", "--short", theirs_ref], &[])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        // Try to extract theirs branch name from MERGE_MSG (most reliable),
        // then fallback to name-rev (validating output), then commit hash.
        let theirs_branch = extract_branch_from_merge_msg(repo_path)
            .or_else(|| {
                run_git(
                    repo_path,
                    &["name-rev", "--name-only", "--no-undefined", theirs_ref],
                    &[],
                )
                .ok()
                .map(|s| s.trim().to_string())
                // name-rev can leak stderr warnings into stdout via run_git —
                // filter out anything that doesn't look like a branch name.
                .filter(|s| !s.is_empty() && !s.contains(' ') && !s.contains("Could not"))
                .map(|s| s.strip_prefix("remotes/origin/").unwrap_or(&s).to_string())
            })
            .unwrap_or_else(|| theirs_commit_id.clone());

        Ok(types::ConflictContents {
            base,
            ours: git_ours,
            theirs: git_theirs,
            ours_commit_id,
            theirs_commit_id,
            ours_branch,
            theirs_branch,
            rebase_commit_message: None,
        })
    }
}

/// Extract the theirs branch name from `.git/MERGE_MSG`.
///
/// Git writes this file during merge and it typically contains lines like:
/// - `Merge branch 'feature-x'`
/// - `Merge branch 'feature-x' into main`
/// - `Merge remote-tracking branch 'origin/feature-x'`
fn extract_branch_from_merge_msg(repo_path: &str) -> Option<String> {
    let msg_path = std::path::Path::new(repo_path).join(".git/MERGE_MSG");
    let content = std::fs::read_to_string(msg_path).ok()?;
    let first_line = content.lines().next()?;

    // "Merge branch 'branch-name'" or "Merge branch 'branch-name' into ..."
    if let Some(rest) = first_line.strip_prefix("Merge branch '") {
        return rest.split('\'').next().map(|s| s.to_string());
    }
    // "Merge remote-tracking branch 'origin/branch-name'"
    if let Some(rest) = first_line.strip_prefix("Merge remote-tracking branch '") {
        let full = rest.split('\'').next()?;
        return Some(full.strip_prefix("origin/").unwrap_or(full).to_string());
    }
    // "Merge pull request #N from owner/branch-name"
    if let Some(rest) = first_line.strip_prefix("Merge pull request ") {
        // Skip "#N from " to get "owner/branch-name"
        if let Some(pos) = rest.find(" from ") {
            let full = &rest[pos + 6..];
            // Strip owner prefix: "owner/branch" → "branch"
            return Some(full.split('/').skip(1).collect::<Vec<_>>().join("/"))
                .filter(|s| !s.is_empty())
                .or_else(|| Some(full.to_string()));
        }
    }
    None
}

/// Returns `true` if a rebase (interactive or apply-based) is currently in progress.
fn is_rebase_in_progress(repo_path: &str) -> bool {
    let git_dir = Path::new(repo_path).join(".git");
    git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists()
}

/// Read the name of the branch being rebased from the rebase state directory.
///
/// During `git rebase B` (while on branch A), the file `head-name` contains
/// `refs/heads/A` — the branch whose commits are being replayed.
/// Returns `None` if no rebase is in progress or the file is missing.
fn read_rebase_head_name(repo_path: &str) -> Option<String> {
    let git_dir = Path::new(repo_path).join(".git");
    let rebase_dir = if git_dir.join("rebase-merge").exists() {
        git_dir.join("rebase-merge")
    } else if git_dir.join("rebase-apply").exists() {
        git_dir.join("rebase-apply")
    } else {
        return None;
    };
    std::fs::read_to_string(rebase_dir.join("head-name"))
        .ok()
        .map(|s| {
            s.trim()
                .strip_prefix("refs/heads/")
                .unwrap_or(s.trim())
                .to_string()
        })
}

/// Read the "onto" target for the current rebase and resolve it to a branch name.
///
/// The `onto` file contains a full commit hash. We use `git name-rev` to
/// resolve it to a branch name, stripping `~N`/`^N` decorations, or fall back
/// to a short hash.
fn read_rebase_onto_name(repo_path: &str) -> Option<String> {
    let git_dir = Path::new(repo_path).join(".git");
    let rebase_dir = if git_dir.join("rebase-merge").exists() {
        git_dir.join("rebase-merge")
    } else if git_dir.join("rebase-apply").exists() {
        git_dir.join("rebase-apply")
    } else {
        return None;
    };
    let onto_hash = std::fs::read_to_string(rebase_dir.join("onto"))
        .ok()?
        .trim()
        .to_string();
    if onto_hash.is_empty() {
        return None;
    }
    // Try to resolve the onto commit to a branch name
    run_git(
        repo_path,
        &["name-rev", "--name-only", "--no-undefined", &onto_hash],
        &[],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty() && !s.contains(' ') && !s.contains("Could not"))
    .map(|s| {
        // Strip decorations like "branch-name~2" that name-rev adds
        let s = s.split('~').next().unwrap_or(&s);
        let s = s.split('^').next().unwrap_or(s);
        s.strip_prefix("remotes/origin/").unwrap_or(s).to_string()
    })
    .or_else(|| {
        // Fall back to short hash
        run_git(repo_path, &["rev-parse", "--short", &onto_hash], &[])
            .ok()
            .map(|s| s.trim().to_string())
    })
}

fn git_show_stage(repo_path: &str, stage: u8, file_path: &str) -> Result<String, AppError> {
    let spec = format!(":{stage}:{file_path}");
    let output = git_cmd()
        .args(["show", &spec])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git show: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Git(format!(
            "Stage {stage} not available for {file_path}"
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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

/// Get the list of files changed in a specific commit.
pub fn get_commit_files(repo_path: &str, commit_id: &str) -> Result<Vec<FileStatus>, AppError> {
    // Get name-status for file status types
    let output = git_cmd()
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
            let file_path = unquote_git_path(parts[1]);
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
                is_conflicted: false,
                conflict_type: None,
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
    let output = git_cmd()
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
            is_truncated: false,
            total_lines: 0,
        });
    }

    Ok(truncate_diff(FileDiff {
        path: file_path.to_string(),
        hunks: parse_unified_diff(&diff_text),
        is_binary: false,
        is_truncated: false,
        total_lines: 0,
    }))
}

/// List all stashes with commit and parent IDs.
pub fn list_stashes(path: &str) -> Result<Vec<StashInfo>, AppError> {
    // Use --format to get: <stash_hash>\t<parent_hash>\t<refname>\t<message>
    let output = git_cmd()
        .args(["stash", "list", "--format=%H%x09%P%x09%gd%x09%gs"])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    let text = String::from_utf8_lossy(&output.stdout);
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

/// Stash current changes (including untracked files).
pub fn stash_push(
    path: &str,
    message: Option<&str>,
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    let mut args = vec!["stash", "push", "-u"];
    if let Some(msg) = message {
        args.push("-m");
        args.push(msg);
    }
    run_git(path, &args, extra_env)
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

    let output = git_cmd()
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
            let file_path = unquote_git_path(parts[1]);
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
                is_conflicted: false,
                conflict_type: None,
            });
        }
    }

    Ok(files)
}

/// List all tags with their commit SHAs and messages.
pub fn list_tags(path: &str) -> Result<Vec<TagInfo>, AppError> {
    let output = git_cmd()
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
    let output = git_cmd()
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
            is_truncated: false,
            total_lines: 0,
        });
    }

    Ok(truncate_diff(FileDiff {
        path: file_path.to_string(),
        hunks: parse_unified_diff(&diff_text),
        is_binary: false,
        is_truncated: false,
        total_lines: 0,
    }))
}

/// Get the last undoable action from the reflog.
pub fn get_undo_action(path: &str) -> Result<UndoAction, AppError> {
    let output = git_cmd()
        .args(["reflog", "--format=%H %gs", "-n", "1"])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to read reflog: {e}")))?;

    let text = String::from_utf8_lossy(&output.stdout);
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
    let output = git_cmd()
        .args(["reflog", "--format=%H %gs", "-n", "2"])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to read reflog: {e}")))?;

    let text = String::from_utf8_lossy(&output.stdout);
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
    let mut args = vec!["stash", "push"];
    if let Some(msg) = message {
        args.push("-m");
        args.push(msg);
    }
    args.push("--");
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    run_git(path, &args, extra_env)
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
