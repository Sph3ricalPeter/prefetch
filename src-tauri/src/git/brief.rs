//! Change Brief: the intent behind a set of changes (#84).
//!
//! Agents keep one draft per session in `<git-dir>/prefetch/wip/<slug>.json`
//! saying *why* the working changes exist. When a commit lands, the drafts that
//! touch its files are stored as a git note on [`NOTES_REF`] — next to the
//! commit, without changing its SHA or the tree. See `docs/skills/prefetch-brief/SKILL.md`
//! for the format agents write.
//!
//! Risk: agents answer fixed yes/no questions per intent ([`Risk`]); the tier is
//! derived here by one rule ([`Risk::tier`]) so it doesn't drift between agents,
//! and a project can pin tiers by path in `.prefetch/risk.json` ([`RiskRules`]).

use crate::error::AppError;
use crate::git::exec::run_git;
use crate::git::forge;
use git2::{Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const NOTES_REF: &str = "refs/notes/prefetch";
/// Where `origin`'s notes land before being merged into [`NOTES_REF`].
const REMOTE_NOTES_REF: &str = "refs/notes/remotes/origin/prefetch";
/// Per-clone opt-in (`.git/config`) for sharing notes with `origin`.
const SYNC_KEY: &str = "prefetch.syncBriefs";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Brief {
    #[serde(default = "v1")]
    pub version: u32,
    /// Draft file stem; identifies the agent session.
    #[serde(default)]
    pub session: String,
    /// The lead intent. Its `files` are unused — files belong to sub-intents.
    pub intent: Intent,
    #[serde(default)]
    pub intents: Vec<Intent>,
    /// Optional tracker issues; empty when the repo uses none.
    #[serde(default)]
    pub issues: Vec<Issue>,
    /// Written by Prefetch from the diff alone, not by the agent that did the work.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inferred: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Intent {
    pub title: String,
    #[serde(default)]
    pub why: String,
    /// `sub` | `enabling` | `unrelated`. Kept as a string so one unknown value
    /// from an agent doesn't reject the whole draft.
    #[serde(default = "sub")]
    pub kind: String,
    /// Repo-relative, forward slashes.
    #[serde(default)]
    pub files: Vec<String>,
    /// Conventional-commit type (`fix`, `feat`, ...); empty when not given.
    #[serde(default, rename = "type", skip_serializing_if = "String::is_empty")]
    pub commit_type: String,
    /// 1-3 short project-specific categories the agent picks; capped on read.
    #[serde(
        default,
        deserialize_with = "lenient_tags",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk: Option<Risk>,
    /// Inferred briefs only: the session of the agent brief this intent is
    /// part of, so the view can show it there instead of on its own.
    #[serde(
        default,
        deserialize_with = "lenient_string",
        skip_serializing_if = "String::is_empty"
    )]
    pub joins: String,
    /// Derived on read from `risk` and the project rules. Never taken from a
    /// draft, and absent from stored notes (drafts are written as read).
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub tier: Option<Tier>,
    /// Derived with `tier`: a project rule raised it above the answers.
    #[serde(
        default,
        skip_deserializing,
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub pinned: bool,
}

/// The agent's answers to the risk questions in the skill.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Risk {
    /// Changed code is used outside this change.
    pub shared: bool,
    /// Touches state outside the repo: databases, migrations, user files, prod config.
    pub data: bool,
    /// Has side effects outside the repo (network writes, emails, payments).
    pub external: bool,
    /// Changes a public API, CLI, file format or protocol.
    pub contract: bool,
    /// Tests exercising it ran and passed.
    pub tested: bool,
    /// `git revert` would not fully undo it.
    pub one_way: bool,
    /// The main concern, one line.
    pub why: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Low,
    Mid,
    High,
}

impl Risk {
    /// `inferred`: answered from the diff alone, where "not tested" only means
    /// no test is visible, so it doesn't raise an impactful change to high.
    pub fn tier(&self, inferred: bool) -> Tier {
        let impactful = self.data || self.external || self.contract;
        if self.one_way || (impactful && !self.tested && !inferred) {
            Tier::High
        } else if impactful || self.shared {
            Tier::Mid
        } else {
            Tier::Low
        }
    }
}

/// `.prefetch/risk.json` at the repo root, committed so the team shares it.
/// Rules pin the tier of matching files, overriding the agent's answers.
#[derive(Debug, Default, Deserialize)]
pub struct RiskRules {
    // The file's `guidance` text is read on its own by `risk_guidance`.
    #[serde(default)]
    pub rules: Vec<RiskRule>,
}

#[derive(Debug, Deserialize)]
pub struct RiskRule {
    /// Globs relative to the repo root, e.g. `migrations/**`.
    pub paths: Vec<String>,
    pub tier: Tier,
}

fn risk_file(repo: &Repository) -> Option<String> {
    fs::read_to_string(repo.workdir()?.join(".prefetch").join("risk.json")).ok()
}

impl RiskRules {
    fn load(repo: &Repository) -> Result<Self, String> {
        risk_file(repo).map_or(Ok(Self::default()), |text| {
            serde_json::from_str(&text).map_err(|e| format!(".prefetch/risk.json: {e}"))
        })
    }

    /// First matching rule's tier for `path`.
    fn tier_for(&self, path: &str) -> Option<Tier> {
        let opts = glob::MatchOptions {
            require_literal_separator: true,
            ..Default::default()
        };
        self.rules.iter().find_map(|r| {
            r.paths
                .iter()
                .any(|g| glob::Pattern::new(g).is_ok_and(|p| p.matches_with(path, opts)))
                .then_some(r.tier)
        })
    }

