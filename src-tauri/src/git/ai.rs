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

/// Commit message for the staged diff. With `write_brief` (Summarize on the
/// Brief tab), the same call reviews every brief: agent drafts are kept,
/// rewritten or dropped, and the inferred brief covers whatever none claims.
/// Otherwise the briefs covering the staged files are context only.
///
/// Deliberately takes no git lock: the diff is captured up front and the
/// model call can run for several seconds.
pub fn suggest_commit_message(
    repo_path: &str,
    claude: &Path,
    model: &str,
    write_brief: bool,
    with_body: bool,
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
    // Summarize always sees every brief: agent ones are input it may keep,
    // rewrite or drop, not territory it has to stay out of.
    let stdout = if let Some(split) = split {
        let unstaged = capture(repo_path, &["diff", "--stat=1000", "--patch"], &[])?;
        let input = format!(
            "=== STAGED (this commit) ===\n{staged}\n\
             === UNSTAGED (not in this commit) ===\n{unstaged}{}",
            untracked_text(repo_path)?
        );
        let mut instructions = brief_prompt(
            repo_path,
            "the uncommitted changes in the input: the staged ones first, then the unstaged ones and untracked files",
            &BriefScope {
                previous: split.inferred.as_slice(),
                others: &split.agents,
                only: &split.unclaimed,
                review_others: true,
            },
        );
        instructions.push_str(MESSAGE_WITH_BRIEF);
        instructions.push_str(&message_format(with_body));
        instructions.push_str(JSON_ONLY);
        let raw = run_claude(
            repo_path,
            claude,
            model,
            STDIN_PROMPT,
            BRIEF_SYSTEM_PROMPT,
            with_instructions(&instructions, input),
        )?;
        tracing::debug!(%raw, "summarize output");
        let summary = brief::parse_summary(&raw)?;
        // Check the reply is whole before it touches anyone's draft.
        if parse_suggestion(&summary.message).is_none() {
            return Err(AppError::Other("Claude returned an empty message".into()));
        }
        brief::apply_summary(repo_path, &split.agents, &summary)?;
        summary.message
    } else {
        let briefs = brief::staged_briefs(repo_path)?;
        let prompt = intent_prompt(&branch, &brief::prompt_context(&briefs), with_body);
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

/// How every brief Prefetch writes or reviews gets its story: written again
/// for the diff as it is now, with the old one as input, not kept verbatim.
const STORY_AGAIN: &str = "A brief's old story (if it has one) is the author's \
    reasoning and reading order: keep what still holds, but every step must fit the \
    diff as it is now and every `at` must come from that file's `+` or `-` lines. \
    A brief with no story gets one.";

const MESSAGE_WITH_BRIEF: &str = "\nReply with ONE JSON object: \
    {\"brief\": <your Change Brief, story included, for the files no agent brief \
    covers after your edits, staged or not; null if there are none>, \
    \"agents\": {\"<session>\": <for EVERY agent brief: the brief rewritten, its new \
    story included; or {\"story\": <its new story>} when its intents stand as they \
    are; or null to drop it>}, \
    \"message\": \"<git commit message for the STAGED changes only>\"}. \
    The message is written from all the briefs as they stand after your edits, \
    about the intents with staged files. The agent briefs carry each intent's risk \
    `tier`: a rewritten or merged intent ranks at the highest tier among the \
    intents it came from. Your own intents have none, so rank them by their risk \
    answers: `oneWay` is high risk; `data`, `external`, `contract` or `shared` is mid; \
    none is low. ";

/// Generate brief's reply: agent briefs in a commit's note keep their
/// intents, so only their stories come back.
const COMMIT_REPLY: &str = "\nReply with ONE JSON object: \
    {\"brief\": <your Change Brief, story included; null when no file is left for it>, \
    \"agents\": {\"<session>\": {\"story\": <that brief's new story>}}}, one entry per \
    other brief.";

const JSON_ONLY: &str = " Output ONLY the JSON object, no fences, no preamble.";

/// Message format shared by both suggestion prompts, ranking intents like the
/// Brief view. With a body every high and mid risk intent gets a line; a
/// subject alone must name every high risk one and as many mid ones as fit.
fn message_format(with_body: bool) -> String {
    let rank = "Rank the intents by importance: higher risk tier first, then fix, \
        then feat, then the rest; unrelated intents last.";
    let format = if with_body {
        "Line 1 is the subject: imperative mood, the conventional-commit prefix \
         and gist of the most important intent, <=72 chars, no trailing period. \
         Then a blank line, then a body with one short plain-text line per intent \
         saying why, most important first, wrapped at 72 chars. Never leave out a \
         high or mid risk intent; leave out low or unknown risk ones only when the \
         body would pass 8 lines. If an issue is listed, end the body with \
         `Refs: <ID>`."
    } else {
        "Write the subject line only, no body: the intents in a few words each, \
         grouped by conventional-commit type, each group starting with its own \
         prefix, everything separated by `, ` (never `;`), groups ordered by \
         their most important intent (e.g. `fix: stop double uploads, find the \
         date picker arrow, ci: add a reach check job`). It must name every high \
         risk intent; add mid risk ones while it stays under about 100 chars, \
         low or unknown risk \
         ones only if there are no others. Shorten words freely. No trailing \
         period."
    };
    format!("{rank} {format}")
}

/// Untracked files aren't in `git diff`; their text, so the model sees what
/// they are. Binary or large ones go by name only.
fn untracked_text(repo_path: &str) -> Result<String, AppError> {
    // -z: names unquoted, so non-ASCII paths come through as they are.
    let untracked = capture(
        repo_path,
        &["ls-files", "-z", "--others", "--exclude-standard"],
        &[],
    )?;
    let mut out = String::new();
    for file in untracked.split('\0').filter(|l| !l.is_empty()) {
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
    /// Other sessions' briefs: context only and their files off limits, unless
    /// `review_others`.
    others: &'a [brief::Brief],
    /// Files the brief covers (with `review_others`: no brief covers yet);
    /// empty means all of them.
    only: &'a [String],
    /// Summarize: `others` are input the model may keep, rewrite or drop.
    review_others: bool,
}

/// Instructions for writing a brief of `subject`, with the project guidance
/// and `scope`. The caller appends the output format.
fn brief_prompt(repo_path: &str, subject: &str, scope: &BriefScope) -> String {
    let mut prompt = format!(
        "Write a Change Brief for {subject} (branch: {}). The spec below is written \
         for coding agents; follow its Format and Rules, ignore where to save the file and the \
         Project risk guidance setup steps. \
         Every file you describe must be in exactly one intent. You only see the diff, so \
         set `tested` only when the diff itself adds or updates tests covering that intent. \
         Write the `story` too, covering only the files your brief describes; take each `at` \
         from that file's `+` or `-` lines in the diff.\n\n\
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
             supports them; fill in what it lacks (types, risk answers). {STORY_AGAIN}\n\
             <existing>\n{json}\n</existing>\n"
        ));
    }
    if !scope.others.is_empty() && scope.review_others {
        let json = serde_json::to_string_pretty(scope.others).unwrap_or_default();
        prompt.push_str(&format!(
            "\nAgent sessions wrote briefs for some of these changes. They watched the \
             work happen, so trust them for why it was done, and keep their risk answers \
             (they ran the tests; you can't see that) unless the diff contradicts them. \
             They are drafts written mid-work by sessions that couldn't see each \
             other, so expect them to overlap and go stale. Read them as the reviewer \
             of this commit will, and fix every one of these:\n\
             - An intent that fixes, reworks or reviews code another intent adds in \
             this same diff (a new file, or lines that aren't committed yet) is not a \
             change of its own: the reviewer never sees the broken version. Fold it \
             into the intent that adds the code (rewrite that brief's `why` to cover \
             it) and remove it from its own brief.\n\
             - The same work described in two briefs: keep it in the one whose goal \
             it serves, remove it from the other.\n\
             - A lead or intent that describes how the work came about (a review, a \
             failing check, a backlog task) instead of what it changes: rewrite it.\n\
             - Intents that no longer match the diff: rewrite or remove them.\n\
             - Changes in an agent brief's file that none of its intents describe: \
             rewrite that brief to cover them (widen an intent or add one), story \
             included. Your own brief never lists an agent brief's file.\n\
             - One file, one intent: every changed file must appear in exactly one \
             intent across all briefs, yours included. When intents in the same or \
             different briefs share a file, merge them into one intent that covers \
             all their changes, in the brief whose goal it serves, and remove them \
             from the others.\n\
             A brief left with no intents is dropped. Keep a brief's intents as they \
             are only when none of these apply. Either way, write every agent brief's \
             `story` again, covering only that brief's files. {STORY_AGAIN} \
             A rewrite may take over files from the briefs \
             it merges with; your own brief covers every file no agent brief covers \
             after your edits. When \
             one of your files is part of an intent in an agent brief (a record of its \
             results, a follow-up it needed), give it an intent of its own with \
             `\"joins\": \"<that brief's session>\"` and a `why` that says how it fits. \
             Joined intents are shown in that brief, so your lead `intent` describes \
             only the intents that don't join one, or all of them if every intent joins.\n\
             <agent-briefs>\n{json}\n</agent-briefs>\n"
        ));
    } else if !scope.others.is_empty() {
        let json = serde_json::to_string_pretty(scope.others).unwrap_or_default();
        prompt.push_str(&format!(
            "\nOther agent sessions already describe some of these changes. Their \
             briefs are context only: do not describe their files. But write each one's \
             `story` again, covering only that brief's files. {STORY_AGAIN} When one of your \
             files is part of an intent in those briefs (a record of its results, a \
             follow-up it needed), give it an intent of its own with \
             `\"joins\": \"<that brief's session>\"` and a `why` that says how it fits. \
             Joined intents are shown in that brief, so your lead `intent` describes \
             only the intents that don't join one, or all of them if every intent joins.\n\
             <other-briefs>\n{json}\n</other-briefs>\n"
        ));
    }
    if !scope.only.is_empty() {
        let lead = if scope.review_others {
            "Files no agent brief covers yet"
        } else {
            "Your brief covers exactly these files"
        };
        prompt.push_str(&format!("\n{lead}:\n{}\n", scope.only.join("\n")));
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

/// Infer a Change Brief for a commit and store it as the commit's note. The
/// inferred brief is rewritten for the files agent briefs don't cover, with
/// the old one as a start. Agent briefs keep their intents; every brief's
/// story is written again. A malformed or missing story keeps the old one.
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
    let (previous, mut others, only) = (
        split.inferred.into_iter().collect::<Vec<_>>(),
        split.agents,
        split.unclaimed,
    );
    if only.is_empty() && others.is_empty() {
        return Err(AppError::Other("No changes to describe".into()));
    }
    // An agent that attached its own draft left no session; name it so its
    // story can come back, and unname it again before writing.
    let unnamed: Vec<usize> = (0..others.len())
        .filter(|&n| others[n].session.is_empty())
        .collect();
    let mut taken: HashSet<String> = others.iter().map(|b| b.session.clone()).collect();
    for &n in &unnamed {
        let name = (n + 1..)
            .map(|k| format!("brief-{k}"))
            .find(|s| !taken.contains(s))
            .unwrap_or_default();
        taken.insert(name.clone());
        others[n].session = name;
    }

    let mut instructions = brief_prompt(
        repo_path,
        "the commit in the input (its message, a diffstat, then the diff)",
        &BriefScope {
            previous: &previous,
            others: &others,
            only: &only,
            review_others: false,
        },
    );
    if only.is_empty() {
        instructions.push_str("\nEvery file already has an agent brief, so `brief` is null.\n");
    }
    instructions.push_str(COMMIT_REPLY);
    instructions.push_str(JSON_ONLY);

    let raw = run_claude(
        repo_path,
        claude,
        model,
        STDIN_PROMPT,
        BRIEF_SYSTEM_PROMPT,
        with_instructions(&instructions, diff),
    )?;
    let reply = brief::parse_summary(&raw)?;
    let allowed: HashSet<String> = only.into_iter().collect();
    for b in &mut others {
        // A model that echoes the whole brief lands in `agents`; its story still counts.
        let echoed = reply
            .agents
            .get(&b.session)
            .and_then(|a| a.as_ref()?.story.as_ref());
        b.restory(reply.stories.get(&b.session).or(echoed));
    }
    for &n in &unnamed {
        others[n].session.clear();
    }
    let mut briefs = others;
    let old = previous.into_iter().next();
    let inferred = match reply.inferred {
        Some(mut b) => {
            let story = b.story.take();
            b.story = old.and_then(|o| o.story);
            b.restory(story.as_ref());
            Some(b)
        }
        // Left out: the old brief stands rather than none.
        None => old,
    };
    briefs.extend(inferred.and_then(|b| b.restricted_to(&allowed)));
    brief::write_note(repo_path, sha, &briefs, env)
}

/// Commit-message prompt, with the Change Brief context when there is one.
fn intent_prompt(branch: &str, intent: &str, with_body: bool) -> String {
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
         {context}{} Output ONLY the message, no fences, no preamble.",
        message_format(with_body)
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
        // The spec asks for a story alongside; it reads back without a model call.
        let told = crate::git::story::read_commit(path, sha).unwrap().unwrap();
        println!("{}", serde_json::to_string_pretty(&told).unwrap());
        assert!(!told.steps.is_empty());
    }

    /// No brief yet: one call writes the brief for everything and the message
    /// for the staged schema change only.
    #[test]
    #[ignore]
    fn suggest_writes_brief_live() {
        let Some(claude) = claude_path() else { return };
        let tmp = live_repo();
        let path = tmp.path().to_str().unwrap();
        let s = suggest_commit_message(path, &claude, "haiku", true, true).unwrap();
        println!("{}\n\n{}", s.subject, s.body);
        let wip = brief::read_wip(path).unwrap();
        println!("{}", serde_json::to_string_pretty(&wip.briefs).unwrap());
        assert!(!s.body.is_empty());
        assert!(wip.briefs[0].inferred);
    }

    /// An agent draft with no story gains one, and Summarize again after an
    /// edit writes the story again instead of keeping it.
    #[test]
    #[ignore]
    fn summarize_again_rewrites_story_live() {
        let Some(claude) = claude_path() else { return };
        // The raw replies.
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_test_writer()
            .try_init();
        let tmp = live_repo();
        let path = tmp.path().to_str().unwrap();
        let wip = tmp.path().join(".git/prefetch/wip");
        std::fs::create_dir_all(&wip).unwrap();
        std::fs::write(
            wip.join("agent.json"),
            r#"{"intent":{"title":"Drop the legacy column"},"intents":[
              {"title":"Drop legacy from users","type":"feat","files":["db.sql"],
               "risk":{"data":true,"oneWay":true}}]}"#,
        )
        .unwrap();
        let story_of = |session: &str| {
            brief::read_wip(path)
                .unwrap()
                .briefs
                .into_iter()
                .find(|b| b.session == session)
                .and_then(|b| b.story)
        };
        suggest_commit_message(path, &claude, "haiku", true, true).unwrap();
        let first = story_of("agent").expect("the agent draft gains a story");
        println!("first: {}", serde_json::to_string_pretty(&first).unwrap());

        std::fs::write(
            tmp.path().join("db.sql"),
            "create table users(id int);\nalter table users drop column legacy;\n\
             create index users_by_email on users(email);\n",
        )
        .unwrap();
        let s = suggest_commit_message(path, &claude, "haiku", true, true).unwrap();
        println!("{}\n\n{}", s.subject, s.body);
        let second = story_of("agent").unwrap();
        println!("second: {}", serde_json::to_string_pretty(&second).unwrap());
        let told = crate::git::story::read_worktree(path).unwrap().unwrap();
        println!("resolved: {}", serde_json::to_string_pretty(&told).unwrap());
        // The edit is in the agent's file, so its story now tells it.
        assert_ne!(first, second, "Summarize again writes the story again");
        assert!(format!("{second:?}").contains("index"), "{second:?}");
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
