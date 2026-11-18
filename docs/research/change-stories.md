# Change stories: read a change as ordered, narrated steps

> **Superseded in part (#93).** As built, a story is part of its Change Brief
> (`story` in the draft or note: steps that point at code by file and anchor
> text, placed on the current diff by `story.rs:from_briefs` on every read).
> Whatever writes a brief writes its story: the agent (the prefetch-brief
> skill), Summarize, and Generate brief on a commit, each rewriting every
> story it returns. The separate model-only story (numbered pieces,
> `generate_story`, a cache under `stories/` with a fingerprint and stale flag,
> a Story button and Regenerate) was built, then removed. Sections 4-6 and 8
> below describe that removed design; they are kept for the reasoning.

Status: built (#93), with the changes in the note above. Builds on `hunk-intents.md` (shelved) and
reopens its question of tying intents to parts of the diff, but for a different
job. A story only helps someone read the change. It decides nothing about who
owns which lines, what gets staged or what goes into a commit.

## 1. The reader's problem, against today's Brief view

What you get today (`brief-view.tsx` → `BriefCard` → `IntentCard` → `Files`):

- **The intents say why but not how.** A card has a title, a `why`, tags and risk. The plan for the code (which piece comes first, what calls what) is in nobody's text. The SKILL tells agents to leave out names and mechanism ("say what changes and why it matters, not how the code does it"), so the brief can't explain the code by design.
- **The order follows risk, not understanding.** `sortIntents` (`src/lib/brief.ts`) and `prompt_context` (`brief.rs`) put high risk first, then fix, then feat, with unrelated last. That is right for a commit message and for triage. It is wrong for reading: a refactor that enables the change (`kind: enabling`) often sorts after the feature that depends on it.
- **The file is the smallest unit.** Clicking a file opens the whole file diff (`selectFile` → `get_file_diff`) in the centre panel. A new file shows every line, and the reader has to find the part that matters and keep the intent's `why` in their head, since it is in the other panel.
- **The reading is a loop, not a scroll.** Read a card, open a file, scroll it, go back, open the next file. Nothing tells you the next file to open or why. With 4 intents and 15 files you lose the thread.
- **A file shared by intents** shows under one of them only (`show_shared_once`), or in full under each (commit notes). Either way the reader doesn't know which hunks serve which intent.
- **Files in the wrong panel.** The Brief sits in the narrow right panel (`detail-panel.tsx`), and the code is in the centre (`graph-panel.tsx` renders `DiffViewer` when `showDiff`). Reading means switching panels on every step.

What a story should be: one scroll in the centre panel that you read top to bottom once. Each block has a sentence or two of explanation, then the hunks it explains, and then the next block.

## 2. Prior art

| Tool | What it does | Takeaway |
|---|---|---|
| CodeRabbit Change Stack [1][2] | A model groups the PR into numbered layers, "a step a developer would recognize". A contract, its implementation and its tests are one layer. Layers are ordered "in the order someone would explain the change", roughly the order it was built. Summaries attach to line spans, not files. The grouping is "fixed for a given snapshot" and can change on a re-run. | The model to copy. Group by purpose, order by explanation, and anchor to spans. Expect it to change between runs. |
| Graphite Code Tours (Apr 2026) [3][4] | A guided walkthrough of a PR with the narration next to the diff. It also draws on the PR description and the review conversation. Details unverified (the blog post returned 404). | Narration and code sit in one view. |
| Cursor Code Tours [5] | "Reads the diff, groups related changes, and explains each group next to its code", "in the order that makes sense to review it". Length scales with the change. Written in the background when a PR opens and again on each push. An older version shows "Not in this version". | Regenerate on change, and label stale parts instead of hiding them. |
| Guided Review (OSS, Apache-2.0) [6][7] | An LLM clusters real hunks into "review units" with short commentary ("schema, then logic, then call-sites, then tests"). "Every displayed line comes from the actual diff, and invalid model references are discarded." Without a model it falls back to one unit per file. | Close to the proposal here: the model picks hunks, it never writes code, and its output is validated. |
| Gnosis [8] | A PR becomes an ordered slideshow. Changes are "grouped by theme and ordered by dependency (foundations first, then implementations, then tests and config)", and each slide has "a short explanation of *why* the change is there". It uses the Claude Code CLI. | Dependency order is the principle, and it runs on the same CLI Prefetch uses. |
| Stage (Show HN, 2026) [9] | AI "chapters" in reading order, each with what changed and what to double-check. Commenters said it "seems to exclusively surface 'what' changes" with no task context, and that AI narration can mislead. | Prefetch has the "why" that Stage lacks (agent briefs). The code must stay visible under the narration so the narration can be checked. |
| agent-change-walkthrough (skill) [10] | The agent writes one story of its own change: numbered steps, "dependency-first causality", no forward references, before and after code for each step, and "never include conversation process". | The agent-writes-it option. Its ordering rules are good. It writes prose files and has no link to the hunks. |
| GitHub Copilot PR summary [11] | A prose overview and a bulleted list of changes, each tied to files. It is generated on request and does not update on push. | A summary is not a reading order: the files stay in path order. |
| CodeTour (VS Code) [12] | Hand-written tours. Each step is anchored to a file and line, or to a regex `pattern` that "matches line content as opposed to ordinal". A tour pinned to a commit "will never get out of sync". | Anchor by content for moving code. A commit is a stable anchor. |
| Baum, Schneider, Bacchelli, ICSME 2017 [13]; Gonçalves et al. 2025 [14] | "An optimal order is mainly an optimal grouping of the change parts by relatedness." Reviewers "mostly navigate the files linearly following the order offered by the review tool". | The tool's order is the order people read in, so getting it right matters. Grouping matters more than the exact sequence. |

Untangling accuracy (SmartCommit 71–84%, ColaUntangle, Atomizer) is already in `hunk-intents.md` §2 and is not repeated here. See §5 for why it matters less now.

## 3. The story model

```
Story
  approach   1–2 sentences: how the change reaches its goal (the brief's lead says why)
  steps[]    ordered
    title    ≤ 8 words, says what this step does
    why      1–2 sentences (≤ 40 words): what it does and why the reader needs it before the next step
    intent   the intent it serves (title), or none for glue code
    pieces[] the parts of the diff it explains, possibly across files
```

- **A piece is the unit a step points at.** A piece is a hunk, or a slice of a big hunk. A hunk with more than about 40 changed lines (a new file is one hunk) is cut at the blank line nearest each 40-line mark. The rule looks only at the hunk itself, so an unchanged hunk always gives the same pieces. Without this, "one hunk" means "the whole new file", which is the complaint from `hunk-intents.md` §1. `ponytail:` blank-line cuts can split a function. Cut at top-level declarations if that shows up.
- **The ordering principle** is what makes this a story and not a set of clusters. Steps go in the order you would explain the change to a colleague: the data shape or contract first, then the logic that uses it, then the wiring (call sites, IPC, UI), then tests, then incidental changes. No step depends on a later one. Prior art agrees on this: Change Stack, Gnosis, agent-change-walkthrough and Guided Review all use some form of "foundations first".
- **Risk does not reorder the story.** A step takes the tier of its intent (`Intent.tier` is already derived on read) and shows it as a stripe and a chip. A line at the top, "Look closely: steps 2, 5", links to the steps with a high or mid tier. The risk-first order stays where it belongs, in the cards and the commit message.
- **Steps cut across intents, and intents do not contain steps.** Intents are sorted by risk, while a story follows dependency order. An `enabling` refactor is step 1 even when its intent sorts last. Nesting steps inside intent cards would bring back the wrong order. So there is one story for the whole change, and each step names one intent. Steps for `unrelated` intents go last, under "Side changes".
- **Text budget.** About 3–8 steps. The narration may name a type or function in backticks, because the code is right below it. This is the one place where the SKILL's "no names" rule is relaxed. The process rule still holds: never "addressed review findings".
- **A fix to uncommitted code disappears by construction.** The story is built from the final diff, so the broken version is never in it. Detecting a fold (`hunk-intents.md` §5) is not needed for reading.
- **The commit message does not change.** The message is a summary ranked by risk. The story is a reading path. Neither feeds the other.

## 4. Data model and storage

### References: one format everywhere

> **Superseded (#93).** References are a file plus optional anchor text (`at`) from the changed lines, matched whitespace-blind against the current diff. No piece ids, line hashes or patch-id keys.


| Reference | Survives edits | Survives staging / partial staging | Survives rebase | Size | Verdict |
|---|---|---|---|---|---|
| Piece id (`p7`) | No | No | No | Tiny | **Prompt only.** The model answers in ids, and Rust converts them right away. |
| Hash of a whole piece | Only untouched pieces | Whole-hunk staging yes, partial no | Yes | Small | Breaks when hunks merge or are partly staged |
| Line ranges in commit coordinates | n/a | n/a | No (lines shift) | Small | Only when a story has to travel in a synced note (§4 notes) |
| **Hashes of changed lines, per file** | **Yes** (changed lines go to "changed since") | **Yes** | **Yes** | ~13 bytes per changed line | **Recommended, for WIP and commits** |

The line hash is the one from `hunk-intents.md` §3: the first 12 hex digits of the git blob id of the line, with whitespace normalised (`git2::Oid::hash_object`, no new crate). One change: the origin (`+` or `-`) is hashed with the line, so an added line and an identical deleted line are different.

**Matching** is a pure function, `story::assign(pieces, steps) -> Vec<StepView>`:

1. For each current piece, count its non-trivial changed lines (not blank, not a lone bracket) whose hash some step holds in the same file.
2. The piece goes to the step with the most matches. A tie goes to the earlier step.
3. A piece with no matches goes to **"Changed since the story was written"** (WIP) or **"Not in the story"** (commit).
4. A step whose pieces all matched only partly is flagged "edited since".
5. A step left with no pieces is dropped.

This one function covers further edits, staging, hunks that merge, two diffs for a partly staged file, rebases, and the commit split in `attach_wip`. A failure always lands a piece in the visible leftover step, and a piece only lands in a wrong step through a duplicate non-trivial line. That `ponytail:` case is the same ceiling as in `hunk-intents.md`.

### Storage

> **Superseded (#93).** No story files. The story travels inside the brief: the WIP draft, then the commit's note, narrowed by `restricted_to` like the intents.


| Scope | Where | Key | Lifetime |
|---|---|---|---|
| Commit (phase 1) | `<git-dir>/prefetch/stories/<patch-id>.json` | `git patch-id --stable` of the commit | Local cache. Regenerated on demand. |
| Working changes (phase 2) | `<git-dir>/prefetch/story.json` | none (one per tree) | Replaced on regenerate. Split on commit. |

- **Not inside `wip/`.** `read_wip_files` (`brief.rs`) parses every `*.json` in `wip/` as a `Brief`, so a story file there would show as an "Ignored" error in the Brief view.
- **The patch-id key** means a rebase, cherry-pick or message-only amend that keeps the diff also keeps the story. Issue #85 already plans to store patch-ids. If the diff itself changed (a conflict was resolved), the key misses. The user regenerates, and the old file can be matched by hashes as a starting point. That reuse is deferred.
- **On commit (phase 2):** `attach_wip` runs `assign` against the commit's diff. Steps with matched pieces are written to `stories/<patch-id>.json`, and their pieces leave `story.json`. This is the line-level version of today's "a draft is done when none of its files are dirty".
- **Old notes** don't change. A commit with no cached story shows "Generate story" (§5).

### Notes: deferred

A story cache is local and can always be regenerated from the diff and the brief, which is fine for a solo developer. If stories ever need to travel (shared with a team, or synced between machines):

- Don't add them to the existing note. It is a `Vec<Brief>` (`NoteBody`), so a wrapping object would make older builds report "Invalid brief note" (`read_note`). Use a separate ref, `refs/notes/prefetch-story`, with its own `notes.rewriteRef` entry and its own sync refspec.
- Store line ranges plus a per-file hash there, not the line hashes, to keep synced notes small.
- First fix the gap from `hunk-intents.md` §3. I checked: this clone has `notes.rewriteRef=refs/notes/prefetch` and no `notes.rewriteMode`, so a squash concatenates two JSON notes into one invalid note. `gh issue list --search rewriteMode` found no issue for it.

## 5. Who writes the story

> **Superseded (#93).** Chosen: A, plus Prefetch whenever it writes a brief. Summarize returns a new story for every brief it shows (an agent brief whose intents stand comes back as `{"story": ...}`), and Generate brief does the same for a commit's briefs. The old story is input for the reasoning and order, not kept verbatim; a malformed story in a reply keeps the old one and never fails the summary or the message. There is no separate story call.


| | A. The agent writes it in its draft | B. The model writes it on demand (Summarize-style call) | C. B, with an outline from the agent |
|---|---|---|---|
| Knows the reasoning | Best. It did the work. | Only through the agent briefs it gets as input (Summarize already says "trust them for why") | Good |
| Knows the final hunks | No. It edits by string replacement and writes mid-work. Other sessions shift its code. | Yes, it sees the final diff | Yes |
| Several sessions in one tree | Each writes part of a story, and nobody orders them | One story over everything | One story |
| Cost | Tokens on every draft rewrite, a longer SKILL, and a hook nudge | One `claude -p` call: up to 100 KB of input (`MAX_DIFF_BYTES`), under 1k output tokens (estimate, unverified) | B, plus a few lines in the draft |
| Freshness | Stale on the next edit | Stale until regenerated, and the staleness is visible (§4) | Same as B |
| No agent brief | Nothing | Works from the diff alone, marked "inferred" | Same as B |
| Coverage guarantee | None | Deterministic: every piece shown exactly once | Same as B |

**Recommendation: B.**

- The reasoning that matters is already in the agent briefs (`why`, `risk.why`), and they go into the prompt. The model's job is the part the agent can't do well: ordering and narrating the final diff.
- Switch to C (an optional `outline: ["Add the ledger type", "Skip finished files on retry", ...]` in the draft, with no code references) only if phase 1 stories read as "what" without "why", the Stage complaint.

**The ~75% accuracy worry:** I agree it matters much less now, for three reasons.

- A misplaced hunk costs a moment of confusion. It does not misattribute ownership, mis-stage code or corrupt a commit.
- The literature number measures recovering the developer's own commit split exactly, which is a stricter task than "a sensible reading order".
- Validation guarantees completeness, so nothing goes missing even when the grouping is off.

The risk that remains is a confident narration over a hunk it doesn't describe ("only adds logging" over a behaviour change), with a reader who skims. Mitigations:

- The code is always rendered under its narration, and steps with a high or mid tier are never collapsed.
- The leftover step stays visible.
- Phase 1 does not use stories for staging or commit splitting. Accuracy matters again if "stage this step" is added (§9).

**Generation.** A new `ai.rs:generate_story`, built from the existing parts:

- `run_claude` makes the tool-less call.
- `STDIN_PROMPT` and `with_instructions` handle prompts too long for a command line.
- The brief context comes from `read_note` / `read_wip` and is rendered like `prompt_context`.
- The project `risk_guidance` is included.

What is new:

1. **Numbered input.** Rust builds the diff text itself from per-file `FileDiff`s and prefixes each piece, e.g. `=== p7 services/vault.py (unstaged) new 41-58 ===`. It does not pipe raw `git diff` as Summarize does. The pieces come from the same functions the viewer uses (`repository.rs:get_commit_file_diff`, `get_file_diff`, both CLI + `parse::unified_diff`), one call per changed file. That way the ids match exactly what is rendered, untracked files and root commits included. `ponytail:` one git process per file; batch into one `git diff` with a multi-file split if commits with hundreds of files make it slow.
2. **Output:** `{"approach": "...", "steps": [{"title", "why", "intent", "pieces": ["p3", "p7"]}]}`.
3. **Validation (pure, unit-tested):**
   - Unknown ids are dropped.
   - A piece named twice stays with the first step.
   - Empty steps are dropped.
   - An unknown intent title shows no chip.
   - Every piece no step names goes into "Not in the story".
   - Pieces cut off by the 100 KB cap go there too, marked "not seen by Claude (diff too large)".

**Why a separate call and not an extension of Summarize** (testing the hypothesis):

- Summarize's JSON already carries briefs, agent rewrites and the message. `apply_summary` writes drafts, so one bad story field there would fail the commit-message path.
- A story is for the whole diff, while the message is for the staged part.
- A commit story has no Summarize at all.

The plumbing is the same, so the cost is one more call. Phase 2 can start the story call in the background right after Summarize.

## 6. UI

> **Superseded (#93).** There is no Story button or Regenerate. The Brief tab is the story's table of contents: clicking a brief, intent, step or file opens that part in the centre panel. When no brief in view has a story, the Brief tab says so and points at Summarize (working changes) or Generate brief (a commit).


The story renders in the **centre panel** (diffs need the width). It sits where `graph-panel.tsx` shows the `DiffViewer`.

- The right-panel Brief tab gets a "Read as story" button in its header (or "Generate story" when there is none, gated on `claudeAvailable` like `GenerateBriefButton`).
- The intent cards stay as they are in phase 1, so the two can be compared.

```
┌ centre panel ───────────────────────────────────────────────────────────┐
│ Story · Never send a Vault file twice on retry   inferred? [↻] [×]     │
│ Retries skip files the server already has: the uploader keeps a list   │
│ of finished ids and checks it before each send.                         │
│ Look closely: 2                                                         │
│                                                                         │
│ 1  Keep a list of finished uploads              refactor: Share retry   │
│    The retry loop needs to know what already landed, so `send_file`    │
│    now returns the id it stored.                                        │
│    services/vault.py · +18 −2                          [open whole file]│
│    │ (read-only hunk lines, syntax highlighted)                         │
│    services/types.py · +4                                               │
│    │ ...                                                                │
│                                                                         │
│▌2  Skip finished files on retry          ● mid  fix: Never send twice   │
│▌   ...                                                                  │
│                                                                         │
│ ▸ Side changes (1)                         collapsed: unrelated intents │
│ ▾ Not in the story (2 parts)                         always expanded    │
└─────────────────────────────────────────────────────────────────────────┘
```

- **A step.** The number and title are in `text-sm font-medium`. The narration is `text-xs text-muted-foreground`. The intent chip is `text-label` with the tier stripe and colour from `TIER_META`, like `IntentCard`. File labels use Inter (`text-xs`), as `CLAUDE.md` requires for paths. Only the code is `font-mono`. The narration stays visible, and the code can be collapsed except on high and mid steps.
- **Reusing the diff viewer.** `DiffViewerBody` is a whole screen: it owns a scroll container, a toolbar, a minimap, selection and staging, and the Shiki effect. It can't be stacked. Extract the per-hunk rendering (the `diff.hunks.map(...)` block with `DiffLine` / `SideBySideHunk`, plus the per-hunk `highlightLines` effect) into a `HunkList` that both use.
  - A piece is passed in as a `DiffHunk` holding a slice of the original lines. `DiffLine` carries `old_lineno` and `new_lineno`, so the line numbers stay right. The header is rebuilt from the first line.
  - Unified and split mode follow `diffViewMode` as usual.
  - Phase 1 leaves out expanding context, line selection and staging.
- **Open whole file** calls the existing `selectFile` / commit file click, so the full `DiffViewer` replaces the story, and Back returns to it.
- **File lists.** In phase 1 the intent cards keep their collapsed "Changes" section. If stories prove themselves (phase 3), the Brief tab becomes the story's table of contents: each intent card lists its step titles, a click scrolls the centre story, and the file list leaves the card (the Files tab still has it). `show_shared_once` then only affects the cards.
- **Leftover pieces** go in "Not in the story" or "Changed since the story was written", at the end, expanded, with a count and a regenerate button. These pieces are where something could hide, so they are never collapsed.

## 7. Scope

| Scope | Diff stability | Brief input | Value | Order |
|---|---|---|---|---|
| A single commit | Immutable | The note (26 commits in this repo have one, checked with `git notes --ref=prefetch list`) | Reviewing agent commits, reading history | **First** |
| Working changes | Changes on every edit | WIP drafts | The highest: the review before you commit | Second |
| Branch or PR range | Immutable per head | The notes of every commit in the range | Reviewing a feature as a whole | Later (#87 "PR/branch roll-up later") |

**Commit first.**

- It tests the one question that matters (is a story easier to follow than the Brief?) without the hard part, staleness.
- It can be checked side by side on real commits that already have agent briefs.
- It reuses the `generate_brief` flow almost line for line.

Working changes bring in staleness, regeneration and the split on commit, and those are worth building only if the answer is yes. A range story is the same generator over `git diff base...head`, cached by (base, head). Its cost is prompt size, since 100 KB is reached quickly.

## 8. Rollout

> **Superseded (#93).** Phases 1-3 shipped in a different shape: commit and working-change stories both come from briefs, and the Brief tab is the table of contents. No cache, no `assign` by line hash, no split in `attach_wip` beyond narrowing the brief.


1. **Commit stories, local cache. Tests the idea.**
   - Rust: a new `git/story.rs` with these functions:
     - `pieces(repo, sha)` builds the pieces from `get_commit_file_diff` per changed path, with the 40-line split.
     - `assign` and `validate` are pure, with fixture tests: every piece appears once, the leftovers are right, a duplicate stays with the first step, truncated pieces are marked.
     - It reads and writes `stories/<patch-id>.json`.
   - `ai.rs:generate_story`. Commands `get_commit_story` and `generate_commit_story`.
   - Frontend: extract `HunkList`. A `StoryView` in the centre panel and a button on the commit Brief tab.
   - Cut: working changes, notes, agent outline, staging, context expansion, the table of contents, auto-generation.
   - **Exit test:** read 5 recent agent commits as a story and as today's Brief. Stories win if, after one pass, you can explain how each change works without opening a whole file for 4 of the 5. If they don't win, stop here. The cost was one module and one component extraction.
2. **Working-change stories.**
   - `pieces` for the working tree: staged and unstaged `get_file_diff`, plus untracked files.
   - `story.json`, and the "Changed since the story was written" step.
   - The split in `attach_wip`.
   - An optional background run after Summarize.
3. **Brief tab as table of contents.** Intent cards list their steps, and the file lists leave the cards. Fold the "call-path steps" part of #87 into this. Drop #87's pseudocode: the real code is already on screen.
4. **Range stories** for a branch against its base.
5. **Only if needed:** an agent outline in the draft (option C), a stories notes ref with sync, and "stage this step" through the existing `generatePatch` → `stagePatch` path.

### What this keeps, drops and changes from `hunk-intents.md`

| | |
|---|---|
| **Keeps** | The diff plumbing (`parse::unified_diff`, line keys, patch path). The line-hash definition. "Unassigned is shown, never guessed silently". Commit-coordinate ranges, but only for synced notes. The `notes.rewriteMode` finding. The prior-art table. |
| **Drops (for now)** | Hook provenance as the source of truth. `hook.js` still only records timestamps and the draft path (`mark()`), and the edit log was never built. Also dropped: a per-line `owner` in `get_file_diff`, owned counts, a separate "intent focus" mode (an intent's steps *are* its focus), fold detection, and "Stage this intent". |
| **Changes** | Model inference moves from the last fallback to the generator, because a reading aid doesn't need exact ownership. The unit is a piece (a hunk or a slice of one), not a line. Hashes become the one reference format for WIP *and* commits (keyed by patch-id). Before, there were two formats. |

## 9. Open questions

| # | Question | Recommendation | What would change it |
|---|---|---|---|
| 1 | Story beside the intent cards, or replacing them? | Beside them in phase 1, for the A/B comparison. Then the Brief tab becomes the table of contents (phase 3). | Stories losing the phase-1 test, or the owner reading only stories |
| 2 | A separate call or part of Summarize? | Separate (`generate_story`), with the same plumbing | Latency of two calls being annoying in practice. Then put both in one call, with the story parsed separately |
| 3 | Should the agent write an outline in its draft? | Not yet | Phase-1 stories explaining "what" but not "why" |
| 4 | Piece size: whole hunks or a 40-line split? | Split at blank lines past 40 changed lines, and tune the number | Steps that regularly cut functions in half |
| 5 | Leftover step collapsed or expanded? | Expanded, at the end | The model dropping so many pieces that the step is noise (then fix the prompt, don't hide the step) |
| 6 | Store stories in notes? | No. A local cache keyed by patch-id. | Needing stories on another machine or for a team. Then a separate notes ref, after the `rewriteMode` fix |
| 7 | Generate stories automatically? | On demand in phase 1. A background run after Summarize in phase 2. | Usage: if every commit gets opened as a story, generate one at commit time |
| 8 | A story with no agent brief? | Yes, from the diff alone, marked inferred | — |
| 9 | Diffs over 100 KB? | The pieces Claude didn't see are listed as such. Per-file summarising stays deferred (the existing `ponytail:` in `run_claude`). | Real commits regularly hitting the cap |
| 10 | Model for stories | The same `aiModel` setting as Summarize | Ordering quality being poor on small models (unverified, test haiku vs sonnet in phase 1) |
| 11 | Risk-first or story order? | Story order, with tier chips and a "Look closely" line | A high-risk step at the end being skipped in practice |

## Verified and unverified

- **Verified in code:**
  - `read_wip_files` parses every `wip/*.json`.
  - `sortIntents` / `prompt_context` put risk first.
  - `run_claude` truncates at `MAX_DIFF_BYTES`.
  - `suggest_commit_message` sends raw `git diff --cached` / `git diff` text plus untracked files.
  - `generate_brief` uses `git show` and `write_note`.
  - `get_file_diff` / `get_commit_file_diff` are CLI + `parse::unified_diff`, per file.
  - `DiffHunk` / `DiffLine` carry both line numbers.
  - `DiffViewerBody` owns its own scroll, toolbar, minimap and highlighting.
  - `BriefView` is in the right panel and `DiffViewer` in the centre.
  - `write_note` sets `notes.rewriteRef` only (the clone's config agrees).
  - `hook.js` has no edit log.
  - 26 brief notes are in this repo.
- **Unverified:**
  - Internals of the prior-art tools beyond their docs: the Graphite post returned 404, and the Guided Review README doesn't show its prompt.
  - The untangling accuracy numbers, carried over from `hunk-intents.md`.
  - Token and latency estimates.
  - Whether model size changes the ordering quality.
  - The effort of the `HunkList` extraction, which is judged from reading `diff-viewer-body.tsx`, not tried.

## Sources

1. CodeRabbit Change Stack docs — https://docs.coderabbit.ai/pr-reviews/change-stack
2. CodeRabbit, introducing Change Stack — https://www.coderabbit.ai/blog/introducing-change-stack-the-first-ai-native-code-review-interface
3. Graphite, Code Tours — https://graphite.com/blog/code-tours (404 when fetched)
4. Graphite Code Tours launch coverage — https://www.distillintelligence.com/news/graphite
5. Cursor Code Tours — https://cursor.com/docs/origin/code-tours
6. Guided Review — https://github.com/nshntarora/guidedreview
7. Guided Review listing — https://alternativeto.net/software/guided-review/about/
8. Gnosis — https://github.com/oddur/gnosis
9. Show HN: Stage — https://hn.svelte.dev/item/47796818
10. agent-change-walkthrough skill — https://skillselion.com/skills/cameroncooke/cameroncooke-skills/agent-change-walkthrough
11. GitHub Copilot PR summaries — https://docs.github.com/en/copilot/responsible-use/pull-request-summaries
12. CodeTour — https://github.com/microsoft/codetour
13. Baum, Schneider, Bacchelli, "On the Optimal Order of Reading Source Code Changes for Review", ICSME 2017 — https://tobiasbaum.github.io/rp/optimalordering.pdf
14. Gonçalves, Rani, Storey, Spinellis, Bacchelli, "Code Review Comprehension: Reviewing Strategies Seen Through Code Comprehension Theories", 2025 — https://arxiv.org/abs/2503.21455
