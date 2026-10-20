# Hunk-level intents: tie each intent to the lines that realise it

Status: research / proposal. No code changed.

## 1. Problem, in today's code

- `Intent.files: Vec<String>` (`src-tauri/src/git/brief.rs`) is the only link between an intent and the diff. The Brief view (`brief-view.tsx` → `IntentCard` → `Files`) lists those paths, and clicking one opens the **whole** file diff (`selectFile` → `get_file_diff`). A new file shows every line (+108, +57, +109 in the Vault example), and the reader has to find the part that belongs to the intent.
- One file, several intents:
  - In the WIP view, `show_shared_once` hides the file under every claimant but one (the riskiest, then the newest). The other intent (often the fix) loses its code from the view, and it disappears entirely if that was its only file.
  - Commit notes keep every claim, so `read_note` → the commit Brief view shows the full file under each intent.
- The rule "every file belongs to exactly one intent" in `SKILL.md` breaks down when two sessions edit one file.
- A "fix" to code that was never committed is not a separate change. It is part of the feature that creates that code. Nothing detects this case today. `SKILL.md` only asks the agent to "take your lead intent from that work's goal".

Diff plumbing we can reuse:
- `parse::unified_diff` → `DiffHunk { old_start, new_start, lines: [DiffLine { origin, old_lineno, new_lineno }] }`.
- Line keys `hunkIdx:lineIdx` (`src/lib/diff-selection.ts`) and `generatePatch` (`src/lib/patch.ts`) → `stage_patch` (`git apply --cached --unidiff-zero`). Hunk and line staging from #5 has shipped.
- The Claude Code hook `docs/skills/prefetch-brief/hook.js` already runs on `PostToolUse` for `Edit|Write|MultiEdit|NotebookEdit`. It sees `session_id` and `tool_input`, and it knows which draft file belongs to the session. **This is the key lever.**

## 2. Prior art

| Tool | How it attributes hunks | Takeaway |
|---|---|---|
| git-absorb | Walks back through recent commits per staged hunk. The first commit the hunk does not *commute* with becomes the target. A hunk with no target stays staged, with a warning. [1] | Deterministic. Leaves ambiguous hunks unassigned and does not guess. |
| `jj absorb`, `sl absorb` | Move each change to the closest ancestor that last modified those lines (blame-like). An ambiguous change "will be left in the source revision" or working copy. [2][3] | Same as our "fold": a fix to lines another uncommitted change wrote belongs to that change. |
| git-ai | Agent hooks run `git ai checkpoint` after every Edit/Write. Each checkpoint diff is labelled AI or human and stored in `.git/ai`. On commit the checkpoints are condensed into a note on `refs/notes/ai`: `file → session → line ranges` (e.g. `session_1 1-8,10-21`). The note is rewritten on rebase and squash. [4][5] | Closest match to our setup: hooks give exact provenance, and ranges in commit coordinates go into a note. |
| Agent Trace (Cursor, RFC 0.1) | `files[].conversations[].ranges[] {start_line, end_line, content_hash}`. Lines "refer to positions at the recorded revision". Uses blame to map current lines, and `content_hash` for "position-independent tracking". [6][7] | Validates the note format: commit coordinates plus a content hash as a fallback. |
| CodeRabbit Change Stack | A model groups a PR into layers. Each layer anchors to line ranges, not files ("a layer can span directories"). The grouping is "fixed for a given snapshot" and can change on a re-run. [8][9] | The UI we want. Shows that model-assigned grouping is not stable across runs. |
| Graphite `gt split --by-hunk` | Manual, `add -p`-style selection per branch. [10] | Intent-to-hunk assignment doubles as a "commit this intent" tool. |
| SmartCommit (FSE'21), ColaUntangle, Atomizer (ICSE'26) | Graph or LLM partitioning of a tangled diff into groups of hunks. SmartCommit reaches a 71–84% median accuracy without a human. [11][12][13] | Inference alone is ~75% accurate, so it can only fill gaps, not be the source of truth. |

## 3. Data model

Options considered for an intent's reference into the diff:

