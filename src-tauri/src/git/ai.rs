//! Commit-message suggestions and inferred Change Briefs via the locally
//! installed Claude Code CLI.
//!
//! No API keys: we shell out to `claude -p`, which uses whatever login the
//! user already has.

use crate::error::AppError;
use crate::git::brief;
use crate::git::exec::{capture, hide_console_window};
use serde::Serialize;
use std::collections::HashSet;
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

#[derive(Debug, Serialize)]
pub struct CommitSuggestion {
    pub subject: String,
    /// Why, from the Change Brief the message was written from.
    pub body: String,
}

/// Commit message for the staged diff. With `write_brief` (the Brief tab), one
/// call also writes the inferred brief for every change no agent describes
/// (stored as the draft, the earlier one as input). Otherwise, or when agents
/// describe everything, the briefs covering the staged files are context only.
///
/// Deliberately takes no git lock: the diff is captured up front and the
/// model call can run for several seconds.
pub fn suggest_commit_message(
    repo_path: &str,
    claude: &Path,
    model: &str,
    write_brief: bool,
) -> Result<CommitSuggestion, AppError> {
    // Stat first so every file stays visible even if the diff gets truncated.
    // Wide stat: without a TTY git shortens long paths to ".../tail".
    let staged = capture(
        repo_path,
        &["diff", "--cached", "--stat=1000", "--patch"],
        &[],
    )?;
    if staged.trim().is_empty() {
        return Err(AppError::Other("Nothing staged".into()));
    }

    let branch = current_branch(repo_path);
    let split = write_brief
        .then(|| brief::wip_split(repo_path))
        .transpose()?;
    let stdout = if let Some(split) = split.filter(|s| !s.unclaimed.is_empty()) {
        let unstaged = capture(repo_path, &["diff", "--stat=1000", "--patch"], &[])?;
        let input = format!(
            "=== STAGED (this commit) ===\n{staged}\n\
             === UNSTAGED (not in this commit) ===\n{unstaged}{}",
            untracked_text(repo_path, &split.unclaimed)?
        );
        let mut instructions = brief_prompt(
            repo_path,
            "the uncommitted changes in the input: the staged ones first, then the unstaged ones and untracked files",
            &BriefScope {
                previous: split.inferred.as_slice(),
                others: &split.agents,
                only: &split.unclaimed,
            },
        );
        instructions.push_str(MESSAGE_WITH_BRIEF);
        instructions.push_str(MESSAGE_FORMAT);
        instructions.push_str(JSON_ONLY);
        let raw = run_claude(
            repo_path,
            claude,
            model,
            STDIN_PROMPT,
            BRIEF_SYSTEM_PROMPT,
            with_instructions(&instructions, input),
        )?;
        let (generated, message) = brief::parse_generated_with_message(&raw)?;
        brief::write_inferred(repo_path, &generated, &split.unclaimed)?;
        message
    } else {
        let briefs = brief::staged_briefs(repo_path)?;
        let prompt = intent_prompt(&branch, &brief::prompt_context(&briefs));
        run_claude(repo_path, claude, model, &prompt, SYSTEM_PROMPT, staged)?
    };
    let (subject, body) = parse_suggestion(&stdout)
        .ok_or_else(|| AppError::Other("Claude returned an empty message".into()))?;
    Ok(CommitSuggestion { subject, body })
}

/// Brief instructions can be long (the spec, other briefs, file lists), too
/// long for a Windows command line, so they go on stdin ahead of the input.
const STDIN_PROMPT: &str =
    "Follow the instructions at the start of stdin; the input they refer to comes after them.";

fn with_instructions(instructions: &str, input: String) -> String {
    format!("{instructions}\n\n=== INPUT ===\n{input}")
}

const MESSAGE_WITH_BRIEF: &str = "\nReply with ONE JSON object: \
    {\"brief\": <your Change Brief, covering the files you were given, staged or not>, \
    \"message\": \"<git commit message for the STAGED changes only>\"}. \
    The message is written from your brief together with the other sessions' briefs, \
    about the intents with staged files. The other briefs carry each intent's risk \
    `tier`; your own intents have none, so rank them by your risk answers: `oneWay` \
    is high risk; `data`, `external`, `contract` or `shared` is mid; none is low. ";