    /// Files a rule matches take the rule's tier, the rest the agent's; the
    /// intent gets the highest. No answers and no matching rule: none.
    fn intent_tier(&self, intent: &Intent, inferred: bool) -> Option<Tier> {
        let answered = intent.risk.as_ref().map(|r| r.tier(inferred));
        if intent.files.is_empty() {
            return answered;
        }
        intent
            .files
            .iter()
            .filter_map(|f| self.tier_for(f).or(answered))
            .max()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Issue {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    /// Acceptance criteria, when the agent had them.
    #[serde(default)]
    pub criteria: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct WipBriefs {
    pub briefs: Vec<Brief>,
    /// `file.json: reason` for drafts that didn't parse.
    pub errors: Vec<String>,
}

fn v1() -> u32 {
    1
}

fn sub() -> String {
    "sub".into()
}

/// Tags as an agent might write them: a list, a lone string, or null. Bad
/// entries are dropped so they can't reject the whole draft.
fn lenient_tags<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    Ok(match serde_json::Value::deserialize(d)? {
        serde_json::Value::String(s) => vec![s],
        serde_json::Value::Array(items) => items
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    })
}

/// Optional fields the model may fill with `null`; anything but a string is empty.
fn lenient_string<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(match serde_json::Value::deserialize(d)? {
        serde_json::Value::String(s) => s,
        _ => String::new(),
    })
}

/// A note holds a list of briefs; a single object is accepted too, so an agent
/// committing on its own can attach its draft file as-is.
#[derive(Deserialize)]
#[serde(untagged)]
enum NoteBody {
    Many(Vec<Brief>),
    One(Box<Brief>),
}

fn parse_note(text: &str) -> Result<Vec<Brief>, serde_json::Error> {
    Ok(match serde_json::from_str(text)? {
        NoteBody::Many(v) => v,
        NoteBody::One(b) => vec![*b],
    })
}

fn normalize(path: &str) -> String {
    let p = path.trim().replace('\\', "/");
    p.strip_prefix("./").unwrap_or(&p).to_string()
}

impl Brief {
    fn normalized(mut self) -> Self {
        for i in &mut self.intents {
            i.files = i.files.iter().map(|f| normalize(f)).collect();
            let mut tags: Vec<String> = Vec::new();
            for t in i.tags.iter().map(|t| t.trim().to_lowercase()) {
                if !t.is_empty() && !tags.contains(&t) {
                    tags.push(t);
                }
            }
            tags.truncate(3);
            i.tags = tags;
        }
        self
    }

    fn with_tiers(mut self, rules: &RiskRules) -> Self {
        let inferred = self.inferred;
        for i in &mut self.intents {
            i.tier = rules.intent_tier(i, inferred);
            i.pinned = i.tier > i.risk.as_ref().map(|r| r.tier(inferred));
        }
        self
    }

    fn files(&self) -> impl Iterator<Item = &String> {
        self.intents.iter().flat_map(|i| &i.files)
    }

    /// This brief narrowed to `paths`, or `None` when it touches none of them.
    /// Intents without files are conceptual and always kept.
    pub fn restricted_to(&self, paths: &HashSet<String>) -> Option<Brief> {
        if !self.files().any(|f| paths.contains(f)) {
            return None;
        }
        let intents = self
            .intents
            .iter()
            .filter_map(|i| {
                if i.files.is_empty() {
                    return Some(i.clone());
                }
                let files: Vec<String> = i
                    .files
                    .iter()
                    .filter(|f| paths.contains(*f))
                    .cloned()
                    .collect();
                (!files.is_empty()).then(|| Intent { files, ..i.clone() })
            })
            .collect();
        Some(Brief {
            intents,
            ..self.clone()
        })
    }
}

/// Every changed path in the working tree, untracked included.
fn dirty_paths(repo: &Repository) -> Result<HashSet<String>, AppError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    Ok(repo
        .statuses(Some(&mut opts))?
        .iter()
        .filter_map(|s| s.path().map(normalize))
        .collect())
}

fn wip_dir(repo: &Repository) -> PathBuf {
    repo.path().join("prefetch").join("wip")
}

/// Drafts with their tiers, for the commit-message prompts. A broken
/// risk.json is reported in the WIP view; here it just means no rules.
fn tiered_drafts(repo: &Repository) -> Vec<Brief> {
    let rules = RiskRules::load(repo).unwrap_or_default();
    read_wip_files(&wip_dir(repo))
        .0
        .into_iter()
        .map(|(_, b)| b.with_tiers(&rules))
        .collect()
}

/// Drafts with the file each came from, plus `file.json: reason` for the ones
/// that don't parse. A draft's session is always its file stem: the JSON can't
/// claim to be another session's draft (or point outside `wip/`).
fn read_wip_files(dir: &Path) -> (Vec<(PathBuf, Brief)>, Vec<String>) {
    let mut out = Vec::new();
    let mut errors = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return (out, errors);
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    paths.sort();
    for path in paths {
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let parsed = fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|t| serde_json::from_str::<Brief>(&t).map_err(|e| e.to_string()));
        match parsed {
            Ok(mut b) => {
                b.session = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into();
                out.push((path, b.normalized()));
            }
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }
    // The inferred draft was narrowed when written, but an agent may have
    // claimed some of its files since. Agents win.
    if let Some(pos) = out.iter().position(|(_, b)| b.session == INFERRED) {
        let (path, inferred) = out.remove(pos);
        let claimed: HashSet<&String> = out.iter().flat_map(|(_, b)| b.files()).collect();
        let free: HashSet<String> = inferred
            .files()
            .filter(|f| !claimed.contains(f))
            .cloned()
            .collect();
        if let Some(b) = inferred.restricted_to(&free) {
            out.insert(pos, (path, b));
        }
    }
    (out, errors)
}

/// All drafts for the working tree, for the Brief view.
pub fn read_wip(path: &str) -> Result<WipBriefs, AppError> {
    let repo = Repository::open(path)?;
    let (drafts, mut errors) = read_wip_files(&wip_dir(&repo));
    let rules = RiskRules::load(&repo).unwrap_or_else(|e| {
        errors.push(e);
        RiskRules::default()
    });
    let mut drafts: Vec<_> = drafts
        .into_iter()
        .map(|(p, b)| (p, b.with_tiers(&rules)))
        .collect();
    show_shared_once(&mut drafts);
    Ok(WipBriefs {
        briefs: drafts.into_iter().map(|(_, b)| b).collect(),
        errors,
    })
}

/// A file several drafts list (sessions that both edited it) shows once:
/// under the riskiest intent claiming it, so the view never reads safer
/// than the commit will, then the draft written last. The others drop it,
/// and any intent it leaves empty. View only: commit notes keep every claim.
fn show_shared_once(drafts: &mut [(PathBuf, Brief)]) {
    type Rank = (Option<Tier>, Option<std::time::SystemTime>);
    let mut owner: HashMap<String, (Rank, usize)> = HashMap::new();
    for (n, (path, brief)) in drafts.iter().enumerate() {
        let written = fs::metadata(path).and_then(|m| m.modified()).ok();
        for i in &brief.intents {
            for f in &i.files {
                let rank = (i.tier, written);
                let e = owner.entry(f.clone()).or_insert((rank, n));
                if rank > e.0 {
                    *e = (rank, n);
                }
            }
        }
    }
    for (n, (_, brief)) in drafts.iter_mut().enumerate() {
        brief.intents.retain_mut(|i| {
            if i.files.is_empty() {
                return true;
            }
            i.files
                .retain(|f| owner.get(f).is_none_or(|&(_, o)| o == n));
            !i.files.is_empty()
        });
    }
}

