//! Git-invocation module — the single seam through which git CLI subprocesses run.
//!
//! Callers never construct a [`Command`] directly; they go through one of three
//! intents so retry, profile-env injection, hook-failure detection, and error
//! enrichment all live in one place:
//!
//! - [`run_git`] — **mutations** (commit, checkout, stash, merge…). Returns git's
//!   combined stdout+stderr as a human-facing string (`"Done"` when empty), with
//!   `index.lock` retry and hook-failure enrichment.
//! - [`capture`] / [`capture_bytes`] — **reads** (`rev-parse`, `status`, `log`,
//!   `for-each-ref`…). Return **clean stdout only**, so stderr warnings can't leak
//!   into parsed output.
//! - [`run_git_with_progress`] — **long-running ops** (fetch, clone, pull) that
//!   stream stderr progress lines to a callback.

use crate::error::AppError;
use crate::git::profile::ActiveProfile;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::RwLock;

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

/// Create a `git` command with the console window hidden on Windows.
///
/// This is the only place a git `Command` is constructed. Prefer [`run_git`],
/// [`capture`], or [`run_git_with_progress`] over calling this directly.
pub(crate) fn git_cmd() -> Command {
    let mut cmd = Command::new("git");
    hide_console_window(&mut cmd);
    cmd
}

/// Serializes git subprocesses so a read never runs while the worktree is
/// being rewritten.
///
/// Reads ([`capture`]) take the read lock and still run concurrently with each
/// other; worktree/index mutations ([`run_git`]) take the write lock. Without
/// this, the 5-second status poll can hash a file at the moment `checkout` or
/// `stash` is replacing it — git bails with `short read while indexing <path>`
/// and the poll surfaces a "Load Status" error — and both processes fight over
/// `index.lock`, which on Windows turns a stash into a retry loop.
///
/// The guard is scoped to the `output()` call alone, never held across the
/// error-enrichment paths that call back into `capture` (that would deadlock:
/// `std::sync::RwLock` is not reentrant).
///
/// Two exemptions, both for long-running commands that touch neither the index
/// nor the worktree: `fetch` / `push` / `clone` in [`run_git_with_progress`]
/// (`pull` there *is* locked — it ends by rewriting the working tree), and
/// `git lfs prune`, which only deletes objects under `.git/lfs`. Holding the
/// write lock across a network transfer or a multi-minute prune would stall
/// every read for its whole duration.
///
/// ponytail: one lock for all repos — fine for a single-repo UI. Key it by repo
/// path if multi-repo windows ever run git concurrently.
static GIT_LOCK: RwLock<()> = RwLock::new(());

fn lock_read() -> std::sync::RwLockReadGuard<'static, ()> {
    GIT_LOCK.read().unwrap_or_else(|e| e.into_inner())
}

fn lock_write() -> std::sync::RwLockWriteGuard<'static, ()> {
    GIT_LOCK.write().unwrap_or_else(|e| e.into_inner())
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

/// Stderr fragments that mean "git itself rejected this" rather than "a user
/// hook rejected this". When any of these appears, a failure is attributed to
/// git, not to a hook — even if a candidate hook file exists.
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

/// Whether `stderr` matches a known git-internal error string.
///
/// Pure classification — the unit-test surface for "is this a git error or a
/// hook rejection?". Case-insensitive substring match against
/// [`GIT_INTERNAL_ERRORS`].
fn is_git_internal_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    GIT_INTERNAL_ERRORS
        .iter()
        .any(|pattern| lower.contains(&pattern.to_lowercase()))
}

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
fn hooks_dir(path: &str) -> PathBuf {
    if let Ok(custom) = capture(path, &["config", "core.hooksPath"], &[]) {
        let custom = custom.trim();
        if !custom.is_empty() {
            let p = Path::new(custom);
            return if p.is_absolute() {
                p.to_path_buf()
            } else {
                Path::new(path).join(p)
            };
        }
    }
    Path::new(path).join(".git").join("hooks")
}

/// Detect whether a git command failure was caused by a hook.
///
/// Returns `Some(hook_name)` if a candidate hook file exists for the given
/// subcommand AND the stderr doesn't look like a git-internal error. Returns
/// `None` otherwise (the error should be treated as a generic git error).
pub(crate) fn detect_hook_failure(path: &str, args: &[&str], stderr: &str) -> Option<String> {
    let subcommand = args.first().copied().unwrap_or("");
    let candidates = candidate_hooks(subcommand);
    if candidates.is_empty() {
        return None;
    }

    // If stderr matches a known git-internal error, it's not a hook failure.
    if is_git_internal_error(stderr) {
        return None;
    }

    // Check if any candidate hook file exists.
    let hooks = hooks_dir(path);
    candidates
        .iter()
        .find(|hook_name| hooks.join(hook_name).exists())
        .map(|hook_name| hook_name.to_string())
}

