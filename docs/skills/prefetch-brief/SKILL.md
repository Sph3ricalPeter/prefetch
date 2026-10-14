---
name: prefetch-brief
description: Record WHY you are changing code as a Prefetch Change Brief draft, so the person who reviews and commits your work sees the intent, not just the diff. Use whenever you edit files in a git repository; keep the draft current as you work.
---

# Prefetch Change Brief

Prefetch (a git client) shows a "Brief" view of the working changes and uses it
to write the commit message. When the commit lands, the brief is stored as a git note
on that commit. The brief carries what the diff cannot: the goal and the reasons for it.

## Where

```
$(git rev-parse --git-dir)/prefetch/wip/<slug>.json
```

- `<slug>` is a short kebab-case name for your task, for example `stash-before-reset`. Use the same file for the whole session.
- The file is inside `.git/`, so it is never tracked. Do not stage it.
- Create the directories if they are missing.

## Other sessions

Several agents can work in the same working tree at once. Each one keeps its own draft.

- Before you write, read the other `*.json` files in the `wip/` folder.
- Never edit or delete another session's draft. `inferred.json` belongs to Prefetch; leave it alone too.
- List a file only if you changed it. If another draft already lists a file that you also changed, list it in your draft too.
- Write the draft with your file-writing tool, not with a shell command, so Prefetch can tell which draft is yours.

## When

- Write the whole file again after each meaningful batch of edits, and before you end your turn.
- If the file is gone, Prefetch used it for a commit. Write a new file that describes only the work that is still uncommitted.

## Format

```json
{
  "intent": {
    "title": "Never destroy uncommitted work on Reset to Remote",
    "why": "reset --hard ran over a dirty tree; double-clicking the remote twin of the current branch lost edits."
  },
  "intents": [
    {
      "title": "Route dirty resets through autostash",
      "why": "Stash, reset, then pop. Pop back if the reset fails.",
      "kind": "sub",
      "type": "fix",
      "files": ["src/stores/repo-store.ts"],
      "risk": {
        "shared": true, "data": false, "external": false, "contract": false,
        "tested": true, "oneWay": false,
        "why": "Every reset path now goes through the stash."
      }
    },
    {
      "title": "Extract resolveDiffRevs helper",
      "kind": "enabling",
      "type": "refactor",
      "files": ["src/lib/utils.ts"],
      "risk": { "shared": true, "tested": true }
    },
    {
      "title": "Fix typo in README",
      "kind": "unrelated",
      "type": "docs",
      "files": ["README.md"],
      "risk": {}
    }
  ],
  "issues": [
    { "id": "NL-123", "title": "Reset loses work", "url": "https://...", "criteria": ["Dirty tree is never reset without a stash"] }
  ]
}
```

## Rules

- **`intent`** is the lead goal. Write `why` from the user's request and the problem: what they asked for and what was wrong. Do not narrate the diff.
- **Every file you changed belongs to exactly one intent.** Paths are repo-relative with forward slashes.
- **`kind`** is one of:
  - `sub`: a part of the lead goal.
  - `enabling`: a refactor that the lead goal needs.
  - `unrelated`: a separate concern that you did on the way.
- **`type`** is the conventional-commit type of that intent: `fix`, `feat`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `style`, `chore` or `revert`.
- **`risk`** answers fixed questions about that intent. Answer only from what you know; Prefetch derives the risk tier from these answers, so do not add your own rating. An omitted field means `false`.
  - `shared`: code you changed is used outside this change (other modules or callers).
  - `data`: it touches persisted data, a schema, migrations, or production config.
  - `external`: it has side effects outside the repo (network writes, emails, payments, form submissions).
  - `contract`: it changes a public API, CLI, file format, or protocol.
  - `tested`: tests that exercise it ran and passed in this session. Not "tests exist".
  - `oneWay`: `git revert` would not fully undo it (data already migrated or sent, published releases, deleted remote state).
  - `why`: one line naming the main concern. Leave it out when every answer is `false`.
- **Project rules.** If the repo has `.prefetch/risk.json`, read its `guidance` before you answer. Its `rules` pin tiers for paths; you do not apply them yourself.
- **Keep it short.** Titles are about 8 words. A `why` is one or two sentences.
- **`issues`** is optional. Add an issue only if the work is tied to a tracker issue that you saw: one the user gave you, one in the branch name, or one from a tracker tool. Never invent IDs. If there is no issue, leave out the field. Add `criteria` only if you have the acceptance criteria.

## If you commit yourself

After `git commit`, attach the brief to the commit, then delete the draft:

```
git notes --ref=prefetch add -f -F "$(git rev-parse --git-dir)/prefetch/wip/<slug>.json" HEAD
```
