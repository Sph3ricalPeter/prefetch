# Release config

Read by the user-level `release` skill. Overrides its generic defaults.

## Version
Lives in three files that must match (CLAUDE.md "Releasing"):
- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"` — what Tauri stamps on the installers
  and what the updater compares against `latest.json`
- `src-tauri/Cargo.toml` → `version`

Bump:
```bash
npm version <x.y.z> --no-git-tag-version   # package.json + package-lock.json
# edit tauri.conf.json and Cargo.toml by hand
(cd src-tauri && cargo check)               # rewrites the prefetch entry in Cargo.lock
```
Stage all five: `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`. Past bumps skipped
`package-lock.json` (stuck at 0.23.1) — harmless, but `npm version` fixes it.

Bump commit message: `chore: bump version to <x.y.z>` (no `release:` prefix —
the release workflow builds notes from `feat`/`fix` subjects only).

## Branch and deploy
Work happens on `dev`. Releases ship from `main`, fast-forward only:
```bash
git checkout main && git merge dev --ff-only   # refuses? fetch; still refuses → investigate, never force
git tag -a v<x.y.z> -m "..."
git push origin main dev --follow-tags
git checkout dev
```
Never push straight to `main` with new commits.

Pushing the `v*.*.*` tag runs `.github/workflows/release.yml`:
1. Builds Windows x64 (NSIS `.exe`) and macOS arm64 (`.dmg`, `.app.tar.gz`),
   signed for the updater, and publishes a **GitHub Release** "Prefetch vX.Y.Z"
   with `latest.json`. No Linux build.
2. Release body is auto-generated from the top 5 `feat:` then `fix:` subjects in
   `<prev tag>..<tag>` — the tag message is not the user-facing note, commit
   subjects are.
3. Commits `docs: update landing page version to vX.Y.Z` to `main`
   (`docs/index.html`, served by GitHub Pages), then fast-forward pushes
   `main` → `dev`.

Pushing `main` also runs `ci.yml` (typecheck, lint, check, build, clippy, fmt,
`tauri build` on 3 OSes).

## Checks
```bash
npm run typecheck && npm run lint && npm run check && npm run build
cd src-tauri && cargo clippy -- -D warnings && cargo fmt -- --check && cargo test
```

## Classifier
Conventional commits (`feat:` → minor, `fix:` → patch, `refactor:`/`docs:`/`chore:`
→ patch). Issue ids `(#N)` are GitHub Issues — `gh issue view N --json labels`;
`type: feature` / `enhancement` → minor, `bug` → patch. History bumps minor for
any `feat:`, patch otherwise. Pre-1.0: no majors.

## Commit convention
`<type>: <imperative subject> (#N)`, `Closes #N` in the body when it finishes
an issue.

## Breaker checks
- **Installed clients auto-update** from `latest.json`, so a bad release reaches
  everyone. Schema changes in `src/lib/database.ts` must be additive
  (`ALTER TABLE ... ADD COLUMN` in a try/catch, nullable or defaulted) — old
  rows and old DBs have to keep loading.
- **Destroying user work**: any path that resets, checks out, rebases or force
  pushes must stash or refuse on a dirty tree (see `bee5b5f`, `85aaff6`).
- **Windows**: long paths, CRLF, and spawning `git` without a console window —
  CI builds Windows but doesn't exercise it.
- **Build-time secrets**: `env!("GH_OAUTH_CLIENT_ID")` etc. fail the build if the
  release workflow doesn't pass the var; `option_env!` silently compiles in an
  empty string. A new forge/OAuth secret needs adding to both `ci.yml` and
  `release.yml`.
- **CSP** in `tauri.conf.json`: a new external origin (avatars, API) works in
  `tauri dev` but is blocked in the bundled app if not listed.
- `git2::Repository` across threads without the `RwLock`; `unwrap()` in
  production Rust.

## Conventions checks
CLAUDE.md covers it: type scale (no `text-[Npx]`), `font-mono` only for
diff/code, no inline styles, no `any`, read ops via git2 / write ops via CLI,
new Tauri commands registered in `lib.rs` + typed in `src/lib/commands.ts`.

## Verify
```bash
gh run list --limit 3                      # Release + CI both green; on failure: gh run view <id> --log-failed
gh release view v<x.y.z> --json assets --jq '.assets[].name'   # .exe, .dmg, .app.tar.gz, .sig files, latest.json
curl -sL https://github.com/Sph3ricalPeter/prefetch/releases/latest/download/latest.json | grep '"version"'
curl -s https://sph3ricalpeter.github.io/prefetch/ | grep 'now available'
```
Release workflow takes ~12–15 min. `latest.json` only flips once every platform
has uploaded. The landing page updates after the workflow's docs commit plus a
Pages deploy (another minute or two). A failed release: fix, delete the tag
locally and on origin, re-tag.

## After release
- `git pull` on `dev` and `main` — CI pushed the landing-page commit to both. If
  `dev` moved during the release, the workflow's FF push no-ops: merge `main`
  into `dev` once by hand.
- Close shipped issues (`gh issue close N`) and the milestone if it's done.
- Running clients pick up the update on their own.
