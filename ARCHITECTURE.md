# Architecture

> Canonical reference for how Prefetch is structured. Read this before making changes.

## Directory Structure

```
prefetch/
├── index.html                          # Entry point, class="dark" on <html>
├── package.json                        # Frontend deps + scripts
├── vite.config.ts                      # Tailwind (first), React, @/ alias
├── components.json                     # shadcn/ui configuration
├── tsconfig.json                       # TS project references
├── tsconfig.app.json                   # App TS config with @/* path alias
├── tsconfig.node.json                  # Node TS config (vite, etc.)
├── eslint.config.js                    # ESLint config
│
├── src/                                # React frontend
│   ├── main.tsx                        # React entry point
│   ├── App.tsx                         # Root component → AppLayout
│   ├── index.css                       # Tailwind v4 + shadcn dark theme tokens
│   ├── vite-env.d.ts                   # Vite type declarations
│   ├── components/
│   │   ├── ui/                         # shadcn/ui primitives (resizable, etc.)
│   │   └── layout/                     # App layout components
│   │       ├── app-layout.tsx          # Three-panel ResizablePanel shell
│   │       ├── sidebar-panel.tsx       # Left: branch list (placeholder)
│   │       ├── graph-panel.tsx         # Center: commit graph (placeholder)
│   │       └── detail-panel.tsx        # Right: commit detail/diff (placeholder)
│   ├── hooks/                          # Custom React hooks
│   ├── stores/                         # Zustand stores
│   ├── lib/
│   │   └── utils.ts                    # cn() utility for Tailwind class merging
│   └── types/                          # TypeScript types
│
├── src-tauri/                          # Rust backend
│   ├── Cargo.toml                      # Rust dependencies
│   ├── tauri.conf.json                 # Tauri app config (window, bundle, etc.)
│   ├── build.rs                        # Tauri build script
│   ├── capabilities/
│   │   └── default.json                # Plugin permissions
│   ├── icons/                          # App icons (placeholder)
│   └── src/
│       ├── main.rs                     # Desktop entry point (calls lib::run)
│       ├── lib.rs                      # App setup: plugin registration, modules
│       ├── error.rs                    # AppError enum with Serialize impl
│       ├── events.rs                   # IPC event name constants
│       ├── commands/
│       │   └── mod.rs                  # Tauri command handlers (per domain)
│       └── git/
│           └── mod.rs                  # Git abstraction layer
│
├── CLAUDE.md                           # Claude Code working rules
├── GITCLIENT_PROJECT_BRIEF.md          # Full product spec & roadmap
├── ARCHITECTURE.md                     # This file
└── LICENSE                             # MIT
```

## IPC Boundary

```
React UI  ←── Tauri IPC (commands + events) ──→  Rust backend
   │                                                    │
   │  invoke('command_name', {args})                     │  Returns Result<T, AppError>
   │  listen('event_name', handler)                      │  Emits via app.emit()
```

### Rules
- **Read operations** (status, log, diff, branch list) → `git2-rs` via the git module
- **Write operations** (commit, push, fetch, pull, checkout) → `git CLI subprocess`
- **All operations are async** — Rust spawns work, streams progress via Tauri events
- **git2-rs fallback** — if git2-rs fails on a read, fall back to CLI and log it
- **Thread safety** — `git2::Repository` is NOT Send/Sync → wrap in `tokio::sync::RwLock`

### Adding a New Tauri Command
1. Create handler function in `src-tauri/src/commands/<domain>.rs`
2. Re-export from `src-tauri/src/commands/mod.rs`
3. Register in `src-tauri/src/lib.rs` via `.invoke_handler(tauri::generate_handler![...])`
4. Add TypeScript wrapper in `src/lib/commands.ts` (typed invoke call)
5. Add return type to `src/types/`

## Plugins

| Plugin | Purpose | When Used |
|--------|---------|-----------|
| `tauri-plugin-sql` (SQLite) | Repo list, UI state cache, cached git status | MVP |
| `tauri-plugin-fs` (watch) | File system monitoring for `.git/` changes | MVP |
| `tauri-plugin-os` | OS detection for platform-specific behavior | MVP |
| `tauri-plugin-keyring` | OAuth token storage per profile (OS keychain) | v0.2 (Profiles) |

## UI Patterns

- **Layout**: Three-panel — left sidebar, center graph, right detail
- **Commit graph**: Canvas API, virtualized (NOT React DOM)
- **Diffs (read-only)**: Shiki
- **Diffs (interactive staging)**: CodeMirror 6
- **State management**: Zustand
- **Errors**: Toast notifications (bottom-right)
- **Theme**: Dark mode only

## Development Commands

```bash
# Run dev mode
npm run tauri dev

# Frontend only
npm run dev              # Vite dev server
npm run build            # tsc + vite build
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint

# Rust only (from src-tauri/)
cargo check              # Type checking
cargo clippy -- -D warnings  # Lint
cargo fmt -- --check     # Format check
cargo test               # Tests

# Full app build
npm run tauri build
```