/// Drafts narrowed to the staged files: the context for a commit message.
pub fn staged_briefs(path: &str) -> Result<Vec<Brief>, AppError> {
    let repo = Repository::open(path)?;
    let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = repo.diff_tree_to_index(head.as_ref(), None, None)?;
    let staged = diff_paths(&diff);
    Ok(tiered_drafts(&repo)
        .iter()
        .filter_map(|b| b.restricted_to(&staged))
        .collect())
}

/// The brief note on a commit, if any. A note that doesn't parse is an error so
/// a bad hand-written note is visible rather than silently ignored.
pub fn read_note(path: &str, commit_id: &str) -> Result<Option<Vec<Brief>>, AppError> {
    let repo = Repository::open(path)?;
    let oid = git2::Oid::from_str(commit_id)?;
    let note = match repo.find_note(Some(NOTES_REF), oid) {
        Ok(n) => n,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let text = note.message().unwrap_or_default();
    // A broken risk.json is reported in the WIP view; here it just means no rules.
    let rules = RiskRules::load(&repo).unwrap_or_default();
    parse_note(text)
        .map(|v| {
            Some(
                v.into_iter()
                    .map(|b| b.normalized().with_tiers(&rules))
                    .collect(),
            )
        })
        .map_err(|e| AppError::Other(format!("Invalid brief note: {e}")))
}

/// What the graph needs from one intent to score a commit's heat.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentMark {
    pub tier: Option<Tier>,
    pub one_way: bool,
}

/// Every commit with a brief note, mapped to its intents' tiers, for the
/// graph's heat strip and score.
// ponytail: parses every note on each graph load; cache by notes-ref oid if it shows in profiles.
pub fn note_marks(path: &str) -> Result<HashMap<String, Vec<IntentMark>>, AppError> {
    let repo = Repository::open(path)?;
    let notes = match repo.notes(Some(NOTES_REF)) {
        Ok(n) => n,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(HashMap::new()),
        Err(e) => return Err(e.into()),
    };
    let rules = RiskRules::load(&repo).unwrap_or_default();
    let mut marks = HashMap::new();
    for (blob_id, commit_id) in notes.flatten() {
        let Ok(blob) = repo.find_blob(blob_id) else {
            continue;
        };
        let intents = std::str::from_utf8(blob.content())
            .ok()
            .and_then(|t| parse_note(t).ok())
            .into_iter()
            .flatten()
            .flat_map(|b| b.normalized().with_tiers(&rules).intents)
            .map(|i| IntentMark {
                tier: i.tier,
                one_way: i.risk.is_some_and(|r| r.one_way),
            })
            .collect();
        marks.insert(commit_id.to_string(), intents);
    }
    Ok(marks)
}

fn diff_paths(diff: &git2::Diff) -> HashSet<String> {
    diff.deltas()
        .flat_map(|d| [d.old_file().path(), d.new_file().path()])
        .flatten()
        .map(|p| normalize(&p.to_string_lossy()))
        .collect()
}

/// After a commit: note HEAD with the drafts that touch its files, then delete
/// drafts with nothing left in the working tree. No drafts → no-op.
pub fn attach_wip(path: &str, env: &[(String, String)]) -> Result<(), AppError> {
    let repo = Repository::open(path)?;
    let dir = wip_dir(&repo);
    let (drafts, _) = read_wip_files(&dir);
    // An inferred draft agents fully shadow is never shown; drop it so it
    // can't come back stale once their drafts are gone.
    if !drafts.iter().any(|(_, b)| b.session == INFERRED) {
        let _ = fs::remove_file(dir.join(format!("{INFERRED}.json")));
    }
    if drafts.is_empty() {
        return Ok(());
    }

    let head = repo.head()?.peel_to_commit()?;
    let sha = head.id().to_string();
    let committed = commit_paths(&repo, &head)?;

    let used: Vec<(&PathBuf, Brief)> = drafts
        .iter()
        .filter_map(|(p, b)| b.restricted_to(&committed).map(|r| (p, r)))
        .collect();
    if used.is_empty() {
        return Ok(());
    }
    // An amend carries the old note over (notes.rewriteRef); keep its briefs
    // and replace only the sessions written again now.
    let mut briefs: Vec<Brief> = stored_note(&repo, &sha)
        .into_iter()
        .filter(|old| !used.iter().any(|(_, b)| b.session == old.session))
        .collect();
    briefs.extend(used.iter().map(|(_, b)| b.clone()));
    write_note(path, &sha, &briefs, env)?;

    // A draft that went into the note is done once none of its files are
    // dirty. Others are left alone: they may describe work not committed yet.
    let dirty = dirty_paths(&repo)?;
    for (file, _) in &used {
        let Some((_, draft)) = drafts.iter().find(|(p, _)| p == *file) else {
            continue;
        };
        if !draft.files().any(|f| dirty.contains(f)) {
            let _ = fs::remove_file(file);
        }
    }
    Ok(())
}

/// Paths a commit changed against its first parent.
fn commit_paths(repo: &Repository, commit: &git2::Commit) -> Result<HashSet<String>, AppError> {
    let parent_tree = commit.parents().next().map(|p| p.tree()).transpose()?;
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit.tree()?), None)?;
    Ok(diff_paths(&diff))
}

/// A note's briefs as stored, for rewriting it: no derived tiers, and an
/// unreadable note counts as empty.
fn stored_note(repo: &Repository, sha: &str) -> Vec<Brief> {
    git2::Oid::from_str(sha)
        .ok()
        .and_then(|oid| repo.find_note(Some(NOTES_REF), oid).ok())
        .and_then(|n| parse_note(n.message().unwrap_or_default()).ok())
        .unwrap_or_default()
        .into_iter()
        .map(Brief::normalized)
        .collect()
}

/// For regenerating a commit's brief: the agent briefs in its note, which are
/// kept as they are, and the files they don't cover, which the inferred brief
/// describes. Errors when agents cover every file.
pub fn commit_split(path: &str, sha: &str) -> Result<WipSplit, AppError> {
    let repo = Repository::open(path)?;
    let commit = repo.find_commit(git2::Oid::from_str(sha)?)?;
    let (inferred, agents): (Vec<Brief>, Vec<Brief>) = stored_note(&repo, sha)
        .into_iter()
        .partition(|b| b.inferred);
    let claimed: HashSet<&String> = agents.iter().flat_map(|b| b.files()).collect();
    let mut unclaimed: Vec<String> = commit_paths(&repo, &commit)?
        .into_iter()
        .filter(|f| !claimed.contains(f))
        .collect();
    unclaimed.sort();
    Ok(WipSplit {
        agents,
        inferred: inferred.into_iter().next(),
        unclaimed,
    })
}

