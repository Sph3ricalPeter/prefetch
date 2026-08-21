//! Git worktree support — reads and mutates linked worktrees via the git CLI.
//!
//! **Why the CLI and not git2**: `git worktree list --porcelain` returns every
//! worktree with its HEAD, branch, and lock/prune state in a single subprocess,
//! and it works from *any* worktree. libgit2's equivalent returns names only,
//! needs a `find_worktree` plus a separate lock-status call per worktree, and
//! wants the main repo. One call beats N+1.

use crate::error::AppError;
use crate::git::exec::run_git;
use crate::git::types::WorktreeInfo;
use std::path::Path;

/// List every worktree attached to the repository at `path`.
///
/// The first record git emits is always the main worktree. `is_current` marks
/// the worktree the app currently has open.
pub fn list_worktrees(path: &str) -> Result<Vec<WorktreeInfo>, AppError> {
    let out = run_git(path, &["worktree", "list", "--porcelain"], &[])?;
    Ok(parse_worktree_list(&out, path))
}

/// Normalise a path for comparison: canonicalise when it exists on disk (this
/// resolves symlinks, 8.3 names, and case on Windows), otherwise fall back to
/// lowercasing and unifying separators. Prunable worktrees point at directories
/// that are gone, so the fallback matters.
fn normalize(p: &str) -> String {
    dunce::canonicalize(p)
        .map(|c| c.to_string_lossy().to_string())
        .unwrap_or_else(|_| p.to_string())
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

/// Parse `git worktree list --porcelain`.
///
/// Records are separated by blank lines. `detached` and `bare` are label-only
/// lines present when true; `locked` and `prunable` appear either bare or with
/// a reason after a single space.
pub(crate) fn parse_worktree_list(porcelain: &str, current_path: &str) -> Vec<WorktreeInfo> {
    let current = normalize(current_path);
    let mut out: Vec<WorktreeInfo> = Vec::new();
    let mut pending: Option<WorktreeInfo> = None;

    // `worktree <path>` opens a record; everything up to the next one (or EOF)
    // belongs to it.
    for line in porcelain.lines() {
        let line = line.trim_end();
        if let Some(wt_path) = line.strip_prefix("worktree ") {
            if let Some(prev) = pending.take() {
                out.push(prev);
            }
            pending = Some(WorktreeInfo {
                path: wt_path.to_string(),
                head: String::new(),
                branch: None,
                is_current: normalize(wt_path) == current,
                is_main: out.is_empty(),
                locked: None,
                prunable: None,
            });
            continue;
        }

        let Some(wt) = pending.as_mut() else {
            continue;
        };

        if let Some(head) = line.strip_prefix("HEAD ") {
            wt.head = head.to_string();
        } else if let Some(branch) = line.strip_prefix("branch ") {
            wt.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
        } else if let Some(reason) = line.strip_prefix("locked") {
            wt.locked = Some(reason.trim().to_string());
        } else if let Some(reason) = line.strip_prefix("prunable") {
            wt.prunable = Some(reason.trim().to_string());
        }
    }

    if let Some(prev) = pending {
        out.push(prev);
    }
    out
}

/// Map `branch name -> worktree path` for branches checked out in a worktree
/// **other than** the one currently open.
///
/// This is what drives the worktree badge: a non-empty entry means git will
/// refuse both `checkout` and `branch -d` for that branch. The current
/// worktree's own branch is excluded because `is_head` already covers it.
pub fn branch_worktree_map(path: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let Ok(worktrees) = list_worktrees(path) else {
        return map;
    };
    for wt in worktrees {
        if wt.is_current {
            continue;
        }
        if let Some(branch) = wt.branch {
            map.insert(branch, wt.path);
        }
    }
    map
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/// Create a worktree at `worktree_path` checked out to an existing `branch`.
pub fn add_worktree(path: &str, worktree_path: &str, branch: &str) -> Result<(), AppError> {
    run_git(path, &["worktree", "add", worktree_path, branch], &[])?;
    Ok(())
}

/// Remove a worktree. `force` passes `-f -f`, which is what git demands to
/// remove a *locked* worktree (a single `-f` only covers a dirty one).
///
/// Refuses to remove the worktree the app currently has open: git deletes the
/// `.git/worktrees/<name>` admin entry first, then fails to delete a directory
/// that is in use ("Permission denied", exit 255). What's left is a directory
/// that is no longer a git repository at all, which is exactly the directory
/// the app is pointed at — every later git call fails.
pub fn remove_worktree(path: &str, worktree_path: &str, force: bool) -> Result<(), AppError> {
    if normalize(path) == normalize(worktree_path) {
        return Err(AppError::Other(
            "Can't remove the worktree that's currently open. Switch to another worktree first."
                .to_string(),
        ));
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("-f");
        args.push("-f");
    }
    args.push(worktree_path);
    run_git(path, &args, &[])?;
    Ok(())
}

/// Drop bookkeeping for worktrees whose directories no longer exist.
pub fn prune_worktrees(path: &str) -> Result<String, AppError> {
    run_git(path, &["worktree", "prune", "-v"], &[])
}

/// Resolve a caller-supplied worktree path against the repo's actual worktree
/// list, returning the path exactly as git knows it.
///
/// Every command that takes a path from the frontend routes through here, so an
/// arbitrary path can never reach `worktree remove` or the file explorer.
pub fn resolve_worktree(path: &str, worktree_path: &str) -> Result<String, AppError> {
    let target = normalize(worktree_path);
    list_worktrees(path)?
        .into_iter()
        .find(|wt| normalize(&wt.path) == target)
        .map(|wt| wt.path)
        .ok_or_else(|| {
            AppError::Other(format!(
                "Not a worktree of this repository: {worktree_path}"
            ))
        })
}

/// Suggest a path for a new worktree: a sibling of the repository root named
/// `<repo>-<branch>`.
///
/// Sibling rather than nested — a worktree inside the repo shows up in
/// `git status` and breaks tools that walk up looking for the repository root.
pub fn suggest_worktree_path(repo_path: &str, branch: &str) -> String {
    let repo = Path::new(repo_path);
    let repo_name = repo
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".to_string());
    // Branch names carry separators and other characters a directory can't.
    let slug: String = branch
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    let leaf = format!("{repo_name}-{slug}");
    match repo.parent() {
        Some(parent) => parent.join(leaf).to_string_lossy().replace('\\', "/"),
        None => leaf,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
worktree /repos/app
HEAD 034249ae5f2531b985636a0f93414b54c6f94e86
branch refs/heads/main

worktree /repos/app-feat
HEAD 6982c969dfec61afb101125b98e08c70c3fa582f
branch refs/heads/feat/hunk-staging
locked on a usb stick

worktree /repos/app-detached
HEAD 35343e4aff97416e027e30dd1da3ee0b361f3a10
detached

worktree /repos/app-gone
HEAD 6982c969dfec61afb101125b98e08c70c3fa582f
branch refs/heads/dead
prunable gitdir file points to non-existent location
";

    #[test]
    fn parses_every_record_and_field() {
        let wts = parse_worktree_list(SAMPLE, "/repos/app");
        assert_eq!(wts.len(), 4);

        assert_eq!(wts[0].branch.as_deref(), Some("main"));
        assert!(wts[0].is_main);
        assert!(wts[0].is_current);
        assert_eq!(wts[0].head, "034249ae5f2531b985636a0f93414b54c6f94e86");

        // Branch names containing a slash survive the refs/heads/ strip.
        assert_eq!(wts[1].branch.as_deref(), Some("feat/hunk-staging"));
        assert_eq!(wts[1].locked.as_deref(), Some("on a usb stick"));
        assert!(!wts[1].is_main);
        assert!(!wts[1].is_current);

        // `detached` means no branch, and it must not be read as one.
        assert_eq!(wts[2].branch, None);
        assert_eq!(wts[2].locked, None);

        assert_eq!(
            wts[3].prunable.as_deref(),
            Some("gitdir file points to non-existent location")
        );
    }

    #[test]
    fn locked_without_reason_is_still_locked() {
        let wts = parse_worktree_list("worktree /a\nHEAD abc\nbranch refs/heads/x\nlocked\n", "/a");
        assert_eq!(wts[0].locked.as_deref(), Some(""));
    }

    #[test]
    fn single_record_without_trailing_blank_line_is_kept() {
        // run_git trims its output, so the final record has no blank line after it.
        let wts = parse_worktree_list("worktree /a\nHEAD abc\nbranch refs/heads/x", "/nowhere");
        assert_eq!(wts.len(), 1);
        assert!(!wts[0].is_current);
    }

    #[test]
    fn current_match_ignores_separator_and_case() {
        // Git emits forward slashes; the app's repo path comes from a Windows
        // file dialog with backslashes.
        let wts = parse_worktree_list(
            "worktree C:/Users/x/Repo\nHEAD abc\nbranch refs/heads/main",
            r"C:\Users\x\repo",
        );
        assert!(wts[0].is_current);
    }

    /// End-to-end against a real repo: add a worktree, then assert the list and
    /// the branch map agree with it. Catches drift between our parser and the
    /// git version actually installed.
    #[test]
    fn lists_a_real_worktree_and_maps_its_branch() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let repo_str = repo.to_str().unwrap();

        for args in [
            vec!["init", "-q", "."],
            vec!["config", "user.email", "t@t.t"],
            vec!["config", "user.name", "t"],
            vec!["commit", "-q", "--allow-empty", "-m", "init"],
            vec!["branch", "feat"],
        ] {
            run_git(repo_str, &args, &[]).unwrap();
        }

        let wt = dir.path().join("repo-feat");
        add_worktree(repo_str, wt.to_str().unwrap(), "feat").unwrap();

        let wts = list_worktrees(repo_str).unwrap();
        assert_eq!(wts.len(), 2);
        assert!(wts[0].is_main && wts[0].is_current);
        assert_eq!(wts[1].branch.as_deref(), Some("feat"));
        assert!(!wts[1].is_current);
        assert!(wts[1].locked.is_none() && wts[1].prunable.is_none());

        // The map excludes the current worktree's own branch and includes the other's.
        let map = branch_worktree_map(repo_str);
        assert!(map.contains_key("feat"));
        assert_eq!(map.len(), 1);

        // An arbitrary path can't pass as a worktree of this repo.
        assert!(resolve_worktree(repo_str, dir.path().to_str().unwrap()).is_err());
        assert!(resolve_worktree(repo_str, wt.to_str().unwrap()).is_ok());

        // Removing the open worktree would delete git's admin entry and then
        // fail on the in-use directory, leaving a dir that is no longer a repo.
        let err = remove_worktree(wt.to_str().unwrap(), wt.to_str().unwrap(), false)
            .expect_err("removing the open worktree must be refused");
        assert!(err.to_string().contains("currently open"), "got: {err}");
        assert_eq!(list_worktrees(repo_str).unwrap().len(), 2);

        remove_worktree(repo_str, wt.to_str().unwrap(), false).unwrap();
        assert_eq!(list_worktrees(repo_str).unwrap().len(), 1);
    }

    #[test]
    fn suggested_path_is_a_sibling_with_a_slugged_branch() {
        assert_eq!(
            suggest_worktree_path("/repos/app", "feat/hunk-staging"),
            "/repos/app-feat-hunk-staging"
        );
    }
}
