//! Git output parsers — pure functions: text/bytes in, typed values out, no I/O.
//!
//! This module is the unit-test surface for "did we read git's output
//! correctly?". Every function here is exercised with fixture strings, never a
//! real repository. The I/O that produces these strings lives in the
//! git-invocation module (`exec`); callers thread the captured text in here.

use crate::git::types::{CoAuthor, DiffHunk, DiffLine, FileStatus};
use std::collections::HashMap;

/// A map of path -> (additions, deletions), as produced by `git diff --numstat`.
pub type NumstatMap = HashMap<String, (u32, u32)>;

/// Unquote a git-quoted path.
///
/// Git wraps filenames in double quotes and uses C-style escaping when they
/// contain special characters (spaces, `&`, non-ASCII, etc.).
/// For example: `"Assets/Fonts & Materials/file.asset"`
///
/// This function strips the surrounding quotes and resolves escape sequences
/// (`\\`, `\"`, `\n`, `\t`, `\NNN` octal bytes, etc.).  If the path is not
/// quoted it is returned unchanged.
pub fn unquote_git_path(raw: &str) -> String {
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

/// Map a git porcelain status char to a UI status string.
pub fn status_type(ch: char) -> &'static str {
    match ch {
        'A' => "added",
        'M' => "modified",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "modified", // copied
        '?' => "untracked",
        _ => "modified",
    }
}

/// Parse `git diff --numstat` output into a map of path -> (additions, deletions).
///
/// Binary files (`-\t-\tpath`) are skipped (non-numeric counts).
pub fn numstat(stdout: &str) -> NumstatMap {
    let mut stats: NumstatMap = HashMap::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let add = parts[0].parse::<u32>().ok();
            let del = parts[1].parse::<u32>().ok();
            if let (Some(a), Some(d)) = (add, del) {
                stats.insert(unquote_git_path(parts[2]), (a, d));
            }
        }
    }
    stats
}

/// Parse `git status --porcelain=v1` output into typed [`FileStatus`] values.
///
/// Handles both `-uall` and `-unormal` output: the latter collapses untracked
/// directories into a single trailing-slash entry, which `-uall` never emits,
/// so the trailing-slash branch is a no-op there. The 7 conflict combinations
/// (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`) are detected and mapped to
/// human-readable conflict types. Line counts come from the two `--numstat`
/// maps (staged = `--cached`, unstaged = worktree). The result is sorted by
/// path.
pub fn porcelain_status(
    stdout: &str,
    staged_stats: &NumstatMap,
    unstaged_stats: &NumstatMap,
) -> Vec<FileStatus> {
    let mut result: Vec<FileStatus> = Vec::new();

    // Porcelain v1 format: "XY filename" where X=index status, Y=worktree status
    for line in stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_status = line.as_bytes()[0] as char;
        let wt_status = line.as_bytes()[1] as char;
        let file_path = unquote_git_path(&line[3..]);

        // `-unormal` shows untracked directories with a trailing slash; `-uall`
        // never does, so this branch is inert for the common path.
        if file_path.ends_with('/') {
            result.push(FileStatus {
                path: file_path.trim_end_matches('/').to_string(),
                status_type: "untracked".to_string(),
                is_staged: false,
                additions: None,
                deletions: None,
                is_conflicted: false,
                conflict_type: None,
            });
            continue;
        }

        // Merge conflicts: both columns have U, or specific add/delete combos.
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
                status_type: status_type(index_status).to_string(),
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
                    status_type(wt_status).to_string()
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
    result
}

/// Whether a unified diff body carries git's "Binary files … differ" marker.
pub fn has_binary_marker(diff_text: &str) -> bool {
    diff_text
        .lines()
        .any(|l| l.starts_with("Binary files ") && l.ends_with(" differ"))
}

