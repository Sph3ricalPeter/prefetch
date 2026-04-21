use crate::events;
use std::process::Command;

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
                let mut cmd = Command::new("git");
                cmd.args(["fetch", "--all", "--prune"])
                    .current_dir(&repo_path);
                hide_console_window(&mut cmd);
                let result = cmd.output();

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
