//! Change stories (#93): one commit read as an ordered, narrated diff.
//!
//! A story is part of a Change Brief: whatever writes a brief (the agent, or
//! Summarize / Generate brief) writes its story. Rust cuts the diff into
//! pieces and [`from_briefs`] places every piece exactly once (a step, or
//! `leftovers`), so nothing in the diff can go unshown.
//! See `docs/research/change-stories.md`.

use crate::error::AppError;
use crate::git::brief::{self, Brief, Intent, Tier};
use crate::git::repository::{
    get_commit_file_diff, get_commit_files, get_file_diff, get_status, get_worktree_file_diff,
};
use crate::git::types::{DiffHunk, FileDiff};
use git2::Repository;
use serde::Serialize;

/// A hunk with more changed lines than this is cut into several pieces.
const PIECE_CHANGED_LINES: usize = 40;
/// How far (in lines) from a `PIECE_CHANGED_LINES` mark to look for a blank line.
const CUT_WINDOW: usize = 20;

#[derive(Debug, Clone, Serialize)]
pub struct Story {
    /// Empty when there are several chapters: each has its own.
    pub approach: String,
    /// One per brief with a story, in the Brief tab's order.
    pub chapters: Vec<Chapter>,
    /// Story order; `side` steps come last.
    pub steps: Vec<StoryStep>,
    /// Pieces no step named, in diff order.
    pub leftovers: Vec<StoryPiece>,
    /// No agent-written brief fed the story.
    pub inferred: bool,
}

/// One brief's part of a story built from briefs.
#[derive(Debug, Clone, Serialize)]
pub struct Chapter {
    /// The brief's lead intent.
    pub title: String,
    pub approach: String,
    pub inferred: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoryStep {
    /// Index into `Story::chapters`.
    pub chapter: usize,
    pub title: String,
    pub why: String,
    /// Title of the brief intent it serves.
    pub intent: Option<String>,
    pub tier: Option<Tier>,
    #[serde(rename = "type")]
    pub commit_type: Option<String>,
    /// The intent's kind is `unrelated`.
    pub side: bool,
    pub pieces: Vec<StoryPiece>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoryPiece {
    /// Repo-relative, forward slashes.
    pub path: String,
    pub hunk: DiffHunk,
}

/// Full sha for a commit id from the frontend.
fn resolve(path: &str, commit_id: &str) -> Result<String, AppError> {
    if commit_id.is_empty() || !commit_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Other("Invalid commit id".into()));
    }
    let repo = Repository::open(path)?;
    let sha = repo.revparse_single(commit_id)?.peel_to_commit()?.id();
    Ok(sha.to_string())
}

/// The commit's diff as pieces, in diff order, read the way the commit diff
/// viewer reads it. Binary files have no pieces. A file the reader truncated
/// (over its line cap) keeps the pieces it returned, as the viewer shows them.
fn pieces(path: &str, sha: &str) -> Result<Vec<StoryPiece>, AppError> {
    // ponytail: one git process per file; batch into one diff if commits with
    // hundreds of files get slow.
    let mut out = Vec::new();
    for file in get_commit_files(path, sha)? {
        push_pieces(&mut out, &get_commit_file_diff(path, sha, &file.path)?);
    }
    Ok(out)
}

/// Everything uncommitted as pieces, relative to HEAD: staged, unstaged and
/// untracked together. A tracked file gets one HEAD-to-worktree diff, so a
/// partly staged file shows each change once; an untracked one is read the
/// way the Working Changes list reads it.
fn worktree_pieces(path: &str) -> Result<Vec<StoryPiece>, AppError> {
    let repo = Repository::open(path)?;
    let base = match repo.head().and_then(|h| h.peel_to_commit()) {
        Ok(c) => c.id(),
        // Unborn branch: everything is new, so diff from the empty tree.
        Err(_) => repo.treebuilder(None)?.write()?,
    }
    .to_string();
    let mut out = Vec::new();
    // A partly staged file has two rows; sorted by path, so they're adjacent.
    let mut files = get_status(path)?;
    files.dedup_by(|b, a| a.path == b.path);
    for file in files {
        let diff = if file.status_type == "untracked" {
            get_file_diff(path, &file.path, false)?
        } else {
            get_worktree_file_diff(path, &base, &file.path)?
        };
        push_pieces(&mut out, &diff);
    }
    Ok(out)
}