const JSON_ONLY: &str = " Output ONLY the JSON object, no fences, no preamble.";

/// Message format shared by both suggestion prompts. Every high and mid risk
/// intent must reach the message, however many intents there are.
const MESSAGE_FORMAT: &str = "Rank the intents by importance: higher risk tier \
    first, then fix, then feat, then the rest. Line 1 is the subject: imperative \
    mood, the conventional-commit prefix and gist of the most important intent, \
    <=72 chars, no trailing period. Then a blank line, then a body with one short \
    plain-text line per intent saying why, most important first, wrapped at 72 \
    chars. Never leave out a high or mid risk intent; leave out low or unknown \
    risk ones only when the body would pass 8 lines. If an issue is listed, \
    end the body with `Refs: <ID>`.";

/// Untracked files aren't in `git diff`; their text, so the model sees what
/// they are. Binary or large ones go by name only.
fn untracked_text(repo_path: &str, only: &[String]) -> Result<String, AppError> {
    // -z: names unquoted, so non-ASCII paths still match `only`.
    let untracked = capture(
        repo_path,
        &["ls-files", "-z", "--others", "--exclude-standard"],
        &[],
    )?;
    let mut out = String::new();
    let wanted = |f: &&str| only.is_empty() || only.iter().any(|o| o == f);
    for file in untracked
        .split('\0')
        .filter(|l| !l.is_empty())
        .filter(wanted)
    {
        let full = Path::new(repo_path).join(file);
        let small = std::fs::metadata(&full).is_ok_and(|m| m.len() <= 20 * 1024);
        let text = small
            .then(|| std::fs::read(&full).ok())
            .flatten()
            .and_then(|b| String::from_utf8(b).ok());
        match text {
            Some(t) => out.push_str(&format!("\nNew untracked file {file}:\n{t}\n")),
            None => out.push_str(&format!("\nNew untracked file {file} (binary or large)\n")),
        }
    }
    Ok(out)
}

/// What a generated brief should build on and stay out of.
struct BriefScope<'a> {
    /// Earlier version of the brief being rewritten.
    previous: &'a [brief::Brief],
    /// Other sessions' briefs: context only, their files are off limits.
    others: &'a [brief::Brief],
    /// Files the brief covers; empty means all of them.
    only: &'a [String],
}

/// Instructions for writing a brief of `subject`, with the project guidance
/// and `scope`. The caller appends the output format.
fn brief_prompt(repo_path: &str, subject: &str, scope: &BriefScope) -> String {
    let mut prompt = format!(
        "Write a Change Brief for {subject} (branch: {}). The spec below is written \
         for coding agents; follow its Format and Rules, ignore where to save the file and the \
         Project risk guidance setup steps. \
         Every file you describe must be in exactly one intent. You only see the diff, so \
         set `tested` only when the diff itself adds or updates tests covering that intent.\n\n\
         <spec>\n{BRIEF_SPEC}\n</spec>\n",
        current_branch(repo_path)
    );
    let guidance = brief::risk_guidance(repo_path);
    if !guidance.is_empty() {
        prompt.push_str(&format!(
            "\nProject risk guidance:\n<guidance>\n{guidance}\n</guidance>\n"
        ));
    }
    if !scope.previous.is_empty() {
        let json = serde_json::to_string_pretty(scope.previous).unwrap_or_default();
        prompt.push_str(&format!(
            "\nAn earlier brief exists. Keep its intents and reasons where the diff \
             supports them; fill in what it lacks (types, risk answers).\n\
             <existing>\n{json}\n</existing>\n"
        ));
    }
    if !scope.others.is_empty() {
        let json = serde_json::to_string_pretty(scope.others).unwrap_or_default();
        prompt.push_str(&format!(
            "\nOther agent sessions already describe some of these changes. Their \
             briefs are context only: do not describe their files. When one of your \
             files is part of an intent in those briefs (a record of its results, a \
             follow-up it needed), give it an intent of its own with \
             `\"joins\": \"<that brief's session>\"` and a `why` that says how it fits. \
             Joined intents are shown in that brief, so your lead `intent` describes \
             only the intents that don't join one, or all of them if every intent joins.\n\
             <other-briefs>\n{json}\n</other-briefs>\n"
        ));
    }
    if !scope.only.is_empty() {
        prompt.push_str(&format!(
            "\nYour brief covers exactly these files:\n{}\n",
            scope.only.join("\n")
        ));
    }
    prompt
}

