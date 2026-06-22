//! Conflict reconstruction — rebuilding the state of an in-progress
//! merge/rebase/cherry-pick for the conflict editor.
//!
//! Split into two halves:
//! - [`gather`] — the **gatherer**: all the git calls and `.git/` reads that
//!   collect the three conflict stages plus commit ids and branch names, in
//!   **git's** orientation (stage 2 = git's "ours", stage 3 = git's "theirs").
//! - [`assemble`] — the pure **conflict assembler**: binary detection, image
//!   preview encoding, and the **ours/theirs swap**. It takes fabricated facts
//!   and produces a [`ConflictContents`] with no I/O, so the swap — the app's
//!   main source of inversion bugs — is unit-testable.

use crate::git::exec::{capture, capture_bytes};
use crate::git::parse;
use crate::git::types::ConflictContents;
use std::path::{Path, PathBuf};

/// Conflict facts as gathered from git, in **git's** orientation (NOT yet
/// swapped for the user's mental model). The pure [`assemble`] step applies the
/// rebase swap.
pub struct ConflictFacts {
    pub file_path: String,
    /// True during a rebase, when git's stage 2/3 are inverted from the user's
    /// perspective and must be swapped.
    pub is_rebase: bool,
    /// git stage 1 — common ancestor (`None` for add/add conflicts).
    pub base_bytes: Option<Vec<u8>>,
    /// git stage 2 — git's "ours" (HEAD side).
    pub git_ours_bytes: Option<Vec<u8>>,
    /// git stage 3 — git's "theirs" (incoming side).
    pub git_theirs_bytes: Option<Vec<u8>>,
    /// Short commit id for the stage-2 side (HEAD).
    pub git_ours_commit: String,
    /// Short commit id for the stage-3 side (REBASE_HEAD / MERGE_HEAD / CHERRY_PICK_HEAD).
    pub git_theirs_commit: String,
    /// Branch name for the stage-2 side. Merge: current branch (`symbolic-ref`).
    /// Rebase: the `onto` / target branch.
    pub git_ours_branch: String,
    /// Branch name for the stage-3 side. Merge: from MERGE_MSG / name-rev.
    /// Rebase: the branch being replayed (`head-name`).
    pub git_theirs_branch: String,
    /// Rebase only: subject line of the commit being replayed.
    pub rebase_commit_message: Option<String>,
}

/// Returns `true` if a rebase (interactive or apply-based) is currently in progress.
pub(crate) fn is_rebase_in_progress(repo_path: &str) -> bool {
    let git_dir = Path::new(repo_path).join(".git");
    git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists()
}

/// Resolve the active rebase state directory (`rebase-merge` or `rebase-apply`).
fn rebase_state_dir(repo_path: &str) -> Option<PathBuf> {
    let git_dir = Path::new(repo_path).join(".git");
    if git_dir.join("rebase-merge").exists() {
        Some(git_dir.join("rebase-merge"))
    } else if git_dir.join("rebase-apply").exists() {
        Some(git_dir.join("rebase-apply"))
    } else {
        None
    }
}

/// Read the name of the branch being rebased from the rebase state directory.
///
/// During `git rebase B` (while on branch A), the file `head-name` contains
/// `refs/heads/A` — the branch whose commits are being replayed.
fn read_rebase_head_name(repo_path: &str) -> Option<String> {
    let rebase_dir = rebase_state_dir(repo_path)?;
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
    let rebase_dir = rebase_state_dir(repo_path)?;
    let onto_hash = std::fs::read_to_string(rebase_dir.join("onto"))
        .ok()?
        .trim()
        .to_string();
    if onto_hash.is_empty() {
        return None;
    }
    // Try to resolve the onto commit to a branch name.
    capture(
        repo_path,
        &["name-rev", "--name-only", "--no-undefined", &onto_hash],
        &[],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty() && !s.contains(' ') && !s.contains("Could not"))
    .map(|s| {
        // Strip decorations like "branch-name~2" that name-rev adds.
        let s = s.split('~').next().unwrap_or(&s);
        let s = s.split('^').next().unwrap_or(s);
        s.strip_prefix("remotes/origin/").unwrap_or(s).to_string()
    })
    .or_else(|| {
        // Fall back to short hash.
        capture(repo_path, &["rev-parse", "--short", &onto_hash], &[])
            .ok()
            .map(|s| s.trim().to_string())
    })
}