/// A file's hunks as pieces, as the diff viewer shows them: binary files have
/// none, a truncated file keeps what the reader returned.
fn push_pieces(out: &mut Vec<StoryPiece>, diff: &FileDiff) {
    if diff.is_binary {
        return;
    }
    for hunk in &diff.hunks {
        out.extend(split_hunk(hunk).into_iter().map(|hunk| StoryPiece {
            path: diff.path.clone(),
            hunk,
        }));
    }
}

/// One piece per hunk, except a hunk with more than `PIECE_CHANGED_LINES`
/// changed lines is cut at the blank line nearest each such mark (right after the mark line
/// when there is no blank one near it). Looks only at the hunk, so the same
/// hunk always gives the same pieces.
// ponytail: blank-line cuts can split a function; cut at top-level
// declarations if that shows up.
fn split_hunk(hunk: &DiffHunk) -> Vec<DiffHunk> {
    let lines = &hunk.lines;
    let changed: Vec<usize> = (0..lines.len())
        .filter(|&i| lines[i].origin != ' ')
        .collect();
    if changed.len() <= PIECE_CHANGED_LINES {
        return vec![hunk.clone()];
    }
    let blank = |i: usize| lines[i].content.trim().is_empty();
    let mut bounds = vec![0];
    for k in (PIECE_CHANGED_LINES..changed.len()).step_by(PIECE_CHANGED_LINES) {
        let mark = changed[k - 1];
        let prev = bounds[bounds.len() - 1];
        // A blank at `b` ends its slice: the next one starts at `b + 1`.
        let lo = prev.max(mark.saturating_sub(CUT_WINDOW));
        let hi = (mark + CUT_WINDOW).min(lines.len() - 2);
        let cut = (lo..=hi)
            .filter(|&b| blank(b))
            .min_by_key(|&b| b.abs_diff(mark))
            .map_or(mark + 1, |b| b + 1);
        if cut > prev && cut < lines.len() {
            bounds.push(cut);
        }
    }
    bounds.push(lines.len());

    // Next line number on each side. An empty range's start is the line
    // before it, so a hunk with no old lines starts one later.
    let mut old = hunk.old_start + u32::from(hunk.old_lines == 0);
    let mut new = hunk.new_start + u32::from(hunk.new_lines == 0);
    let section = hunk.header.splitn(3, "@@").nth(2).unwrap_or("");
    bounds
        .windows(2)
        .enumerate()
        .map(|(n, w)| {
            let lines = lines[w[0]..w[1]].to_vec();
            let old_lines = lines.iter().filter(|l| l.origin != '+').count() as u32;
            let new_lines = lines.iter().filter(|l| l.origin != '-').count() as u32;
            let start = |next: u32, count: u32| {
                if count == 0 {
                    next.saturating_sub(1)
                } else {
                    next
                }
            };
            let (old_start, new_start) = (start(old, old_lines), start(new, new_lines));
            old += old_lines;
            new += new_lines;
            DiffHunk {
                header: format!(
                    "@@ -{old_start},{old_lines} +{new_start},{new_lines} @@{}",
                    if n == 0 { section } else { "" }
                ),
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines,
            }
        })
        .collect()
}

