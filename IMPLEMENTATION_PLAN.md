# Prefetch — Implementation Plan (v0.2+)

> Last updated: 2026-04-22
> Status: v0.3.0. Phases 1–4 complete (Phase 2 missing LFS pull/fetch). This document tracks remaining phases.

---

## What's Already Done

### Core (v0.1)
- ✅ Visual commit graph — Canvas API, virtualized, lane algorithm
- ✅ Branch list with checkout on click, smart remote branch tracking
- ✅ Fetch / pull / push with live progress indicators
- ✅ Force push with `--force-with-lease` + confirmation dialog
- ✅ Stage / unstage at file level
- ✅ Diff viewer (read-only, grouped hunks, plain HTML)
- ✅ Commit with message + description, amend
- ✅ Stash push / pop / drop
- ✅ Tag list — create, delete, push
- ✅ Cherry-pick, rebase, reset (soft / hard)
- ✅ Merge conflict detection + per-file Ours / Theirs resolution
- ✅ Discard changes (per-file or all)
- ✅ Undo via reflog (Ctrl+Z)
- ✅ Background auto-fetch (5 min interval)
- ✅ File watcher for instant UI refresh on `.git/` changes
- ✅ Context menus on commits (right-click)
- ✅ SQLite persistence — recent repos, UI state
- ✅ Recent repos list with quick-switch
- ✅ CI/CD — GitHub Actions, Windows NSIS + macOS DMG on tag push
- ✅ Windows console-window suppression for git subprocess calls

### Phase 1 — Distribution Cleanup ✅
- ✅ Version synced (`package.json` → `0.3.0`)
- ✅ Auto-updater plugin (`tauri-plugin-updater` in Cargo.toml + `package.json`)
- ✅ Updater registration in `lib.rs`
- ✅ Updater capability in `capabilities/default.json`
- ✅ Updater config in `tauri.conf.json` (endpoints → GitHub releases)
- ✅ Updater UI (`src/components/updater.tsx`) — auto-check on mount, download progress, restart prompt
- ✅ CI signing env vars in `.github/workflows/release.yml`

### Phase 2 — Git LFS Support ⚠️ (~85%)
- ✅ Rust module `src-tauri/src/git/lfs.rs` — version check, init, track/untrack, prune, ls-files, get-info
- ✅ Tauri commands `src-tauri/src/commands/lfs.rs` — 6 commands registered
- ✅ LFS types in Rust + TypeScript
- ✅ Frontend IPC wrappers, store actions (loadLfsInfo, initializeLfs, trackLfsPattern, untrackLfsPattern, pruneLfsObjects)
- ✅ LFS panel in sidebar (collapsible, three states: not installed / not initialized / initialized)
- ✅ LFS file badges in staging file list
- ✅ Performance optimization: fast-path check via `.git/config` read (<1ms for non-LFS repos)
- ❌ **Missing: `lfs_pull_objects` and `lfs_fetch_objects`** — no progress-streaming pull/fetch commands

### Phase 3 — GitHub / GitLab Integration ✅
- ✅ Rust module `src-tauri/src/git/forge.rs` — detect forge, parse remote URL, GitHub + GitLab API
- ✅ Tauri commands `src-tauri/src/commands/forge.rs` — 6 commands (get_forge_status, save/delete token, get PR, clear cache, open URL)
- ✅ Forge types in Rust + TypeScript (ForgeKind, ForgeConfig, PrInfo, ForgeStatus)
- ✅ OS keychain token storage via `keyring` crate (profile-scoped with legacy fallback)
- ✅ PR badge in branch list (lazy-loaded, tooltip with PR number + title, click opens browser)
- ✅ Forge settings modal (token entry, connection status, quick-link to GitHub/GitLab token page)
- ✅ Sidebar footer indicator (forge host + owner/repo + token status dot)
- ✅ PR cache with invalidation on fetch/pull
- ✅ `reqwest` for HTTP, `keyring` for secure storage, `open` for browser launch