/// Read a conflict stage as raw bytes (`:1:`=base, `:2:`=ours, `:3:`=theirs).
/// Returns `None` if the stage doesn't exist (e.g. base for an add/add conflict).
fn git_show_stage_bytes(repo_path: &str, stage: u8, file_path: &str) -> Option<Vec<u8>> {
    let spec = format!(":{stage}:{file_path}");
    capture_bytes(repo_path, &["show", &spec], &[]).ok()
}

/// Read the "theirs" branch name from `.git/MERGE_MSG` (merge / PR-merge forms).
fn branch_from_merge_msg(repo_path: &str) -> Option<String> {
    let msg_path = Path::new(repo_path).join(".git/MERGE_MSG");
    let content = std::fs::read_to_string(msg_path).ok()?;
    parse::branch_from_merge_msg(&content)
}

/// Git's binary heuristic: a NUL byte within the first 8000 bytes.
fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(8000)].contains(&0)
}

/// Whether a path has an image extension we can preview in the binary resolver.
fn is_image_path(file_path: &str) -> bool {
    let lower = file_path.to_ascii_lowercase();
    [
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".avif",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

/// Gather the raw conflict facts for `file_path` from git, in git's orientation.
///
/// Every read is best-effort: missing refs degrade to short hashes rather than
/// erroring, mirroring the conflict editor's tolerance for partial state.
pub fn gather(repo_path: &str, file_path: &str) -> ConflictFacts {
    // :1: = base (common ancestor), :2: = git's ours, :3: = git's theirs
    let base_bytes = git_show_stage_bytes(repo_path, 1, file_path);
    let git_ours_bytes = git_show_stage_bytes(repo_path, 2, file_path);
    let git_theirs_bytes = git_show_stage_bytes(repo_path, 3, file_path);

    let short = |args: &[&str]| -> String {
        capture(repo_path, args, &[])
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };

    if is_rebase_in_progress(repo_path) {
        // During rebase of A onto B, git stage 2 = HEAD = target B and
        // stage 3 = REBASE_HEAD = user's branch A.
        let head_short = short(&["rev-parse", "--short", "HEAD"]);
        let rebase_head_short = short(&["rev-parse", "--short", "REBASE_HEAD"]);
        let onto_name = read_rebase_onto_name(repo_path).unwrap_or_else(|| head_short.clone());
        let head_name = read_rebase_head_name(repo_path).unwrap_or_else(|| {
            capture(
                repo_path,
                &["name-rev", "--name-only", "--no-undefined", "REBASE_HEAD"],
                &[],
            )
            .ok()
            .and_then(|s| parse::sanitize_name_rev(&s))
            .unwrap_or_else(|| rebase_head_short.clone())
        });
        let rebase_commit_message =
            capture(repo_path, &["log", "-1", "--format=%s", "REBASE_HEAD"], &[])
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

        ConflictFacts {
            file_path: file_path.to_string(),
            is_rebase: true,
            base_bytes,
            git_ours_bytes,
            git_theirs_bytes,
            git_ours_commit: head_short, // stage 2 = HEAD = target
            git_theirs_commit: rebase_head_short, // stage 3 = REBASE_HEAD = user branch
            git_ours_branch: onto_name,  // target / onto
            git_theirs_branch: head_name, // branch being replayed
            rebase_commit_message,
        }
    } else {
        // Merge and cherry-pick: git's ours/theirs already match the user.
        let head_short = short(&["rev-parse", "--short", "HEAD"]);
        let head_branch = capture(repo_path, &["symbolic-ref", "--short", "HEAD"], &[])
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| head_short.clone());

        let theirs_ref = if Path::new(repo_path).join(".git/MERGE_HEAD").exists() {
            "MERGE_HEAD"
        } else if Path::new(repo_path).join(".git/CHERRY_PICK_HEAD").exists() {
            "CHERRY_PICK_HEAD"
        } else {
            "HEAD" // shouldn't reach here given the rebase check above
        };
        let theirs_short = short(&["rev-parse", "--short", theirs_ref]);
        let theirs_branch = branch_from_merge_msg(repo_path)
            .or_else(|| {
                capture(
                    repo_path,
                    &["name-rev", "--name-only", "--no-undefined", theirs_ref],
                    &[],
                )
                .ok()
                .and_then(|s| parse::sanitize_name_rev(&s))
            })
            .unwrap_or_else(|| theirs_short.clone());

        ConflictFacts {
            file_path: file_path.to_string(),
            is_rebase: false,
            base_bytes,
            git_ours_bytes,
            git_theirs_bytes,
            git_ours_commit: head_short,
            git_theirs_commit: theirs_short,
            git_ours_branch: head_branch,
            git_theirs_branch: theirs_branch,
            rebase_commit_message: None,
        }
    }
}

/// Assemble user-facing [`ConflictContents`] from gathered facts. **Pure.**
///
/// Detects binary content (NUL-byte heuristic), encodes image previews, and
/// applies the rebase **ours/theirs swap** so the UI always shows the user's
/// own branch as "ours" and the incoming branch as "theirs".
pub fn assemble(facts: ConflictFacts) -> ConflictContents {
    // Binary files (images, archives, fonts, …) must never be diffed as text:
    // the line-by-line conflict editor would choke on the lossy-decoded bytes.
    let is_binary = [
        &facts.base_bytes,
        &facts.git_ours_bytes,
        &facts.git_theirs_bytes,
    ]
    .into_iter()
    .filter_map(|b| b.as_deref())
    .any(looks_binary);

    let (base, git_ours, git_theirs, git_ours_image, git_theirs_image) = if is_binary {
        // Skip text content entirely; ship base64 previews for image files only.
        let encode = |b: &Option<Vec<u8>>| -> Option<String> {
            if !is_image_path(&facts.file_path) {
                return None;
            }
            use base64::Engine;
            b.as_deref()
                .map(|d| base64::engine::general_purpose::STANDARD.encode(d))
        };
        (
            None,
            String::new(),
            String::new(),
            encode(&facts.git_ours_bytes),
            encode(&facts.git_theirs_bytes),
        )
    } else {
        let to_text = |b: &[u8]| String::from_utf8_lossy(b).into_owned();
        (
            facts.base_bytes.as_deref().map(to_text),
            facts
                .git_ours_bytes
                .as_deref()
                .map(to_text)
                .unwrap_or_default(),
            facts
                .git_theirs_bytes
                .as_deref()
                .map(to_text)
                .unwrap_or_default(),
            None,
            None,
        )
    };

    if facts.is_rebase {
        // Swap so the UI shows the user's branch (git stage 3) as "ours" and the
        // target branch (git stage 2) as "theirs".
        ConflictContents {
            base,
            ours: git_theirs,
            theirs: git_ours,
            ours_commit_id: facts.git_theirs_commit,
            theirs_commit_id: facts.git_ours_commit,
            ours_branch: facts.git_theirs_branch,
            theirs_branch: facts.git_ours_branch,
            rebase_commit_message: facts.rebase_commit_message,
            is_binary,
            ours_image: git_theirs_image,
            theirs_image: git_ours_image,
        }
    } else {
        ConflictContents {
            base,
            ours: git_ours,
            theirs: git_theirs,
            ours_commit_id: facts.git_ours_commit,
            theirs_commit_id: facts.git_theirs_commit,
            ours_branch: facts.git_ours_branch,
            theirs_branch: facts.git_theirs_branch,
            rebase_commit_message: None,
            is_binary,
            ours_image: git_ours_image,
            theirs_image: git_theirs_image,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_facts(is_rebase: bool) -> ConflictFacts {
        ConflictFacts {
            file_path: "src/a.rs".into(),
            is_rebase,
            base_bytes: Some(b"base\n".to_vec()),
            git_ours_bytes: Some(b"stage2-head\n".to_vec()),
            git_theirs_bytes: Some(b"stage3-incoming\n".to_vec()),
            git_ours_commit: "head222".into(),
            git_theirs_commit: "incom33".into(),
            git_ours_branch: "stage2-branch".into(),
            git_theirs_branch: "stage3-branch".into(),
            rebase_commit_message: Some("replayed subject".into()),
        }
    }

    #[test]
    fn rebase_swaps_ours_and_theirs() {
        let c = assemble(text_facts(true));
        // User's own branch (git stage 3) becomes "ours".
        assert_eq!(c.ours, "stage3-incoming\n");
        assert_eq!(c.theirs, "stage2-head\n");
        assert_eq!(c.ours_commit_id, "incom33");
        assert_eq!(c.theirs_commit_id, "head222");
        assert_eq!(c.ours_branch, "stage3-branch");
        assert_eq!(c.theirs_branch, "stage2-branch");
        assert_eq!(c.rebase_commit_message.as_deref(), Some("replayed subject"));
        assert!(!c.is_binary);
    }

    #[test]
    fn merge_keeps_git_orientation() {
        let c = assemble(text_facts(false));
        assert_eq!(c.ours, "stage2-head\n");
        assert_eq!(c.theirs, "stage3-incoming\n");
        assert_eq!(c.ours_commit_id, "head222");
        assert_eq!(c.theirs_commit_id, "incom33");
        assert_eq!(c.ours_branch, "stage2-branch");
        assert_eq!(c.theirs_branch, "stage3-branch");
        assert!(c.rebase_commit_message.is_none());
        assert_eq!(c.base.as_deref(), Some("base\n"));
    }

    #[test]
    fn binary_image_suppresses_text_and_encodes_previews() {
        let mut facts = text_facts(false);
        facts.file_path = "logo.png".into();
        facts.base_bytes = None;
        facts.git_ours_bytes = Some(vec![0x89, b'P', b'N', b'G', 0x00, 0x01]);
        facts.git_theirs_bytes = Some(vec![0x89, b'P', b'N', b'G', 0x00, 0x02]);

        let c = assemble(facts);
        assert!(c.is_binary);
        assert_eq!(c.ours, ""); // text suppressed for binary
        assert_eq!(c.theirs, "");
        assert!(c.ours_image.is_some());
        assert!(c.theirs_image.is_some());
    }

    #[test]
    fn binary_non_image_has_no_preview() {
        let mut facts = text_facts(false);
        facts.file_path = "data.bin".into();
        facts.base_bytes = None;
        facts.git_ours_bytes = Some(vec![0x00, 0x01, 0x02]);
        facts.git_theirs_bytes = Some(vec![0x00, 0x03]);

        let c = assemble(facts);
        assert!(c.is_binary);
        assert!(c.ours_image.is_none());
        assert!(c.theirs_image.is_none());
    }

    #[test]
    fn rebase_swaps_image_previews_too() {
        let mut facts = text_facts(true);
        facts.file_path = "logo.png".into();
        facts.base_bytes = None;
        facts.git_ours_bytes = Some(vec![0x00, b'A']); // stage 2 (target)
        facts.git_theirs_bytes = Some(vec![0x00, b'B']); // stage 3 (user)

        let c = assemble(facts);
        assert!(c.is_binary);
        use base64::Engine;
        let b64 = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
        // ours_image should be the user's (stage 3) bytes after the swap.
        assert_eq!(c.ours_image.as_deref(), Some(b64(&[0x00, b'B']).as_str()));
        assert_eq!(c.theirs_image.as_deref(), Some(b64(&[0x00, b'A']).as_str()));
    }
}