| Reference | Survives further edits | Survives staging / partial commit | Stable in a note | Verdict |
|---|---|---|---|---|
| Hunk index (`"hunks": [0, 2]`) | No (indexes shift, and staged/unstaged split hunks) | No | No | Reject |
| Line ranges in working-tree coordinates | No (shifts with edits above, by any session) | Partly | n/a | WIP only, with re-anchoring. Fragile. |
| **Content hashes of the changed lines** | **Yes** (position-independent) | **Yes** (the same line has the same hash in either diff) | Larger, but OK | **WIP layer** |
| **Line ranges in the commit's own diff** | n/a (the commit is immutable) | n/a | **Yes**, as git-ai and Agent Trace do it | **Note layer** |
| Symbols (`fn send_file`) | Mostly | Yes | Yes | Optional hint only. Needs per-language parsing. |

Proposal: **two representations, one concept ("the lines an intent owns")**.

**WIP: provenance by content.** The hook appends one record per edit to `<git-dir>/prefetch/edits/<session_id>.jsonl`. It stores hashes, not code:

```json
{"t":1760950000123,"file":"services/vault.py","add":["3f9a1c2e04b1","9b0d77e1aa02"],"del":["77aa01c3f9e0"]}
{"t":1760950100456,"draft":"vault-retry-fix"}
```

- `add` and `del` hold the line hashes in `new_string` minus `old_string`, and the reverse. Both are multisets, so no diff algorithm is needed in the hook. For `Write`, every line of `content` counts as added.
- A hash is the first 12 hex digits of the git blob id of the whitespace-normalised line. Rust computes it with `git2::Oid::hash_object`, Node with `crypto` SHA-1, so no new crate is needed.
- The `draft` record links the session to its `wip/<slug>.json`. The hook already detects that write in `mark()`.

When Rust reads a file's diff, it hashes each `+` and `-` line and looks the hash up per file:

- **Owner of a line** = the session whose most recent edit added (or removed) that content.
- **Owning intent** = the intent in that session's draft that lists the file.
- Trivial lines (blank, `}`, `)`, `]`) take the owner of their neighbours. `ponytail:` the line-hash lookup can misattribute repeated non-trivial lines. Add blame-style ordering if that shows up.

Matching by content makes this independent of line shifts, staging, partial commits and concurrent sessions in one file.

**Notes: ranges in commit coordinates**, an additive field written by `attach_wip`:

```json
{
  "title": "Never send a Vault file twice on retry",
  "type": "fix",
  "files": ["services/vault.py", "tests/unit/test_vault.py"],
  "lines": {
    "services/vault.py": { "new": [[41, 58], [90, 92]], "old": [[39, 40]] },
    "tests/unit/test_vault.py": { "new": [[30, 57]] }
  }
}
```

- `new` holds post-image line numbers and `old` holds pre-image numbers, so pure deletions can be represented.
- A file in `files` but absent from `lines`, or a note with no `lines` at all, means the whole file. This is today's meaning, so every existing note stays valid.
- `Intent.lines` is `#[serde(default)]`. In WIP it is filled on read, like `tier`. In notes it is stored.
- `restricted_to` also narrows `lines`.
- Older Prefetch builds ignore the field when reading. They drop it if they rewrite the note (amend). That is acceptable.
- Optional `"hash"` per file (of the owned lines) lets a rebased commit detect drift and fall back to whole-file.

Unrelated issue found here: `write_note` sets `notes.rewriteRef` but not `notes.rewriteMode`. The default, `concatenate`, joins two JSON notes on a squash into an invalid note. Set `notes.rewriteMode=ignore` or merge the notes ourselves. File a separate issue.

## 4. Who assigns lines

| | A. Agent declares ranges | B. Model infers at Summarize | C. Hook provenance | D. Hybrid (C + fallbacks + B for the rest) |
|---|---|---|---|---|
| Accuracy | Poor. Agents edit by string replacement and never see final line numbers. Their own later edits and other sessions shift lines. | ~70–85% (untangling literature). Sees only the diff and guesses. | Exact for lines the agent's tools wrote | Exact where known, best effort elsewhere |
| Cost | Tokens every draft write, and the skill gets more complex | One call. Hunk ids add a little input; output is small. 100 KB diff cap (`MAX_DIFF_BYTES`). | ~0. One append per edit. | ~0, plus B only when there is something left |
| Freshness | Stale as soon as the agent edits again | Stale until the next Summarize | Live | Live |
| Concurrent sessions in one file | Breaks | Guesses | Natural (per-session logs) | Natural |
| Gaps | — | — | Bash/formatter edits, hand edits, agents without hooks, inferred brief | Covered by fallbacks |

