use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub parent_ids: Vec<String>,
    pub co_authors: Vec<CoAuthor>,
    pub lane: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct CoAuthor {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub from_row: usize,
    pub from_lane: usize,
    pub to_row: usize,
    pub to_lane: usize,
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, Serialize)]
pub enum EdgeType {
    Straight,
    Merge,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub commits: Vec<CommitInfo>,
    pub edges: Vec<GraphEdge>,
    pub total_lanes: usize,
    /// The commit SHA that HEAD currently points to (works for both branch and detached HEAD).
    pub head_commit_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub commit_id: String,
    pub short_commit_id: String,
    /// Commits ahead of upstream (None if no upstream configured or remote branch).
    pub ahead: Option<u32>,
    /// Commits behind upstream (None if no upstream configured or remote branch).
    pub behind: Option<u32>,
    /// True when HEAD is an ancestor of this branch — rebasing would be a
    /// simple fast-forward (pointer move, no replay).
    pub can_fast_forward: bool,
    /// Short name of the upstream tracking branch (e.g. "origin/main"). None for remote branches or locals without an upstream.
    pub upstream_name: Option<String>,
    /// Path of the linked worktree this branch is checked out in, when that
    /// worktree is *not* the one currently open. Set means git will refuse both
    /// `checkout` and `branch -d` for this branch.
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeInfo {
    /// Path as git reports it (forward slashes, even on Windows).
    pub path: String,
    pub head: String,
    /// Branch shorthand, or None when the worktree has a detached HEAD.
    pub branch: Option<String>,
    /// True for the worktree the app currently has open.
    pub is_current: bool,
    /// True for the repository's main worktree (git lists it first).
    pub is_main: bool,
    /// Lock reason when locked. `Some("")` means locked without a reason.
    pub locked: Option<String>,
    /// Prune reason when the worktree's directory has gone missing.
    pub prunable: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
    /// For renames/copies: the pre-rename path. `path` is always the new path.
    pub old_path: Option<String>,
    pub status_type: String, // "modified", "added", "deleted", "renamed", "untracked", "conflicted"
    pub is_staged: bool,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub is_conflicted: bool,
    /// "both_modified", "both_added", "deleted_by_us", "deleted_by_them", etc.
    pub conflict_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub hunks: Vec<DiffHunk>,
    pub is_binary: bool,
    /// True when the diff exceeded MAX_DIFF_LINES and was truncated.
    #[serde(default)]
    pub is_truncated: bool,
    /// Total line count before truncation (0 when not truncated).
    #[serde(default)]
    pub total_lines: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    pub origin: char,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StashInfo {
    pub index: usize,
    pub message: String,
    pub commit_id: String,
    pub parent_commit_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub name: String,
    pub commit_id: String,
    pub message: Option<String>,
}

/// State of an in-progress merge, rebase, or cherry-pick.
#[derive(Debug, Clone, Serialize)]
pub struct ConflictState {
    pub in_progress: bool,
    /// "rebase", "cherry-pick", "merge", or ""
    pub operation: String,
}

/// Progress info for an in-progress rebase.
#[derive(Debug, Clone, Serialize)]
pub struct RebaseProgress {
    /// Current step (1-based).
    pub step: u32,
    /// Total number of steps.
    pub total: u32,
    /// The original commit message for the current step.
    pub message: String,
    /// Short commit hash for the current step.
    pub commit_id: String,
}

/// What rewording a commit would rewrite — shown before the user confirms.
#[derive(Debug, Clone, Serialize)]
pub struct RewordImpact {
    /// Why the commit can't be reworded, or `None` if it can.
    pub blocker: Option<String>,
    /// How many commits get rewritten (the target plus everything after it).
    pub commit_count: u32,
    /// Remote-tracking branches containing the commit — a force push is needed.
    pub pushed_to: Vec<String>,
    /// Other local branches and tags containing the commit. They keep pointing
    /// at the old commits, so history forks unless they're moved too.
    pub stranded_refs: Vec<String>,
}

/// The three versions of a conflicted file for merge resolution.
#[derive(Debug, Clone, Serialize)]
pub struct ConflictContents {
    /// Base (common ancestor) — None if file didn't exist in base.
    pub base: Option<String>,
    /// Ours (current branch version).
    pub ours: String,
    /// Theirs (incoming branch version).
    pub theirs: String,
    /// Short commit hash for ours (HEAD).
    pub ours_commit_id: String,
    /// Short commit hash for theirs (MERGE_HEAD / REBASE_HEAD).
    pub theirs_commit_id: String,
    /// Branch name for ours (current branch).
    pub ours_branch: String,
    /// Branch or ref name for theirs (incoming).
    pub theirs_branch: String,
    /// During rebase: subject line of the commit being replayed.
    pub rebase_commit_message: Option<String>,
    /// True if the conflicted file is binary (e.g. an image). When set, the
    /// text fields (`base`/`ours`/`theirs`) are empty — binary content is never
    /// shipped as a lossy UTF-8 string, and the UI shows a binary resolver
    /// instead of the line-by-line conflict editor.
    pub is_binary: bool,
    /// Base64-encoded "ours" blob, populated only for binary image files so the
    /// UI can preview the two versions. `None` for text or non-image binaries.
    pub ours_image: Option<String>,
    /// Base64-encoded "theirs" blob, populated only for binary image files.
    pub theirs_image: Option<String>,
}

/// Describes the last undoable action from the reflog.
#[derive(Debug, Clone, Serialize)]
pub struct UndoAction {
    /// Human-readable description (e.g. "Undo commit: fix bug")
    pub description: String,
    /// Whether an undo is possible
    pub can_undo: bool,
}

// ── Forge (GitHub / GitLab) types ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ForgeKind {
    GitHub,
    GitLab,
    Bitbucket,
}

/// Detected information about the remote forge (GitHub or GitLab instance).
#[derive(Debug, Clone, Serialize)]
pub struct ForgeConfig {
    pub kind: ForgeKind,
    /// Hostname, e.g. "github.com" or a self-hosted GitLab domain
    pub host: String,
    pub owner: String,
    pub repo: String,
}

/// A pull request / merge request on the remote forge.
#[derive(Debug, Clone, Serialize)]
pub struct PrInfo {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// "open", "closed", or "merged"
    pub state: String,
}

/// A repository from the forge API (GitHub/GitLab).
#[derive(Debug, Clone, Serialize)]
pub struct ForgeRepo {
    pub name: String,
    pub full_name: String,
    pub clone_url_https: String,
    pub clone_url_ssh: Option<String>,
    pub description: Option<String>,
    pub is_private: bool,
    pub updated_at: String,
}

// ── CI types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStatus {
    Queued,
    InProgress,
    Success,
    /// Job failed but was allowed to fail (`allow_failure` in GitLab).
    Warning,
    Failure,
    Cancelled,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct Pipeline {
    pub id: u64,
    /// Human-readable label — workflow name (GitHub Actions) or `None` (GitLab).
    pub name: Option<String>,
    /// What triggered this pipeline — e.g. "push", "pull_request", "schedule",
    /// "merge_request_event", "web", "workflow_dispatch", etc.
    pub source: Option<String>,
    /// Name/description of the schedule that triggered this pipeline, if any.
    /// GitLab only links each schedule to its most recent pipeline, so this is
    /// populated for the latest run of a schedule and `None` otherwise.
    pub schedule_name: Option<String>,
    pub status: PipelineStatus,
    pub branch: String,
    pub commit_sha: String,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub duration_secs: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CiJob {
    pub id: u64,
    pub name: String,
    pub status: PipelineStatus,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration_secs: Option<u64>,
}

// ── LFS types ─────────────────────────────────────────────────────────────────

/// A single pattern being tracked by git-lfs (from .gitattributes).
#[derive(Debug, Clone, Serialize)]
pub struct LfsTrackPattern {
    /// The glob pattern, e.g. "*.psd"
    pub pattern: String,
    /// Which .gitattributes file declares this (usually ".gitattributes")
    pub source: String,
}

/// Metadata for a single LFS-managed file.
#[derive(Debug, Clone, Serialize)]
pub struct LfsFileInfo {
    pub oid: String,
    pub path: String,
    /// Size in bytes of the actual object (not the pointer file)
    pub size: u64,
}

/// Aggregate LFS status for the open repository.
#[derive(Debug, Clone, Serialize)]
pub struct LfsInfo {
    /// Whether the `git-lfs` binary is available on PATH
    pub installed: bool,
    /// Whether LFS hooks are installed in this repository (`git lfs install --local` has run)
    pub initialized: bool,
    /// Version string from `git lfs version`, e.g. "git-lfs/3.5.1"
    pub version: Option<String>,
    /// Patterns declared in .gitattributes with filter=lfs
    pub tracked_patterns: Vec<LfsTrackPattern>,
    /// Number of LFS-managed files in the working tree
    pub file_count: usize,
    /// Total byte size of all LFS objects on disk
    pub total_size: u64,
}

// ── Git identity ─────────────────────────────────────────────────────────────

/// The resolved git user identity and where it came from.
#[derive(Debug, Clone, Serialize)]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
    /// Where the identity was resolved from: "local", "global", "system", or "unknown"
    pub source: String,
}
