//! Git LFS support — all operations call the `git lfs` CLI.
//!
//! Reuses `run_git` / `git_cmd` from `repository` so Windows
//! console-window suppression and error handling are consistent.

use crate::error::AppError;
use crate::git::repository::{git_cmd, run_git};
use crate::git::types::{LfsFileInfo, LfsInfo, LfsTrackPattern};
use std::path::Path;

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
/// We consider LFS initialised when both conditions hold:
///   1. `.gitattributes` contains at least one `filter=lfs` entry, OR
///      `git config --get filter.lfs.process` returns a value (hooks are set).
///   2. The `git-lfs` binary is available.
pub fn is_lfs_initialized(path: &str) -> bool {
    // Fast path: check .gitattributes for filter=lfs
    let gitattributes = Path::new(path).join(".gitattributes");
    if gitattributes.exists() {
        if let Ok(contents) = std::fs::read_to_string(&gitattributes) {
            if contents.contains("filter=lfs") {
                return true;
            }
        }
    }

    // Slower: check if the lfs filter process is configured locally or globally
    let out = git_cmd()
        .args(["config", "--get", "filter.lfs.process"])
        .current_dir(path)
        .output();

    matches!(out, Ok(o) if o.status.success() && !o.stdout.is_empty())
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/// Ensure LFS hooks are installed if the repo uses LFS.
///
/// Called automatically when a repo is opened.  Returns `true` when LFS is
/// active (hooks present), `false` when the repo does not use LFS or
/// git-lfs is not installed.
pub fn ensure_lfs_hooks(path: &str) -> Result<bool, AppError> {
    // git-lfs binary not on PATH — nothing we can do
    if lfs_version().is_none() {
        return Ok(false);
    }

    // Repo already has hooks set up
    if is_lfs_initialized(path) {
        return Ok(true);
    }

    // Check if the repo actually uses LFS (.gitattributes contains filter=lfs)
    let gitattributes = Path::new(path).join(".gitattributes");
    if gitattributes.exists() {
        if let Ok(contents) = std::fs::read_to_string(&gitattributes) {
            if contents.contains("filter=lfs") {
                lfs_install(path)?;
                return Ok(true);
            }
        }
    }

    Ok(false)
}

/// Run `git lfs install --local` to set up LFS hooks in the repository.
pub fn lfs_install(path: &str) -> Result<String, AppError> {
    run_git(path, &["lfs", "install", "--local"])
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
    run_git(path, &["lfs", "track", pattern])
}

/// Untrack a pattern: `git lfs untrack "<pattern>"`.
pub fn lfs_untrack(path: &str, pattern: &str) -> Result<String, AppError> {
    run_git(path, &["lfs", "untrack", pattern])
}

// ── Object operations ─────────────────────────────────────────────────────────

/// Prune unreferenced LFS objects: `git lfs prune`.
pub fn lfs_prune(path: &str) -> Result<String, AppError> {
    run_git(path, &["lfs", "prune"])
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
pub fn lfs_get_info(path: &str) -> LfsInfo {
    let version = lfs_version();
    let installed = version.is_some();
    let initialized = installed && is_lfs_initialized(path);

    let tracked_patterns = if initialized {
        lfs_track_list(path).unwrap_or_default()
    } else {
        Vec::new()
    };

    let files = if initialized {
        lfs_ls_files(path).unwrap_or_default()
    } else {
        Vec::new()
    };

    let total_size = files.iter().map(|f| f.size).sum();
    let file_count = files.len();

    LfsInfo {
        installed,
        initialized,
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
