use crate::git::exec::profile_env;
use crate::git::profile::ActiveProfile;
use crate::git::repository;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// Repo path → unix-millis of its last *successful* fetch (`None` = never, as
/// far as we know).
///
/// Git truncates `.git/FETCH_HEAD` before it talks to the remote, so once
/// we've attempted a fetch its mtime is no longer evidence that one succeeded.
/// The map is seeded from that mtime when a fetcher starts — before anything
/// can clobber it — and only moves forward on success after that.
static LAST_FETCH: Mutex<BTreeMap<String, Option<u64>>> = Mutex::new(BTreeMap::new());

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Unix-millis mtime of `.git/FETCH_HEAD`, the best guess for fetches that
/// happened before this session.
fn fetch_head_mtime_ms(repo_path: &str) -> Option<u64> {
    // `Repository::path()` is per-worktree, which matches FETCH_HEAD's scope.
    let git_dir = git2::Repository::open(repo_path).ok()?.path().to_path_buf();
    let mtime = std::fs::metadata(git_dir.join("FETCH_HEAD"))
        .ok()?
        .modified()
        .ok()?;
    Some(mtime.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// Take the pre-fetch reading of FETCH_HEAD's mtime, once per repo per session.
fn seed_last_fetch(repo_path: &str) {
    if let Ok(mut map) = LAST_FETCH.lock() {
        map.entry(repo_path.to_string())
            .or_insert_with(|| fetch_head_mtime_ms(repo_path));
    }
}

/// Record a successful fetch. Called from `repository::fetch_all`, so the
/// toolbar button and the background loop both land here.
pub fn mark_fetched(repo_path: &str) {
    if let Ok(mut map) = LAST_FETCH.lock() {
        map.insert(repo_path.to_string(), Some(now_ms()));
    }
}

/// Unix-millis of the last fetch, or `None` if this repo has never been
/// fetched successfully.
pub fn last_fetch_ms(repo_path: &str) -> Option<u64> {
    match LAST_FETCH
        .lock()
        .ok()
        .and_then(|m| m.get(repo_path).copied())
    {
        Some(known) => known,
        None => fetch_head_mtime_ms(repo_path),
    }
}

/// True when the last fetch is older than `interval` seconds (or never happened).
/// `abs_diff`, not subtraction: a FETCH_HEAD mtime in the future (clock skew,
/// cloud-synced folder) counts as due rather than pinning us at "not due".
fn fetch_is_due(repo_path: &str, interval_secs: u64) -> bool {
    let Some(last) = last_fetch_ms(repo_path) else {
        return true;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    now.abs_diff(last) >= interval_secs * 1000
}

/// How recent a fetch has to be to suppress the one on repo open when the
/// recurring loop is switched off. With the loop on, its interval is used.
const LOOP_OFF_STARTUP_GUARD_SECS: u64 = 300;

/// Repos with a background fetch running right now. Guards against two
/// fetches of the *same* repo overlapping: the fetcher is restarted on repo
/// open and again when profile auto-switch fires, and `Drop` only sets a stop
/// flag — it can't kill a `git fetch` that's already running. Keyed by repo so
/// switching to another repo mid-fetch still gets its own startup fetch.
static FETCHING: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

struct InFlight(String);

impl InFlight {
    /// `None` when this repo is already being fetched.
    fn acquire(repo_path: &str) -> Option<Self> {
        let mut fetching = FETCHING.lock().ok()?;
        fetching
            .insert(repo_path.to_string())
            .then(|| InFlight(repo_path.to_string()))
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        if let Ok(mut fetching) = FETCHING.lock() {
            fetching.remove(&self.0);
        }
    }
}

/// Background thread that fetches once on start and then every `interval`
/// seconds. The file watcher picks up the resulting ref changes and emits
/// `repo_changed`.
pub struct BackgroundFetcher {
    stop: Arc<AtomicBool>,
}

impl BackgroundFetcher {
    /// Start a background fetch loop for the given repo.
    ///
    /// The fetcher runs in a separate thread and checks the stop flag every
    /// second so it can shut down quickly when the repo changes.
    /// `interval` is a shared `Arc<AtomicU64>` (seconds); write to it from any
    /// thread to change the fetch cadence at runtime. Pass 0 to disable the
    /// recurring loop — the fetch on start still runs.
    /// `active_profile` is cloned at start time; if the profile changes,
    /// the fetcher must be stopped and restarted.
    pub fn start(
        repo_path: String,
        _app: AppHandle,
        active_profile: Option<ActiveProfile>,
        interval: Arc<AtomicU64>,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();
        let interval_clone = Arc::clone(&interval);
        let mut env_vars = profile_env(&active_profile);
        // Nobody is watching an unattended fetch, so never let git block on a
        // credential prompt — it would hang the thread (and its in-flight
        // guard) for the rest of the session. The manual fetch keeps prompts.
        env_vars.push(("GIT_TERMINAL_PROMPT".into(), "0".into()));
        env_vars.push(("GCM_INTERACTIVE".into(), "never".into()));
        let pid = active_profile.as_ref().map(|p| p.profile_id.clone());

        thread::spawn(move || {
            seed_last_fetch(&repo_path);

            // Same fetch the toolbar button runs — explicit refspecs, so
            // refs/remotes/* actually moves and not just FETCH_HEAD — minus the
            // tag mirroring. We don't inspect the result: the file watcher
            // already detects the resulting ref changes, so emitting
            // REPO_CHANGED here would cause a redundant double reload.
            let fetch_once = || {
                let Some(_guard) = InFlight::acquire(&repo_path) else {
                    return;
                };
                let _ = repository::fetch_all(&repo_path, |_| {}, &env_vars, pid.as_deref(), false);
            };

            // Fetch straight away on repo open / profile switch, so the graph
            // isn't stale for a whole interval. The interval setting governs
            // the recurring loop only — opening a repo fetches even when the
            // loop is off. Still skipped when a fetch already happened
            // recently: reopening a repo or flipping profiles shouldn't hammer
            // the remote.
            let startup_guard_secs = match interval_clone.load(Ordering::Relaxed) {
                0 => LOOP_OFF_STARTUP_GUARD_SECS,
                secs => secs,
            };
            if !stop_clone.load(Ordering::Relaxed) && fetch_is_due(&repo_path, startup_guard_secs) {
                fetch_once();
            }

            // Tick once per second; fetch after `interval` ticks.
            // Reads the interval atomically on every tick so runtime changes
            // take effect within one second.
            let mut elapsed: u64 = 0;
            loop {
                thread::sleep(Duration::from_secs(1));
                if stop_clone.load(Ordering::Relaxed) {
                    return;
                }

                let secs = interval_clone.load(Ordering::Relaxed);
                if secs == 0 {
                    // Disabled — reset counter so re-enabling starts a fresh
                    // countdown rather than firing immediately.
                    elapsed = 0;
                    continue;
                }

                elapsed += 1;
                if elapsed < secs {
                    continue;
                }
                elapsed = 0;

                if stop_clone.load(Ordering::Relaxed) {
                    return;
                }

                fetch_once();
            }
        });

        Self { stop }
    }
}

impl Drop for BackgroundFetcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_fetch_guard() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        let repo = git2::Repository::init(path).unwrap();

        // Never fetched → due.
        assert!(last_fetch_ms(path).is_none());
        assert!(fetch_is_due(path, 300));

        // Fetched before this session (FETCH_HEAD on disk, nothing seeded yet)
        // → not due until the interval elapses.
        std::fs::write(repo.path().join("FETCH_HEAD"), "").unwrap();
        assert!(last_fetch_ms(path).is_some());
        assert!(!fetch_is_due(path, 300));
    }

    /// A failed fetch still rewrites FETCH_HEAD, so the seeded reading — not
    /// the mtime — has to drive the next decision.
    #[test]
    fn failed_fetch_does_not_count_as_fetched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        let repo = git2::Repository::init(path).unwrap();

        seed_last_fetch(path); // never fetched at seed time
        std::fs::write(repo.path().join("FETCH_HEAD"), "").unwrap(); // failed attempt
        assert!(last_fetch_ms(path).is_none());
        assert!(fetch_is_due(path, 300));

        mark_fetched(path);
        assert!(last_fetch_ms(path).is_some());
        assert!(!fetch_is_due(path, 300));
    }

    #[test]
    fn in_flight_flag_excludes_a_second_fetch_of_the_same_repo() {
        let first = InFlight::acquire("/repo/a").unwrap();
        assert!(InFlight::acquire("/repo/a").is_none());
        // A different repo is free to fetch concurrently.
        assert!(InFlight::acquire("/repo/b").is_some());
        drop(first);
        assert!(InFlight::acquire("/repo/a").is_some());
    }
}
