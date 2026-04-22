# Git Client Project Brief
> A GitKraken-UX, Linear-design, open source desktop git client. No subscription. Built with Tauri + Rust + React + shadcn/ui.

---

## What this is

A personal replacement for GitKraken — same UX intuitions, same commit graph layout, but built on a modern lightweight stack (Tauri instead of Electron), open sourced on GitHub, and designed to grow incrementally. The goal is to daily-drive it yourself and let it grow if others care.

Positioning: **"GitKraken UX, Linear design system, MIT licensed, no subscription."**

---

## Design direction

- **UI library**: shadcn/ui + Tailwind CSS
- **Design inspiration**: Linear's design system — clean, dense, monochrome-first, sharp typography, no gradients
- **NOT**: the typical purple-gradient AI slop aesthetic that most Electron git tools ship with
- **Theme**: Dark mode only. No light mode.
- GitKraken's layout is the UX reference — three-panel (left sidebar, center graph, right detail), not to be reinvented

---

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Desktop shell | **Tauri v2** (Rust) | ~10MB installer vs Electron's 150MB+, native webview, proper OS keychain access. Note: on Windows 10, WebView2 runtime (~150MB) may download on first launch (pre-installed on Win 11) |
| Git backend | **git CLI subprocess** (Rust) for mutations | Credential delegation just works, SSH agent just works |
| Git read ops | **git2-rs crate** | Fast status/log reads without spawning processes |
| Frontend | **React + TypeScript** | Ecosystem, CC familiarity |
| UI components | **shadcn/ui** | Unstyled primitives, full control, Linear-compatible |
| Commit graph | **Canvas API** (virtualized) | NOT React tree — mandatory for 50k+ commit repos without lag |
| Diff view (read-only) | **Shiki** | Same as t3.chat — VS Code grammar engine, zero client runtime, beautiful |
| Diff view (staging) | **CodeMirror 6** | Interactive hunk staging, syntax aware, ~150KB vs Monaco's 2-3MB |
| State | **Zustand** | Lightweight, no boilerplate |
| Local persistence | **SQLite via Tauri plugin** | Repo list, UI state, cached git status — load from cache first, reconcile async |

### Why Tauri over Electron

GitKraken uses Electron which is why it's sluggish on startup and on large repos. Tauri uses the OS webview (WKWebView on macOS, WebView2 on Windows) and Rust for all subprocess work. The UI never blocks on git ops — Rust spawns the process, streams progress events to React via IPC. Result: the slowest thing is git itself, not the app.

### Shiki vs CodeMirror — when to use each

