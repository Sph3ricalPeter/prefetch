//! Commit-message suggestions via the locally installed Claude Code CLI.
//!
//! No API keys: we shell out to `claude -p`, which uses whatever login the
//! user already has.

use crate::error::AppError;
use crate::git::exec::{capture, hide_console_window};
use crate::git::types::CommitSuggestion;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

const MAX_DIFF_BYTES: usize = 100 * 1024;

const SYSTEM_PROMPT: &str = "You write git commit messages. Reply with the message only.";

fn claude_cmd(bin: &Path) -> Command {
    let mut cmd = Command::new(bin);
    hide_console_window(&mut cmd);
    cmd
}

fn runs(bin: &Path) -> bool {
    claude_cmd(bin)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .is_ok_and(|o| o.status.success())
}

/// Locate the `claude` binary, checked once per app run.
///
/// PATH first; then `~/.local/bin`, since GUI apps on macOS launch with a
/// minimal PATH that misses it. On Windows `USERPROFILE` goes first: git users
/// often set a custom `HOME` that isn't where the installer put claude.
pub fn claude_path() -> Option<PathBuf> {
    static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        let on_path = PathBuf::from("claude");
        if runs(&on_path) {
            return Some(on_path);
        }
        let (name, vars) = if cfg!(windows) {
            ("claude.exe", ["USERPROFILE", "HOME"])
        } else {
            ("claude", ["HOME", "USERPROFILE"])
        };
        vars.into_iter()
            .filter_map(std::env::var_os)
            .map(|home| Path::new(&home).join(".local").join("bin").join(name))
            .find(|local| runs(local))
    })
    .clone()
}

/// Ask Claude for a commit message describing the staged diff.
///
/// Deliberately takes no git lock: the diff is captured up front and the
/// model call can run for several seconds.
pub fn suggest_commit_message(
    repo_path: &str,
    claude: &Path,
    model: &str,
) -> Result<CommitSuggestion, AppError> {
    // `model` comes from the frontend and lands in argv.
    if !valid_model(model) {
        return Err(AppError::Other("Invalid model name".into()));
    }
    let mut diff = capture(repo_path, &["diff", "--cached"], &[])?;
    if diff.trim().is_empty() {
        return Err(AppError::Other("Nothing staged".into()));
    }
    // ponytail: naive byte cap; per-file summarization if huge diffs matter
    if diff.len() > MAX_DIFF_BYTES {
        let mut cut = MAX_DIFF_BYTES;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
        diff.push_str("\n[diff truncated]");
    }

    let branch = capture(repo_path, &["symbolic-ref", "--short", "HEAD"], &[])
        .map(|b| b.trim().to_string())
        .unwrap_or_else(|_| "detached HEAD".into());
    let prompt = format!(
        "Write a git commit message for the staged diff on stdin (branch: {branch}). \
         Subject line: imperative mood, <=50 chars, conventional-commit prefix \
         (feat/fix/refactor/chore/docs/test) when it fits, no trailing period. \
         If the change warrants explanation, add a blank line then 1-3 short body lines. \
         Output ONLY the commit message, no fences, no preamble."
    );

    // No `--bare`: it ignores OAuth logins. `--setting-sources ""` still keeps
    // the user's hooks/plugins from firing; `--tools` is variadic so it goes last.
    let mut child = claude_cmd(claude)
        .args(["-p", &prompt])
        .args(["--model", model, "--output-format", "text"])
        .args(["--no-session-persistence", "--strict-mcp-config"])
        .args(["--disable-slash-commands", "--setting-sources", ""])
        .args(["--system-prompt", SYSTEM_PROMPT, "--tools", ""])
        .current_dir(repo_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to run claude: {e}")))?;

    // A write error here is a broken pipe from claude exiting early (e.g. not
    // logged in); the real reason is in its output, so let wait_with_output report it.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(diff.as_bytes());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::Other(format!("Failed to wait for claude: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        // `claude -p` puts the useful error ("Not logged in", bad model) on
        // stdout and noise on stderr, so prefer stdout.
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = match (stdout.trim(), stderr.trim()) {
            ("", "") => format!("claude exited with {}", output.status),
            ("", err) => err.to_string(),
            (out, _) => out.to_string(),
        };
        return Err(AppError::Other(msg));
    }
    parse_suggestion(&stdout)
        .ok_or_else(|| AppError::Other("Claude returned an empty message".into()))
}

/// Model ids/aliases like `sonnet`, `claude-opus-5-5`, `opus[1m]`. No leading
/// `-` so it can't be read as a flag.
fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && !model.starts_with('-')
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._[]".contains(c))
}

/// Strip code fences and split into subject (first line) + body (the rest).
/// `None` when empty.
fn parse_suggestion(raw: &str) -> Option<CommitSuggestion> {
    let raw = raw.replace("\r\n", "\n");
    let mut text = raw.trim();
    if let Some(rest) = text.strip_prefix("```") {
        // Drop the fence line (and any language tag on it).
        text = rest.split_once('\n').map_or("", |(_, r)| r);
    }
    text = text.trim_end().strip_suffix("```").unwrap_or(text).trim();

    let (head, body) = text.split_once('\n').unwrap_or((text, ""));
    let subject = head.trim().trim_end_matches('.').to_string();
    if subject.is_empty() {
        return None;
    }
    Some(CommitSuggestion {
        subject,
        body: body.trim().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subject_only() {
        let s = parse_suggestion("  fix: handle empty diff.\n").unwrap();
        assert_eq!(s.subject, "fix: handle empty diff");
        assert_eq!(s.body, "");
    }

    #[test]
    fn subject_and_body() {
        let s = parse_suggestion("feat: add x\n\nWhy line one.\nWhy line two.").unwrap();
        assert_eq!(s.subject, "feat: add x");
        assert_eq!(s.body, "Why line one.\nWhy line two.");
    }

    #[test]
    fn body_without_blank_line_and_crlf() {
        let s = parse_suggestion("fix: y\r\nMore detail.\r\n").unwrap();
        assert_eq!(s.subject, "fix: y");
        assert_eq!(s.body, "More detail.");
    }

    #[test]
    fn strips_fences() {
        let s = parse_suggestion("```text\nchore: bump deps\n\nBody.\n```\n").unwrap();
        assert_eq!(s.subject, "chore: bump deps");
        assert_eq!(s.body, "Body.");
    }

    #[test]
    fn model_names() {
        for ok in [
            "sonnet",
            "claude-opus-5-5",
            "claude-opus-5-5[1m]",
            "claude-3.5",
        ] {
            assert!(valid_model(ok), "{ok}");
        }
        for bad in [
            "", "--tools", "a b", "x;y", "opus
",
        ] {
            assert!(!valid_model(bad), "{bad}");
        }
    }

    #[test]
    fn empty_is_none() {
        assert!(parse_suggestion("  \n").is_none());
        assert!(parse_suggestion("```\n```").is_none());
    }
}
