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
    "why": "Resetting a branch to its remote copy threw away uncommitted edits without any warning."
  },
  "intents": [
    {
      "title": "Set edits aside before a reset",
      "why": "Uncommitted edits are stashed first and restored afterwards, even when the reset fails.",
      "kind": "sub",
      "type": "fix",
      "tags": ["git ops", "data safety"],
      "files": ["src/stores/repo-store.ts"],
      "risk": {
        "shared": true, "data": false, "external": false, "contract": false,
        "tested": true, "oneWay": false,
        "why": "Every reset path now goes through the stash."
      }
    },
    {
      "title": "Share the diff-range logic between views",
      "kind": "enabling",
      "type": "refactor",
      "tags": ["diff view"],
      "files": ["src/lib/utils.ts"],
      "risk": { "shared": true, "tested": true }
    },
    {
      "title": "Fix typo in README",
      "kind": "unrelated",
      "type": "docs",
      "tags": ["docs"],
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
- **Describe the product change, not the process.** How the work came about (a code review, a failing check, a lint run, a release) is never an intent. A fix a review turned up is titled by what it fixes ("Never send a file twice on retry"), not "Fix review findings". If your edits correct work that another draft or a recent commit describes, take your lead intent from that work's goal.
- **Every file you changed belongs to exactly one intent.** Paths are repo-relative with forward slashes.
- **`kind`** is one of:
  - `sub`: a part of the lead goal.
  - `enabling`: a refactor that the lead goal needs.
  - `unrelated`: a separate concern that you did on the way.
- **`type`** is the conventional-commit type of that intent: `fix`, `feat`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `style`, `chore` or `revert`.
- **`tags`** are 1 to 3 short lowercase categories that place the intent in this project: the product area, domain or data it touches (for example `checkout`, `pricing data`, `auth`). They let a reader sort changes at a glance, so pick the names this project's people use. Reuse tags from the other drafts in `wip/` when they fit, so the same area keeps the same name. Do not repeat the `type` or the risk.
- **`risk`** answers fixed questions about that intent. Answer only from what you know; Prefetch derives the risk tier from these answers, so do not add your own rating. An omitted field means `false`.
  - `shared`: code you changed is used outside this change (other modules or callers).
  - `data`: it touches state that lives outside the repo: databases and their schema or migrations, user or save files, deployed production config. Files that ship from the repo (scenes, assets, prefabs, fixtures, content, settings files) are not `data`: reverting the commit restores them.
  - `external`: it has side effects outside the repo (network writes, emails, payments, form submissions).
  - `contract`: it changes a public API, CLI, file format, or protocol.
  - `tested`: tests that exercise it ran and passed in this session. Not "tests exist".
  - `oneWay`: `git revert` would not fully undo it (data already migrated or sent, published releases, deleted remote state).
  - `why`: one line naming the main concern. Leave it out when every answer is `false`.
- **Project rules.** Read the `guidance` in `.prefetch/risk.json` before you answer (see "Project risk guidance" below). Its `rules` pin tiers for paths; you do not apply them yourself.
- **Plain language.** Write every title and `why` for a teammate who has not seen the code or this conversation. Use everyday words and full sentences. Say what changes and why it matters, not how the code does it. Leave out function, file and variable names, ticket numbers and internal shorthand unless the reader needs them.
- **Keep it short.** Titles are about 8 words. A `why` is one or two sentences.
- **`issues`** is optional. Add an issue only if the work is tied to a tracker issue that you saw: one the user gave you, one in the branch name, or one from a tracker tool. Never invent IDs. If there is no issue, leave out the field. Add `criteria` only if you have the acceptance criteria.

## Project risk guidance

`.prefetch/risk.json` at the repo root tells everyone who answers the risk questions (agents and Prefetch) what they mean in this project. The user tunes it; it is committed so the team shares it.

If the file is missing, create it before your first draft:

- Read the project's agent instructions (`CLAUDE.md`, `AGENTS.md`), the README and the docs.
- Write `guidance` as plain sentences that answer, for this project: which state outside the repo counts as `data` (databases, user or save files, deployed config) and which repo files might look like it but are not; what counts as `external`; what counts as `contract`; and which areas the docs call critical.
- Add `rules` only for paths the docs say always need review. Tiers are `low`, `mid` or `high`.
- List the file in your draft as its own intent with `"kind": "unrelated"` and `"type": "chore"`.

Once the file exists, change it only when the user asks.

```json
{
  "guidance": "The production database and its migrations are data; seed files and fixtures in the repo are not. Writes to the billing API are external. Renaming a public API field is a contract change.",
  "rules": [{ "paths": ["migrations/**"], "tier": "high" }]
}
```

## If you commit yourself

After `git commit`, attach the brief to the commit, then delete the draft:

```
git notes --ref=prefetch add -f -F "$(git rev-parse --git-dir)/prefetch/wip/<slug>.json" HEAD
```
