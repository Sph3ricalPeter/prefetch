# Prefetch

**GitKraken UX, Linear design, MIT licensed, no subscription.**

A desktop git client built for developers who want a visual commit graph, profile-based multi-account support, and a fast native app — without a monthly subscription.

<!-- Screenshot coming soon -->

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Tauri v2 (Rust) |
| Git backend | git CLI subprocess (mutations) + git2-rs (fast reads) |
| Frontend | React + TypeScript |
| UI components | shadcn/ui + Tailwind CSS |
| Commit graph | Canvas API (virtualized) |
| Diff view | Shiki (read-only) + CodeMirror 6 (interactive staging) |
| State | Zustand |
| Local persistence | SQLite via Tauri plugin |

## Getting Started

huuuh

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.77+
- Platform-specific Tauri dependencies: [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## License

[MIT](LICENSE)
