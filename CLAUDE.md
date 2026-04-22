# CLAUDE.md - Prefetch Development Rules

**This file governs how Claude Code works with this codebase.**

## Project Overview

Prefetch is a desktop git client built with Tauri v2 + Rust + React + TypeScript + shadcn/ui.
See `GITCLIENT_PROJECT_BRIEF.md` for full product spec, tech stack decisions, and feature roadmap.

**Positioning**: GitKraken UX, Linear design, MIT licensed, no subscription.

## Working Rules

### Ask Or Search The Web Before Assuming
- There is no rush, best solutions take time and discussion
- Ambiguous requirements -> ASK
- Gap in documentation -> ASK
- Odd/inconsistent existing implementation -> ASK
- When asked for "best practices" or "latest" -> SEARCH THE WEB
- Multiple approaches -> ASK which to use
- Can't find something you expect to exist -> ASK before creating it

### Task Tracking — GitHub Issues
- **GitHub Issues are the single source of truth for TODOs.** No local TODO files.
- Issues are organized with **milestones** (v0.4.0, v0.5.0, v1.0.0) and **labels** (priority, area, type).
- Before starting work, check `gh issue list --milestone <version>` for the current backlog.
- When finishing a feature, close the issue via commit message (`Closes #N`) or `gh issue close N`.
- When discovering new work during implementation, create an issue with `gh issue create` — don't just leave a TODO comment.
- Reference issues in commit messages (e.g. `feat: add LFS pull with progress (#1)`).

### Code Standards
- **Rust**: Follow `cargo clippy` and `cargo fmt` conventions. No `unwrap()` in production code — use proper error handling with `thiserror` or `anyhow`.
- **TypeScript/React**: Strict mode. No `any` types. Functional components only. Use Zustand for state.
- **CSS**: Tailwind only via shadcn/ui. No inline styles, no CSS modules, no styled-components.
- **Naming**: Rust = snake_case. React components = PascalCase. Files = kebab-case for TS, snake_case for Rust.

## Architecture Quick Reference

```
src/                    # React frontend
  components/           # React components (shadcn/ui based)
    layout/             # App shell, sidebar, panels
    sidebar/            # Branch list, stash list, tag list, LFS panel
    staging/            # File list, diff viewer, commit box
    graph/              # Commit graph (Canvas)
    ui/                 # Shared UI: forge settings, profile switcher/modal, settings modal, etc.
  hooks/                # Custom React hooks
  stores/               # Zustand stores
    repo-store.ts       # Main repo state (git ops, forge, LFS)
    profile-store.ts    # Profile CRUD, auto-switch, session persistence
  lib/                  # Utilities, IPC wrappers
    commands.ts         # All Tauri invoke wrappers (typed)
    database.ts         # SQLite ops (repos, profiles, UI state)
  types/                # TypeScript types
    git.ts              # Git + forge + LFS types
    profile.ts          # Profile types

src-tauri/
  src/
    main.rs             # Tauri entry point
    lib.rs              # App setup, plugin registration, generate_handler!
    commands/           # Tauri IPC command handlers (one file per domain)
      mod.rs            # Re-exports all command modules
      repo.rs           # All git operations (status, commit, push, fetch, etc.)
      lfs.rs            # LFS commands (init, track, prune, etc.)
      forge.rs          # GitHub/GitLab PAT, PR lookup, open URL
      profile.rs        # Active profile get/set
    git/                # Git abstraction layer
      mod.rs
      repository.rs     # git2-rs wrapper, CLI subprocess runner, profile env injection
      graph.rs          # Commit graph algorithm (topological sort, lane assignment)
      types.rs          # Shared git types (Commit, Branch, Status, LFS, Forge, etc.)
      lfs.rs            # LFS operations (version, track, prune, ls-files)
      forge.rs          # Forge detection, keychain token ops, PR API calls
      profile.rs        # ActiveProfile type
    error.rs            # Error types, Tauri-compatible serialization
```

### IPC Boundary Rules
- **Read operations** (status, log, diff, branch list): use `git2-rs` via the repository wrapper
- **Write operations** (commit, push, fetch, pull, checkout, rebase): use `git CLI subprocess`
- **All git ops are async**: Rust spawns work, streams progress to React via Tauri events
- **git2-rs fallback**: If git2-rs fails on a read op, fall back to CLI. Log the fallback for debugging.
- **Thread safety**: `git2::Repository` is NOT Send/Sync. Wrap in `tokio::sync::RwLock`. Background fetch thread and UI reads must coordinate through this lock.

