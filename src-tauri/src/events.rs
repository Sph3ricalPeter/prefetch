/// Event emitted when the repository state changes (file watcher or background fetch).
/// Payload is a string: "Status", "Refs", or "Head".
pub const REPO_CHANGED: &str = "repo_changed";

/// Event emitted during fetch/pull/push with progress text.
pub const GIT_PROGRESS: &str = "git_progress";