### Phase 4 — Profiles & Identity ✅
- ✅ Database tables: `profiles`, `profile_paths` (auto-switch), `recent_repos.profile_id`
- ✅ Full profile CRUD in `src/lib/database.ts`
- ✅ Longest-prefix-match auto-switch (`matchProfileForRepo`)
- ✅ Rust commands `src-tauri/src/commands/profile.rs` — set/get active profile
- ✅ Git env var injection in `repository.rs` — GIT_AUTHOR_NAME/EMAIL, GIT_COMMITTER_NAME/EMAIL, GIT_SSH_COMMAND
- ✅ All git mutation commands pass profile env vars
- ✅ Profile-scoped forge tokens (per-profile keychain keys)
- ✅ Zustand profile store with persist/restore across sessions
- ✅ Profile switcher dropdown (sidebar footer) — avatar, name, email, default badge
- ✅ Profile management modal — create, edit, delete, path prefixes, SSH key path
- ✅ Identity badge in commit box — avatar, name, source (Local/Global/Profile)
- ✅ Gravatar integration for avatars
- ✅ Background fetcher restarts with new profile credentials on switch

---

## Phase Overview

| # | Phase | Priority | Status |
|---|-------|----------|--------|
| 1 | Distribution cleanup | 🔴 Ship blocker | ✅ Complete |
| 2 | Git LFS support | 🔴 High | ⚠️ ~85% — missing pull/fetch |
| 3 | GitHub / GitLab integration | 🟠 High | ✅ Complete |
| 4 | Profiles & Identity | 🟠 Medium | ✅ Complete |
| 5 | Diff & Staging overhaul | 🟡 Medium | Not started |
| 6 | Git Hooks UX | 🟡 Medium | Not started |
| 7 | Command Palette | 🟢 Polish | Not started |

---

## Phase 1 — Distribution Cleanup ✅ COMPLETE

> Goal: app can be installed and self-updates.

All items implemented. Updater checks on mount with 3s delay, shows download progress, prompts restart. CI pipeline produces signed installers for Windows (NSIS) and macOS (DMG, arm64 + x64).

**Remaining polish (optional):**
- Replace placeholder pubkey in `tauri.conf.json` with real signing key
- Test end-to-end update flow against a GitHub release

---

## Phase 2 — Git LFS Support ⚠️ ~85% COMPLETE

> Goal: game dev repos that use LFS don't silently corrupt. Show LFS status, allow managing tracked patterns, run `git lfs pull/fetch` with progress.

### What's done
- ✅ All architecture decisions implemented as specified
- ✅ `run_git`, `run_git_with_progress`, `git_cmd` made `pub(crate)`
- ✅ All LFS types in `types.rs` (Rust + TypeScript)
- ✅ `src-tauri/src/git/lfs.rs` — 8 functions: `lfs_version`, `is_lfs_initialized` (fast path via .git/config), `lfs_install`, `lfs_track_list`, `lfs_track`, `lfs_untrack`, `lfs_prune`, `lfs_ls_files`, `lfs_get_info`, `parse_lfs_size`
- ✅ `src-tauri/src/commands/lfs.rs` — 6 commands: `lfs_check_initialized`, `lfs_get_info`, `lfs_initialize`, `lfs_track_pattern`, `lfs_untrack_pattern`, `lfs_prune_objects`
- ✅ Frontend: types, IPC wrappers, store actions, `loadLfsInfo()` in `openRepository`
- ✅ `src/components/sidebar/lfs-panel.tsx` — collapsible, three states, deferred full load
- ✅ LFS file badges in `file-list.tsx`
- ✅ LFS indicator in sidebar footer

### What's missing

