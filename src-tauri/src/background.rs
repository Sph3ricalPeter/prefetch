use crate::events;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

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
    pub fn start(repo_path: String, app: AppHandle) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();

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

                // Run git fetch
                let result = Command::new("git")
                    .args(["fetch", "--all", "--prune"])
                    .current_dir(&repo_path)
                    .output();

                if let Ok(output) = result {
                    if output.status.success() {
                        // Only emit if fetch actually got something
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        if !stderr.trim().is_empty() {
                            app.emit(events::REPO_CHANGED, "Refs").ok();
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