fn current_branch(repo_path: &str) -> String {
    capture(repo_path, &["symbolic-ref", "--short", "HEAD"], &[])
        .map(|b| b.trim().to_string())
        .unwrap_or_else(|_| "detached HEAD".into())
}

/// One tool-less `claude -p` call with `input` on stdin; returns stdout.
fn run_claude(
    repo_path: &str,
    claude: &Path,
    model: &str,
    prompt: &str,
    system: &str,
    mut input: String,
) -> Result<String, AppError> {
    // `model` comes from the frontend and lands in argv.
    if !valid_model(model) {
        return Err(AppError::Other("Invalid model name".into()));
    }
    // ponytail: naive byte cap; per-file summarization if huge diffs matter
    if input.len() > MAX_DIFF_BYTES {
        let mut cut = MAX_DIFF_BYTES;
        while !input.is_char_boundary(cut) {
            cut -= 1;
        }
        input.truncate(cut);
        input.push_str("\n[diff truncated]");
    }

    // No `--bare`: it ignores OAuth logins. `--setting-sources ""` still keeps
    // the user's hooks/plugins from firing; `--tools` is variadic so it goes last.
    let mut child = claude_cmd(claude)
        .args(["-p", prompt])
        .args(["--model", model, "--output-format", "text"])
        .args(["--no-session-persistence", "--strict-mcp-config"])
        .args(["--disable-slash-commands", "--setting-sources", ""])
        .args(["--system-prompt", system, "--tools", ""])
        .current_dir(repo_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to run claude: {e}")))?;

    // A write error here is a broken pipe from claude exiting early (e.g. not
    // logged in); the real reason is in its output, so let wait_with_output report it.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::Other(format!("Failed to wait for claude: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
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
    Ok(stdout)
}

/// The agent skill doubles as the format spec, so the two can't drift.
const BRIEF_SPEC: &str = include_str!("../../../docs/skills/prefetch-brief/SKILL.md");

const BRIEF_SYSTEM_PROMPT: &str =
    "You write Prefetch Change Briefs. Reply with one JSON object only.";

/// Infer a Change Brief for a commit and store it as the commit's note. Agent
/// briefs in the note are kept as they are; only the inferred one is
/// rewritten, for the files they don't cover, with the old one as a start.
pub fn generate_brief(
    repo_path: &str,
    claude: &Path,
    model: &str,
    sha: &str,
    env: &[(String, String)],
) -> Result<(), AppError> {
    if !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Other("Invalid commit id".into()));
    }
    let split = brief::commit_split(repo_path, sha)?;
    let diff = capture(
        repo_path,
        &["show", "--format=%B", "--stat=1000", "--patch", sha],
        &[],
    )?;
    let (previous, others, only) = (
        split.inferred.into_iter().collect::<Vec<_>>(),
        split.agents,
        split.unclaimed,
    );
    if only.is_empty() {
        return Err(AppError::Other(if others.is_empty() {
            "No changes to describe".into()
        } else {
            "Every change already has an agent's brief; ask that agent to update it".into()
        }));
    }

    let mut instructions = brief_prompt(
        repo_path,
        "the commit in the input (its message, a diffstat, then the diff)",
        &BriefScope {
            previous: &previous,
            others: &others,
            only: &only,
        },
    );
    instructions.push_str(JSON_ONLY);

    let raw = run_claude(
        repo_path,
        claude,
        model,
        STDIN_PROMPT,
        BRIEF_SYSTEM_PROMPT,
        with_instructions(&instructions, diff),
    )?;
    let generated = brief::parse_generated(&raw)?;
    let allowed: HashSet<String> = only.into_iter().collect();
    let mut briefs = others;
    briefs.extend(generated.restricted_to(&allowed));
    brief::write_note(repo_path, sha, &briefs, env)
}