| Item | Files to change |
|------|-----------------|
| `lfs_pull()` function | `src-tauri/src/git/lfs.rs` — `git lfs pull --progress`, parse progress lines |
| `lfs_fetch()` function | `src-tauri/src/git/lfs.rs` — `git lfs fetch --progress`, parse progress lines |
| `lfs_pull_objects` command | `src-tauri/src/commands/lfs.rs` — call `lfs_pull` + emit `GIT_PROGRESS` events |
| `lfs_fetch_objects` command | `src-tauri/src/commands/lfs.rs` — call `lfs_fetch` + emit `GIT_PROGRESS` events |
| Register commands | `src-tauri/src/lib.rs` — add to `generate_handler!` |
| `lfsPullObjects` IPC wrapper | `src/lib/commands.ts` |
| `lfsFetchObjects` IPC wrapper | `src/lib/commands.ts` |
| `pullLfsObjects` store action | `src/stores/repo-store.ts` |
| `fetchLfsObjects` store action | `src/stores/repo-store.ts` |
| Pull / Fetch buttons in panel | `src/components/sidebar/lfs-panel.tsx` |

### Implementation notes
- Reuse `run_git_with_progress` from `repository.rs` — it already streams stderr progress lines as `GIT_PROGRESS` events
- LFS progress lines look like: `download 3/10 100 MB / 250 MB` — parse and emit as percentage
- Profile env vars must be passed through (for SSH key injection)

### Verification
- `git lfs install && git lfs track "*.png"` in a test repo
- Open in Prefetch → LFS panel shows tracked pattern + file count ✅
- Track a new pattern → `.gitattributes` updated ✅
- Pull LFS objects → progress toasts appear ❌ (not yet implemented)
- `cargo clippy -- -D warnings`, `npm run typecheck`, `npm run lint`

---

## Phase 3 — GitHub / GitLab Integration ✅ COMPLETE

> Goal: detect open PRs per branch, show badge in sidebar, click to open in browser. Securely store PATs per forge.

All items implemented. Key implementation details vs. original plan:
- Used native `keyring` crate (not `tauri-plugin-keyring`) — tokens stored directly in OS keychain from Rust, never exposed to frontend
- Tokens are **profile-scoped** (Phase 4 integration) — keychain keys use `<profile_id>/<host>` with fallback to legacy `<host>` keys
- Added `clear_pr_cache` command (not in original plan) for explicit cache invalidation on fetch/pull
- Supports both SSH and HTTPS remote URL parsing, including GitLab subgroups
- `reqwest::blocking` client (not async) to avoid overhead for short API calls

---

## Phase 4 — Profiles & Identity ✅ COMPLETE

> Goal: auto-switch git identity (name/email) and forge tokens by repo path. The "killer feature gap vs GitKraken."

All items implemented. Key implementation details vs. original plan:
- Database uses `profiles` + `profile_paths` tables (not `repo_profiles`) — `profile_paths` stores path prefixes for auto-switch, `recent_repos.profile_id` stores per-repo association
- Profile IDs are UUIDs (not autoincrement integers)
- Rust commands in `commands/profile.rs` (not `config.rs`) — `set_active_profile` + `get_active_profile`
- Identity commands (`get_git_identity`, `set_git_identity`) in `commands/repo.rs`
- Env var injection via `profile_env()` helper in `repository.rs` — all git mutations pass profile env
- `GIT_SSH_COMMAND` injection for SSH key paths (`ssh -i "{path}" -o IdentitiesOnly=yes`)
- Separate Zustand `profile-store.ts` (not in repo-store) — handles CRUD, auto-switch, session persistence
- Active profile persisted in `ui_state` table, restored on app startup
- Background fetcher restarts with new profile credentials on switch
- Gravatar integration for profile avatars
- Longest-prefix-match for auto-switch (SQL `LIKE` + `LENGTH` ordering)

---

## Phase 5 — Diff & Staging Overhaul

> Goal: syntax-highlighted diffs via Shiki, hunk/line staging via CodeMirror 6, proper merge conflict editor.