/// Anchor text as matched: every whitespace character removed, so
/// reformatting, indentation and line breaks never matter.
fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// The story the briefs tell themselves, resolved against `pieces` with no
/// model call; `None` when no brief has a story. One chapter per brief with
/// a story, in the Brief tab's order. Each piece goes to at most one step:
///
/// 1. A reference with `at` claims the pieces of its file whose changed
///    (`+`/`-`) lines contain the anchor, whitespace ignored, as many as
///    match. Only when no piece of the file has it there, the pieces whose
///    context lines or hunk heading do.
/// 2. Then a reference with no `at` claims the pieces of its file still free.
///
/// Within each pass the earlier step wins, across chapters too. An anchor
/// that matches nothing claims nothing (it never widens to the whole file).
/// A step's pieces follow its references' order, then diff order; a step
/// left with none is dropped; steps of `unrelated` intents go last. Every
/// piece no step claimed is a leftover, in diff order.
fn from_briefs(briefs: &[Brief], pieces: Vec<StoryPiece>) -> Option<Story> {
    let mut told: Vec<&Brief> = briefs.iter().filter(|b| b.story.is_some()).collect();
    if told.is_empty() {
        return None;
    }
    // `sortBriefs`: by the brief's most important intent; none sorts last.
    told.sort_by_key(|b| {
        b.intents
            .iter()
            .map(brief::intent_rank)
            .min()
            .map_or((1, (false, 0, 0)), |r| (0, r))
    });
    let all: Vec<&Intent> = briefs.iter().flat_map(|b| &b.intents).collect();
    let mut chapters = Vec::new();
    // (chapter, brief, step)
    let mut wanted = Vec::new();
    for (c, b) in told.iter().enumerate() {
        let Some(story) = &b.story else { continue };
        chapters.push(Chapter {
            title: b.intent.title.clone(),
            approach: story.approach.clone(),
            inferred: b.inferred,
        });
        wanted.extend(story.steps.iter().map(|s| (c, *b, s)));
    }

    let changed: Vec<String> = pieces
        .iter()
        .map(|p| {
            let lines = p.hunk.lines.iter().filter(|l| l.origin != ' ');
            squash(&lines.map(|l| l.content.as_str()).collect::<String>())
        })
        .collect();
    let around: Vec<String> = pieces
        .iter()
        .map(|p| {
            let heading = p.hunk.header.splitn(3, "@@").nth(2).unwrap_or("");
            let lines = p.hunk.lines.iter().map(|l| l.content.as_str());
            squash(&std::iter::once(heading).chain(lines).collect::<String>())
        })
        .collect();
    // piece → (step, reference index in that step)
    let mut owner: Vec<Option<(usize, usize)>> = vec![None; pieces.len()];
    for anchored in [true, false] {
        for (s, (_, _, step)) in wanted.iter().enumerate() {
            for (r, code) in step.code.iter().enumerate() {
                let at = squash(&code.at);
                if at.is_empty() == anchored {
                    continue;
                }
                let in_file: Vec<usize> = (0..pieces.len())
                    .filter(|&i| pieces[i].path == code.file)
                    .collect();
                let mut hits: Vec<usize> = in_file
                    .iter()
                    .copied()
                    .filter(|&i| at.is_empty() || changed[i].contains(&at))
                    .collect();
                if hits.is_empty() {
                    hits = in_file
                        .into_iter()
                        .filter(|&i| around[i].contains(&at))
                        .collect();
                }
                for i in hits {
                    owner[i].get_or_insert((s, r));
                }
            }
        }
    }

    let mut slots: Vec<Option<StoryPiece>> = pieces.into_iter().map(Some).collect();
    let mut steps: Vec<StoryStep> = Vec::new();
    for (s, (c, b, step)) in wanted.iter().enumerate() {
        let mut mine: Vec<(usize, usize)> = owner
            .iter()
            .enumerate()
            .filter_map(|(i, o)| o.filter(|o| o.0 == s).map(|(_, r)| (r, i)))
            .collect();
        if mine.is_empty() {
            continue;
        }
        mine.sort();
        // Its own brief's intent first: two briefs may share a title.
        let named = |i: &&Intent| i.title.trim().eq_ignore_ascii_case(&step.intent);
        let intent = (!step.intent.is_empty())
            .then(|| {
                b.intents
                    .iter()
                    .find(named)
                    .or_else(|| all.iter().copied().find(named))
            })
            .flatten();
        steps.push(StoryStep {
            chapter: *c,
            title: step.title.clone(),
            why: step.why.clone(),
            intent: intent.map(|i| i.title.clone()),
            tier: intent.and_then(|i| i.tier),
            commit_type: intent
                .map(|i| i.commit_type.clone())
                .filter(|t| !t.is_empty()),
            side: intent.is_some_and(|i| i.kind == "unrelated"),
            pieces: mine
                .into_iter()
                .filter_map(|(_, i)| slots[i].take())
                .collect(),
        });
    }
    steps.sort_by_key(|s| s.side);
    Some(Story {
        approach: match chapters.as_slice() {
            [only] => only.approach.clone(),
            _ => String::new(),
        },
        inferred: told.iter().all(|b| b.inferred),
        chapters,
        steps,
        leftovers: slots.into_iter().flatten().collect(),
    })
}