**D, the fallback order per changed line:**

1. **Hook provenance.** The owning session's intent for that file.
2. **Only one claimant.** If exactly one intent lists the file, unattributed lines go to it. This is today's behaviour, now limited to the leftovers, and it covers formatter runs and hand edits in a file one agent owns.
3. **Summarize.** Hunks get ids (`h1`, `h2`, …) in the prompt (`ai.rs`, `brief_prompt`). The model returns `"hunks": [...]` per intent, for the inferred brief and for lines several intents claim. Prefetch converts the ids to hashes (WIP) or ranges (note). Agent provenance always wins over the model.
4. **Otherwise unassigned.** Shown as such, never guessed silently.

Optional, for one session splitting one file across two of its own intents (the skill forbids it today): the agent may write `{"path": "...", "at": ["send_file"]}`. Prefetch resolves the name to the hunk whose `@@ … @@ funcname` context, or whose added lines, contain it. Defer until someone needs it.

Other agents: Cursor and Codex have hook mechanisms too. I did not check whether their hook payloads include the edit text. Each would need its own small adapter that writes the same JSONL. Until then they get fallbacks 2–4. Prefetch could also read git-ai or Agent Trace data if it is present.

## 5. New files and follow-up fixes

- **A new file split between intents** needs nothing special under C. Session A's `Write` owns every line. Session B's `Edit`s own the lines they changed (last writer wins). Each intent shows its own lines.
- **Fold detection ("a fix to uncommitted code isn't a fix").** Intent *I* (session B) is a **follow-up** of intent *J* (session A) when every line *I* owns is an added line (not in HEAD) inside a block of added lines that *J* otherwise owns. For a new file, that block is the whole file.
  - The rule is deterministic, is computed on read, and works the same on a commit's own diff, so notes get it too.
  - The result is a derived `follows: "<session>#<intent title>"`, the same idea as the existing `joins`.
  - A fix to committed code never matches, because its lines replace lines that are in HEAD. So real fixes stay separate.
  - Effects:
    - The view nests *I* under *J* as "follow-up".
    - `prompt_context` merges *I* into *J*'s line, so the commit message does not get a separate `fix:` for code that never shipped.
    - *J*'s tier becomes the higher of *J*'s and *I*'s.
    - Summarize is told about the relation and may rewrite B's draft to take its lead from A, as the skill already asks.

## 6. UI (Brief view)

- **Intent card → Changes.** List files with the **owned** `+a −d` counts (`DiffStat` over owned lines, not the file).
- **Opening a file from an intent** gives "intent focus":
  - Only hunks that contain owned lines are shown.
  - Changed lines owned by another intent are dimmed, with a tooltip naming that intent.
  - A "Whole file" toggle returns to today's view.
  - Implemented by filtering `FileDiff.hunks` and passing an owned-line set. The WIP diff carries a per-line `owner` that Rust adds in `get_file_diff`. For a commit, the note's `lines` are used.
- **Unassigned lines.** A file appears under "Not in any brief" whenever any of its lines is unassigned, even if intents own the rest. The count shows only the unassigned lines.
- **A line claimed by two intents.**
  - With provenance this cannot happen (last writer wins).
  - It can happen only through fallback 2 or 3 in a file with several claimants. Show the hunk under each claimant, marked "shared with <intent>".
  - `show_shared_once` then only applies to files without line data, and can be deleted once Summarize assigns those lines.
- **Follow-ups** are nested under their parent intent, collapsed, with their own small focus diff.
- Later: an inline preview of the first owned hunk in the card (CodeRabbit-style), and **"Stage this intent"**, which maps owned lines to `hunkIdx:lineIdx` keys → `generatePatch` → `stagePatch`. With that, the Brief tab can split a tangled tree into one commit per intent, like `gt split --by-hunk` but with the grouping already done.

## 7. Interactions