### UI Patterns
- **Layout**: Three-panel — left sidebar (branches), center (commit graph), right (detail/diff)
- **Commit graph**: Canvas API, virtualized. NOT React DOM nodes.
- **Diffs (read-only)**: Currently plain HTML with grouped hunks. Shiki upgrade planned (#4).
- **Diffs (interactive staging)**: Currently file-level only. CodeMirror 6 hunk/line staging planned (#5).
- **Errors**: Toast notifications, bottom-right. All error types.
- **Theme**: Dark mode only.

## Agentic Workflow

### Before Implementing Any Feature

1. **Read the brief**: Always check `GITCLIENT_PROJECT_BRIEF.md` for the spec of whatever you're building. Don't reinvent decisions that are already made.
2. **Check ARCHITECTURE.md**: Once it exists, check it for where new code should live. If it doesn't cover your case, update it after implementation.
3. **Check existing code**: Search for existing utilities, types, and patterns before creating new ones. Reuse > reinvent.

### Implementation Cycle

For every feature or change, follow this cycle:

```
1. UNDERSTAND  ->  Read spec, find related code, identify affected files
2. IMPLEMENT   ->  Write the code, following architecture rules above
3. VERIFY      ->  Run all checks (see below)
4. SCREENSHOT  ->  For UI changes: navigate to localhost:5173, take screenshot, review visually
5. DEMO        ->  Only present to user after verification + visual check passes
```

### Verification Checklist (run before presenting work)

**Rust backend:**
```bash
cd src-tauri
cargo check                    # Type checking
cargo clippy -- -D warnings    # Lint (treat warnings as errors)
cargo fmt -- --check           # Format check
cargo test                     # Run tests
```

**Frontend:**
```bash
npm run typecheck              # tsc --noEmit (or equivalent)
npm run lint                   # ESLint
npm run build                  # Vite build succeeds
```

**Integration (when Tauri app exists):**
```bash
cargo tauri build --debug      # Full app builds
```

**Visual verification (for any UI change):**

After code checks pass, verify the UI looks correct using Playwright MCP:

1. Ensure `npm run tauri dev` is running (the Vite dev server serves at `http://localhost:5173`)
2. Navigate Playwright to `http://localhost:5173`
3. Take a screenshot via `mcp__plugin_playwright_playwright__browser_take_screenshot`
4. Review the screenshot yourself — check for:
   - Layout correctness (panels visible, correct proportions)
   - Dark theme applied (dark background, light text, no white flash)
   - No visual breakage (overlapping elements, missing borders, broken spacing)
   - Text content renders correctly (no missing fonts, no clipped text)
5. If the UI looks wrong, fix it before presenting to the user
6. Include the screenshot when presenting work so the user can see the result

**When to screenshot:**
- Any change to layout components, CSS, or theme
- New UI components or panels
- After adding shadcn/ui components
- NOT needed for Rust-only backend changes

**Do NOT present work to the user until ALL applicable checks pass.** If a check fails, fix it first. If you can't fix it, explain what's broken and why.

### Testing Strategy

- **Rust git operations**: Integration tests against temp git repos. Create a repo in a temp dir, run operations, assert state. Use `tempfile` crate.
- **Graph algorithm**: Snapshot/golden tests. Given a topology (defined as parent relationships), assert expected lane assignments.
- **React components**: Component tests where valuable. Don't test shadcn primitives — test custom logic.
- **No E2E tests in MVP**: Too much overhead for a solo project. Rely on the Rust + component tests and manual verification.

### When Adding a New Tauri Command

1. Define the command function in the appropriate file under `src-tauri/src/commands/`
2. Register it in `src-tauri/src/lib.rs` (or `main.rs`) via `.invoke_handler()`
3. Add the TypeScript wrapper in `src/lib/commands.ts` (typed invoke call)
4. Add the return type to `src/types/`
5. Run verification checklist

### When Adding a New React Component

1. Use shadcn/ui primitives where possible (`npx shadcn-ui@latest add <component>`)
2. Place in `src/components/` with kebab-case filename
3. Co-locate component-specific types in the same file (export separately if shared)
4. Use Zustand store for state that needs to persist across components
5. Run verification checklist

## Context Compaction

When compacting, always preserve:
- List of modified files and their purposes
- Current task state and next steps
- Test commands used and their results
- Key decisions made during the session
- Which docs were already read (so they don't get re-read)
- Current feature being implemented (reference brief section)
- Any git2-rs limitations encountered and workarounds used

## Git Workflow

### Branching model: main / dev
- **`dev`** — default branch. All feature work targets `dev`. Push here freely.
- **`main`** — stable releases only. Merge `dev` → `main` when features are complete, tested, and version is bumped. Releases auto-trigger from `main` (CI tags + builds installers).
- **Feature branches** — optional. For larger features, branch off `dev` (e.g. `feat/hunk-staging`), PR back into `dev`. For smaller changes, commit directly to `dev`.
- **No direct pushes to `main`** — always merge from `dev` via PR or local merge.

### Commits
- Imperative mood, concise, explain the "why"
- Reference GitHub issues: `feat: add LFS pull with progress (#1)`
- Close issues via commit message when appropriate: `Closes #1`
- Don't push unless asked

### Releasing
1. Ensure all target milestone issues are closed
2. Bump version in `package.json` and `src-tauri/tauri.conf.json`
3. Merge `dev` → `main`
4. Tag: `git tag v0.X.0` + push tag
5. CI builds installers + creates GitHub release automatically
