//! Git LFS support — all operations call the `git lfs` CLI.
//!
//! Reuses `run_git` / `git_cmd` from `repository` so Windows
//! console-window suppression and error handling are consistent.

use crate::error::AppError;
use crate::git::repository::{git_cmd, run_git};
use crate::git::types::{LfsFileInfo, LfsInfo, LfsTrackPattern};
use std::path::Path;
use tracing::{debug, warn};

// ── Detection ─────────────────────────────────────────────────────────────────

/// Return the git-lfs version string (e.g. "git-lfs/3.5.1 ...") if installed,
/// or `None` if the binary is not on PATH.
pub fn lfs_version() -> Option<String> {
    let out = git_cmd().args(["lfs", "version"]).output().ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

/// Check whether LFS is initialised in the given repository.
///
/// LFS is considered initialised when `git lfs install` has been run,
/// which creates a `[filter "lfs"]` section in the local `.git/config`.
///
/// Having `filter=lfs` entries in `.gitattributes` alone is NOT enough —
/// those just declare tracking patterns. Without the filter config, git
/// won't actually invoke the LFS filter process on commit/checkout.
///
/// **No subprocesses**: reads `.git/config` directly (<1ms) instead of
/// spawning `git config` (~300ms on Windows).
pub fn is_lfs_initialized(path: &str) -> bool {
    let local_config = Path::new(path).join(".git").join("config");
    if local_config.exists() {
        if let Ok(contents) = std::fs::read_to_string(&local_config) {
            if contents.contains("[filter \"lfs\"]") {
                return true;
            }
        }
    }

    false
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/// Run `git lfs install --local` to set up LFS hooks in the repository.
pub fn lfs_install(path: &str) -> Result<String, AppError> {
    run_git(path, &["lfs", "install", "--local"], &[])
}

// ── Tracking ─────────────────────────────────────────────────────────────────

/// Return the list of patterns currently tracked by LFS.
///
/// Parses `git lfs track` output. Each line looks like:
///   `    *.psd (stored in .gitattributes)`
pub fn lfs_track_list(path: &str) -> Result<Vec<LfsTrackPattern>, AppError> {
    let out = git_cmd()
        .args(["lfs", "track"])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git lfs track: {e}")))?;

    let text = String::from_utf8_lossy(&out.stdout);
    let mut patterns = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        // Lines that declare a tracked pattern look like:
        //   "*.psd (stored in .gitattributes)"
        if let Some(paren_pos) = trimmed.find(" (stored in ") {
            let pattern = trimmed[..paren_pos].trim().to_string();
            let source_raw = &trimmed[paren_pos + " (stored in ".len()..];
            let source = source_raw.trim_end_matches(')').trim().to_string();
            if !pattern.is_empty() {
                patterns.push(LfsTrackPattern { pattern, source });
            }
        }
    }

    Ok(patterns)
}

/// Track a new file glob pattern with LFS: `git lfs track "<pattern>"`.
pub fn lfs_track(path: &str, pattern: &str) -> Result<String, AppError> {
    run_git(path, &["lfs", "track", pattern], &[])
}

/// Untrack a pattern: `git lfs untrack "<pattern>"`.
pub fn lfs_untrack(path: &str, pattern: &str) -> Result<String, AppError> {
    run_git(path, &["lfs", "untrack", pattern], &[])
}

// ── Object operations ─────────────────────────────────────────────────────────

/// Prune unreferenced LFS objects: `git lfs prune`.
pub fn lfs_prune(path: &str) -> Result<String, AppError> {
    run_git(path, &["lfs", "prune"], &[])
}

// ── File listing ──────────────────────────────────────────────────────────────

/// List all LFS-managed files with their OIDs and sizes.
///
/// Parses `git lfs ls-files -s` output. Each line looks like:
///   `abc123def456 * path/to/file.psd (1.2 MB)`
pub fn lfs_ls_files(path: &str) -> Result<Vec<LfsFileInfo>, AppError> {
    let out = git_cmd()
        .args(["lfs", "ls-files", "-s"])
        .current_dir(path)
        .output()
        .map_err(|e| AppError::Other(format!("Failed to run git lfs ls-files: {e}")))?;

    if !out.status.success() {
        // Not an error if LFS isn't installed or no files tracked
        return Ok(Vec::new());
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut files = Vec::new();

    for line in text.lines() {
        // Format: "<oid> <*|-> <path> (<size>)"
        let parts: Vec<&str> = line.splitn(3, ' ').collect();
        if parts.len() < 3 {
            continue;
        }
        let oid = parts[0].to_string();
        // parts[1] is "*" (present) or "-" (pointer only)
        let rest = parts[2]; // "path/to/file.psd (1.2 MB)"

        // Split off the size suffix in parens
        let (file_path, size_bytes) = if let Some(paren) = rest.rfind(" (") {
            let p = rest[..paren].trim().to_string();
            let size_str = &rest[paren + 2..rest.len() - 1]; // "1.2 MB"
            let bytes = parse_lfs_size(size_str);
            (p, bytes)
        } else {
            (rest.trim().to_string(), 0u64)
        };

        files.push(LfsFileInfo {
            oid,
            path: file_path,
            size: size_bytes,
        });
    }

    Ok(files)
}

/// Build the full `LfsInfo` aggregate used by the `lfs_get_info` command.
///
/// Performance: checks `.gitattributes` and git config FIRST (file read +
/// one lightweight subprocess at most) before spawning any `git lfs` Go
/// binaries (~500ms each on Windows). Repos that don't use LFS return in
/// under 1ms instead of the previous 2+ seconds.
pub fn lfs_get_info(path: &str) -> LfsInfo {
    // ── Fast path: does this repo even use LFS? ──────────────────────────
    // is_lfs_initialized checks .gitattributes (file read) then falls back
    // to `git config` (lightweight, not a Go binary). If neither indicates
    // LFS, we can skip ALL expensive `git lfs` subprocess calls.
    let repo_uses_lfs = is_lfs_initialized(path);
    debug!(repo_uses_lfs, "lfs_get_info: checked initialization");

    if !repo_uses_lfs {
        // Repo doesn't use LFS — no need to check if git-lfs is installed.
        // The `installed` field only matters when the repo actually uses LFS
        // (to show "git-lfs not found" warnings), so we can skip the ~500ms
        // `git lfs version` call entirely.
        return LfsInfo {
            installed: true,
            initialized: false,
            version: None,
            tracked_patterns: Vec::new(),
            file_count: 0,
            total_size: 0,
        };
    }

    // ── Slow path: repo uses LFS, need full details ──────────────────────
    let version = lfs_version();
    let installed = version.is_some();

    if !installed {
        return LfsInfo {
            installed: false,
            initialized: true, // repo wants LFS but binary is missing
            version: None,
            tracked_patterns: Vec::new(),
            file_count: 0,
            total_size: 0,
        };
    }

    // Ensure hooks are set up (reuses the initialized check we already did)
    if let Err(e) = lfs_install(path) {
        warn!("LFS hook setup failed: {e}");
    }

    let tracked_patterns = lfs_track_list(path).unwrap_or_default();
    let files = lfs_ls_files(path).unwrap_or_default();

    let total_size = files.iter().map(|f| f.size).sum();
    let file_count = files.len();

    LfsInfo {
        installed,
        initialized: true,
        version,
        tracked_patterns,
        file_count,
        total_size,
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Parse a human-readable LFS size string like "1.2 MB" into bytes.
fn parse_lfs_size(s: &str) -> u64 {
    let parts: Vec<&str> = s.trim().splitn(2, ' ').collect();
    if parts.len() != 2 {
        return 0;
    }
    let value: f64 = parts[0].parse().unwrap_or(0.0);
    let multiplier: f64 = match parts[1].to_uppercase().as_str() {
        "B" => 1.0,
        "KB" => 1_024.0,
        "MB" => 1_048_576.0,
        "GB" => 1_073_741_824.0,
        _ => 0.0,
    };
    (value * multiplier) as u64
}