- **Hunk/line staging (#5).** Ownership is by content, so staging does not affect it. "Stage this intent" reuses the existing patch path as it is.
- **Commit notes.**
  - `attach_wip` computes `lines` from the commit's parent→commit diff.
  - "Draft is done" moves from "none of its files are dirty" to "none of its *lines* are dirty". This fixes drafts lingering, or being deleted early, after partial commits.
  - Edit logs are deleted together with their draft.
- **Risk tiers.**
  - `Risk::tier` is unchanged.
  - `RiskRules::intent_tier` applies path rules only to files where the intent owns lines, so a file shared between two intents no longer pins both.
  - Follow-ups raise their parent's tier.
- **Summarize.**
  - "Unclaimed" moves from file-level (`wip_split().unclaimed`) to unassigned hunks, so lines an agent didn't write in its file finally get inferred.
  - Hunk ids in the prompt let the model assign lines. Its rewrites can't take lines an agent's provenance owns, the same rule `apply_summary` uses for files today.

## 8. Recommendation and rollout

Recommendation: **D (hybrid)**. Hook provenance is the source of truth for agent work, with the single-claimant fallback, then Summarize for the rest. Content hashes are used in WIP, and commit-coordinate ranges are stored in notes.

1. **Smallest step that fixes "whole file under every intent" (WIP only).**
   - `hook.js` `mark()` appends hash records to `edits/<session_id>.jsonl`.
   - Rust adds a per-line `owner` to `get_file_diff` and per-intent owned counts to `read_wip`, with a golden test of two sessions in one new file.
   - The Brief view shows owned counts and opens files in intent focus.
   - Unchanged: the draft format, the skill text agents follow, and notes.
2. **Fold detection.** `follows` is computed on read. The view nests follow-ups, and `prompt_context` merges them.
3. **Notes.** `attach_wip` writes `lines`, the commit Brief view uses them, and drafts are cleaned up per line. Fix `notes.rewriteMode`.
4. **Summarize assigns the rest.** Hunk ids in the prompt; the inferred brief and multi-claim lines get lines. Delete `show_shared_once`.
5. **"Stage this intent"**, and anchors for splitting one file within a session, only if needed.

## 9. Open questions

1. Is a Claude Code hook as the source of truth acceptable? Lines written by agents without a hook only get fallbacks 2–4. Should adapters for other agents (Cursor, Codex) be on the roadmap?
2. Should opening a file from an intent default to intent focus (only its hunks) or to the whole file with its lines highlighted?
3. Follow-ups: nest them automatically and drop them from the commit message, or only suggest the fold and let Summarize or the user confirm?
4. Hashes-only edit logs (no code under `.git/prefetch`): OK, or is storing the edited text for debugging worth it?
5. Notes: OK to add `lines` to synced notes (size, and older builds dropping it on amend)?
6. Last writer wins: when B edits A's uncommitted line and the result is not a pure follow-up, should the line count as B's (blame semantics, proposed) or stay A's?

## Sources

1. git-absorb — https://github.com/tummychow/git-absorb
2. jj CLI reference, `jj absorb` — https://docs.jj-vcs.dev/latest/cli-reference/
3. Sapling `sl absorb` — https://sapling-scm.com/docs/commands/absorb/
4. Git AI, how it works — https://usegitai.com/docs/cli/how-git-ai-works
5. Git AI 1.0 — https://usegitai.com/blog/introducing-git-ai
6. Agent Trace spec — https://agent-trace.dev/
7. Thoughtworks Radar, Agent Trace — https://www.thoughtworks.com/en-ca/radar/platforms/agent-trace
8. CodeRabbit Change Stack — https://docs.coderabbit.ai/pr-reviews/change-stack
9. CodeRabbit review — https://coderabbit.ai/blog/coderabbit-review-reads-a-pr-how-author-would-explain-it
10. Graphite squash/fold/split — https://graphite.com/docs/squash-fold-split
11. SmartCommit (ESEC/FSE 2021) — https://2021.esec-fse.org/details/fse-2021-papers/20/SmartCommit-A-Graph-Based-Interactive-Assistant-for-Activity-Oriented-Commits
12. ColaUntangle — https://arxiv.org/abs/2507.16395
13. Atomizer (ICSE 2026) — https://arxiv.org/abs/2601.01233
