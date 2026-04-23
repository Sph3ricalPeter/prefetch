use crate::git::forge;
use crate::git::profile::ActiveProfile;
use crate::git::repository::profile_env;
use std::process::Command;
use tracing::debug;

/// Configure a Command to hide the console window on Windows.
#[cfg(target_os = "windows")]
fn hide_console_window(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000) // CREATE_NO_WINDOW
}

#[cfg(not(target_os = "windows"))]
fn hide_console_window(cmd: &mut Command) -> &mut Command {
    cmd
}
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// The fetcher runs in a separate thread and checks the stop flag
    /// every second so it can shut down quickly when the repo changes.
    /// `active_profile` is cloned at start time; if the profile changes,
    /// the fetcher must be stopped and restarted.
    pub fn start(
        repo_path: String,
        _app: AppHandle,
        active_profile: Option<ActiveProfile>,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();
        let env_vars = profile_env(&active_profile);
        let pid = active_profile.as_ref().map(|p| p.profile_id.clone());

        thread::spawn(move || {
            // Wait 5 minutes between fetches, checking stop flag each second
            loop {
                for _ in 0..300 {
                    if stop_clone.load(Ordering::Relaxed) {
                        return;
                    }
                    thread::sleep(Duration::from_secs(1));
                }

                if stop_clone.load(Ordering::Relaxed) {
                    return;
                }

                // Run git fetch, injecting forge credentials for HTTPS remotes
                // and profile env vars for SSH key injection
                let mut cmd = Command::new("git");
                for (k, v) in &env_vars {
                    cmd.env(k, v);
                }
                if let Some(authed) = forge::authenticated_remote_url(&repo_path, pid.as_deref()) {
                    // Suppress GCM to prevent caching of embedded credentials
                    for (k, v) in &authed.extra_env {
                        cmd.env(k, v);
                    }
                    // -c flags must come before the subcommand
                    let mut args: Vec<String> = authed.extra_args.clone();
                    args.extend([
                        "fetch".to_string(),
                        authed.url.clone(),
                        "--prune".to_string(),
                    ]);
                    cmd.args(&args);
                } else {
                    cmd.args(["fetch", "--all", "--prune"]);
                }
                cmd.current_dir(&repo_path);
                hide_console_window(&mut cmd);
                let result = cmd.output();

                if let Ok(output) = result {
                    if output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        if !stderr.trim().is_empty() {
                            debug!("background fetch got new data");
                            // No need to emit REPO_CHANGED — the file watcher
                            // already detects .git/FETCH_HEAD and ref changes
                            // from the fetch. Emitting here would cause a
                            // redundant double reload.
                        }
                    }
                }
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
