use serde::Serialize;

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
}

#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
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