/// Parse a unified diff body into hunks with per-line old/new line numbers.
pub fn unified_diff(diff_text: &str) -> Vec<DiffHunk> {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut old_counter: u32 = 0;
    let mut new_counter: u32 = 0;

    for line in diff_text.lines() {
        if line.starts_with("@@") {
            let (old_start, old_lines, new_start, new_lines) = hunk_header(line);
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

/// Parse a `@@ -old_start,old_lines +new_start,new_lines @@` header.
///
/// Missing counts default to 1 (git omits `,N` when N == 1). Returns
/// `(old_start, old_lines, new_start, new_lines)`.
pub fn hunk_header(line: &str) -> (u32, u32, u32, u32) {
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

/// Parse "Co-Authored-By: Name <email>" trailers from a commit message.
pub fn co_authors(message: &str) -> Vec<CoAuthor> {
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

/// Extract the "theirs" branch name from the first line of a `.git/MERGE_MSG`.
///
/// Recognises the messages git writes for merges and PR merges:
/// - `Merge branch 'feature-x'` / `… into main`
/// - `Merge remote-tracking branch 'origin/feature-x'`
/// - `Merge pull request #N from owner/branch-name`
pub fn branch_from_merge_msg(content: &str) -> Option<String> {
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

/// Sanitise the output of `git name-rev --name-only`.
///
/// `name-rev` can leak warnings or print `undefined`/multi-token noise that, if
/// captured loosely, would be shown to the user as a "branch name". Reject
/// anything that doesn't look like a single ref, and strip a leading
/// `remotes/origin/`. Returns `None` when the output isn't a usable name.
pub fn sanitize_name_rev(stdout: &str) -> Option<String> {
    let s = stdout.trim();
    if s.is_empty() || s.contains(' ') || s.contains("Could not") || s.contains("undefined") {
        return None;
    }
    Some(s.strip_prefix("remotes/origin/").unwrap_or(s).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unquote_plain_path_is_unchanged() {
        assert_eq!(unquote_git_path("src/main.rs"), "src/main.rs");
    }

    #[test]
    fn unquote_resolves_escapes_and_octal() {
        // Git quotes non-ASCII bytes as octal escapes.
        assert_eq!(
            unquote_git_path(r#""Assets/Fonts & Materials/file.asset""#),
            "Assets/Fonts & Materials/file.asset"
        );
        assert_eq!(unquote_git_path(r#""a\tb""#), "a\tb");
        // "café" → the é is UTF-8 0xC3 0xA9 = octal \303\251
        assert_eq!(unquote_git_path(r#""caf\303\251""#), "café");
    }

    #[test]
    fn numstat_parses_counts_and_skips_binary() {
        let map = numstat("3\t1\tsrc/a.rs\n-\t-\timg/logo.png\n10\t0\tb.txt\n");
        assert_eq!(map.get("src/a.rs"), Some(&(3, 1)));
        assert_eq!(map.get("b.txt"), Some(&(10, 0)));
        assert_eq!(map.get("img/logo.png"), None); // binary skipped
    }

    #[test]
    fn porcelain_detects_all_conflict_combos() {
        let cases = [
            ("UU file", "both_modified"),
            ("AA file", "both_added"),
            ("DD file", "both_deleted"),
            ("AU file", "added_by_us"),
            ("UA file", "added_by_them"),
            ("DU file", "deleted_by_us"),
            ("UD file", "deleted_by_them"),
        ];
        for (line, expected) in cases {
            let out = porcelain_status(line, &HashMap::new(), &HashMap::new());
            assert_eq!(out.len(), 1, "line {line:?}");
            assert!(out[0].is_conflicted, "line {line:?}");
            assert_eq!(out[0].conflict_type.as_deref(), Some(expected));
        }
    }

    #[test]
    fn porcelain_splits_staged_and_unstaged_for_same_file() {
        // Index modified + worktree modified → two rows for one path.
        let mut staged = HashMap::new();
        staged.insert("a.txt".to_string(), (2u32, 0u32));
        let mut unstaged = HashMap::new();
        unstaged.insert("a.txt".to_string(), (0u32, 3u32));

        let out = porcelain_status("MM a.txt", &staged, &unstaged);
        assert_eq!(out.len(), 2);
        let staged_row = out.iter().find(|f| f.is_staged).unwrap();
        let unstaged_row = out.iter().find(|f| !f.is_staged).unwrap();
        assert_eq!(staged_row.additions, Some(2));
        assert_eq!(unstaged_row.deletions, Some(3));
    }

    #[test]
    fn porcelain_handles_untracked_file_and_unormal_directory() {
        let out = porcelain_status("?? new.txt\n?? build/", &HashMap::new(), &HashMap::new());
        let new = out.iter().find(|f| f.path == "new.txt").unwrap();
        assert_eq!(new.status_type, "untracked");
        // -unormal directory entry: trailing slash stripped, marked untracked.
        let dir = out.iter().find(|f| f.path == "build").unwrap();
        assert_eq!(dir.status_type, "untracked");
        assert!(!dir.is_conflicted);
    }

    #[test]
    fn hunk_header_parses_counts_with_default_one() {
        assert_eq!(hunk_header("@@ -1,4 +1,6 @@"), (1, 4, 1, 6));
        // Omitted ,N means 1 line.
        assert_eq!(hunk_header("@@ -10 +12 @@ fn ctx()"), (10, 1, 12, 1));
    }

    #[test]
    fn unified_diff_tracks_line_numbers_per_origin() {
        let diff = "@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n";
        let hunks = unified_diff(diff);
        assert_eq!(hunks.len(), 1);
        let lines = &hunks[0].lines;
        assert_eq!(lines[0].origin, ' ');
        assert_eq!(lines[0].old_lineno, Some(1));
        assert_eq!(lines[0].new_lineno, Some(1));
        assert_eq!(lines[1].origin, '-');
        assert_eq!(lines[1].old_lineno, Some(2));
        assert_eq!(lines[1].new_lineno, None);
        assert_eq!(lines[2].origin, '+');
        assert_eq!(lines[2].old_lineno, None);
        assert_eq!(lines[2].new_lineno, Some(2));
    }

    #[test]
    fn co_authors_parses_trailers() {
        let msg = "Title\n\nCo-Authored-By: Ada <ada@x.io>\nCo-authored-by: Bob <bob@y.io>\n";
        let cas = co_authors(msg);
        assert_eq!(cas.len(), 2);
        assert_eq!(cas[0].name, "Ada");
        assert_eq!(cas[0].email, "ada@x.io");
        assert_eq!(cas[1].name, "Bob");
    }

    #[test]
    fn branch_from_merge_msg_handles_each_form() {
        assert_eq!(
            branch_from_merge_msg("Merge branch 'feature-x'"),
            Some("feature-x".to_string())
        );
        assert_eq!(
            branch_from_merge_msg("Merge branch 'feature-x' into main"),
            Some("feature-x".to_string())
        );
        assert_eq!(
            branch_from_merge_msg("Merge remote-tracking branch 'origin/feature-x'"),
            Some("feature-x".to_string())
        );
        assert_eq!(
            branch_from_merge_msg("Merge pull request #42 from acme/fix-thing"),
            Some("fix-thing".to_string())
        );
        assert_eq!(branch_from_merge_msg("Some unrelated message"), None);
    }

    #[test]
    fn sanitize_name_rev_rejects_noise_and_strips_remote() {
        assert_eq!(
            sanitize_name_rev("feature-x\n"),
            Some("feature-x".to_string())
        );
        assert_eq!(
            sanitize_name_rev("remotes/origin/feature-x"),
            Some("feature-x".to_string())
        );
        assert_eq!(sanitize_name_rev(""), None);
        assert_eq!(sanitize_name_rev("Could not get name"), None);
        assert_eq!(sanitize_name_rev("warning: something\nfeature"), None); // multi-token
    }
}