### 5A. Dependencies
```
@codemirror/view @codemirror/state @codemirror/language @codemirror/merge
@codemirror/commands shiki
```

### 5B. Read-only diff viewer (`src/components/staging/diff-viewer.tsx`)
- Replace current plain-HTML renderer with Shiki-highlighted unified diff
- Line numbers in both old/new columns
- Side-by-side toggle (split view: old left, new right)

### 5C. Hunk/line staging (CodeMirror 6)
- Interactive staging panel uses CodeMirror 6 (not Shiki)
- User clicks hunk header to stage/unstage the whole hunk
- User selects lines → "Stage selection" button
- New Rust command: `stage_hunk(file_path, patch)` → `git apply --cached`
- Frontend generates the patch string from selected hunk/line range

### 5D. Merge conflict editor (CodeMirror merge)
- Replace current Ours/Theirs button approach with `@codemirror/merge` three-way editor
- New Rust command: `get_conflict_versions(file_path)` → `{ base, ours, theirs }` via `git show :1:file`, `:2:file`, `:3:file`
- New Rust command: `resolve_conflict_with_content(file_path, content)` → write + `git add`

### Verification
- Open a staged file → Shiki-highlighted diff with line numbers
- Click hunk in interactive mode → hunk staged/unstaged
- Select partial lines → staged correctly
- Trigger merge conflict → three-way editor appears, resolve, verify file staged

---

## Phase 6 — Git Hooks UX

> Goal: when a git hook (pre-commit, pre-push, etc.) fails, show a clear notification with the hook name and its output — not a generic "Git error".

### 6A. New error variant (`src-tauri/src/error.rs`)
```rust
pub enum AppError {
    Git(String),
    HookFailed { hook_name: String, output: String },
    Io(#[from] std::io::Error),
    Other(String),
}
```

Serialized as `[hook:<name>] <output>` string prefix — non-breaking, frontend parses the prefix.

### 6B. Hook detection (`src-tauri/src/git/repository.rs`)

Add `detect_hook_failure(path, args, stderr) -> Option<String>`:
- Maps git subcommand to candidate hooks:
  - `commit` → `pre-commit`, `prepare-commit-msg`, `commit-msg`
  - `push` → `pre-push`
  - `merge` → `pre-merge-commit`
  - `rebase` → `pre-rebase`
- Checks `.git/hooks/<name>` for existence
- Also checks `core.hooksPath` config (handles husky, lefthook, pre-commit framework)

Modify `run_git` error path: if `detect_hook_failure` returns `Some(name)`, return `AppError::HookFailed` instead of `AppError::Git`.

### 6C. Frontend parsing (`src/stores/repo-store.ts`)
```typescript
function parseError(e: unknown): { type: "hook" | "git"; hook?: string; message: string } {
  const msg = String(e);
  const m = msg.match(/^\[hook:([^\]]+)\]\s*([\s\S]*)$/);
  return m ? { type: "hook", hook: m[1], message: m[2] } : { type: "git", message: msg };
}
```

Update commit/push/merge catch blocks:
```typescript
const err = parseError(e);
if (err.type === "hook") {
  toast.error(`Hook "${err.hook}" failed`, { description: err.message.slice(0, 300), duration: 10000 });
} else {
  toast.error(err.message);
}
```

### Verification
- `.git/hooks/pre-commit` that exits 1 with a message → distinct "Hook 'pre-commit' failed" toast
- husky-based repo (`core.hooksPath = .husky`) → hook detected correctly
- Normal git error (auth failure, network) → still shows as generic error (no false positives)

---

## Phase 7 — Command Palette

> Goal: `Ctrl+K` / `Cmd+K` opens a fuzzy-search command palette for keyboard-driven workflows (Linear-style).

### 7A. Command registry (`src/lib/command-registry.ts`)
```typescript
interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: "git" | "navigation" | "view" | "lfs" | "forge";
  action: () => void;
  enabled?: () => boolean;
}
```