- **Shiki** → read-only diff views (commit history, PR review panel). Lightweight, renders highlighted HTML, no JS runtime.
- **CodeMirror 6** → interactive staging panel where the user clicks hunks/lines to stage. Also for the conflict resolution picker. ~150KB (vs Monaco's 2-3MB), extensible, used by GitHub.com.

---

## Architecture: Tauri IPC boundary

```
React UI  ←──── Tauri IPC (commands + events) ────→  Rust backend
   │                                                        │
   │  invoke('git_status')                                  │  git2-rs (fast reads)
   │  invoke('git_commit', {message})                       │  git CLI subprocess (mutations)
   │                                                        │  Keychain API (credentials)
   │  listen('fetch_progress', handler)                     │  Background fetch thread
   │  listen('repo_changed', handler)                       │  File watcher (notify crate)
```

Key principle: **all git operations are async**, fired from Rust, progress streamed to React as events. The UI never blocks.

### Background heartbeat (from lazygit's pattern)

A Rust background thread runs `git fetch --all` on a configurable timer (default: every 5 minutes) and emits a `repo_changed` event to the frontend. The file watcher (using the `notify` crate) fires `repo_changed` on any `.git/` change. React subscribes to this event and refreshes affected panels. This is what makes the UI feel live without a manual refresh button.

### git2-rs caveats

- No support for partial clones, sparse checkouts, commit-graph file acceleration, multi-pack-index
- `Repository` is not `Send`/`Sync` — wrap in `tokio::sync::RwLock` for concurrent access (background fetch thread vs UI-triggered reads)
- Credential callbacks are fragile compared to CLI delegation — fall back to CLI for reads when git2-rs fails
- In practice the CLI/git2-rs boundary will be blurrier than the clean split implies — design for graceful fallback

---

## Feature scope

### What shipped (v0.1 → v0.3)

> Original version boundaries didn't hold — features shipped faster than planned. Current release: **v0.3.0**.

**Core (originally v0.1):**
1. ✅ **Commit graph** — Canvas API, virtualized, lane algorithm
2. ✅ **Branch list** — checkout on click, smart remote tracking
3. ✅ **Fetch / pull / push** — with live progress indicators
4. ✅ **Stage / unstage files** — file-level (hunk staging deferred to diff overhaul)
5. ✅ **Diff viewer** — read-only, plain HTML with grouped hunks (Shiki deferred to diff overhaul)
6. ✅ **Commit** — message + description, amend
7. ✅ **Stash** — push / pop / drop

**Shipped beyond original MVP:**
8. ✅ **Tags** — create, delete, push
9. ✅ **Cherry-pick & rebase** — cherry-pick, non-interactive rebase, reset (soft/hard)
10. ✅ **Undo** via reflog (Ctrl+Z)
11. ✅ **Merge conflict** — detection + per-file ours/theirs resolution
12. ✅ **Force push** — `--force-with-lease` + confirmation dialog
13. ✅ **Auto-updater** — check on mount, download progress, restart prompt, CI signing
14. ✅ **GitHub / GitLab PAT** — OS keychain storage, per-profile tokens, PR badges on branches
15. ✅ **Profiles** — full CRUD, auto-switch by repo path, SSH key injection, env var identity
16. ⚠️ **Git LFS** — initialize, track/untrack, prune, file badges (~85%, missing pull/fetch with progress)

**Infrastructure:**
- ✅ Background auto-fetch (5 min)
- ✅ File watcher for `.git/` changes
- ✅ SQLite persistence (repos, UI state, profiles)
- ✅ CI/CD — GitHub Actions, Windows NSIS + macOS DMG
- ✅ Windows console-window suppression

Errors surfaced via **toast notifications** (bottom-right). Auth failures, push rejections, merge conflicts — all toasts.

One repo at a time with recent-repos quick-switch. Tabbed multi-repo is a future consideration.

### Next up

17. **LFS pull/fetch** — complete the remaining 15% of LFS (pull/fetch with progress streaming)
18. **Diff & staging overhaul** — Shiki for read-only diffs, CodeMirror 6 for hunk/line staging, merge conflict editor upgrade
19. **Git hooks UX** — detect hook failures, show hook name + output in toast (not generic error)
20. **Command palette** (Cmd+K) — fuzzy-search all actions, keyboard-driven workflows

### Future

21. **GitHub/GitLab OAuth** — upgrade from PAT to OAuth per profile (requires app registration)
22. **Branch divergence indicators** — ahead/behind counts in branch list
23. **Remote management** — add, remove, rename remotes
24. **Git config editor** — global and local, UI for user.name / user.email / default branch

### Explicitly out of scope (not even v1)

- Interactive rebase with commit reordering
- Worktrees UI
- Bitbucket / Azure DevOps
- AI commit messages (easy to add later via Anthropic API)
- Team collaboration / cloud workspaces
- Jira / Linear deep integration (opening a PR that already has a Linear link is enough)

---

## Profiles spec (work / personal)

This is the feature that replaces a GitKraken paid subscription for multi-account developers.

### What a profile stores
- `user.name` and `user.email` for git commits
- SSH key path preference
- GitHub OAuth token
- GitLab OAuth token (if used)
- List of repo paths belonging to this profile

### Auto-switch behavior (killer feature)
When opening a repo, the app checks the repo path against each profile's path list and **automatically activates the matching profile**. GitKraken makes you manually switch; this should be invisible.

Example:
```
~/work/     → activates Work profile (work email, work GitLab token)
~/personal/ → activates Personal profile (personal email, GitHub token)
```

### Implementation notes
- Credentials stored in OS keychain via Tauri's `keyring` plugin (not plaintext)
- Git operations run with the active profile's `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_EMAIL`, and credential helper env vars injected per-command
- Profile switcher always visible in the header/toolbar as a quick escape hatch

---

## Undo spec (reflog-based, from lazygit)

### How it works
Parse `git reflog` on each operation. On undo:
- If last reflog entry = branch checkout → checkout the previous branch
- If last reflog entry = commit applied → reset to parent commit
- If last reflog entry = merge/rebase → `git reset --hard ORIG_HEAD`

### Limitations (communicate clearly in UI)
- Cannot undo working tree changes (not in reflog)
- Cannot undo stash operations
- Cannot undo pushes to remote
- Cannot undo branch creation (not in reflog)

### Implementation
This is all reflog parsing in Rust + a single `git reset` / `git checkout` command. No custom state machine needed. The reflog IS the undo history. Since it reads the actual git reflog, undo works even for operations the user ran directly in terminal — which is a feature, not a limitation.

---

## Commit graph implementation

This is the hardest single piece. Key decisions:

### Canvas, not React
Do NOT use React tree nodes for graph commits. At 10k+ commits the DOM is unusable. Use a virtualized Canvas:
- Only render commits visible in the current viewport
- Calculate first/last visible row from scroll position via integer division
- Redraw on scroll, resize, repo change

### Lane layout algorithm
GitKraken uses **straight lines** (not curved like SourceTree). Reference: pvigier's master thesis at `pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html` — the canonical algorithm for topological sort + lane assignment.

Key concepts:
- Commits sorted in topological order (not just chronological)
- Each commit gets a column (lane) assigned based on its branch/merge children
- "Branch child" = child that continues or starts a branch
- "Merge child" = child that ends a branch via merge
- Lanes are straight vertical lines; merges are diagonal connectors

### Performance targets
- Open a repo with 100k commits: graph renders in < 500ms
- Scroll through 10k commits: no dropped frames
- `git status` refresh: < 100ms (use git2-rs, not CLI subprocess)

### Canvas interaction layer

- Hit-testing: row-based Y-coordinate lookup (integer division from scroll position — same math as virtualization)
- Hover: tooltip with full commit message, author, date, SHA
- Click: select commit → populate right detail panel
- Right-click: context menu (checkout, cherry-pick, reset to here, copy SHA)
- Multi-select: shift-click for range (cherry-pick range, diff between two commits)

### Diff algorithm

Default to **histogram** diff algorithm (produces cleaner diffs for code than Myers default). Expose as a setting.

---

## Open PR detection

Per branch, check if a PR/MR exists on GitHub or GitLab:

```
GitHub:  GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open
GitLab:  GET /projects/{id}/merge_requests?source_branch={branch}&state=opened
```

Cache the result per branch (invalidate on fetch). Show a small PR icon badge next to the branch name in the left panel and in the graph. Clicking it calls `open_in_browser(pr_url)` — that's the entire PR integration. No PR creation UI, no PR review UI, no comment threads.

---

## Reference projects

### GitButler (study architecture, not UX)
- Repo: `github.com/gitbutlerapp/gitbutler`
- Stack: Tauri v2 + Rust backend + Svelte frontend (you'd use React)
- Why relevant: Their Rust IPC patterns, `git2-rs` usage, subprocess wrappers for push/fetch, and credential handling are exactly what you're building. Their UX is a completely different workflow (virtual branches) — ignore the product, study the plumbing.
- License: Fair Source (can study, can't compete with it directly)

### pvigier's commit graph algorithm
- URL: `pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html`
- Read this before writing a single line of graph code. It's a master thesis chapter that documents the lane assignment algorithm, virtualized canvas rendering, and the edge-visibility problem for long-running branches. GitKraken's straight-lane layout is described and compared here.

### DoltHub commit graph (2024)
- URL: `dolthub.com/blog/2024-08-07-drawing-a-commit-graph/`
- Modern React+Canvas implementation. They built their own after gitgraph.js proved too limited. Good reference for the React-side wiring.

### Lazygit (study undo + auto-fetch patterns only)
- Repo: `github.com/jesseduffield/lazygit`
- It's a TUI in Go — completely different product. But:
  - Their reflog-based undo is the exact implementation to copy (see `docs/Undoing.md`)
  - Their auto-fetch + auto-refresh config pattern is the right background heartbeat model
  - Their "open PR in browser" (branch panel icon + `o` key) is the exact scope of PR integration you want

### t3.chat (design + local-first patterns)
- Shiki for syntax highlighting (same package Theo uses) — dramatically faster than `react-syntax-highlighter` for code rendering
- Local-first architecture: load from SQLite cache immediately, reconcile with live data async. Apply this to repo state, branch list, recent repos.
- The Cloneathon submissions (github.com/T3-Content/t3-cloneathon) are a live reference for polished shadcn apps at production quality

---

## Build approach (Theo's t3.chat model)

Start with the smallest version you'll actually use daily. Open source from day one. Build what you need in the order you need it. Let others contribute features you don't care about.

### Day 1 repo setup checklist
- [ ] Tauri v2 + React + TypeScript scaffold (`create-tauri-app`)
- [ ] shadcn/ui initialized with Tailwind
- [ ] `ARCHITECTURE.md` in repo root (critical for CC session continuity — describes the IPC boundary, Rust command structure, React component tree)
- [ ] GitHub Actions: build on push, release artifacts on tag
- [ ] (Optional) Tauri updater plugin — for future distribution. Not needed while building/running locally
- [ ] README with clear positioning: "GitKraken UX, Linear design, MIT, no subscription"

### ARCHITECTURE.md matters for Claude Code
CC loses context between sessions. A tight `ARCHITECTURE.md` that describes:
- Where Rust commands are defined (`src-tauri/src/commands/`)
- How IPC events work
- The React component tree structure
- Which operations use git2-rs vs CLI subprocess

...prevents CC from making inconsistent decisions about where logic lives across sessions. GitButler has this in their repo — worth copying the pattern.

### Feature build order
```
1. Repo open + commit graph (Canvas, virtualized, interaction layer)  ✅
2. Branch list + checkout                                             ✅
3. Fetch / pull / push with progress + error toasts                   ✅
4. Stage/unstage + diff (plain HTML) + commit                         ✅
5. Stash                                                              ✅
── ship v0.1 ──
6.  Tags (create, delete, push)                                       ✅
7.  Cherry-pick & non-interactive rebase                              ✅
8.  Undo via reflog                                                   ✅
9.  Merge conflict detection + per-file ours/theirs                   ✅
10. Force push with --force-with-lease                                ✅
11. Auto-updater + distribution cleanup                               ✅
12. Forge integration (GitHub/GitLab PAT, open PR)                    ✅
13. Git LFS support (manage patterns, status)                         ⚠️ ~85% (missing pull/fetch)
14. Profiles (work/personal) with auto-switch                         ✅
── current: v0.3.0 ──
15. LFS pull/fetch with progress
16. Diff & staging overhaul (Shiki + CodeMirror + hunk/line staging)
17. Git hooks UX (clear hook failure notifications)
18. Command palette (Cmd+K)
── ship next ──
19. GitHub/GitLab OAuth (upgrade PAT → OAuth per profile)
20. Branch divergence indicators
21. Remote management
22. Git config editor UI
── future ──
```

---

## Competitive gap this fills

| Tool | Problem |
|---|---|
| GitKraken | $5/mo subscription, Electron (slow), closed source |
| GitButler | Different workflow entirely (virtual branches), not GitKraken UX |
| GitHub Desktop | Intentionally limited, GitHub-only |
| Sourcetree | Mac/Windows only, Atlassian-owned, stagnating |
| Fork | Not open source, $50 one-time but no Linux |
| Sublime Merge | Good performance but minimal UI, no profile management |

**The gap**: MIT licensed, Tauri-fast, GitKraken-familiar UX, Linear-quality design, profile management for multi-account devs. Nobody has built this.