/// The briefs in a commit's note. A broken note is shown in the Brief tab;
/// here it just means none.
fn note_briefs(path: &str, sha: &str) -> Vec<Brief> {
    brief::read_note(path, sha)
        .unwrap_or_else(|e| {
            tracing::warn!(%e, "story without brief note");
            None
        })
        .unwrap_or_default()
}

/// The working tree's briefs as the Brief tab shows them. Broken drafts are
/// shown there; here they are skipped.
fn wip_briefs(path: &str) -> Vec<Brief> {
    brief::wip_in_view(path).unwrap_or_else(|e| {
        tracing::warn!(%e, "story without brief drafts");
        Vec::new()
    })
}

/// A commit's story, from the briefs in its note; `None` when none tells one.
pub fn read_commit(path: &str, commit_id: &str) -> Result<Option<Story>, AppError> {
    let sha = resolve(path, commit_id)?;
    let briefs = note_briefs(path, &sha);
    if !briefs.iter().any(|b| b.story.is_some()) {
        return Ok(None);
    }
    Ok(from_briefs(&briefs, pieces(path, &sha)?))
}

/// The working tree's story, from the drafts in view, built fresh on every
/// read so it follows each edit. `None` when no draft tells one or nothing
/// is left to tell.
pub fn read_worktree(path: &str) -> Result<Option<Story>, AppError> {
    let briefs = wip_briefs(path);
    if !briefs.iter().any(|b| b.story.is_some()) {
        return Ok(None);
    }
    let pieces = worktree_pieces(path)?;
    if pieces.is_empty() {
        return Ok(None);
    }
    Ok(from_briefs(&briefs, pieces))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::types::DiffLine;
    use std::fs;

    /// A new file's hunk, as `unified_diff` parses it.
    fn added(contents: &[&str]) -> DiffHunk {
        DiffHunk {
            header: format!("@@ -0,0 +1,{} @@", contents.len()),
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: contents.len() as u32,
            lines: contents
                .iter()
                .enumerate()
                .map(|(i, c)| DiffLine {
                    origin: '+',
                    content: c.to_string(),
                    old_lineno: None,
                    new_lineno: Some(i as u32 + 1),
                })
                .collect(),
        }
    }

    fn line(origin: char, content: &str, old: Option<u32>, new: Option<u32>) -> DiffLine {
        DiffLine {
            origin,
            content: content.into(),
            old_lineno: old,
            new_lineno: new,
        }
    }

    /// Each slice's numbers match its own lines.
    fn assert_consistent(h: &DiffHunk) {
        let old: Vec<u32> = h.lines.iter().filter_map(|l| l.old_lineno).collect();
        let new: Vec<u32> = h.lines.iter().filter_map(|l| l.new_lineno).collect();
        assert_eq!(h.old_lines as usize, old.len(), "{}", h.header);
        assert_eq!(h.new_lines as usize, new.len(), "{}", h.header);
        if let Some(&first) = old.first() {
            assert_eq!(h.old_start, first, "{}", h.header);
        }
        if let Some(&first) = new.first() {
            assert_eq!(h.new_start, first, "{}", h.header);
        }
        assert!(h.header.starts_with(&format!(
            "@@ -{},{} +{},{} @@",
            h.old_start, h.old_lines, h.new_start, h.new_lines
        )));
    }

    #[test]
    fn small_hunk_is_untouched() {
        let h = added(&["a"; 40]);
        let out = split_hunk(&h);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].header, h.header);
        assert_eq!(out[0].lines.len(), 40);
    }

    #[test]
    fn big_new_file_cuts_after_nearest_blank() {
        // 100 lines, blanks at indexes 35 and 85.
        let mut text = vec!["x"; 100];
        text[35] = "";
        text[85] = "";
        let h = added(&text);
        let out = split_hunk(&h);
        // Marks at index 39 and 79: cut after the blanks at 35 and 85.
        let lens: Vec<usize> = out.iter().map(|p| p.lines.len()).collect();
        assert_eq!(lens, [36, 50, 14]);
        assert_eq!(out[0].header, "@@ -0,0 +1,36 @@");
        assert_eq!(out[1].header, "@@ -0,0 +37,50 @@");
        assert_eq!(out[2].header, "@@ -0,0 +87,14 @@");
        out.iter().for_each(assert_consistent);
        let joined: Vec<String> = out
            .iter()
            .flat_map(|p| &p.lines)
            .map(|l| l.content.clone())
            .collect();
        let orig: Vec<String> = h.lines.iter().map(|l| l.content.clone()).collect();
        assert_eq!(joined, orig);
        // Pure: same hunk, same cuts.
        assert_eq!(split_hunk(&h).len(), 3);
    }

    #[test]
    fn no_blank_cuts_at_the_mark() {
        let out = split_hunk(&added(&["x"; 81]));
        let lens: Vec<usize> = out.iter().map(|p| p.lines.len()).collect();
        assert_eq!(lens, [40, 40, 1]);
        out.iter().for_each(assert_consistent);
    }

    #[test]
    fn mixed_hunk_slices_keep_both_sides_right() {
        // Context, 45 deleted lines, 85 added, context; no blank near a mark.
        let mut lines = vec![line(' ', "ctx", Some(10), Some(10))];
        for i in 0..45 {
            lines.push(line('-', "old", Some(11 + i), None));
        }
        for i in 0..85 {
            lines.push(line('+', "new", None, Some(11 + i)));
        }
        lines.push(line(' ', "", Some(56), Some(96)));
        let h = DiffHunk {
            header: "@@ -10,47 +10,87 @@ fn f".into(),
            old_start: 10,
            old_lines: 47,
            new_start: 10,
            new_lines: 87,
            lines,
        };
        let out = split_hunk(&h);
        let headers: Vec<&str> = out.iter().map(|p| p.header.as_str()).collect();
        assert_eq!(
            headers,
            [
                "@@ -10,41 +10,1 @@ fn f",
                "@@ -51,5 +11,35 @@",
                // Only additions: the old range anchors on the line before.
                "@@ -55,0 +46,40 @@",
                "@@ -56,1 +86,11 @@",
            ]
        );
        out.iter().for_each(assert_consistent);
        let total: usize = out.iter().map(|p| p.lines.len()).sum();
        assert_eq!(total, h.lines.len());
    }

    fn piece(path: &str, n: u32) -> StoryPiece {
        let mut hunk = added(&["x"]);
        hunk.new_start = n;
        StoryPiece {
            path: path.into(),
            hunk,
        }
    }

    fn ids(pieces: &[StoryPiece]) -> Vec<u32> {
        pieces.iter().map(|p| p.hunk.new_start).collect()
    }

    /// A piece of `path` tagged by its `new_start`, with `(origin, content)` lines.
    fn coded(path: &str, n: u32, heading: &str, lines: &[(char, &str)]) -> StoryPiece {
        let mut p = piece(path, n);
        p.hunk.header = format!("@@ -1,1 +1,1 @@{heading}");
        p.hunk.lines = lines.iter().map(|&(o, c)| line(o, c, None, None)).collect();
        p
    }

    fn brief_json(v: serde_json::Value) -> Brief {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn from_briefs_resolution_rules() {
        let pieces = vec![
            coded("a.rs", 1, " fn shape()", &[('+', "pub struct Ledger {")]),
            coded(
                "a.rs",
                2,
                "",
                &[('+', "fn  record(&mut self,"), ('+', "  id: u32)")],
            ),
            coded(
                "a.rs",
                3,
                " fn retry()",
                &[(' ', "fn retry() {"), ('+', "skip(done);")],
            ),
            coded("a.rs", 4, "", &[('-', "old_call();")]),
            coded("a.rs", 9, "", &[('+', "tail();")]),
            coded("b.rs", 5, "", &[('+', "Ledger::new()"), ('+', "record(1)")]),
            coded("b.rs", 8, "", &[('+', "record(2)")]),
            coded("c.rs", 6, "", &[('+', "docs")]),
            coded("d.rs", 7, "", &[('+', "nobody")]),
        ];
        // Lead "Retry" is mid risk, so it reads before "Docs" despite file order.
        let docs = brief_json(serde_json::json!({
            "session": "docs", "intent": {"title": "Docs"},
            "intents": [{"title": "Tidy docs", "kind": "unrelated", "files": ["c.rs"]}],
            "story": {"approach": "Docs only.", "steps": [
                {"title": "Docs", "why": "w", "intent": "tidy docs", "code": ["c.rs"]},
                // Claimed by the earlier chapter first.
                {"title": "Late", "why": "w", "code": [{"file": "a.rs", "at": "struct Ledger"}]}
            ]}
        }));
        let mut retry = brief_json(serde_json::json!({
            "session": "retry", "intent": {"title": "Retry"},
            "intents": [{"title": "Never send twice", "type": "fix", "files": ["a.rs", "b.rs"]}],
            "story": {"approach": "Keep a ledger.", "steps": [
                // Whole file, but the anchored steps below take their pieces first.
                {"title": "Rest", "why": "w", "intent": "Never send twice", "code": ["a.rs"]},
                {"title": "Shape", "why": "w", "code": [{"file": "a.rs", "at": "pub struct Ledger"}]},
                // Whitespace and line breaks are ignored; matches pieces in a.rs only.
                {"title": "Record", "why": "w", "code": [{"file": "a.rs", "at": "fn record(&mut self, id: u32)"}]},
                // Changed lines lack it: falls back to the heading and context.
                {"title": "Retry", "why": "w", "code": [{"file": "a.rs", "at": "fn retry"}]},
                // Matches nothing, never widens: dropped.
                {"title": "Gone", "why": "w", "code": [{"file": "a.rs", "at": "fn vanished"}]},
                // Several matches in one file: all of them. A deleted line counts.
                // Pieces follow reference order, then diff order.
                {"title": "Use", "why": "w", "code": [{"file": "b.rs", "at": "record"}, {"file": "a.rs", "at": "old_call"}]}
            ]}
        }));
        retry.intents[0].tier = Some(Tier::Mid);
        let old = brief_json(serde_json::json!({
            "session": "old", "intent": {"title": "Old"}, "intents": [{"title": "x", "files": ["d.rs"]}]
        }));
        assert!(from_briefs(std::slice::from_ref(&old), pieces.clone()).is_none());

        let story = from_briefs(&[docs, old, retry], pieces).unwrap();
        assert!(!story.inferred);
        let chapters: Vec<&str> = story.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(chapters, ["Retry", "Docs"]);
        assert_eq!(story.approach, "", "several chapters carry their own");
        let got: Vec<(&str, usize, Vec<u32>)> = story
            .steps
            .iter()
            .map(|s| (s.title.as_str(), s.chapter, ids(&s.pieces)))
            .collect();
        assert_eq!(
            got,
            [
                ("Rest", 0, vec![9]),
                ("Shape", 0, vec![1]),
                ("Record", 0, vec![2]),
                ("Retry", 0, vec![3]),
                ("Use", 0, vec![5, 8, 4]),
                // Unrelated intent: last.
                ("Docs", 1, vec![6]),
            ]
        );
        let rest = &story.steps[0];
        assert_eq!(
            (
                rest.intent.as_deref(),
                rest.tier,
                rest.commit_type.as_deref()
            ),
            (Some("Never send twice"), Some(Tier::Mid), Some("fix"))
        );
        assert_eq!(story.steps[5].intent.as_deref(), Some("Tidy docs"));
        assert!(story.steps[5].side);
        assert_eq!(ids(&story.leftovers), [7]);
    }

    #[test]
    fn brief_story_travels_into_the_note_and_back() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let path = dir.to_str().unwrap();
        git(dir, &["init", "-q"]);
        fs::write(dir.join("a.rs"), "fn one() {}\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-qm", "root"]);
        fs::write(dir.join("a.rs"), "fn one() {}\nfn two() {}\n").unwrap();
        fs::write(dir.join("b.rs"), "fn three() {}\n").unwrap();
        fs::write(dir.join("c.rs"), "old style\n").unwrap();
        let wip = dir.join(".git/prefetch/wip");
        fs::create_dir_all(&wip).unwrap();
        fs::write(
            wip.join("agent.json"),
            serde_json::json!({
                "intent": {"title": "Add two and three"},
                "intents": [{"title": "Add two", "type": "feat", "files": ["a.rs", "b.rs"]}],
                "story": {"approach": "Two functions.", "steps": [
                    {"title": "Add three", "why": "First.", "intent": "Add two", "code": ["b.rs"]},
                    {"title": "Add two", "why": "Then.", "intent": "Add two", "code": [{"file": "a.rs", "at": "fn two"}]}
                ]}
            })
            .to_string(),
        )
        .unwrap();
        // Old format: no story; its file is a leftover.
        fs::write(
            wip.join("old.json"),
            r#"{"intent":{"title":"Old"},"intents":[{"title":"o","files":["c.rs"]}]}"#,
        )
        .unwrap();

        let titles = |s: &Story| s.steps.iter().map(|s| s.title.clone()).collect::<Vec<_>>();
        let live = read_worktree(path).unwrap().unwrap();
        assert_eq!(titles(&live), ["Add three", "Add two"]);
        assert_eq!(
            live.leftovers
                .iter()
                .map(|p| p.path.as_str())
                .collect::<Vec<_>>(),
            ["c.rs"]
        );

        // Commit only a.rs: the note keeps the step that points at it.
        git(dir, &["add", "a.rs", "c.rs"]);
        git(dir, &["commit", "-qm", "two"]);
        crate::git::brief::attach_wip(path, &[]).unwrap();
        let sha = git(dir, &["rev-parse", "HEAD"]);
        let note = crate::git::brief::read_note(path, &sha).unwrap().unwrap();
        let agent = note.iter().find(|b| b.session == "agent").unwrap();
        let steps = &agent.story.as_ref().unwrap().steps;
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].code[0].at, "fn two");
        assert!(note
            .iter()
            .find(|b| b.session == "old")
            .unwrap()
            .story
            .is_none());

        let told = read_commit(path, &sha).unwrap().unwrap();
        assert_eq!(titles(&told), ["Add two"]);
        assert_eq!(told.steps[0].intent.as_deref(), Some("Add two"));
        assert_eq!(
            told.leftovers
                .iter()
                .map(|p| p.path.as_str())
                .collect::<Vec<_>>(),
            ["c.rs"]
        );
        // The draft still covers uncommitted b.rs, story and all.
        let left = read_worktree(path).unwrap().unwrap();
        assert_eq!(titles(&left), ["Add three"]);
    }

    fn git(dir: &std::path::Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[test]
    fn pieces_of_a_real_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let path = dir.to_str().unwrap();
        git(dir, &["init", "-q"]);
        fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-qm", "root"]);
        let root = git(dir, &["rev-parse", "HEAD"]);
        assert_eq!(pieces(path, &root).unwrap().len(), 1);

        fs::write(dir.join("a.txt"), "one\n2\nthree\n").unwrap();
        let big: String = (1..=60)
            .map(|i| {
                if i == 30 {
                    "\n".into()
                } else {
                    format!("l{i}\n")
                }
            })
            .collect();
        fs::create_dir(dir.join("src")).unwrap();
        fs::write(dir.join("src/b.txt"), big).unwrap();
        fs::write(dir.join("bin.dat"), [0u8, 1, 2]).unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-qm", "two files"]);
        let sha = git(dir, &["rev-parse", "HEAD"]);
        assert_eq!(resolve(path, &sha[..8]).unwrap(), sha);
        assert!(resolve(path, "HEAD").is_err());

        let ps = pieces(path, &sha).unwrap();
        let got: Vec<(&str, &str)> = ps
            .iter()
            .map(|p| (p.path.as_str(), p.hunk.header.as_str()))
            .collect();
        assert_eq!(
            got,
            [
                ("a.txt", "@@ -1,3 +1,3 @@"),
                ("src/b.txt", "@@ -0,0 +1,30 @@"),
                ("src/b.txt", "@@ -0,0 +31,30 @@"),
            ]
        );

        // No note, so no story.
        assert!(read_commit(path, &sha).unwrap().is_none());
    }

    #[test]
    fn worktree_pieces_show_each_change_once() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let path = dir.to_str().unwrap();
        git(dir, &["init", "-q"]);
        // Unborn branch: a staged file is all new.
        fs::write(
            dir.join("a.txt"),
            "one\ntwo\nthree\nfour\nfive\nsix\nseven\n",
        )
        .unwrap();
        git(dir, &["add", "."]);
        let got: Vec<String> = worktree_pieces(path)
            .unwrap()
            .iter()
            .map(|p| format!("{} {}", p.path, p.hunk.header))
            .collect();
        assert_eq!(got, ["a.txt @@ -0,0 +1,7 @@"]);
        git(dir, &["commit", "-qm", "root"]);
        assert!(worktree_pieces(path).unwrap().is_empty());

        // a.txt: line 2 changed and staged, line 6 changed after; plus a new file.
        fs::write(
            dir.join("a.txt"),
            "one\nTWO\nthree\nfour\nfive\nsix\nseven\n",
        )
        .unwrap();
        git(dir, &["add", "a.txt"]);
        fs::write(
            dir.join("a.txt"),
            "one\nTWO\nthree\nfour\nfive\nSIX\nseven\n",
        )
        .unwrap();
        fs::write(dir.join("new.txt"), "fresh\n").unwrap();
        let status = get_status(path).unwrap();
        assert_eq!(status.iter().filter(|f| f.path == "a.txt").count(), 2);

        let ps = worktree_pieces(path).unwrap();
        let changed: Vec<String> = ps
            .iter()
            .flat_map(|p| {
                p.hunk
                    .lines
                    .iter()
                    .filter(|l| l.origin != ' ')
                    .map(|l| format!("{} {}{}", p.path, l.origin, l.content))
            })
            .collect();
        // Staged and unstaged edits in one hunk from HEAD, each once.
        assert_eq!(
            changed,
            [
                "a.txt -two",
                "a.txt +TWO",
                "a.txt -six",
                "a.txt +SIX",
                "new.txt +fresh"
            ]
        );

        // No draft tells a story.
        assert!(read_worktree(path).unwrap().is_none());
    }
}
