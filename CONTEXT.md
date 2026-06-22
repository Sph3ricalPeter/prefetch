# Context — Domain & Architecture Glossary

> Shared vocabulary for Prefetch's git layer. Architecture reviews and design
> conversations use these terms exactly. Add a term here when a module is named
> after a concept that isn't yet defined.

## Git backend

**Git-invocation module** (`src-tauri/src/git/exec.rs`)
The single seam through which git CLI subprocesses run. Owns process spawning,
profile env injection, `index.lock` retry, hook-failure detection, and error
enrichment. Callers never construct a `Command` directly — they go through this
module so retry/error behaviour lives in one place.

**`run_git` vs `capture`**
Two functions on the invocation module for two intents.
- `run_git` — for **mutations** (commit, checkout, stash, merge…). Returns git's
  combined stdout+stderr as a human-facing string that may be surfaced in a
  toast (`"Done"` when empty).
- `capture` — for **reads** (`rev-parse`, `name-rev`, `symbolic-ref`, `log`,
  `for-each-ref`…). Returns **clean stdout only**. Read callers must use this so
  stderr warnings can't leak into parsed output. `capture_bytes` is the raw-bytes
  variant for binary blobs (`git show :2:file`) and size-guarded reads.
- `run_git_with_progress` — for long ops (fetch/clone/pull) that stream stderr
  progress to a callback.

**Git output parsers** (`src-tauri/src/git/parse.rs`)
Pure functions: text/bytes in, typed values out, no I/O. The parser interface is
the unit-test surface — exercised with fixture strings, never a real repo.
Includes porcelain-status parsing, unified-diff/hunk parsing, merge-message
branch extraction, and name-rev output sanitising.

**Porcelain parse**
Turning `git status --porcelain=v1` lines (the `XY path` columns) plus
`--numstat` line counts into `FileStatus` values, including the 7 conflict
combos (`UU` = both_modified, `AA` = both_added, …).

**Conflict reconstruction** (`src-tauri/src/git/conflict.rs`)
Rebuilding the state of an in-progress merge/rebase/cherry-pick for the conflict
editor: which content is base/ours/theirs, the commit ids, and the branch names.
Split into a **gatherer** (`gather` — the git calls and `.git/` reads, producing
a `ConflictFacts` in git's orientation) and a pure **conflict assembler**
(`assemble`, below).

**Ours/theirs swap**
The orientation rule the conflict assembler (`conflict::assemble`) applies.
During a rebase, git's stage 2 ("ours") is the branch being rebased *onto* and
stage 3 ("theirs") is the user's branch — inverted from the user's mental model —
so the assembler swaps them. During merge/cherry-pick, git's orientation already
matches the user. This swap is the app's main source of inversion bugs; it lives
in a pure function (`assemble`, fed a `ConflictFacts`) so it is testable with
fabricated facts — see the swap regression tests in `conflict.rs`.

## Forge

**Forge** — a code-hosting platform Prefetch talks to over HTTP: GitHub, GitLab,
or Bitbucket. Detected by classifying a remote's host.

**`ForgeProvider` seam** (`src-tauri/src/git/forge/`)
The established trait with one adapter per forge, dispatched centrally in
`forge/mod.rs`. This is a real, healthy seam — treat it as settled; don't
re-suggest "introduce a forge abstraction."