/// Whether this clone shares briefs with `origin`. Off unless the user opts in:
/// briefs carry reasoning that may not belong on the remote.
pub fn sync_enabled(path: &str) -> Result<bool, AppError> {
    Ok(Repository::open(path)?
        .config()?
        .get_bool(SYNC_KEY)
        .unwrap_or(false))
}

pub fn set_sync_enabled(path: &str, enabled: bool) -> Result<(), AppError> {
    Repository::open(path)?
        .config()?
        .open_level(git2::ConfigLevel::Local)?
        .set_bool(SYNC_KEY, enabled)?;
    Ok(())
}

/// Exchange brief notes with `origin` when the clone opted in: fetch theirs,
/// merge (ours wins for a commit noted on both sides), then push when `push`.
pub fn sync_notes(
    path: &str,
    push: bool,
    env: &[(String, String)],
    profile_id: Option<&str>,
) -> Result<(), AppError> {
    if !sync_enabled(path)? {
        return Ok(());
    }
    let authed = forge::authenticated_remote_url(path, profile_id);
    let remote = authed.as_ref().map_or("origin", |a| a.url.as_str());
    let mut remote_env = authed
        .as_ref()
        .map_or_else(|| env.to_vec(), |a| a.merge_env(env));
    // English messages, so the "nothing pushed yet" match below holds.
    remote_env.push(("LC_ALL".into(), "C".into()));
    let remote_git = |args: &[&str]| match &authed {
        Some(a) => run_git(path, &a.build_args(args), &remote_env),
        None => run_git(path, args, &remote_env),
    };

    let spec = format!("+{NOTES_REF}:{REMOTE_NOTES_REF}");
    match remote_git(&["fetch", remote, &spec]) {
        Ok(_) => {
            run_git(
                path,
                &[
                    "notes",
                    "--ref",
                    NOTES_REF,
                    "merge",
                    "-s",
                    "ours",
                    REMOTE_NOTES_REF,
                ],
                env,
            )?;
        }
        // Nothing pushed to the remote yet.
        Err(AppError::Git(m)) if m.contains("couldn't find remote ref") => {}
        Err(e) => return Err(e),
    }
    if push && Repository::open(path)?.find_reference(NOTES_REF).is_ok() {
        // The notes ref isn't code: don't run the repo's pre-push hooks again.
        remote_git(&["push", "--no-verify", remote, NOTES_REF])?;
    }
    Ok(())
}

/// Replace the brief note on `sha`.
pub fn write_note(
    path: &str,
    sha: &str,
    briefs: &[Brief],
    env: &[(String, String)],
) -> Result<(), AppError> {
    let repo = Repository::open(path)?;
    let dir = repo.path().join("prefetch");
    fs::create_dir_all(&dir).map_err(|e| AppError::Other(format!("Write brief: {e}")))?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let tmp = dir.join(format!("NOTE_EDITMSG-{}-{nonce}.json", std::process::id()));
    let json = serde_json::to_string_pretty(briefs)
        .map_err(|e| AppError::Other(format!("Serialize brief: {e}")))?;
    fs::write(&tmp, json).map_err(|e| AppError::Other(format!("Write brief: {e}")))?;
    let tmp_str = tmp.to_string_lossy();
    let res = run_git(
        path,
        &[
            "notes", "--ref", NOTES_REF, "add", "-f", "-F", &tmp_str, sha,
        ],
        env,
    );
    let _ = fs::remove_file(&tmp);
    res?;
    // Let amend and rebase carry the note to the rewritten commit.
    repo.config()?
        .open_level(git2::ConfigLevel::Local)?
        .set_multivar("notes.rewriteRef", &format!("^{NOTES_REF}$"), NOTES_REF)?;
    Ok(())
}

fn strip_fences(raw: &str) -> &str {
    let text = raw.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text);
    text.trim().strip_suffix("```").unwrap_or(text).trim()
}

/// The project's risk guidance text, empty when there is none. Read on its
/// own: agents write this file, and a bad `rules` entry shouldn't drop it.
pub fn risk_guidance(path: &str) -> String {
    #[derive(Deserialize)]
    struct Guidance {
        #[serde(default)]
        guidance: String,
    }
    Repository::open(path)
        .ok()
        .and_then(|r| risk_file(&r))
        .and_then(|t| serde_json::from_str::<Guidance>(&t).ok())
        .map(|g| g.guidance)
        .unwrap_or_default()
}

/// A brief from model output: fences stripped, validated, marked inferred.
pub fn parse_generated(raw: &str) -> Result<Brief, AppError> {
    let mut b: Brief = serde_json::from_str(strip_fences(raw))
        .map_err(|e| AppError::Other(format!("Claude returned an invalid brief: {e}")))?;
    b.inferred = true;
    b.session = INFERRED.into();
    Ok(b.normalized())
}

/// What Summarize returns: the inferred brief, its verdict on agent briefs,
/// and the commit message.
pub struct Summary {
    pub inferred: Option<Brief>,
    /// Session → rewritten brief, or `None` to drop it. Absent: kept as is.
    pub agents: HashMap<String, Option<Brief>>,
    pub message: String,
}

/// `{"brief": ..., "agents": {...}, "message": "..."}` from model output.
pub fn parse_summary(raw: &str) -> Result<Summary, AppError> {
    let invalid =
        |e: serde_json::Error| AppError::Other(format!("Claude returned invalid JSON: {e}"));
    let v: serde_json::Value = serde_json::from_str(strip_fences(raw)).map_err(invalid)?;
    let inferred = match &v["brief"] {
        serde_json::Value::Null => None,
        b => Some(parse_generated(&b.to_string())?),
    };
    // Keyed by session as asked, but models also key by file name or send a
    // list of briefs carrying their `session`.
    let entries: Vec<(String, serde_json::Value)> = match &v["agents"] {
        serde_json::Value::Object(map) => map.iter().map(|(k, b)| (k.clone(), b.clone())).collect(),
        serde_json::Value::Array(list) => list
            .iter()
            .filter_map(|b| Some((b["session"].as_str()?.to_string(), b.clone())))
            .collect(),
        _ => Vec::new(),
    };
    let mut agents = HashMap::new();
    for (key, b) in entries {
        let session = key.trim().trim_end_matches(".json").to_string();
        let rewrite = match b {
            serde_json::Value::Null => None,
            // "keep" or any other note: leave the draft alone.
            serde_json::Value::String(s) if s.eq_ignore_ascii_case("drop") => None,
            serde_json::Value::String(_) => continue,
            b => Some(
                serde_json::from_value::<Brief>(b)
                    .map_err(invalid)?
                    .normalized(),
            ),
        };
        agents.insert(session, rewrite);
    }
    tracing::info!(
        edits = ?agents.iter().map(|(k, v)| (k, v.is_some())).collect::<Vec<_>>(),
        has_brief = !v["brief"].is_null(),
        "summary parsed"
    );
    let message = v["message"].as_str().unwrap_or_default().to_string();
    Ok(Summary {
        inferred,
        agents,
        message,
    })
}

