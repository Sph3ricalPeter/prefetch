# Prefetch

**GitKraken UX, Linear design, MIT licensed, no subscription.**

> ⚠️ **Alpha software** — This is an early-stage project and **will** have bugs. Prefetch is primarily a personal GitKraken replacement built for my own workflow. Use at your own risk.

A desktop git client built for developers who want a visual commit graph, profile-based multi-account support, and a fast native app — without a monthly subscription.

<!-- Screenshot coming soon -->

## Install

Download the latest release for your platform:

**[Download from GitHub Releases](https://github.com/Sph3ricalPeter/prefetch/releases/latest)**

| Platform | File |
|----------|------|
| Windows x64 | `Prefetch_x.x.x_x64-setup.exe` |
| macOS Apple Silicon | `Prefetch_x.x.x_aarch64.dmg` |
| macOS Intel | `Prefetch_x.x.x_x64.dmg` |

### Windows

1. Download the `.exe` installer
2. Run it — Windows SmartScreen may warn about an unsigned app, click "More info" → "Run anyway"
3. Installs to your user directory (no admin required)

### macOS

1. Download the `.dmg` for your chip (Apple Silicon = M1/M2/M3/M4, Intel = older Macs)
2. Open the `.dmg` and drag Prefetch to Applications
3. First launch: right-click → Open (macOS Gatekeeper blocks unsigned apps on first run)

## Features

- Visual commit graph with branch/tag badges
- File staging, diff viewer, commit with description
- Stash push/pop/drop
- Fetch, pull, push with live progress indicators
- Undo via reflog (Ctrl+Z)
- Cherry-pick, rebase, reset (soft/hard)
- Merge conflict detection with per-file Ours/Theirs resolution
- Force push with confirmation (--force-with-lease)
- Discard changes (per-file or all)
- Recent repos with quick-switch
- Background auto-fetch (every 5 min)
- File watcher for instant UI updates
- Smart remote branch checkout (auto-create tracking branch or reset to remote)
- Dark mode only, ~4MB installer

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Tauri v2 (Rust) — ~4MB installer |
| Git backend | git CLI subprocess (mutations) + git2-rs (fast reads) |
| Frontend | React 19 + TypeScript |
| UI components | shadcn/ui + Tailwind CSS v4 |
| Commit graph | Canvas API (virtualized) |
| State | Zustand |
| Local persistence | SQLite via Tauri plugin |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.77+
- Platform-specific Tauri dependencies: [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Run

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

### Release

Push a version tag to trigger the GitHub Actions release workflow:

```bash
git tag v0.1.1
git push origin v0.1.1
```

This builds Windows (.exe) and macOS (.dmg) installers and uploads them to GitHub Releases.

## Contributing

Contributions are **not accepted** at this time. This is a personal project and I'm not looking for outside contributions. Feel free to fork it and make it your own though!

## License

[MIT](LICENSE)
