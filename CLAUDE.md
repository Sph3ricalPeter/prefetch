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

### Code Standards
- **Rust**: Follow `cargo clippy` and `cargo fmt` conventions. No `unwrap()` in production code — use proper error handling with `thiserror` or `anyhow`.
- **TypeScript/React**: Strict mode. No `any` types. Functional components only. Use Zustand for state.
- **CSS**: Tailwind only via shadcn/ui. No inline styles, no CSS modules, no styled-components.
- **Naming**: Rust = snake_case. React components = PascalCase. Files = kebab-case for TS, snake_case for Rust.

## Architecture Quick Reference

```
src/                    # React frontend
  components/           # React components (shadcn/ui based)
  hooks/                # Custom React hooks
  stores/               # Zustand stores
  lib/                  # Utilities, IPC wrappers
  types/                # TypeScript types

src-tauri/
  src/
    main.rs             # Tauri entry point
    lib.rs              # App setup, plugin registration
    commands/           # Tauri IPC command handlers (one file per domain)
      mod.rs            # Re-exports all command modules
      git_status.rs     # Status, diff reads (git2-rs)
      git_mutations.rs  # Commit, push, fetch, pull (git CLI subprocess)
      repo.rs           # Repo open/close, recent repos
    git/                # Git abstraction layer
      mod.rs
      repository.rs     # git2-rs wrapper with RwLock
      cli.rs            # Git CLI subprocess runner
      types.rs          # Shared git types (Commit, Branch, Status, etc.)
    events.rs           # Event names and payloads for IPC events
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
- **Diffs (read-only)**: Shiki
- **Diffs (interactive staging)**: CodeMirror 6
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
4. DEMO        ->  Only present to user after verification passes
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

- Work on `main` for now (solo project)
- Commit messages: imperative mood, concise, explain the "why"
- Don't create feature branches unless asked
- Don't push unless asked