/// Commit-message prompt, with the Change Brief context when there is one.
fn intent_prompt(branch: &str, intent: &str) -> String {
    let context = if intent.is_empty() {
        String::new()
    } else {
        format!(
            "The Change Brief below records the intent behind them. Trust it for WHY; \
             trust the diff for WHAT. Describe intents, not a list of files.\n\n\
             <intent>\n{intent}\n</intent>\n\n"
        )
    };
    format!(
        "Write a git commit message for the staged changes on stdin (branch: {branch}); \
         a diffstat comes first, then the diff.\n\n\
         {context}{MESSAGE_FORMAT} Output ONLY the message, no fences, no preamble."
    )
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

/// Strip code fences and split into subject and body. `None` when empty.
fn parse_suggestion(raw: &str) -> Option<(String, String)> {
    let raw = raw.replace("\r\n", "\n");
    let mut text = raw.trim();
    if let Some(rest) = text.strip_prefix("```") {
        // Drop the fence line (and any language tag on it).
        text = rest.split_once('\n').map_or("", |(_, r)| r);
    }
    text = text.trim_end().strip_suffix("```").unwrap_or(text).trim();

    let (first, rest) = text.split_once('\n').unwrap_or((text, ""));
    let subject = first.trim().trim_end_matches('.');
    (!subject.is_empty()).then(|| (subject.to_string(), rest.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Throwaway repo: one commit, then a destructive schema edit and a new
    /// README left uncommitted.
    fn live_repo() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .args(["-c", "user.name=t", "-c", "user.email=t@t"])
                .args(args)
                .current_dir(dir)
                .output()
                .unwrap()
        };
        git(&["init", "-q"]);
        std::fs::write(dir.join("db.sql"), "create table users(id int);\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "init"]);
        std::fs::write(
            dir.join("db.sql"),
            "create table users(id int);\nalter table users drop column legacy;\n",
        )
        .unwrap();
        std::fs::write(dir.join("README.md"), "Run migrations before deploy.\n").unwrap();
        git(&["add", "db.sql"]);
        tmp
    }

    /// Real `claude -p` round trips (cost model calls):
    /// `cargo test _live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn generate_brief_live() {
        let Some(claude) = claude_path() else { return };
        let tmp = live_repo();
        let path = tmp.path().to_str().unwrap();
        let sha = capture(path, &["rev-parse", "HEAD"], &[]).unwrap();
        let sha = sha.trim();
        generate_brief(path, &claude, "haiku", sha, &[]).unwrap();
        let note = brief::read_note(path, sha).unwrap().unwrap();
        println!("{}", serde_json::to_string_pretty(&note).unwrap());
        assert!(note[0].inferred);
    }

    /// No brief yet: one call writes the brief for everything and the message
    /// for the staged schema change only.
    #[test]
    #[ignore]
    fn suggest_writes_brief_live() {
        let Some(claude) = claude_path() else { return };
        let tmp = live_repo();
        let path = tmp.path().to_str().unwrap();
        let s = suggest_commit_message(path, &claude, "haiku", true).unwrap();
        println!("{}\n\n{}", s.subject, s.body);
        let wip = brief::read_wip(path).unwrap();
        println!("{}", serde_json::to_string_pretty(&wip.briefs).unwrap());
        assert!(!s.body.is_empty());
        assert!(wip.briefs[0].inferred);
    }

    #[test]
    fn subject_only() {
        let (s, b) = parse_suggestion("  fix: handle empty diff.\n").unwrap();
        assert_eq!(s, "fix: handle empty diff");
        assert_eq!(b, "");
    }

    #[test]
    fn splits_body() {
        let (s, b) = parse_suggestion("feat: add x; fix: y\n\n- feat: add x\n- fix: y").unwrap();
        assert_eq!(s, "feat: add x; fix: y");
        assert_eq!(b, "- feat: add x\n- fix: y");
        let (s, b) = parse_suggestion("fix: y\r\nMore detail.\r\n").unwrap();
        assert_eq!(s, "fix: y");
        assert_eq!(b, "More detail.");
    }

    #[test]
    fn strips_fences() {
        let (s, b) = parse_suggestion("```text\nchore: bump deps\n\nBody.\n```\n").unwrap();
        assert_eq!(s, "chore: bump deps");
        assert_eq!(b, "Body.");
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