/// Write Summarize's edits: rewritten agent drafts, dropped ones deleted,
/// every file left in only one intent, then the inferred brief for every
/// changed file no agent draft claims afterwards. Drafts Summarize didn't
/// edit change only when a file they share moves elsewhere.
pub fn apply_summary(path: &str, current: &[Brief], summary: &Summary) -> Result<(), AppError> {
    let repo = Repository::open(path)?;
    let dir = wip_dir(&repo);
    let write_err = |e: std::io::Error| AppError::Other(format!("Write brief: {e}"));
    let unknown: Vec<&String> = summary
        .agents
        .keys()
        .filter(|k| !current.iter().any(|a| &a.session == *k))
        .collect();
    if !unknown.is_empty() {
        tracing::warn!(?unknown, "summary edits name no current draft; ignored");
    }
    // A rewrite may take any changed file: merging two sessions' intents on
    // one file moves it between briefs. Rewrites go first so their merges win.
    let dirty = dirty_paths(&repo)?;
    let mut drafts: Vec<(String, Option<Brief>, bool)> = Vec::new();
    for agent in current {
        match summary.agents.get(&agent.session) {
            Some(edit) => drafts.insert(
                drafts.iter().filter(|d| d.2).count(),
                (
                    agent.session.clone(),
                    edit.as_ref().and_then(|b| b.restricted_to(&dirty)),
                    true,
                ),
            ),
            None => drafts.push((agent.session.clone(), Some(agent.clone()), false)),
        }
    }
    // One file, one intent: a file already claimed leaves every later intent,
    // and an intent or brief left with no files goes.
    let mut seen: HashSet<String> = HashSet::new();
    for (_, brief, changed) in &mut drafts {
        let Some(b) = brief else { continue };
        let before = b.intents.clone();
        b.intents.retain_mut(|i| {
            if i.files.is_empty() {
                return true;
            }
            i.files.retain(|f| seen.insert(f.clone()));
            !i.files.is_empty()
        });
        if b.intents != before {
            *changed = true;
        }
        if !b.intents.iter().any(|i| !i.files.is_empty()) {
            *brief = None;
        }
    }
    for (session, brief, changed) in drafts {
        if !changed {
            continue;
        }
        let target = dir.join(format!("{session}.json"));
        match brief {
            Some(mut b) => {
                b.session = session;
                b.inferred = false;
                for i in &mut b.intents {
                    (i.tier, i.pinned) = (None, false);
                }
                let json = serde_json::to_string_pretty(&b)
                    .map_err(|e| AppError::Other(format!("Serialize brief: {e}")))?;
                fs::write(&target, json).map_err(write_err)?;
            }
            None => fs::remove_file(&target).or_else(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(write_err(e))
                }
            })?,
        }
    }
    let unclaimed = wip_split(path)?.unclaimed;
    match &summary.inferred {
        Some(b) => write_inferred(path, b, &unclaimed),
        None => {
            let _ = fs::remove_file(dir.join(format!("{INFERRED}.json")));
            Ok(())
        }
    }
}

/// Session name of the brief Prefetch infers for the working tree.
pub const INFERRED: &str = "inferred";

/// Changes as owned by briefs (the working tree, or one commit's note): the
/// briefs agent sessions wrote (only Summarize edits them), the inferred one,
/// and the changed files no agent brief claims, which inference covers.
pub struct WipSplit {
    pub agents: Vec<Brief>,
    pub inferred: Option<Brief>,
    pub unclaimed: Vec<String>,
}

pub fn wip_split(path: &str) -> Result<WipSplit, AppError> {
    let repo = Repository::open(path)?;
    let (inferred, agents): (Vec<Brief>, Vec<Brief>) = tiered_drafts(&repo)
        .into_iter()
        .partition(|b| b.session == INFERRED);
    let claimed: HashSet<&String> = agents.iter().flat_map(|b| b.files()).collect();
    let mut unclaimed: Vec<String> = dirty_paths(&repo)?
        .into_iter()
        .filter(|f| !claimed.contains(f))
        .collect();
    unclaimed.sort();
    Ok(WipSplit {
        agents,
        inferred: inferred.into_iter().next(),
        unclaimed,
    })
}

/// Store the inferred brief, narrowed to `unclaimed` so it never repeats a
/// file an agent describes. Nothing left: the inferred draft is removed.
pub fn write_inferred(path: &str, generated: &Brief, unclaimed: &[String]) -> Result<(), AppError> {
    let repo = Repository::open(path)?;
    let dir = wip_dir(&repo);
    let target = dir.join(format!("{INFERRED}.json"));
    let allowed: HashSet<String> = unclaimed.iter().cloned().collect();
    let Some(narrowed) = generated.restricted_to(&allowed) else {
        let _ = fs::remove_file(&target);
        return Ok(());
    };
    fs::create_dir_all(&dir).map_err(|e| AppError::Other(format!("Write brief: {e}")))?;
    let json = serde_json::to_string_pretty(&narrowed)
        .map_err(|e| AppError::Other(format!("Serialize brief: {e}")))?;
    fs::write(&target, json).map_err(|e| AppError::Other(format!("Write brief: {e}")))
}

