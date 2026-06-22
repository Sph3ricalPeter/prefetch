use crate::git::exec::{profile_env, run_git};
use crate::git::forge;
use crate::git::profile::ActiveProfile;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

/// Background thread that runs `git fetch --all --prune` every 5 minutes
/// and emits a `repo_changed` event when new data arrives.
pub struct BackgroundFetcher {
    stop: Arc<AtomicBool>,
}

impl BackgroundFetcher {
    /// Start a background fetch loop for the given repo.
    ///
    /// The fetcher runs in a separate thread and checks the stop flag every
    /// second so it can shut down quickly when the repo changes.
    /// `interval` is a shared `Arc<AtomicU64>` (seconds); write to it from
    /// any thread to change the fetch cadence at runtime. Pass 0 to disable.
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
        let env_vars = profile_env(&active_profile);
        let pid = active_profile.as_ref().map(|p| p.profile_id.clone());

        thread::spawn(move || {
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

                // Run git fetch through the invocation seam, injecting forge
                // credentials for HTTPS remotes and profile env vars for SSH key
                // injection. We don't inspect the result: the file watcher already
                // detects the resulting .git/FETCH_HEAD and ref changes, so
                // emitting REPO_CHANGED here would cause a redundant double reload.
                let mut env = env_vars.clone();
                let args: Vec<String> = if let Some(authed) =
                    forge::authenticated_remote_url(&repo_path, pid.as_deref())
                {
                    // Suppress GCM to prevent caching of embedded credentials.
                    env.extend(authed.extra_env.iter().cloned());
                    // -c flags must come before the subcommand.
                    let mut args = authed.extra_args.clone();
                    args.extend(["fetch".into(), authed.url.clone(), "--prune".into()]);
                    args
                } else {
                    vec!["fetch".into(), "--all".into(), "--prune".into()]
                };
                let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                let _ = run_git(&repo_path, &arg_refs, &env);
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
