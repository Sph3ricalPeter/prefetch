use crate::events;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tracing::debug;

/// Watches the `.git/` directory for changes and emits `repo_changed` events.
///
/// Debounces filesystem events (500ms) to avoid flooding the frontend
/// during git operations that touch many files rapidly.
pub struct RepoWatcher {
    /// Kept alive to maintain the watch — dropped when RepoWatcher is dropped,
    /// which disconnects the channel and stops the debounce thread.
    _watcher: RecommendedWatcher,
}

impl RepoWatcher {
    /// Start watching the given repository for `.git/` changes.
    ///
    /// Spawns a background thread that debounces events and emits
    /// `repo_changed` events to the Tauri frontend.
    pub fn start(repo_path: &str, app_handle: AppHandle) -> Result<Self, String> {
        let git_dir = Path::new(repo_path).join(".git");
        if !git_dir.exists() {
            return Err("Not a git repository".to_string());
        }

        let (tx, rx) = mpsc::channel();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    tx.send(event).ok();
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create watcher: {e}"))?;

        // Watch .git/ non-recursively to catch HEAD, index, FETCH_HEAD
        watcher
            .watch(&git_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch .git: {e}"))?;

        // Watch .git/refs/ recursively to catch branch and tag changes
        let refs_dir = git_dir.join("refs");
        if refs_dir.exists() {
            watcher
                .watch(&refs_dir, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch .git/refs: {e}"))?;
        }

        let git_dir_owned = git_dir.to_path_buf();
        thread::spawn(move || {
            Self::debounce_loop(rx, &git_dir_owned, &app_handle);
        });

        Ok(Self { _watcher: watcher })
    }

    /// Receives raw filesystem events, debounces them, classifies the change
    /// type, and emits a single `repo_changed` event after 500ms of quiet.
    fn debounce_loop(rx: mpsc::Receiver<Event>, git_dir: &Path, app: &AppHandle) {
        let debounce_duration = Duration::from_millis(500);
        let mut last_emit = Instant::now() - debounce_duration;
        let mut pending: Option<ChangeType> = None;

        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(event) => {
                    if let Some(ct) = Self::classify_event(&event, git_dir) {
                        // Upgrade pending change type (Head > Refs > Status)
                        pending = Some(match (&pending, &ct) {
                            (Some(ChangeType::Head), _) | (_, ChangeType::Head) => ChangeType::Head,
                            (Some(ChangeType::Refs), _) | (_, ChangeType::Refs) => ChangeType::Refs,
                            _ => ct,
                        });
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(ref ct) = pending {
                        if last_emit.elapsed() >= debounce_duration {
                            let payload = match ct {
                                ChangeType::Status => "Status",
                                ChangeType::Refs => "Refs",
                                ChangeType::Head => "Head",
                            };
                            debug!(change_type = payload, "watcher: emitting repo_changed");
                            app.emit(events::REPO_CHANGED, payload).ok();
                            last_emit = Instant::now();
                            pending = None;
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    /// Classify a filesystem event into a change type based on which
    /// `.git/` file was modified.
    fn classify_event(event: &Event, git_dir: &Path) -> Option<ChangeType> {
        for path in &event.paths {
            if let Ok(rel) = path.strip_prefix(git_dir) {
                let rel_str = rel.to_string_lossy();

                // Skip lock files — they're transient
                if rel_str.ends_with(".lock") {
                    continue;
                }

                if rel_str == "HEAD" {
                    debug!(file = %rel_str, "watcher: detected Head change");
                    return Some(ChangeType::Head);
                }
                if rel_str.starts_with("refs")
                    || rel_str == "FETCH_HEAD"
                    || rel_str == "packed-refs"
                {
                    debug!(file = %rel_str, "watcher: detected Refs change");
                    return Some(ChangeType::Refs);
                }
                if rel_str == "index" {
                    debug!(file = %rel_str, "watcher: detected Status change");
                    return Some(ChangeType::Status);
                }
            }
        }
        None
    }
}

#[derive(Clone)]
enum ChangeType {
    /// Working tree / staging area changed (index file)
    Status,
    /// Branch or tag refs changed
    Refs,
    /// HEAD pointer changed (checkout)
    Head,
}