/// Plain-text rendering for the commit-message prompt: each brief's lead,
/// then every intent across them, riskiest first, so the model can't miss
/// a risky one behind a benign lead.
pub fn prompt_context(briefs: &[Brief]) -> String {
    let mut s = String::new();
    for b in briefs {
        s.push_str(&format!("Lead intent: {}\n", b.intent.title));
        if !b.intent.why.is_empty() {
            s.push_str(&format!("Why: {}\n", b.intent.why));
        }
        for i in &b.issues {
            s.push_str(format!("Issue: {} {}", i.id, i.title).trim_end());
            s.push('\n');
        }
        s.push('\n');
    }
    let mut intents: Vec<&Intent> = briefs.iter().flat_map(|b| &b.intents).collect();
    // The Brief view's order (`sortIntents` in src/lib/brief.ts), so the
    // message lists intents the way the cards read. Stable within a rank.
    let type_rank = |t: &str| match t {
        "fix" => 0,
        "feat" => 1,
        _ => 2,
    };
    intents.sort_by_key(|i| {
        (
            i.kind == "unrelated",
            std::cmp::Reverse(i.tier),
            type_rank(&i.commit_type),
        )
    });
    if !intents.is_empty() {
        s.push_str("Intents, most important first:\n");
    }
    for i in intents {
        let tier = match i.tier {
            Some(Tier::High) => "high risk",
            Some(Tier::Mid) => "mid risk",
            Some(Tier::Low) => "low risk",
            None => "risk unknown",
        };
        let mut tag = vec![tier, i.kind.as_str()];
        if !i.commit_type.is_empty() {
            tag.push(&i.commit_type);
        }
        s.push_str(&format!("- [{}] {}", tag.join(", "), i.title));
        if !i.why.is_empty() {
            s.push_str(&format!(" — {}", i.why));
        }
        if let Some(r) = i.risk.as_ref().filter(|r| !r.why.is_empty()) {
            s.push_str(&format!("; concern: {}", r.why));
        }
        if !i.files.is_empty() {
            s.push_str(&format!(" ({})", i.files.join(", ")));
        }
        s.push('\n');
    }
    s.trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .current_dir(dir)
            .status()
            .is_ok_and(|s| s.success());
        assert!(ok, "git {args:?}");
    }

    fn draft(session: &str, files: &[&[&str]]) -> String {
        let intents: Vec<_> = files
            .iter()
            .enumerate()
            .map(|(n, f)| serde_json::json!({ "title": format!("i{n}"), "files": f }))
            .collect();
        serde_json::json!({ "session": session, "intent": { "title": "lead", "why": "w" }, "intents": intents })
            .to_string()
    }

    #[test]
    fn restrict_and_note_shapes() {
        let b: Brief = serde_json::from_str(&draft("s", &[&["a.rs"], &["./b.rs"], &[]])).unwrap();
        let b = b.normalized();
        let only_b: HashSet<String> = ["b.rs".to_string()].into();
        let r = b.restricted_to(&only_b).unwrap();
        assert_eq!(r.intents.len(), 2, "b.rs intent + file-less intent");
        assert_eq!(r.intents[0].files, ["b.rs"]);
        assert!(b.restricted_to(&HashSet::new()).is_none());

        assert_eq!(parse_note(&draft("x", &[])).unwrap().len(), 1);
        assert_eq!(
            parse_note(&format!("[{}]", draft("x", &[]))).unwrap().len(),
            1
        );
        assert!(parse_note("{}").is_err());
    }

    #[test]
    fn summary_keeps_rewrites_and_drops_agent_drafts() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let path = dir.to_str().unwrap();
        git(dir, &["init", "-q"]);
        for f in ["a.rs", "b.rs", "c.rs", "d.rs", "e.rs", "f.rs"] {
            fs::write(dir.join(f), "x").unwrap();
        }
        let wip = dir.join(".git/prefetch/wip");
        fs::create_dir_all(&wip).unwrap();
        fs::write(wip.join("keep.json"), draft("keep", &[&["e.rs"]])).unwrap();
        fs::write(wip.join("share.json"), draft("share", &[&["a.rs"]])).unwrap();
        fs::write(wip.join("fix.json"), draft("fix", &[&["b.rs"]])).unwrap();
        fs::write(wip.join("dup.json"), draft("dup", &[&["f.rs"], &["f.rs"]])).unwrap();
        fs::write(wip.join("gone.json"), draft("gone", &[&["c.rs"]])).unwrap();
        let agents = wip_split(path).unwrap().agents;

        // The rewrite merges in share's a.rs and the free d.rs.
        let s = parse_summary(
            r#"{"brief":{"intent":{"title":"inf"},"intents":[{"title":"i","files":["a.rs","c.rs","d.rs"]}]},
                "agents":{"fix":{"intent":{"title":"Never send twice"},"intents":[{"title":"r","files":["b.rs","d.rs","a.rs"]}]},
                          "gone":null,"../evil":null},
                "message":"fix: x"}"#,
        )
        .unwrap();
        apply_summary(path, &agents, &s).unwrap();

        let briefs = read_wip(path).unwrap().briefs;
        let by = |s: &str| briefs.iter().find(|b| b.session == s);
        assert_eq!(by("keep").unwrap().intent.title, "lead");
        let fix = by("fix").unwrap();
        assert_eq!(fix.intent.title, "Never send twice");
        assert!(!fix.inferred);
        assert_eq!(fix.intents[0].files, ["b.rs", "d.rs", "a.rs"]);
        // share lost its only file to the merge; dup keeps f.rs in one intent.
        assert!(by("share").is_none() && !wip.join("share.json").exists());
        assert_eq!(by("dup").unwrap().intents.len(), 1);
        assert!(by("gone").is_none() && !wip.join("gone.json").exists());
        // Only the dropped draft's c.rs is left for inference.
        assert_eq!(by(INFERRED).unwrap().intents[0].files, ["c.rs"]);
        // No file in two intents anywhere.
        let mut all: Vec<&String> = briefs.iter().flat_map(|b| b.files()).collect();
        let n = all.len();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), n);
    }

    #[test]
    fn prompt_lists_riskiest_staged_intent_first_across_briefs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q"]);
        let wip = dir.join(".git/prefetch/wip");
        fs::create_dir_all(&wip).unwrap();
        // Drafts sort by file name, so "a" (benign) would come first unsorted.
        for (session, file, risk) in [
            ("a", "benign.rs", Some(serde_json::json!({}))),
            ("b", "unrated.rs", None),
            ("c", "risky.rs", Some(serde_json::json!({ "oneWay": true }))),
            (
                "d",
                "middling.rs",
                Some(serde_json::json!({ "shared": true })),
            ),
        ] {
            fs::write(dir.join(file), "x").unwrap();
            let mut intent = serde_json::json!({ "title": file, "files": [file] });
            if let Some(r) = risk {
                intent["risk"] = r;
            }
            let d = serde_json::json!({ "intent": { "title": session }, "intents": [intent] });
            fs::write(wip.join(format!("{session}.json")), d.to_string()).unwrap();
        }
        git(dir, &["add", "."]);

        let ctx = prompt_context(&staged_briefs(dir.to_str().unwrap()).unwrap());
        let at = |t: &str| ctx.find(&format!("] {t}")).unwrap();
        assert!(at("risky") < at("middling"));
        assert!(at("middling") < at("benign"));
        assert!(at("benign") < at("unrated"));
        assert!(ctx.contains("[high risk, sub] risky.rs"));
    }

    #[test]
    fn attach_notes_commit_and_clears_finished_drafts() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let path = dir.to_str().unwrap();
        git(dir, &["init", "-q"]);
        fs::write(dir.join("a.rs"), "a").unwrap();
        fs::write(dir.join("b.rs"), "b").unwrap();
        let wip = dir.join(".git/prefetch/wip");
        fs::create_dir_all(&wip).unwrap();
        // `done` is fully committed; `half` still has b.rs dirty.
        fs::write(wip.join("done.json"), draft("done", &[&["a.rs"]])).unwrap();
        fs::write(
            wip.join("half.json"),
            draft("half", &[&["a.rs"], &["b.rs"]]),
        )
        .unwrap();
        fs::write(wip.join("broken.json"), "{").unwrap();
        assert_eq!(read_wip(path).unwrap().errors.len(), 1);

        git(dir, &["add", "a.rs"]);
        let staged = staged_briefs(path).unwrap();
        assert_eq!(staged.len(), 2);
        assert!(prompt_context(&staged).contains("(a.rs)"));
        git(dir, &["commit", "-qm", "c1"]);
        attach_wip(path, &[]).unwrap();

        let head = Repository::open(path)
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap();
        let note = read_note(path, &head.to_string()).unwrap().unwrap();
        assert_eq!(note.len(), 2);
        assert!(note
            .iter()
            .all(|b| b.intents.iter().all(|i| i.files == ["a.rs"])));
        assert!(!wip.join("done.json").exists());
        assert!(wip.join("half.json").exists());

        // The note follows the commit through an amend, and attaching a new
        // draft on amend adds to it instead of replacing it.
        fs::write(dir.join("c.rs"), "c").unwrap();
        fs::write(wip.join("later.json"), draft("later", &[&["c.rs"]])).unwrap();
        fs::write(
            wip.join("unrelated.json"),
            draft("unrelated", &[&["zzz.rs"]]),
        )
        .unwrap();
        git(dir, &["add", "c.rs"]);
        git(dir, &["commit", "-q", "--amend", "-m", "c1b"]);
        attach_wip(path, &[]).unwrap();
        let amended = Repository::open(path)
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap();
        let note = read_note(path, &amended.to_string()).unwrap().unwrap();
        let sessions: Vec<&str> = note.iter().map(|b| b.session.as_str()).collect();
        assert!(
            sessions.contains(&"done") && sessions.contains(&"later"),
            "{sessions:?}"
        );
        // Stored notes never carry derived tiers.
        let raw = stored_note(&Repository::open(path).unwrap(), &amended.to_string());
        assert!(raw
            .iter()
            .flat_map(|b| &b.intents)
            .all(|i| i.tier.is_none()));
        // A draft whose files this commit didn't touch is kept.
        assert!(wip.join("unrelated.json").exists());
    }

    #[test]
    fn tier_rule_and_project_overrides() {
        let risk = |f: fn(&mut Risk)| {
            let mut r = Risk::default();
            f(&mut r);
            r.tier(false)
        };
        assert_eq!(risk(|_| {}), Tier::Low);
        assert_eq!(risk(|r| r.shared = true), Tier::Mid);
        assert_eq!(risk(|r| r.data = true), Tier::High);
        // Inferred: untested only means no test in the diff, so not high.
        let data = Risk {
            data: true,
            ..Default::default()
        };
        assert_eq!(data.tier(true), Tier::Mid);
        let one_way = Risk {
            one_way: true,
            ..Default::default()
        };
        assert_eq!(one_way.tier(true), Tier::High);
        assert_eq!(
            risk(|r| {
                r.data = true;
                r.tested = true
            }),
            Tier::Mid
        );
        assert_eq!(
            risk(|r| {
                r.one_way = true;
                r.tested = true
            }),
            Tier::High
        );

        let rules: RiskRules = serde_json::from_str(
            r#"{"rules":[{"paths":["docs/**"],"tier":"low"},{"paths":["db/*.sql"],"tier":"high"}]}"#,
        )
        .unwrap();
        let intent = |files: &[&str], risk: Option<Risk>| Intent {
            title: "t".into(),
            why: String::new(),
            kind: "sub".into(),
            files: files.iter().map(|f| f.to_string()).collect(),
            commit_type: String::new(),
            tags: Vec::new(),
            risk,
            joins: String::new(),
            tier: None,
            pinned: false,
        };
        let data = Some(Risk {
            data: true,
            ..Default::default()
        });
        // A rule lowers files it covers; unmatched files keep the answer.
        assert_eq!(
            rules.intent_tier(&intent(&["docs/a/b.md"], data.clone()), false),
            Some(Tier::Low)
        );
        assert_eq!(
            rules.intent_tier(&intent(&["docs/a.md", "src/x.rs"], data), false),
            Some(Tier::High)
        );
        // A rule raises even unassessed intents; `*` stays inside one folder.
        assert_eq!(
            rules.intent_tier(&intent(&["db/1.sql"], None), false),
            Some(Tier::High)
        );
        assert_eq!(
            rules.intent_tier(&intent(&["db/x/1.sql"], None), false),
            None
        );
    }

    #[test]
    fn generated_brief_parses_fenced_and_replaces_drafts() {
        let raw = "```json\n{\"intent\":{\"title\":\"t\"},\"intents\":[{\"title\":\"a\",\"type\":\"fix\",\"tags\":[\" Pricing \",\"pricing\",\"\",\"de\",\"tiers\",\"extra\"],\"files\":[\"./src\\\\a.rs\"],\"risk\":{\"oneWay\":true}}]}\n```";
        let b = parse_generated(raw).unwrap();
        assert!(b.inferred);
        assert_eq!(b.intents[0].files, ["src/a.rs"]);
        assert_eq!(b.intents[0].tags, ["pricing", "de", "tiers"]);
        for (tags, want) in [
            (r#""Auth""#, vec!["auth"]),
            ("null", vec![]),
            (r#"["a",1]"#, vec!["a"]),
        ] {
            let raw = format!(
                r#"{{"intent":{{"title":"t"}},"intents":[{{"title":"a","tags":{tags}}}]}}"#
            );
            assert_eq!(
                parse_generated(&raw).unwrap().intents[0].tags,
                want,
                "{tags}"
            );
        }
        let raw = r#"{"intent":{"title":"t"},"intents":[{"title":"a","joins":null},{"title":"b","joins":"x"}]}"#;
        let joins: Vec<String> = parse_generated(raw)
            .unwrap()
            .intents
            .into_iter()
            .map(|i| i.joins)
            .collect();
        assert_eq!(joins, ["", "x"]);
        assert_eq!(b.intents[0].commit_type, "fix");
        assert!(parse_generated("not json").is_err());
        let s = parse_summary(
            "{\"brief\":{\"intent\":{\"title\":\"t\"}},\"message\":\"fix: x\\n\\nwhy\"}",
        )
        .unwrap();
        assert!(s.inferred.unwrap().inferred);
        assert!(s.agents.is_empty());
        assert_eq!(s.message, "fix: x\n\nwhy");

        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().to_str().unwrap();
        git(tmp.path(), &["init", "-q"]);
        fs::write(tmp.path().join("a.rs"), "a").unwrap();
        fs::write(tmp.path().join("b.rs"), "b").unwrap();
        let wip = tmp.path().join(".git/prefetch/wip");
        fs::create_dir_all(&wip).unwrap();
        fs::write(wip.join("agent.json"), draft("agent", &[&["a.rs"]])).unwrap();

        // The agent owns a.rs; only b.rs is left for inference.
        let split = wip_split(path).unwrap();
        assert_eq!(split.agents.len(), 1);
        assert_eq!(split.unclaimed, ["b.rs"]);

        // A generated brief claiming both keeps only b.rs; the agent draft stays.
        let mut both = b.clone();
        both.intents[0].files = vec!["a.rs".into(), "b.rs".into()];
        write_inferred(path, &both, &split.unclaimed).unwrap();
        let read = read_wip(path).unwrap();
        assert_eq!(read.briefs.len(), 2);
        let inferred = read.briefs.iter().find(|b| b.inferred).unwrap();
        assert_eq!(inferred.intents[0].files, ["b.rs"]);
        assert_eq!(inferred.intents[0].tier, Some(Tier::High));

        // The agent claims b.rs afterwards: the stale inferred draft gives way.
        fs::write(wip.join("agent.json"), draft("agent", &[&["a.rs", "b.rs"]])).unwrap();
        assert_eq!(read_wip(path).unwrap().briefs.len(), 1);
        fs::write(wip.join("agent.json"), draft("agent", &[&["a.rs"]])).unwrap();

        // Shadowed entirely, it's deleted on the next commit rather than kept.
        fs::write(wip.join("agent.json"), draft("agent", &[&["a.rs", "b.rs"]])).unwrap();
        git(tmp.path(), &["add", "."]);
        git(tmp.path(), &["commit", "-qm", "c1"]);
        attach_wip(path, &[]).unwrap();
        assert!(!wip.join("inferred.json").exists());
        write_inferred(path, &both, &["b.rs".into()]).unwrap();
        fs::write(wip.join("agent.json"), draft("agent", &[&["a.rs"]])).unwrap();

        // Nothing unclaimed: the inferred draft goes away.
        write_inferred(path, &both, &[]).unwrap();
        assert_eq!(read_wip(path).unwrap().briefs.len(), 1);
    }

    #[test]
    fn shared_file_shows_under_newest_draft_only() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q"]);
        let wip = dir.join(".git/prefetch/wip");
        fs::create_dir_all(&wip).unwrap();
        fs::write(
            wip.join("old.json"),
            draft("old", &[&["a.rs"], &["s.json"]]),
        )
        .unwrap();
        fs::write(wip.join("new.json"), draft("new", &[&["s.json", "b.rs"]])).unwrap();
        let past = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(wip.join("old.json"))
            .and_then(|f| f.set_modified(past))
            .unwrap();

        let briefs = read_wip(dir.to_str().unwrap()).unwrap().briefs;
        let files = |s: &str| -> Vec<Vec<String>> {
            let b = briefs.iter().find(|b| b.session == s).unwrap();
            b.intents.iter().map(|i| i.files.clone()).collect()
        };
        // The old draft's intent for s.json had nothing else, so it's gone.
        assert_eq!(files("old"), [["a.rs"]]);
        assert_eq!(files("new"), [["s.json", "b.rs"]]);

        // A riskier claim wins over a newer one, so the view isn't calmer than the note.
        let risky = serde_json::json!({ "intent": { "title": "lead" }, "intents": [
            { "title": "i0", "files": ["a.rs"] },
            { "title": "i1", "files": ["s.json"], "risk": { "oneWay": true } } ] });
        fs::write(wip.join("old.json"), risky.to_string()).unwrap();
        fs::File::options()
            .write(true)
            .open(wip.join("old.json"))
            .and_then(|f| f.set_modified(past))
            .unwrap();
        let briefs = read_wip(dir.to_str().unwrap()).unwrap().briefs;
        let files = |s: &str| -> Vec<Vec<String>> {
            let b = briefs.iter().find(|b| b.session == s).unwrap();
            b.intents.iter().map(|i| i.files.clone()).collect()
        };
        assert_eq!(files("old"), [["a.rs"], ["s.json"]]);
        assert_eq!(files("new"), [["b.rs"]]);
    }

    #[test]
    fn commit_regeneration_keeps_agent_briefs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let path = dir.to_str().unwrap();
        git(dir, &["init", "-q"]);
        fs::write(dir.join("a.rs"), "a").unwrap();
        fs::write(dir.join("b.rs"), "b").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-qm", "c1"]);
        let sha = Repository::open(path)
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap()
            .to_string();
        let agent: Brief = serde_json::from_str(&draft("agent", &[&["a.rs"]])).unwrap();
        write_note(path, &sha, &[agent], &[]).unwrap();

        let split = commit_split(path, &sha).unwrap();
        assert_eq!(split.agents.len(), 1);
        assert!(split.inferred.is_none());
        assert_eq!(split.unclaimed, ["b.rs"]);
    }

    #[test]
    fn sync_is_opt_in_and_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let (remote, a, b) = (root.join("r.git"), root.join("a"), root.join("b"));
        git(root, &["init", "-q", "--bare", remote.to_str().unwrap()]);
        git(root, &["clone", "-q", "r.git", "a"]);
        git(&a, &["commit", "-q", "--allow-empty", "-m", "c1"]);
        git(&a, &["push", "-q", "origin", "HEAD"]);
        git(
            &a,
            &["notes", "--ref", NOTES_REF, "add", "-m", "[]", "HEAD"],
        );
        let a_path = a.to_str().unwrap();

        // Off by default: nothing reaches the remote.
        sync_notes(a_path, true, &[], None).unwrap();
        let bare = Repository::open_bare(&remote).unwrap();
        assert!(bare.find_reference(NOTES_REF).is_err());

        set_sync_enabled(a_path, true).unwrap();
        sync_notes(a_path, true, &[], None).unwrap();
        assert!(bare.find_reference(NOTES_REF).is_ok());

        git(root, &["clone", "-q", "r.git", "b"]);
        let b_path = b.to_str().unwrap();
        set_sync_enabled(b_path, true).unwrap();
        sync_notes(b_path, false, &[], None).unwrap();
        let head = Repository::open(b_path)
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap();
        assert!(read_note(b_path, &head.to_string()).unwrap().is_some());
    }
}