/// Run a git CLI **mutation** in the given repo directory.
/// Returns combined stdout+stderr on success, or AppError on failure.
///
/// `extra_env` allows injecting environment variables (e.g. profile identity
/// overrides). Pass `&[]` for operations that don't need them.
pub(crate) fn run_git(
    path: &str,
    args: &[&str],
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    const MAX_RETRIES: u32 = 3;
    const RETRY_DELAY_MS: u64 = 200;

    // See GIT_LOCK: prune is long and confined to the LFS object store.
    let needs_lock = !matches!(args, ["lfs", "prune", ..]);

    for attempt in 0..MAX_RETRIES {
        let mut cmd = git_cmd();
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
        let output = {
            let _guard = needs_lock.then(lock_write);
            cmd.args(args).current_dir(path).output()
        }
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

/// Run a read-only git command and return **clean stdout** (lossy UTF-8).
///
/// Unlike [`run_git`], stderr is never folded into the result, so warnings
/// (e.g. from `name-rev`) cannot leak into parsed output. On a non-zero exit
/// the trimmed stderr is returned as [`AppError::Git`]. For best-effort reads
/// that should degrade to a default, use `.ok()` / `.unwrap_or_default()`.
///
/// Output is returned untrimmed — callers that need trimming do so explicitly.
pub(crate) fn capture(
    path: &str,
    args: &[&str],
    extra_env: &[(String, String)],
) -> Result<String, AppError> {
    let out = capture_bytes(path, args, extra_env)?;
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// Like [`capture`] but returns **raw stdout bytes** — for binary blobs
/// (`git show :2:file`, image previews) and size-guarded reads that must
/// measure bytes before a lossy decode.
pub(crate) fn capture_bytes(
    path: &str,
    args: &[&str],
    extra_env: &[(String, String)],
) -> Result<Vec<u8>, AppError> {
    let mut cmd = git_cmd();
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let output = {
        let _guard = lock_read();
        cmd.args(args).current_dir(path).output()
    }
    .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Git(stderr));
    }
    Ok(output.stdout)
}

/// Run a git **mutation** that reads its input from stdin (`git apply --cached -`).
///
/// Separate from [`run_git`] only because the payload has to be streamed into
/// the child, which `Command::output()` can't do. Same write lock, same
/// [`AppError::Git`] on failure. No `index.lock` retry: the lock is what keeps
/// our own reads off the index, and an outside git process holding it is a
/// case the retry never reliably covered anyway.
pub(crate) fn run_git_stdin(path: &str, args: &[&str], input: &[u8]) -> Result<String, AppError> {
    let _guard = lock_write();
    let mut child = git_cmd()
        .args(args)
        .current_dir(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to run git: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input)
            .map_err(|e| AppError::Other(format!("Failed to write to git stdin: {e}")))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::Other(format!("Failed to wait for git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Git(stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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
    // A pull ends by merging into the working tree, so it takes the same write
    // lock as any other mutation — held for the whole stream, network phase
    // included, since there's no seam between fetch and merge here. fetch /
    // push / clone leave the worktree alone and stay unlocked.
    let _guard = args.contains(&"pull").then(lock_write);

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_errors_are_attributed_to_git_not_hooks() {
        assert!(is_git_internal_error(
            "nothing to commit, working tree clean"
        ));
        assert!(is_git_internal_error(
            "error: failed to push some refs (non-fast-forward)"
        ));
        assert!(is_git_internal_error(
            "error: pathspec 'foo.txt' did not match any file(s) known to git"
        ));
        // A hook's own rejection message is NOT a git-internal error.
        assert!(!is_git_internal_error("husky > pre-commit hook failed"));
        assert!(!is_git_internal_error("lint-staged found problems"));
    }

    #[test]
    fn profile_env_is_empty_without_a_profile() {
        assert!(profile_env(&None).is_empty());
    }

    #[test]
    fn profile_env_sets_identity_and_ssh_overrides() {
        let profile = ActiveProfile {
            profile_id: "p1".into(),
            user_name: "Ada Lovelace".into(),
            user_email: "ada@example.com".into(),
            ssh_key_path: Some("/home/ada/.ssh/id_ed25519".into()),
        };
        let env = profile_env(&Some(profile));
        let get = |k: &str| -> Option<&str> {
            env.iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(get("GIT_AUTHOR_NAME"), Some("Ada Lovelace"));
        assert_eq!(get("GIT_AUTHOR_EMAIL"), Some("ada@example.com"));
        assert_eq!(get("GIT_COMMITTER_NAME"), Some("Ada Lovelace"));
        assert_eq!(get("GIT_COMMITTER_EMAIL"), Some("ada@example.com"));
        assert_eq!(
            get("GIT_SSH_COMMAND"),
            Some("ssh -i \"/home/ada/.ssh/id_ed25519\" -o IdentitiesOnly=yes")
        );
    }

    #[test]
    fn profile_env_omits_ssh_command_without_a_key() {
        let profile = ActiveProfile {
            profile_id: "p1".into(),
            user_name: "Grace".into(),
            user_email: "grace@example.com".into(),
            ssh_key_path: None,
        };
        let env = profile_env(&Some(profile));
        assert!(!env.iter().any(|(k, _)| k == "GIT_SSH_COMMAND"));
        assert_eq!(env.len(), 4);
    }

    #[test]
    fn no_candidate_hooks_means_no_hook_failure() {
        // `status` has no associated hooks, so even a non-internal stderr
        // can't be a hook failure.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        assert_eq!(
            detect_hook_failure(path, &["status"], "something broke"),
            None
        );
    }

    #[test]
    fn detect_hook_failure_finds_an_existing_candidate_hook() {
        let dir = tempfile::tempdir().unwrap();
        let hooks = dir.path().join(".git").join("hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        std::fs::write(hooks.join("pre-commit"), "#!/bin/sh\nexit 1\n").unwrap();
        let path = dir.path().to_str().unwrap();

        // Non-internal stderr + existing pre-commit hook → attributed to the hook.
        assert_eq!(
            detect_hook_failure(path, &["commit", "-m", "x"], "linting failed"),
            Some("pre-commit".to_string())
        );
        // Internal git error wins even though the hook file exists.
        assert_eq!(
            detect_hook_failure(path, &["commit", "-m", "x"], "nothing to commit"),
            None
        );
    }
}