Register all existing actions: fetch, pull, push, stash pop, stash push, checkout branch, create branch, undo, discard all, open repo, force push, pull LFS, connect GitHub, etc.

### 7B. Palette component (`src/components/ui/command-palette.tsx`)
- Modal opens on `Ctrl+K` / `Cmd+K` (global listener in `App.tsx`)
- Text input with debounced fuzzy filter (simple substring match first, can upgrade to fzf-style later)
- Results grouped by category
- Keyboard nav: arrow keys, Enter to execute, Escape to close
- Shows shortcut hint next to each item
- No external library needed — plain React + state

### 7C. Migrate inline shortcuts
- Move `useEffect` keyboard handlers from `graph-panel.tsx` (Ctrl+Z undo) and `commit-box.tsx` (Ctrl+Enter commit) into command registry
- Palette becomes the single source of truth for all keybindings

### Verification
- `Ctrl+K` opens palette
- Type "fetch" → fetch command appears, Enter triggers it
- Arrow keys navigate correctly
- Escape closes without action
- All previously-working keyboard shortcuts still work

---

## Key Files Reference

### Existing files (modified across phases)

| File | Phases | Status |
|------|--------|--------|
| `src-tauri/src/lib.rs` | 1, 2, 3, 4 — plugin registration + `generate_handler!` | ✅ Done |
| `src-tauri/src/git/repository.rs` | 2, 5, 6 — `pub(crate)` helpers, profile env, hook detection, hunk staging | ✅ (2), pending (5, 6) |
| `src-tauri/src/git/types.rs` | 2, 3 — LFS types, forge types | ✅ Done |
| `src-tauri/src/error.rs` | 6 — `HookFailed` variant | Pending |
| `src-tauri/src/commands/mod.rs` | 2, 3, 4 — module re-exports | ✅ Done |
| `src-tauri/Cargo.toml` | 1, 2, 3 — deps (updater, reqwest, keyring) | ✅ Done |
| `src/stores/repo-store.ts` | 2, 3, 5, 6 — state + actions | ✅ (2, 3), pending (5, 6) |
| `src/stores/profile-store.ts` | 4 — profile CRUD, auto-switch, session persistence | ✅ Done |
| `src/lib/commands.ts` | 2, 3, 4, 5 — IPC wrappers | ✅ (2, 3, 4), pending (5) |
| `src/types/git.ts` | 2, 3 — LFS + forge TS types | ✅ Done |
| `src/types/profile.ts` | 4 — profile TS types | ✅ Done |
| `src/App.tsx` | 1, 7 — updater mount, palette listener | ✅ (1), pending (7) |
| `package.json` | 1, 3, 5 — frontend deps | ✅ (1, 3), pending (5) |

### Files created in completed phases

| File | Phase | Status |
|------|-------|--------|
| `src-tauri/src/git/lfs.rs` | 2 | ✅ Created |
| `src-tauri/src/commands/lfs.rs` | 2 | ✅ Created |
| `src/components/sidebar/lfs-panel.tsx` | 2 | ✅ Created |
| `src/components/updater.tsx` | 1 | ✅ Created |
| `src-tauri/src/git/forge.rs` | 3 | ✅ Created |
| `src-tauri/src/commands/forge.rs` | 3 | ✅ Created |
| `src/components/ui/forge-settings.tsx` | 3 | ✅ Created |
| `src-tauri/src/commands/profile.rs` | 4 | ✅ Created |
| `src/components/ui/profile-switcher.tsx` | 4 | ✅ Created |
| `src/components/ui/profile-modal.tsx` | 4 | ✅ Created |

### Files to create in remaining phases

| File | Phase |
|------|-------|
| `src/lib/command-registry.ts` | 7 |
| `src/components/ui/command-palette.tsx` | 7 |
